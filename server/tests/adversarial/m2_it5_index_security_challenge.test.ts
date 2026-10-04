import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { TemplateService, escapeHtml, sanitizeLinkUrl } from '../../src/services/template.service';
import { resetAuthRateLimiter } from '../../src/middleware/rateLimiter';
import { UserRole } from '../../src/types';

describe('Empirical Challenger M2-IT5: Index Uniqueness & Security Posture Battery', () => {
  function makeAuthToken(role: UserRole, firmId?: string | null, userId = 'usr-chal-it5'): string {
    return signToken({
      id: userId,
      email: `${role}@chal-firm.local`,
      fullName: `Challenger IT5 ${role}`,
      role,
      lawFirmId: firmId || null
    });
  }

  const superAdminToken = makeAuthToken('super_admin');
  const firmAdminToken = makeAuthToken('law_firm_admin', 'firm-CHAL-IT5');
  const otherFirmAdminToken = makeAuthToken('law_firm_admin', 'firm-OTHER-IT5');

  let testCase: any;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    testCase = await Case.create({
      name: 'M2 IT5 Index & Security Challenge Case',
      docketNumber: 'DOCK-IT5-2026',
      lawFirmId: 'firm-CHAL-IT5',
      settlementFundTotal: 50000.00,
      disbursementDeadline: new Date('2026-12-31T23:59:59.000Z'),
      fallbackPaymentMethod: 'physical_check',
      status: 'draft'
    });
  });

  // =========================================================================
  // 1. COMPOUND INDEX UNIQUENESS & CONCURRENCY STRESS TESTS
  // =========================================================================
  describe('1. Compound Index Uniqueness & Concurrency Stress on { caseId: 1, claimId: 1 }', () => {
    it('[IDX-01] Pre-initialized Mongoose compound unique index exists on Claimant collection', async () => {
      console.log('DIAGNOSTICS:', {
        workerFilepath: (globalThis as any).__vitest_worker__?.filepath,
        testPath: typeof expect !== 'undefined' && expect.getState ? expect.getState().testPath : undefined,
        poolId: process.env.VITEST_POOL_ID,
        workerId: process.env.VITEST_WORKER_ID,
        dbName: mongoose.connection.db?.databaseName
      });
      const indexes = await Claimant.collection.indexes();
      const compoundIndex = indexes.find(idx => idx.key?.caseId === 1 && idx.key?.claimId === 1);
      
      expect(compoundIndex).toBeDefined();
      expect(compoundIndex?.unique).toBe(true);
    });

    it('[IDX-02] Duplicate claimant commit collision returns HTTP 409 with specific message', async () => {
      // First commit: succeeds
      const claimantPayload = [
        {
          claimId: 'CLM-IT5-UNIQ-001',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice.smith@example.com',
          settlementAmount: 150.00
        }
      ];

      const res1 = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: claimantPayload });

      expect(res1.status).toBe(201);
      expect(res1.body.insertedCount).toBe(1);

      // Second commit with identical claimId for the same case: must return 409
      const res2 = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: claimantPayload });

      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe('Claimant with this Claim ID already exists for this case');

      // Database integrity: only 1 document exists
      const count = await Claimant.countDocuments({ caseId: testCase._id, claimId: 'CLM-IT5-UNIQ-001' });
      expect(count).toBe(1);
    });

    it('[IDX-03] High-concurrency race condition: 30 concurrent duplicate commits yield exactly 1 success and 29 HTTP 409s', async () => {
      const collisionClaimant = [
        {
          claimId: 'CLM-RACE-CONCURRENT-999',
          firstName: 'Race',
          lastName: 'Conditioner',
          email: 'race.condition@stress.local',
          settlementAmount: 75.00
        }
      ];

      const CONCURRENCY = 30;
      const promises = Array.from({ length: CONCURRENCY }).map(() =>
        request(app)
          .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
          .set('Authorization', `Bearer ${firmAdminToken}`)
          .send({ claimants: collisionClaimant })
      );

      const responses = await Promise.all(promises);

      const successes = responses.filter(r => r.status === 201);
      const conflicts = responses.filter(r => r.status === 409);
      const otherErrors = responses.filter(r => r.status !== 201 && r.status !== 409);

      expect(otherErrors).toHaveLength(0);
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(CONCURRENCY - 1);

      // All conflicts must have the exact required error message
      for (const conflict of conflicts) {
        expect(conflict.body.error).toBe('Claimant with this Claim ID already exists for this case');
      }

      // Final database assertion: exactly one record exists in Mongo
      const count = await Claimant.countDocuments({
        caseId: testCase._id,
        claimId: 'CLM-RACE-CONCURRENT-999'
      });
      expect(count).toBe(1);
    });

    it('[IDX-04] Direct Mongoose concurrent insertMany on collision triggers MongoBulkWriteError (E11000)', async () => {
      const rawDocs = [
        {
          caseId: testCase._id,
          claimId: 'CLM-BULK-001',
          firstName: 'Direct',
          lastName: 'Mongoose',
          email: 'direct@mongoose.local',
          settlementAmount: 100.00,
          status: 'pending_selection'
        }
      ];

      // First direct insert succeeds
      await Claimant.insertMany(rawDocs, { ordered: false });

      // Second direct insert must reject with code 11000
      let caughtError: any = null;
      try {
        await Claimant.insertMany(rawDocs, { ordered: false });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe(11000);
      expect(caughtError.message).toMatch(/E11000 duplicate key error/);

      const totalCount = await Claimant.countDocuments({
        caseId: testCase._id,
        claimId: 'CLM-BULK-001'
      });
      expect(totalCount).toBe(1);
    });

    it('[IDX-05] Multi-case scoping: identical claimId across two distinct cases succeeds cleanly without collision', async () => {
      const secondCase = await Case.create({
        name: 'Second Distinct Case',
        docketNumber: 'DOCK-2ND-2026',
        lawFirmId: 'firm-CHAL-IT5',
        settlementFundTotal: 25000.00,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z'),
        fallbackPaymentMethod: 'physical_check',
        status: 'draft'
      });

      const sharedClaimId = 'CLM-SHARED-ID-OK';

      // Insert into Case 1
      const res1 = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({
          claimants: [
            {
              claimId: sharedClaimId,
              firstName: 'User1',
              lastName: 'Case1',
              email: 'user1@case1.org',
              settlementAmount: 100.00
            }
          ]
        });
      expect(res1.status).toBe(201);

      // Insert into Case 2
      const res2 = await request(app)
        .post(`/api/cases/${secondCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({
          claimants: [
            {
              claimId: sharedClaimId,
              firstName: 'User2',
              lastName: 'Case2',
              email: 'user2@case2.org',
              settlementAmount: 200.00
            }
          ]
        });
      expect(res2.status).toBe(201);

      const count1 = await Claimant.countDocuments({ caseId: testCase._id, claimId: sharedClaimId });
      const count2 = await Claimant.countDocuments({ caseId: secondCase._id, claimId: sharedClaimId });
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  // =========================================================================
  // 2. RATE LIMITER COUNTERS & MULTI-CORE FORK ISOLATION
  // =========================================================================
  describe('2. Rate Limiter Isolation & Token Expiration Posture', () => {
    it('[RATE-01] Auth rate limiter enforces 5 failed attempts before issuing 429 Too Many Requests', async () => {
      await resetAuthRateLimiter();

      const targetEmail = 'brute-target@chal.local';

      // First 5 failed login attempts -> HTTP 401
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: targetEmail, password: 'WrongPassword123!' });
        expect(res.status).toBe(401);
      }

      // 6th attempt -> HTTP 429 Too Many Requests
      const blockedRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'WrongPassword123!' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain('Too many authentication attempts');

      // Different target email is NOT blocked (keyed by IP + email)
      const otherEmailRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'different-user@chal.local', password: 'WrongPassword123!' });

      expect(otherEmailRes.status).toBe(401); // 401, not 429!

      // Reset works cleanly
      await resetAuthRateLimiter();
      const afterResetRes = await request(app)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'WrongPassword123!' });
      expect(afterResetRes.status).toBe(401); // Reset allows request again
    });

    it('[TOKEN-01] Forged or expired JWT access token is rejected with 401 Unauthorized', async () => {
      const expiredToken = signToken(
        {
          id: 'expired-user',
          email: 'expired@juris.local',
          fullName: 'Expired User',
          role: 'case_manager',
          lawFirmId: null
        },
        '-10s' // already expired
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired/i);
    });

    it('[TOKEN-02] Tampered signature on valid JWT structure is rejected with 401', async () => {
      const validToken = makeAuthToken('super_admin');
      const tamperedToken = validToken.slice(0, -6) + 'abcdef';

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired/i);
    });
  });

  // =========================================================================
  // 3. DYNAMIC MERGE TAG ESCAPING & LANDING PAGE XSS SANITIZATION
  // =========================================================================
  describe('3. Dynamic Merge Tag Escaping & Localized Landing Page Stored XSS Protection', () => {
    it('[XSS-01] Dynamic merge tag values are strictly HTML-escaped during template resolution', () => {
      const template = '<h1>Hello {{claimant_first_name}} {{claimant_last_name}}</h1><p>Case: {{case_name}}</p>';
      const maliciousContext = {
        claimant_first_name: '<script>alert("first_xss")</script>',
        claimant_last_name: '<img src=x onerror=alert("last_xss")>',
        case_name: '"><svg onload=alert("case_xss")>'
      };

      const resolved = TemplateService.resolve(template, maliciousContext);

      expect(resolved).not.toContain('<script');
      expect(resolved).not.toContain('<img');
      expect(resolved).not.toContain('<svg');
      expect(resolved).toContain('&lt;script&gt;alert(&quot;first_xss&quot;)&lt;/script&gt;');
      expect(resolved).toContain('&lt;img src=x onerror=alert(&quot;last_xss&quot;)&gt;');
      expect(resolved).toContain('&quot;&gt;&lt;svg onload=alert(&quot;case_xss&quot;)&gt;');
    });

    it('[XSS-02] Payment selection link sanitization neutralizes javascript: and data: pseudo-protocols to #', () => {
      const dangerousUrls = [
        'javascript:alert(1)',
        'JAVASCRIPT:alert(document.cookie)',
        '  javascript:alert(1)  ',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd'
      ];

      for (const dangerous of dangerousUrls) {
        const sanitized = sanitizeLinkUrl(dangerous);
        expect(sanitized).toBe('#');
      }

      // Safe URLs are preserved
      expect(sanitizeLinkUrl('https://portal.juris-banking.com/claim/abc123token')).toBe(
        'https://portal.juris-banking.com/claim/abc123token'
      );
      expect(sanitizeLinkUrl('/claim/abc123token')).toBe('/claim/abc123token');
    });

    it('[XSS-03] Template preview endpoint neutralizes stored and dynamic XSS payloads', async () => {
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/templates/preview`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({
          template: '<p>Dear {{claimant_first_name}}, visit <a href="{{payment_selection_link}}">portal</a></p>',
          sampleData: {
            claimant_first_name: '<script>alert("injected")</script>',
            payment_selection_link: 'javascript:stealTokens()'
          },
          viewport: 'desktop'
        });

      expect(res.status).toBe(200);
      expect(res.body.renderedHtml).not.toContain('<script>');
      expect(res.body.renderedHtml).not.toContain('javascript:');
      expect(res.body.renderedHtml).toContain('&lt;script&gt;');
      expect(res.body.renderedHtml).toContain('href="#"');
    });

    it('[XSS-04] Stored XSS in createCase: localized landing page texts are sanitized prior to Mongo persistence', async () => {
      const maliciousCasePayload = {
        name: 'XSS Injection Test Case',
        docketNumber: 'DOCK-XSS-2026',
        lawFirmId: 'firm-CHAL-IT5',
        settlementFundTotal: 10000.00,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z'),
        landingPageText: {
          headline: 'Normal Headline <script>alert("stored-headline")</script>',
          introHtml: '<p>Safe intro</p><script>alert("stored-intro")</script><img src=x onerror=alert(1)>',
          faqAccordion: [
            {
              question: 'FAQ Q1 <svg onload=alert("faq-q")>',
              answer: 'FAQ A1 <iframe src="javascript:alert(1)"></iframe>'
            }
          ]
        },
        localizedLandingPageText: {
          es: {
            headline: 'Titular <script>alert("es-headline")</script>',
            introHtml: '<p>Intro en Espanol</p><img src=x onerror=alert("es-img")>',
            faqAccordion: [
              {
                question: '<b onmouseover="alert(1)">Pregunta</b>',
                answer: '<a href="javascript:alert(1)">Respuesta</a>'
              }
            ]
          }
        }
      };

      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send(maliciousCasePayload);

      expect(res.status).toBe(201);
      const createdCaseId = res.body.case.id || res.body.case._id;

      // Inspect persisted document directly from MongoDB
      const storedCase = await Case.findById(createdCaseId).lean();
      expect(storedCase).toBeDefined();

      const headline = storedCase?.landingPageText?.headline || '';
      const intro = storedCase?.landingPageText?.introHtml || '';
      const faqAnswer = storedCase?.landingPageText?.faqAccordion?.[0]?.answer || '';
      const esHeadline = (storedCase as any)?.localizedLandingPageText?.es?.headline || '';
      const esIntro = (storedCase as any)?.localizedLandingPageText?.es?.introHtml || '';
      const esFaqAnswer = (storedCase as any)?.localizedLandingPageText?.es?.faqAccordion?.[0]?.answer || '';

      // Verify complete elimination of script, onerror, onload, iframe, javascript:
      expect(headline).not.toContain('<script>');
      expect(intro).not.toContain('<script>');
      expect(intro).not.toContain('onerror');
      expect(faqAnswer).not.toContain('<iframe');
      expect(faqAnswer).not.toContain('javascript:');

      expect(esHeadline).not.toContain('<script>');
      expect(esIntro).not.toContain('onerror');
      expect(esFaqAnswer).not.toContain('javascript:');
    });

    it('[XSS-05] Stored XSS in updateCase (PATCH): updates to localized landing page texts are sanitized', async () => {
      const patchPayload = {
        landingPageText: {
          headline: 'Updated <script>alert("patched")</script>',
          introHtml: '<div onclick="alert(1)">Click me</div>'
        },
        localizedLandingPageText: {
          fr: {
            headline: 'Bienvenue <svg onload=alert("fr-svg")>',
            introHtml: '<a href="javascript:alert(\'fr\')">Lien</a>'
          }
        }
      };

      const res = await request(app)
        .patch(`/api/cases/${testCase._id}`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send(patchPayload);

      expect(res.status).toBe(200);

      const updatedCase = await Case.findById(testCase._id).lean();
      const headline = updatedCase?.landingPageText?.headline || '';
      const intro = updatedCase?.landingPageText?.introHtml || '';
      const frHeadline = (updatedCase as any)?.localizedLandingPageText?.fr?.headline || '';
      const frIntro = (updatedCase as any)?.localizedLandingPageText?.fr?.introHtml || '';

      expect(headline).not.toContain('<script>');
      expect(intro).not.toContain('onclick');
      expect(frHeadline).not.toContain('onload');
      expect(frIntro).not.toContain('javascript:');
    });
  });
});
