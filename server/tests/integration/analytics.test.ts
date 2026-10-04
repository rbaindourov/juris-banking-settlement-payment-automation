import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { signToken } from '../../src/utils/jwt';

describe('Integration: Analytics REST APIs & Streaming Audit Export', () => {
  let testCase: any;
  let adminToken: string;
  let otherFirmToken: string;

  beforeAll(async () => {
    await setupTestDb('analytics_integration');
    adminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm1.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-001'
    });

    otherFirmToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm2.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-OTHER-999'
    });
  });

  afterAll(async () => {
    await teardownTestDb('analytics_integration');
  });

  beforeEach(async () => {
    await clearTestDb('analytics_integration');

    testCase = await Case.create({
      name: 'Analytics Test Litigation',
      docketNumber: '1:24-cv-00555',
      lawFirmId: 'FIRM-001',
      settlementFundTotal: 10000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // Populate realistic claimant cohort
    await Claimant.create([
      {
        caseId: testCase._id,
        claimId: 'CLM-001',
        firstName: 'Alice',
        lastName: 'Anderson',
        email: 'alice@example.com',
        settlementAmount: 2000,
        status: 'disbursed',
        emailSent: true,
        emailSentAt: new Date(),
        selectedPaymentMethod: 'ach',
        paymentDetails: { routingNumber: '123456789', accountNumber: '11112222' },
        disbursedAt: new Date()
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-002',
        firstName: 'Bob',
        lastName: 'Baker',
        email: 'bob@example.com',
        settlementAmount: 1500,
        status: 'selected',
        emailSent: true,
        emailSentAt: new Date(),
        selectedPaymentMethod: 'paypal',
        paymentDetails: { email: 'bob@paypal.com' },
        selectedAt: new Date()
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-003',
        firstName: 'Charlie',
        lastName: 'Clark',
        email: 'charlie@example.com',
        settlementAmount: 1500,
        status: 'pending_selection',
        emailSent: true,
        emailSentAt: new Date(),
        linkClicked: true,
        linkClickedAt: new Date()
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-004',
        firstName: 'Diana',
        lastName: 'Davis',
        email: 'diana@example.com',
        settlementAmount: 1000,
        status: 'pending_selection',
        emailSent: true,
        emailSentAt: new Date()
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-005',
        firstName: 'Evan',
        lastName: 'Evans',
        email: 'evan@example.com',
        settlementAmount: 1000,
        status: 'pending_selection'
      }
    ]);

    // Create 1 open exception
    await ReconciliationException.create({
      caseId: testCase._id,
      claimId: 'CLM-001',
      amount: 2000,
      exceptionType: 'ach_return',
      returnCode: 'R01',
      returnReason: 'Insufficient Funds',
      resolved: false,
      resolutionStatus: 'open'
    });
  });

  describe('1. Authentication & Multi-Tenant Boundaries', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const resFunnel = await request(app).get(`/api/cases/${testCase._id}/analytics/funnel`);
      expect(resFunnel.status).toBe(401);

      const resMethods = await request(app).get(`/api/cases/${testCase._id}/analytics/methods`);
      expect(resMethods.status).toBe(401);

      const resSummary = await request(app).get(`/api/cases/${testCase._id}/analytics/summary`);
      expect(resSummary.status).toBe(401);

      const resCsv = await request(app).get(`/api/cases/${testCase._id}/audit-export`);
      expect(resCsv.status).toBe(401);
    });

    it('enforces fail-closed multi-tenant isolation returning 403 Forbidden for cross-tenant access', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/analytics/summary`)
        .set('Authorization', `Bearer ${otherFirmToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/tenant/i);
    });

    it('returns 404 for non-existent case ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/cases/${fakeId}/analytics/summary`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Case not found');
    });
  });

  describe('2. GET /api/cases/:id/analytics/funnel', () => {
    it('returns delivery funnel counts and calculated conversion rates', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/analytics/funnel`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const funnel = res.body;
      expect(funnel.uploaded).toBe(5);
      expect(funnel.dispatched).toBe(4);
      expect(funnel.delivered).toBe(4);
      expect(funnel.visited).toBe(3);
      expect(funnel.selected).toBe(2);
      expect(funnel.disbursed).toBe(1);

      expect(funnel.deliveryRate).toBe(100); // 4 delivered / 4 dispatched = 100%
      expect(funnel.conversionRate).toBeCloseTo(66.67, 1); // 2 selected / 3 visited = 66.67%
      expect(funnel.disbursementRate).toBe(50); // 1 disbursed / 2 selected = 50%

      expect(funnel.funnel).toHaveLength(6);
      expect(funnel.funnel[0].stage).toBe('uploaded');
      expect(funnel.funnel[5].stage).toBe('disbursed');
    });
  });

  describe('3. GET /api/cases/:id/analytics/methods', () => {
    it('returns payment rail breakdown covering all 9 rails', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/analytics/methods`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const data = res.body;
      expect(data.totalSelected).toBe(2);
      expect(data.totalAmount).toBe(3500); // 2000 (ach) + 1500 (paypal)

      const achMethod = data.methods.find((m: any) => m.method === 'ach');
      expect(achMethod).toBeDefined();
      expect(achMethod.count).toBe(1);
      expect(achMethod.totalAmount).toBe(2000);

      const paypalMethod = data.methods.find((m: any) => m.method === 'paypal');
      expect(paypalMethod).toBeDefined();
      expect(paypalMethod.count).toBe(1);
      expect(paypalMethod.totalAmount).toBe(1500);

      expect(data.methods).toHaveLength(9);
    });
  });

  describe('4. GET /api/cases/:id/analytics/summary', () => {
    it('returns financial KPI summary metrics and exception counts', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/analytics/summary`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const summary = res.body;
      expect(summary.settlementFundTotal).toBe(10000);
      expect(summary.totalClaimed).toBe(3500); // 2000 disbursed + 1500 selected
      expect(summary.totalDisbursed).toBe(2000);
      expect(summary.totalOutstanding).toBe(8000); // 10000 - 2000 disbursed
      expect(summary.openExceptionsCount).toBe(1);
    });
  });

  describe('5. GET /api/cases/:id/audit-export', () => {
    it('streams RFC 4180 CSV export with proper headers, BOM, and masked data', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/audit-export`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename="case_1_24-cv-00555_audit_ledger_');

      const csvContent = res.text;
      // Check UTF-8 BOM
      expect(csvContent.charCodeAt(0)).toBe(0xfeff);

      // Check header line
      expect(csvContent).toContain('Claim ID,Claimant Name,First Name,Last Name,Email');
      expect(csvContent).toContain('Masked Payment Details');
      expect(csvContent).toContain('Exception Status');

      // Check claimant rows and masking
      expect(csvContent).toContain('CLM-001');
      expect(csvContent).toContain('Anderson, Alice');
      expect(csvContent).toContain('Routing: 123456789, Account: ****2222');
      expect(csvContent).toContain('R01'); // Exception Code
      expect(csvContent).toContain('Insufficient Funds'); // Exception Notes

      expect(csvContent).toContain('CLM-002');
      expect(csvContent).toContain('Baker, Bob');
      expect(csvContent).toContain('PayPal: bob@paypal.com');
    });
  });
});
