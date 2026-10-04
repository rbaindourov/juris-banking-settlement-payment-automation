import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as xlsx from 'xlsx';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { UserRole } from '../../src/types';

describe('Case Management, Claimant Ingestion & Template APIs', () => {
  function makeAuthToken(role: UserRole, firmId?: string | null, userId = 'usr-test-1'): string {
    return signToken({
      id: userId,
      email: `${role}@test-firm.com`,
      fullName: `Test ${role}`,
      role,
      lawFirmId: firmId || null
    });
  }

  const superAdminToken = makeAuthToken('super_admin');
  const firmAAdminToken = makeAuthToken('law_firm_admin', 'firm-A');
  const firmBAdminToken = makeAuthToken('law_firm_admin', 'firm-B');
  const firmACaseManagerToken = makeAuthToken('case_manager', 'firm-A');
  const firmAAuditorToken = makeAuthToken('auditor', 'firm-A');

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  describe('Case CRUD & RBAC Tenant Scoping', () => {
    it('Law Firm Admin can create a settlement case for their own firm', async () => {
      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          name: 'In re Green Consumer Privacy',
          docketNumber: '3:25-cv-01234',
          settlementFundTotal: 50000.00,
          disbursementDeadline: '2026-11-30T23:59:59.000Z',
          fallbackPaymentMethod: 'physical_check',
          emailTemplate: {
            subject: 'Important Notice Regarding Your Settlement',
            bodyHtml: '<h1>Notice</h1><p>Dear {{claimant_first_name}}, claim {{settlement_amount}}.</p>'
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.case).toBeDefined();
      expect(res.body.case.name).toBe('In re Green Consumer Privacy');
      expect(res.body.case.lawFirmId).toBe('firm-A');
      expect(res.body.case.status).toBe('draft');
      expect(res.body.case.emailTemplate.subject).toBe('Important Notice Regarding Your Settlement');
    });

    it('Super Admin can create a settlement case for any firm', async () => {
      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Global Antitrust Litigation',
          docketNumber: '1:24-cv-99999',
          lawFirmId: 'any-firm-123',
          settlementFundTotal: 250000.00,
          disbursementDeadline: '2026-12-15T00:00:00.000Z'
        });

      expect(res.status).toBe(201);
      expect(res.body.case.lawFirmId).toBe('any-firm-123');
    });

    it('Law Firm Admin is blocked (403) from creating a case for another firm', async () => {
      const res = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          name: 'Cross Firm Case',
          docketNumber: '2:25-cv-00001',
          lawFirmId: 'firm-B', // Cross-tenant spoofing attempt
          settlementFundTotal: 10000.00,
          disbursementDeadline: '2026-12-31T00:00:00.000Z'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('Case Manager and Auditor are blocked (403) from creating cases', async () => {
      const caseManagerRes = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .send({
          name: 'Unauthorized Case Creation',
          docketNumber: '1:25-cv-00002',
          settlementFundTotal: 5000.00,
          disbursementDeadline: '2026-12-31T00:00:00.000Z'
        });

      expect(caseManagerRes.status).toBe(403);

      const auditorRes = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${firmAAuditorToken}`)
        .send({
          name: 'Unauthorized Case Creation',
          docketNumber: '1:25-cv-00002',
          settlementFundTotal: 5000.00,
          disbursementDeadline: '2026-12-31T00:00:00.000Z'
        });

      expect(auditorRes.status).toBe(403);
    });

    it('Tenant Isolation: Law Firm Admin can only list their own cases', async () => {
      // Seed Case A
      await Case.create({
        name: 'Case A',
        docketNumber: '111',
        lawFirmId: 'firm-A',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date('2026-12-31')
      });

      // Seed Case B
      await Case.create({
        name: 'Case B',
        docketNumber: '222',
        lawFirmId: 'firm-B',
        settlementFundTotal: 20000,
        disbursementDeadline: new Date('2026-12-31')
      });

      // Firm A query
      const resA = await request(app)
        .get('/api/cases')
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body.cases.length).toBe(1);
      expect(resA.body.cases[0].name).toBe('Case A');

      // Super Admin query
      const resSuper = await request(app)
        .get('/api/cases')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(resSuper.status).toBe(200);
      expect(resSuper.body.cases.length).toBe(2);
    });

    it('Cross-tenant view protection: Firm B cannot access Firm A case by ID (403)', async () => {
      const caseA = await Case.create({
        name: 'Confidential Case A',
        docketNumber: '333',
        lawFirmId: 'firm-A',
        settlementFundTotal: 15000,
        disbursementDeadline: new Date('2026-12-31')
      });

      const res = await request(app)
        .get(`/api/cases/${caseA._id}`)
        .set('Authorization', `Bearer ${firmBAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('Updates case details, deadline, and automatically sanitizes HTML templates', async () => {
      const caseA = await Case.create({
        name: 'Modifiable Case',
        docketNumber: '444',
        lawFirmId: 'firm-A',
        settlementFundTotal: 25000,
        disbursementDeadline: new Date('2026-12-31')
      });

      const res = await request(app)
        .patch(`/api/cases/${caseA._id}`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          settlementFundTotal: 30000,
          emailTemplate: {
            subject: 'Updated Subject',
            bodyHtml: '<h3>Official Header</h3><script>steal()</script><p>Clean content</p>'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.case.settlementFundTotal).toBe(30000);
      expect(res.body.case.emailTemplate.subject).toBe('Updated Subject');
      expect(res.body.case.emailTemplate.bodyHtml).not.toContain('<script>');
      expect(res.body.case.emailTemplate.bodyHtml).toContain('<h3>Official Header</h3>');
    });
  });

  describe('Claimant Ingestion: Staged Preview & Commit Protocol', () => {
    let testCase: any;

    beforeEach(async () => {
      testCase = await Case.create({
        name: 'Ingestion Test Case',
        docketNumber: '555',
        lawFirmId: 'firm-A',
        settlementFundTotal: 1000.00,
        disbursementDeadline: new Date('2026-12-31')
      });
    });

    it('Stages a valid CSV upload via multipart form and returns accurate validation metrics', async () => {
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-101,John,Doe,john@firm.com,200.00',
        'CLM-102,Jane,Smith,jane@firm.com,300.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'roster.csv');

      expect(res.status).toBe(200);
      expect(res.body.validCount).toBe(2);
      expect(res.body.invalidCount).toBe(0);
      expect(res.body.totalAllocation).toBe(500.00);
      expect(res.body.settlementFundTotal).toBe(1000.00);
      expect(res.body.fundVariance).toBe(-500.00);
      expect(res.body.canCommit).toBe(true);
      expect(res.body.preview.length).toBe(2);

      // Verify records are NOT yet in the database (two-phase isolation)
      const count = await Claimant.countDocuments({ caseId: testCase._id });
      expect(count).toBe(0);
    });

    it('Stages an Excel (.xlsx) roster file successfully', async () => {
      const data = [
        ['Claim ID', 'First Name', 'Last Name', 'Email', 'Settlement Amount'],
        ['XLS-01', 'Ada', 'Lovelace', 'ada@history.org', 450.00]
      ];
      const ws = xlsx.utils.aoa_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .attach('file', buffer, 'roster.xlsx');

      expect(res.status).toBe(200);
      expect(res.body.validCount).toBe(1);
      expect(res.body.preview[0].claimId).toBe('XLS-01');
      expect(res.body.canCommit).toBe(true);
    });

    it('Flags validation errors on malformed records (invalid emails, duplicate Claim IDs)', async () => {
      const badCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-BAD-1,John,Doe,not-an-email,100.00',
        'CLM-BAD-2,Jane,Smith,jane@good.com,-50.00',
        'CLM-BAD-1,Duplicate,Person,dup@good.com,100.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .attach('file', Buffer.from(badCsv), 'bad.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors.some((e: any) => e.code === 'INVALID_EMAIL_FORMAT')).toBe(true);
      expect(res.body.errors.some((e: any) => e.code === 'INVALID_AMOUNT')).toBe(true);
      expect(res.body.errors.some((e: any) => e.code === 'DUPLICATE_CLAIM_ID')).toBe(true);
    });

    it('Blocks commit and reports SETTLEMENT_FUND_OVERALLOCATION when allocations exceed fund pool', async () => {
      const overAllocatedCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-OVER-1,John,Doe,john@test.com,600.00',
        'CLM-OVER-2,Jane,Smith,jane@test.com,500.00' // Total: $1100 > $1000
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .attach('file', Buffer.from(overAllocatedCsv), 'overallocation.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.fundVariance).toBe(100.00);
      expect(res.body.errors.some((e: any) => e.code === 'SETTLEMENT_FUND_OVERALLOCATION')).toBe(true);
    });

    it('Commits staged claimants to database, generates 64-hex tokens, and transitions case to active', async () => {
      const stagedClaimants = [
        {
          claimId: 'CLM-COMM-01',
          firstName: 'Alice',
          lastName: 'Walker',
          email: 'alice@litigation.org',
          settlementAmount: 250.00
        },
        {
          claimId: 'CLM-COMM-02',
          firstName: 'Bob',
          lastName: 'Dylan',
          email: 'bob@litigation.org',
          settlementAmount: 250.00
        }
      ];

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({ claimants: stagedClaimants });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.insertedCount).toBe(2);

      // Verify in DB
      const dbClaimants = await Claimant.find({ caseId: testCase._id });
      expect(dbClaimants.length).toBe(2);

      for (const claimant of dbClaimants) {
        expect(claimant.paymentSelectionToken).toBeDefined();
        expect(claimant.paymentSelectionToken).toHaveLength(64);
        expect(claimant.paymentSelectionToken).toMatch(/^[0-9a-f]{64}$/);
        expect(claimant.status).toBe('pending_selection');
        expect(claimant.tokenExpiresAt).toBeDefined();
      }

      // Verify case transitioned to active
      const updatedCase = await Case.findById(testCase._id);
      expect(updatedCase?.status).toBe('active');
    });

    it('GET /api/cases/:id/claimants lists claimants with search and pagination', async () => {
      await Claimant.create([
        {
          caseId: testCase._id,
          claimId: 'SEARCH-01',
          firstName: 'Sherlock',
          lastName: 'Holmes',
          email: 'sherlock@bakerstreet.co.uk',
          settlementAmount: 500,
          paymentSelectionToken: '1111111111111111111111111111111111111111111111111111111111111111'
        },
        {
          caseId: testCase._id,
          claimId: 'SEARCH-02',
          firstName: 'John',
          lastName: 'Watson',
          email: 'watson@bakerstreet.co.uk',
          settlementAmount: 300,
          paymentSelectionToken: '2222222222222222222222222222222222222222222222222222222222222222'
        }
      ]);

      const listRes = await request(app)
        .get(`/api/cases/${testCase._id}/claimants?search=Sherlock`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.claimants[0].firstName).toBe('Sherlock');
    });

    it('Detects duplicate Claim IDs already existing in database for this case', async () => {
      // First commit CLM-EXIST-01
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-EXIST-01',
        firstName: 'Existing',
        lastName: 'User',
        email: 'exist@test.com',
        settlementAmount: 100,
        paymentSelectionToken: '3333333333333333333333333333333333333333333333333333333333333333'
      });

      // Try staging file containing same Claim ID
      const csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-EXIST-01,New,Person,new@test.com,100.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .attach('file', Buffer.from(csv), 'dup.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      const dupDbError = res.body.errors.find((e: any) => e.code === 'DUPLICATE_DB_CLAIM_ID');
      expect(dupDbError).toBeDefined();
      expect(dupDbError.message).toContain('already exists in this case in the database');
    });
  });

  describe('Template Preview API (/api/cases/:id/templates/preview)', () => {
    it('renders sanitized and merge-tag resolved HTML preview for desktop and mobile viewports', async () => {
      const testCase = await Case.create({
        name: 'Privacy Class Action Preview',
        docketNumber: '777',
        lawFirmId: 'firm-A',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date('2026-11-15T00:00:00Z'),
        emailTemplate: {
          subject: 'Your Claim',
          bodyHtml: '<h2>Notice for {{case_name}}</h2><p>Amount: {{settlement_amount}}</p><script>evil()</script>'
        }
      });

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/templates/preview`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          viewport: 'desktop',
          sampleData: {
            settlement_amount: '$750.00'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.sanitizedHtml).not.toContain('<script>');
      expect(res.body.renderedHtml).toContain('Privacy Class Action Preview');
      expect(res.body.renderedHtml).toContain('$750.00');
      expect(res.body.previewHtml).toContain('max-width: 680px');
    });

    it('Addendum 3: Supports landing page localization and preview by language code', async () => {
      const testCase = await Case.create({
        name: 'Multi-Lingual Settlement',
        docketNumber: '888',
        lawFirmId: 'firm-A',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date('2026-12-31T00:00:00Z'),
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'es', 'zh'],
        landingPageText: {
          headline: 'Official Settlement Election Portal',
          introHtml: '<p>Welcome in English.</p>'
        },
        localizedLandingPageText: {
          es: {
            headline: 'Portal Oficial de Elección de Acuerdo',
            introHtml: '<p>Bienvenido al portal en español para {{case_name}}.</p>',
            faqAccordion: [{ question: '¿Cuándo es la fecha límite?', answer: 'El 31 de diciembre.' }],
            supportContact: 'soporte@acuerdo.org'
          }
        }
      });

      // Preview in Spanish
      const resEs = await request(app)
        .post(`/api/cases/${testCase._id}/templates/preview`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          type: 'landing',
          language: 'es'
        });

      expect(resEs.status).toBe(200);
      expect(resEs.body.language).toBe('es');
      expect(resEs.body.renderedHtml).toContain('Bienvenido al portal en español para Multi-Lingual Settlement');
      expect(resEs.body.landingPageText.headline).toBe('Portal Oficial de Elección de Acuerdo');

      // Default (English) fallback preview
      const resEn = await request(app)
        .post(`/api/cases/${testCase._id}/templates/preview`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          type: 'landing',
          language: 'en'
        });

      expect(resEn.status).toBe(200);
      expect(resEn.body.language).toBe('en');
      expect(resEn.body.renderedHtml).toContain('Welcome in English.');
    });
  });
});
