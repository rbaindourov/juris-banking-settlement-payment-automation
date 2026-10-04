import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { signToken } from '../../src/utils/jwt';
import { CORE_AGENDA_JOBS, AGENDA_JOBS } from '../../src/types';

describe('Empirical Challenger: Milestone 5 Multi-Tenant Scoping, Agendash Auth, Funnel Edge Cases & PII Masking', () => {
  let caseFirmA: any;
  let caseFirmB: any;
  let emptyCaseFirmA: any;

  // Firm A Tokens
  let firmAAdminToken: string;
  let firmACaseManagerToken: string;
  let firmAAuditorToken: string;

  // Firm B Tokens
  let firmBAdminToken: string;
  let firmACrossAttemptToken: string;

  // Unassigned Tenant Tokens (missing lawFirmId)
  let unassignedAdminToken: string;
  let unassignedManagerToken: string;
  let unassignedAuditorToken: string;

  // Global Admin Tokens
  let superAdminToken: string;
  let platformAdminToken: string;

  beforeAll(async () => {
    await setupTestDb('m5_empirical_challenger');

    firmAAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-a.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-A'
    });

    firmACaseManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'manager@firm-a.com',
      role: 'case_manager',
      lawFirmId: 'FIRM-A'
    });

    firmAAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-a.com',
      role: 'auditor',
      lawFirmId: 'FIRM-A'
    });

    firmBAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-b.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-B'
    });

    firmACrossAttemptToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'intruder@firm-b.com',
      role: 'case_manager',
      lawFirmId: 'FIRM-B'
    });

    unassignedAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'unassigned-admin@nowhere.com',
      role: 'law_firm_admin'
      // missing lawFirmId
    });

    unassignedManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'unassigned-manager@nowhere.com',
      role: 'case_manager'
      // missing lawFirmId
    });

    unassignedAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'unassigned-auditor@nowhere.com',
      role: 'auditor'
      // missing lawFirmId
    });

    superAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'super@platform.gov',
      role: 'super_admin'
    });

    platformAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'platform@platform.gov',
      role: 'platform_admin'
    });
  });

  afterAll(async () => {
    await teardownTestDb('m5_empirical_challenger');
  });

  beforeEach(async () => {
    await clearTestDb('m5_empirical_challenger');

    // Create Case for Firm A
    caseFirmA = await Case.create({
      name: 'Firm A Class Action',
      docketNumber: '1:24-cv-00101',
      lawFirmId: 'FIRM-A',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 60),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // Create Case for Firm B
    caseFirmB = await Case.create({
      name: 'Firm B Environmental Litigation',
      docketNumber: '2:24-cv-00202',
      lawFirmId: 'FIRM-B',
      settlementFundTotal: 250000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 90),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // Create Empty Case for Firm A (0 Claimants)
    emptyCaseFirmA = await Case.create({
      name: 'Firm A Empty Shell Case',
      docketNumber: '1:24-cv-00000',
      lawFirmId: 'FIRM-A',
      settlementFundTotal: 50000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  // =========================================================================
  // BATTERY 1: Multi-Tenant Boundary Security
  // =========================================================================
  describe('Battery 1: Multi-Tenant Boundary Security', () => {
    const endpoints = [
      { name: 'funnel', path: (id: string) => `/api/cases/${id}/analytics/funnel` },
      { name: 'methods', path: (id: string) => `/api/cases/${id}/analytics/methods` },
      { name: 'summary', path: (id: string) => `/api/cases/${id}/analytics/summary` },
      { name: 'audit-export', path: (id: string) => `/api/cases/${id}/audit-export` },
      { name: 'export-ledger', path: (id: string) => `/api/cases/${id}/export/ledger` }
    ];

    for (const ep of endpoints) {
      it(`[TENANT-01] Rejects Firm A user accessing Firm B ${ep.name} with HTTP 403 Forbidden`, async () => {
        const res = await request(app)
          .get(ep.path(caseFirmB._id.toString()))
          .set('Authorization', `Bearer ${firmAAdminToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/tenant/i);
      });

      it(`[TENANT-02] Rejects Firm B user accessing Firm A ${ep.name} with HTTP 403 Forbidden`, async () => {
        const res = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${firmACrossAttemptToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/tenant/i);
      });

      it(`[TENANT-03] Rejects unassigned token (missing lawFirmId) accessing ${ep.name} with HTTP 403 Forbidden`, async () => {
        // law_firm_admin without lawFirmId
        const resAdmin = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${unassignedAdminToken}`);
        expect(resAdmin.status).toBe(403);
        expect(resAdmin.body.error).toMatch(/tenant/i);

        // case_manager without lawFirmId
        const resMgr = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${unassignedManagerToken}`);
        expect(resMgr.status).toBe(403);
        expect(resMgr.body.error).toMatch(/tenant/i);

        // auditor without lawFirmId
        const resAud = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${unassignedAuditorToken}`);
        expect(resAud.status).toBe(403);
        expect(resAud.body.error).toMatch(/tenant/i);
      });

      it(`[TENANT-04] Allows super_admin to access ${ep.name} across Firm A and Firm B`, async () => {
        const resA = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${superAdminToken}`);
        expect(resA.status).toBe(200);

        const resB = await request(app)
          .get(ep.path(caseFirmB._id.toString()))
          .set('Authorization', `Bearer ${superAdminToken}`);
        expect(resB.status).toBe(200);
      });

      it(`[TENANT-05] Allows platform_admin to access ${ep.name} across Firm A and Firm B`, async () => {
        const resA = await request(app)
          .get(ep.path(caseFirmA._id.toString()))
          .set('Authorization', `Bearer ${platformAdminToken}`);
        expect(resA.status).toBe(200);

        const resB = await request(app)
          .get(ep.path(caseFirmB._id.toString()))
          .set('Authorization', `Bearer ${platformAdminToken}`);
        expect(resB.status).toBe(200);
      });
    }

    it('[TENANT-06] Legitimate Firm A users (admin, manager, auditor) can all access Firm A cases', async () => {
      const resAdmin = await request(app)
        .get(`/api/cases/${caseFirmA._id}/analytics/summary`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);
      expect(resAdmin.status).toBe(200);

      const resManager = await request(app)
        .get(`/api/cases/${caseFirmA._id}/analytics/summary`)
        .set('Authorization', `Bearer ${firmACaseManagerToken}`);
      expect(resManager.status).toBe(200);

      const resAuditor = await request(app)
        .get(`/api/cases/${caseFirmA._id}/analytics/summary`)
        .set('Authorization', `Bearer ${firmAAuditorToken}`);
      expect(resAuditor.status).toBe(200);
    });
  });

  // =========================================================================
  // BATTERY 2: Agendash Authorization & Content Negotiation
  // =========================================================================
  describe('Battery 2: Agendash Authorization Security & Content Negotiation', () => {
    it('[AGENDASH-01] Rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
      const resNoAuth = await request(app).get('/agendash');
      expect(resNoAuth.status).toBe(401);

      const resNoAuthSlash = await request(app).get('/agendash/');
      expect(resNoAuthSlash.status).toBe(401);

      const resNoAuthJson = await request(app)
        .get('/agendash')
        .set('Accept', 'application/json');
      expect(resNoAuthJson.status).toBe(401);
    });

    it('[AGENDASH-02] Rejects non-administrative roles (auditor, case_manager) with HTTP 403 Forbidden', async () => {
      const resAuditor = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${firmAAuditorToken}`)
        .set('Accept', 'application/json');
      expect(resAuditor.status).toBe(403);
      expect(resAuditor.body.error).toMatch(/forbidden/i);

      const resManager = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .set('Accept', 'application/json');
      expect(resManager.status).toBe(403);
      expect(resManager.body.error).toMatch(/forbidden/i);
    });

    it('[AGENDASH-03] Permits super_admin, platform_admin, and law_firm_admin access', async () => {
      const resSuper = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');
      expect(resSuper.status).toBe(200);

      const resPlatform = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .set('Accept', 'application/json');
      expect(resPlatform.status).toBe(200);

      const resFirmAdmin = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .set('Accept', 'application/json');
      expect(resFirmAdmin.status).toBe(200);
    });

    it('[AGENDASH-04] Dual-mode content negotiation: Accept application/json returns registered jobs payload', async () => {
      const res = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Agendash scheduler interface');

      // Assert exactly 5 core Agenda scheduled jobs
      expect(res.body.registeredJobs).toBeDefined();
      expect(res.body.registeredJobs).toHaveLength(5);
      expect(res.body.registeredJobs).toEqual([...CORE_AGENDA_JOBS]);
      expect(res.body.registeredJobs).toContain('case:dispatch-notifications');
      expect(res.body.registeredJobs).toContain('case:send-deadline-reminders');
      expect(res.body.registeredJobs).toContain('case:enforce-deadline-fallback');
      expect(res.body.registeredJobs).toContain('sftp:generate-and-upload-batch');
      expect(res.body.registeredJobs).toContain('sftp:poll-reconciliation-reports');

      // Assert 6 total jobs including Gmail bounce scanner
      expect(res.body.allJobs).toBeDefined();
      expect(res.body.allJobs).toHaveLength(6);
      expect(res.body.allJobs).toEqual([...AGENDA_JOBS]);
      expect(res.body.allJobs).toContain('email:scan-gmail-bounces');
    });

    it('[AGENDASH-05] Content negotiation handles trailing slash (/agendash/) with application/json', async () => {
      const res = await request(app)
        .get('/agendash/')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.registeredJobs).toEqual([...CORE_AGENDA_JOBS]);
    });
  });

  // =========================================================================
  // BATTERY 3: Funnel & Edge Cases (Zero Claimants / Division-by-Zero)
  // =========================================================================
  describe('Battery 3: Funnel & Edge Cases (Zero Claimants & Conversion Rates)', () => {
    it('[FUNNEL-01] Empty case with 0 claimants returns 0 for counts and rates without NaN or division by zero', async () => {
      const res = await request(app)
        .get(`/api/cases/${emptyCaseFirmA._id}/analytics/funnel`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      const funnel = res.body;

      // Assert 0 for all counts
      expect(funnel.uploaded).toBe(0);
      expect(funnel.dispatched).toBe(0);
      expect(funnel.delivered).toBe(0);
      expect(funnel.visited).toBe(0);
      expect(funnel.selected).toBe(0);
      expect(funnel.disbursed).toBe(0);

      // Assert 0 for all conversion rates
      expect(funnel.deliveryRate).toBe(0);
      expect(funnel.clickRate).toBe(0);
      expect(funnel.conversionRate).toBe(0);
      expect(funnel.disbursementRate).toBe(0);
      expect(funnel.overallConversionRate).toBe(0);
      expect(funnel.overallDisbursementRate).toBe(0);

      // Verify no NaN or null in the response string
      const rawJson = JSON.stringify(funnel);
      expect(rawJson).not.toContain('NaN');
      expect(rawJson).not.toContain('null');
      expect(rawJson).not.toContain('Infinity');

      // Verify all 6 stages exist in funnel array with count 0
      expect(funnel.funnel).toHaveLength(6);
      for (const item of funnel.funnel) {
        expect(item.count).toBe(0);
        expect(typeof item.conversionRate).toBe('number');
        expect(isNaN(item.conversionRate)).toBe(false);
        expect(typeof item.dropOffRate).toBe('number');
        expect(isNaN(item.dropOffRate)).toBe(false);
      }
    });

    it('[FUNNEL-02] Empty case payment methods breakdown returns 0 without crashing', async () => {
      const res = await request(app)
        .get(`/api/cases/${emptyCaseFirmA._id}/analytics/methods`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalSelected).toBe(0);
      expect(res.body.totalAmount).toBe(0);
      expect(res.body.totalAmountFormatted).toBe('$0.00');
      expect(res.body.methods).toHaveLength(9);

      for (const m of res.body.methods) {
        expect(m.count).toBe(0);
        expect(m.percentage).toBe(0);
        expect(m.totalAmount).toBe(0);
        expect(m.totalAmountFormatted).toBe('$0.00');
        expect(isNaN(m.percentage)).toBe(false);
      }
    });

    it('[FUNNEL-03] Empty case financial summary returns valid zero metrics without division by zero', async () => {
      const res = await request(app)
        .get(`/api/cases/${emptyCaseFirmA._id}/analytics/summary`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      const summary = res.body;

      expect(summary.totalClaimants).toBe(0);
      expect(summary.claimedClaimants).toBe(0);
      expect(summary.disbursedClaimants).toBe(0);
      expect(summary.disbursementProgressPercent).toBe(0);
      expect(isNaN(summary.disbursementProgressPercent)).toBe(false);
      expect(summary.totalAllocated).toBe(0);
      expect(summary.totalClaimed).toBe(0);
      expect(summary.totalDisbursed).toBe(0);
      expect(summary.settlementFundTotal).toBe(50000);
      expect(summary.totalOutstanding).toBe(50000);
      expect(summary.remainingUnclaimedFund).toBe(50000);
      expect(summary.fundVariance).toBe(-50000); // 0 allocated - 50000 fund
    });

    it('[FUNNEL-04] Full 100% conversion cohort computes 100% rates without rounding overflow', async () => {
      // Seed 3 claimants, all disbursed
      await Claimant.create([
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-100-A',
          firstName: 'Per',
          lastName: 'Fect',
          email: 'per@fect.com',
          settlementAmount: 1000,
          status: 'disbursed',
          emailSent: true,
          emailOpened: true,
          linkClicked: true,
          selectedPaymentMethod: 'ach',
          paymentDetails: { routingNumber: '123456789', accountNumber: '11112222' }
        },
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-100-B',
          firstName: 'All',
          lastName: 'Done',
          email: 'all@done.com',
          settlementAmount: 1500,
          status: 'disbursed',
          emailSent: true,
          emailOpened: true,
          linkClicked: true,
          selectedPaymentMethod: 'paypal',
          paymentDetails: { email: 'all@done.com' }
        }
      ]);

      const res = await request(app)
        .get(`/api/cases/${caseFirmA._id}/analytics/funnel`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      const f = res.body;
      expect(f.uploaded).toBe(2);
      expect(f.dispatched).toBe(2);
      expect(f.delivered).toBe(2);
      expect(f.visited).toBe(2);
      expect(f.selected).toBe(2);
      expect(f.disbursed).toBe(2);

      expect(f.deliveryRate).toBe(100);
      expect(f.clickRate).toBe(100);
      expect(f.conversionRate).toBe(100);
      expect(f.disbursementRate).toBe(100);
      expect(f.overallConversionRate).toBe(100);
      expect(f.overallDisbursementRate).toBe(100);
    });
  });

  // =========================================================================
  // BATTERY 4: CSV Export & PII / PCI Masking Integrity
  // =========================================================================
  describe('Battery 4: CSV Export Streaming & PII Masking Integrity', () => {
    it('[CSV-01] Empty case streams CSV export with BOM and headers without crashing', async () => {
      const res = await request(app)
        .get(`/api/cases/${emptyCaseFirmA._id}/audit-export`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');

      const csv = res.text;
      // Byte Order Mark
      expect(csv.charCodeAt(0)).toBe(0xfeff);

      // Header row
      expect(csv).toContain('Claim ID,Claimant Name,First Name,Last Name,Email');
      expect(csv).toContain('Masked Payment Details');
      expect(csv).toContain('Digital Signature');
      expect(csv).toContain('Signature IP');
      expect(csv).toContain('Signature Timestamp');

      // Only 1 line (the header) + trailing empty line
      const lines = csv.substring(1).trim().split('\r\n');
      expect(lines.length).toBe(1);
    });

    it('[CSV-02] Properly masks ACH bank accounts (****1234), debit PANs (**** **** **** 1234), and captures signature IP/timestamp', async () => {
      const rawAccountNumber = '987654321234';
      const rawRoutingNumber = '111000025';
      const rawDebitPan = '4111222233331234';
      const rawSignatureIp = '198.51.100.77';
      const signatureTime = new Date('2026-03-20T10:15:30.000Z');

      await Claimant.create([
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-ACH-01',
          firstName: 'Alice',
          lastName: 'Achison',
          email: 'alice@ach.org',
          phone: '555-010-0001',
          settlementAmount: 3500.00,
          status: 'selected',
          selectedPaymentMethod: 'ach',
          paymentDetails: {
            routingNumber: rawRoutingNumber,
            accountNumber: rawAccountNumber
          },
          digitalSignature: 'Alice Achison',
          signatureIp: rawSignatureIp,
          signedAt: signatureTime,
          confirmationNumber: 'CONF-ACH-01'
        },
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-DEBIT-02',
          firstName: 'Dan',
          lastName: 'Debitson',
          email: 'dan@debit.org',
          settlementAmount: 1200.50,
          status: 'selected',
          selectedPaymentMethod: 'push_to_debit',
          paymentDetails: {
            pan: rawDebitPan,
            exp: '11/29'
          },
          digitalSignature: 'Dan Debitson',
          signatureIp: '203.0.113.88',
          signedAt: signatureTime,
          confirmationNumber: 'CONF-DEBIT-02'
        },
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-BTC-03',
          firstName: 'Satoshi',
          lastName: 'Nakamoto',
          email: 'satoshi@btc.org',
          settlementAmount: 5000.00,
          status: 'selected',
          selectedPaymentMethod: 'bitcoin',
          paymentDetails: {
            bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
          },
          digitalSignature: 'Satoshi Nakamoto',
          signatureIp: '192.0.2.1',
          signedAt: signatureTime
        }
      ]);

      const res = await request(app)
        .get(`/api/cases/${caseFirmA._id}/audit-export`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      const csv = res.text;

      // 1. Verify ACH Account Number is masked as ****1234
      expect(csv).toContain('Routing: 111000025, Account: ****1234');
      // Crucial: Raw full bank account number MUST NOT leak in the CSV
      expect(csv).not.toContain(rawAccountNumber);

      // 2. Verify Debit PAN is masked as **** **** **** 1234
      expect(csv).toContain('Card: **** **** **** 1234, Exp: **/**');
      // Crucial: Raw 16-digit PAN MUST NOT leak in the CSV
      expect(csv).not.toContain(rawDebitPan);

      // 3. Verify Bitcoin Address is masked
      expect(csv).toContain('BTC: bc1qar...wf5mdq');
      expect(csv).not.toContain('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');

      // 4. Verify Digital Signature, IP, and Timestamp are recorded in audit ledger
      expect(csv).toContain('Alice Achison');
      expect(csv).toContain(rawSignatureIp);
      expect(csv).toContain('2026-03-20T10:15:30.000Z');
      expect(csv).toContain('CONF-ACH-01');

      expect(csv).toContain('Dan Debitson');
      expect(csv).toContain('203.0.113.88');
    });

    it('[CSV-03] Handles RFC 4180 complex fields with commas, double quotes, and newlines', async () => {
      await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-QUOTES-99',
        firstName: 'Robert "Bob"',
        lastName: 'O\'Connor, Esq.',
        email: 'bob@quotes.com',
        address: {
          street: '123 Main St\nApt 4B',
          city: 'New York, NY',
          state: 'NY',
          zip: '10001'
        },
        settlementAmount: 750,
        status: 'selected',
        selectedPaymentMethod: 'physical_check',
        paymentDetails: {
          street: '123 Main St, Suite "A"',
          city: 'New York',
          state: 'NY',
          zip: '10001'
        },
        digitalSignature: 'Robert "Bob" O\'Connor',
        signatureIp: '127.0.0.1',
        signedAt: new Date('2026-01-01T00:00:00Z')
      });

      const res = await request(app)
        .get(`/api/cases/${caseFirmA._id}/audit-export`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);

      expect(res.status).toBe(200);
      const csv = res.text;

      // RFC 4180 double-quoted fields
      expect(csv).toContain('"O\'Connor, Esq., Robert ""Bob"""');
      expect(csv).toContain('"Robert ""Bob"""');
      expect(csv).toContain('"Mailed to: 123 Main St, Suite ""A"", New York, NY 10001"');
      expect(csv).toContain('"Robert ""Bob"" O\'Connor"');
    });
  });
});
