import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { UserRole } from '../../src/types';

describe('Milestone 2 Gate Remediation Verification Suite', () => {
  function makeAuthToken(role: UserRole, firmId?: string | null, userId = 'usr-rem-1'): string {
    return signToken({
      id: userId,
      email: `${role}_${firmId || 'nofirm'}@juris-test.local`,
      fullName: `Test ${role}`,
      role,
      lawFirmId: firmId || null
    });
  }

  const superAdminToken = makeAuthToken('super_admin');
  const firmAToken = makeAuthToken('law_firm_admin', 'firm-A');
  const noFirmManagerToken = makeAuthToken('case_manager', null);

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  // =========================================================================
  // 1. Stored XSS Sanitization for Localized Landing Pages
  // =========================================================================
  describe('Stored XSS Sanitization for Localized Landing Pages', () => {
    it('sanitizes headline, introHtml, and faqAccordion items in localized landing page on case creation', async () => {
      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmAToken}`)
        .send({
          name: 'XSS Protection Case',
          docketNumber: '1:26-cv-00777',
          settlementFundTotal: 15000,
          disbursementDeadline: new Date('2026-12-31T23:59:59.000Z'),
          localizedLandingPageText: {
            es: {
              headline: 'Aviso <script>alert("XSS_HEADLINE")</script>',
              introHtml: '<p>Bienvenido</p><img src="x" onerror="alert(\'XSS_IMG\')">',
              faqAccordion: [
                {
                  question: 'Pregunta <script>alert("FAQ_Q")</script>',
                  answer: 'Respuesta <a href="javascript:alert(\'FAQ_A\')">Link</a>'
                }
              ]
            }
          }
        });

      expect(res.status).toBe(201);
      const caseId = res.body.case.id || res.body.case._id;
      const savedCase = await Case.findById(caseId);
      expect(savedCase).toBeDefined();

      const esData = savedCase?.localizedLandingPageText?.es;
      expect(esData).toBeDefined();
      expect(esData.headline).not.toContain('<script>');
      expect(esData.headline).toBe('Aviso ');
      expect(esData.introHtml).not.toContain('onerror=');
      expect(esData.introHtml).toContain('<p>Bienvenido</p>');
      expect(esData.faqAccordion[0].question).not.toContain('<script>');
      expect(esData.faqAccordion[0].answer).not.toContain('javascript:');
    });

    it('sanitizes localized landing page content during PATCH update', async () => {
      const createdCase = await Case.create({
        name: 'Update Sanitization Case',
        docketNumber: '1:26-cv-00888',
        lawFirmId: 'firm-A',
        settlementFundTotal: 20000,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z')
      });

      const res = await request(app)
        .patch(`/api/cases/${createdCase._id}`)
        .set('Authorization', `Bearer ${firmAToken}`)
        .send({
          localizedLandingPageText: {
            zh: {
              headline: '门户 <script>alert("ZH_XSS")</script>',
              introHtml: '<p>欢迎</p><svg onload="alert(1)"></svg>'
            }
          }
        });

      expect(res.status).toBe(200);
      const updatedCase = await Case.findById(createdCase._id);
      const zhData = updatedCase?.localizedLandingPageText?.zh;
      expect(zhData.headline).not.toContain('<script>');
      expect(zhData.headline).toBe('门户 ');
      expect(zhData.introHtml).not.toContain('onload=');
      expect(zhData.introHtml).toContain('<p>欢迎</p>');
    });
  });

  // =========================================================================
  // 2. Strict Multi-Tenant Isolation (Null LawFirmId Rejection)
  // =========================================================================
  describe('Strict Multi-Tenant Isolation for Cases', () => {
    it('strictly forbids users with null lawFirmId from reading or updating cases (403 Forbidden)', async () => {
      const caseDoc = await Case.create({
        name: 'Firm A Protected Case',
        docketNumber: '1:26-cv-00999',
        lawFirmId: 'firm-A',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z')
      });

      // User with role case_manager and null lawFirmId attempts to read case
      const getRes = await request(app)
        .get(`/api/cases/${caseDoc._id}`)
        .set('Authorization', `Bearer ${noFirmManagerToken}`);

      expect(getRes.status).toBe(403);
      expect(getRes.body.error).toContain('Forbidden');

      // User attempts to patch case
      const patchRes = await request(app)
        .patch(`/api/cases/${caseDoc._id}`)
        .set('Authorization', `Bearer ${noFirmManagerToken}`)
        .send({ name: 'Hijacked' });

      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error).toContain('Forbidden');
    });
  });

  // =========================================================================
  // 3. Dynamic Duplicate Key Error Handling (Mongo 11000)
  // =========================================================================
  describe('Dynamic Duplicate Key Error Handling (Code 11000)', () => {
    it('returns 409 and specific Claim ID collision message when claimId collides within a case', async () => {
      const caseDoc = await Case.create({
        name: 'Duplicate Key Test Case',
        docketNumber: '1:26-cv-00123',
        lawFirmId: 'firm-A',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z')
      });

      // Insert first claimant directly
      await Claimant.create({
        caseId: caseDoc._id,
        claimId: 'CLM-DUPLICATE-01',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@test.com',
        settlementAmount: 100
      });

      // Attempt to insert duplicate claimant via commit-upload
      const res = await request(app)
        .post(`/api/cases/${caseDoc._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAToken}`)
        .send({
          claimants: [
            {
              claimId: 'CLM-DUPLICATE-01',
              firstName: 'Bob',
              lastName: 'Jones',
              email: 'bob@test.com',
              settlementAmount: 200
            }
          ]
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Claimant with this Claim ID already exists for this case');
    });
  });

  // =========================================================================
  // 5. Cumulative Multi-Batch Allocation Variance Ingestion Protection
  // =========================================================================
  describe('Cumulative Multi-Batch Allocation Variance Protection', () => {
    it('prevents multi-file uploads from exceeding settlement fund total when case already has existing claimants in DB', async () => {
      const caseDoc = await Case.create({
        name: 'Multi-Batch Fund Case',
        docketNumber: '1:26-cv-00999',
        lawFirmId: 'firm-A',
        settlementFundTotal: 1000,
        disbursementDeadline: new Date('2026-12-31T23:59:59.000Z')
      });

      // Insert existing committed claimant for $600
      await Claimant.create({
        caseId: caseDoc._id,
        claimId: 'CLM-COMMITTED-01',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@test.com',
        settlementAmount: 600,
        status: 'pending_selection'
      });

      // Secondary file with $500 allocation -> cumulative = $1100 > $1000 settlement fund
      const overCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-NEW-01,Bob,Jones,bob@test.com,500.00'
      ].join('\n');

      const overRes = await request(app)
        .post(`/api/cases/${caseDoc._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAToken}`)
        .attach('file', Buffer.from(overCsv), 'secondary_over.csv');

      expect(overRes.status).toBe(200);
      expect(overRes.body.validCount).toBe(1);
      expect(overRes.body.totalAllocation).toBe(500.00);
      expect(overRes.body.existingAllocation).toBe(600.00);
      expect(overRes.body.fundVariance).toBe(100.00);
      expect(overRes.body.canCommit).toBe(false);
      const varianceError = overRes.body.errors.find((e: any) => e.code === 'SETTLEMENT_FUND_OVERALLOCATION');
      expect(varianceError).toBeDefined();
      expect(varianceError.message).toContain('exceeds case settlement fund');
      expect(varianceError.message).toContain('existing committed $600.00');

      // Secondary file within remaining allowance: $350 -> cumulative = $950 <= $1000
      const validCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-NEW-02,Charlie,Brown,charlie@test.com,350.00'
      ].join('\n');

      const validRes = await request(app)
        .post(`/api/cases/${caseDoc._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAToken}`)
        .attach('file', Buffer.from(validCsv), 'secondary_valid.csv');

      expect(validRes.status).toBe(200);
      expect(validRes.body.validCount).toBe(1);
      expect(validRes.body.totalAllocation).toBe(350.00);
      expect(validRes.body.existingAllocation).toBe(600.00);
      expect(validRes.body.fundVariance).toBe(-50.00);
      expect(validRes.body.canCommit).toBe(true);
      expect(validRes.body.errors).toHaveLength(0);
    });
  });
});
