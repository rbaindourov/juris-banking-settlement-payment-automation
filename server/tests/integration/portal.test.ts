import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { Case } from '../../src/models/Case';

describe('Claimant Portal Public API Integration Tests (/api/public/claim)', () => {
  beforeAll(async () => {
    await setupTestDb('portal_integration');
  });

  afterAll(async () => {
    await teardownTestDb('portal_integration');
  });

  beforeEach(async () => {
    await clearTestDb('portal_integration');
  });

  describe('GET /api/public/claim/:token', () => {
    it('returns 200 OK with sanitized claim, case, and localized landing text', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Hill House Settlement',
        docketNumber: '1:24-cv-09821',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'es'],
        landingPageText: {
          headline: 'Official Settlement Payment Portal',
          introHtml: '<p>Please elect your payment method below.</p>',
          faqAccordion: [
            { question: 'When are funds disbursed?', answer: 'Within 14 business days.' }
          ]
        }
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-10029',
        firstName: 'Eleanor',
        lastName: 'Vance',
        email: 'eleanor.vance@example.com',
        settlementAmount: 325.5,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/claim/${token}`);

      expect(res.status).toBe(200);
      expect(res.body.claim).toBeDefined();
      expect(res.body.claim.token).toBe(token);
      expect(res.body.claim.claimId).toBe('CLM-10029');
      expect(res.body.claim.firstName).toBe('Eleanor');
      expect(res.body.claim.lastName).toBe('Vance');
      expect(res.body.claim.settlementAmount).toBe(325.5);
      expect(res.body.claim.formattedAwardAmount).toBe('$325.50');
      expect(res.body.claim.status).toBe('pending_selection');
      expect(res.body.claim.isExpired).toBe(false);

      expect(res.body.case).toBeDefined();
      expect(res.body.case.name).toBe('In re Hill House Settlement');
      expect(res.body.case.docketNumber).toBe('1:24-cv-09821');
      expect(res.body.case.landingPageText.headline).toBe('Official Settlement Payment Portal');
    });

    it('returns effective status "expired" and isExpired=true when disbursement deadline has passed', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const pastDeadline = new Date(Date.now() - 3600000 * 24); // 1 day ago
      const testCase = await Case.create({
        name: 'In re Past Deadline Case',
        docketNumber: '1:24-cv-09999',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: pastDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-EXPIRED-01',
        firstName: 'Arthur',
        lastName: 'Dent',
        email: 'arthur.dent@example.com',
        settlementAmount: 42.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/claim/${token}`);

      expect(res.status).toBe(200);
      expect(res.body.claim.isExpired).toBe(true);
      expect(res.body.claim.status).toBe('expired');
      expect(res.body.claim.assignedFallbackMethod).toBe('physical_check');
    });

    it('returns 400 for malformed token format', async () => {
      const res = await request(app).get('/api/public/claim/short-invalid-token');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_TOKEN_FORMAT');
    });

    it('returns 404 CLAIM_NOT_FOUND for non-existent token without leaking metadata', async () => {
      const token = '0000000000000000000000000000000000000000000000000000000000000000';
      const res = await request(app).get(`/api/public/claim/${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CLAIM_NOT_FOUND');
      expect(res.body).not.toHaveProperty('databaseQuery');
      expect(res.body).not.toHaveProperty('stack');
    });
  });

  describe('POST /api/public/claim/:token/select-payment', () => {
    it('rejects with 403 DEADLINE_PASSED if election is attempted after deadline', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const pastDeadline = new Date(Date.now() - 3600000); // 1 hour ago
      const testCase = await Case.create({
        name: 'In re Expired Settlement',
        docketNumber: '1:24-cv-09822',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: pastDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-EXP-02',
        firstName: 'Luke',
        lastName: 'Skywalker',
        email: 'luke@example.com',
        settlementAmount: 250.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app)
        .post(`/api/public/claim/${token}/select-payment`)
        .send({
          method: 'physical_check',
          details: {
            recipientName: 'Luke Skywalker',
            street1: '100 Dune Road',
            city: 'Mos Eisley',
            state: 'CA',
            zip: '90210'
          },
          certificationAffirmed: true,
          signature: 'Luke Skywalker'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('DEADLINE_PASSED');
      expect(res.body.assignedFallbackMethod).toBe('physical_check');
    });

    it('rejects with 400 CERTIFICATION_REQUIRED if perjury certification is not affirmed', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Active Case',
        docketNumber: '1:24-cv-09823',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-ACTIVE-01',
        firstName: 'Leia',
        lastName: 'Organa',
        email: 'leia@example.com',
        settlementAmount: 500.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app)
        .post(`/api/public/claim/${token}/select-payment`)
        .send({
          method: 'paypal',
          details: { paypalAccount: 'leia@example.com' },
          certificationAffirmed: false,
          signature: 'Leia Organa'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('CERTIFICATION_REQUIRED');
    });

    it('rejects with 400 SIGNATURE_REQUIRED if signature is missing or too short', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Active Case',
        docketNumber: '1:24-cv-09823',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-ACTIVE-02',
        firstName: 'Han',
        lastName: 'Solo',
        email: 'han@example.com',
        settlementAmount: 500.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app)
        .post(`/api/public/claim/${token}/select-payment`)
        .send({
          method: 'paypal',
          details: { paypalAccount: 'han@example.com' },
          certificationAffirmed: true,
          signature: ' '
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SIGNATURE_REQUIRED');
    });

    it('successfully processes ACH selection: updates status to "selected", captures audit trail, returns confirmation receipt', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Hill House Settlement',
        docketNumber: '1:24-cv-09821',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-10029',
        firstName: 'Eleanor',
        lastName: 'Vance',
        email: 'eleanor.vance@example.com',
        settlementAmount: 325.5,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app)
        .post(`/api/public/claim/${token}/select-payment`)
        .send({
          method: 'ach',
          details: {
            routingNumber: '021000021',
            accountNumber: '1234567890',
            confirmAccountNumber: '1234567890',
            accountType: 'checking',
            bankName: 'JPMorgan Chase'
          },
          certificationAffirmed: true,
          signature: 'Eleanor Vance'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('selected');
      expect(res.body.confirmationNumber).toMatch(/^CONF-\d{4}-/);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.claimantName).toBe('Eleanor Vance');
      expect(res.body.receipt.amount).toBe(325.5);
      expect(res.body.receipt.digitalSignature).toBe('Eleanor Vance');
      expect(res.body.receipt.ipAddress).toBeDefined();

      // Verify claimant persistence in database
      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant?.status).toBe('selected');
      expect(updatedClaimant?.selectedPaymentMethod).toBe('ach');
      expect(updatedClaimant?.confirmationNumber).toBe(res.body.confirmationNumber);
      expect(updatedClaimant?.digitalSignature).toBe('Eleanor Vance');
      expect(updatedClaimant?.certificationAffirmed).toBe(true);
      expect(updatedClaimant?.signedAt).toBeInstanceOf(Date);
      expect(updatedClaimant?.paymentDetails?.encryptedAccountNumber).toBeDefined();
      expect(updatedClaimant?.paymentDetails?.accountNumberMasked).toBe('******7890');
    });
  });

  describe('GET /api/public/claim/:token/receipt', () => {
    it('returns receipt data for confirmed claim election', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Hill House Settlement',
        docketNumber: '1:24-cv-09821',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const receiptObj = {
        confirmationNumber: 'CONF-2026-HILL-9912',
        claimId: 'CLM-10029',
        claimantName: 'Eleanor Vance',
        caseName: 'In re Hill House Settlement',
        docketNumber: '1:24-cv-09821',
        selectedMethod: 'ach',
        amount: 325.5,
        formattedAmount: '$325.50',
        timestamp: new Date().toISOString(),
        digitalSignature: 'Eleanor Vance',
        ipAddress: '127.0.0.1',
        maskedDetails: { accountNumberMasked: '******7890' }
      };

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-10029',
        firstName: 'Eleanor',
        lastName: 'Vance',
        email: 'eleanor.vance@example.com',
        settlementAmount: 325.5,
        status: 'selected',
        paymentSelectionToken: token,
        confirmationNumber: 'CONF-2026-HILL-9912',
        receiptDetails: receiptObj
      });

      const res = await request(app).get(`/api/public/claim/${token}/receipt`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.receipt.confirmationNumber).toBe('CONF-2026-HILL-9912');
      expect(res.body.receipt.digitalSignature).toBe('Eleanor Vance');
    });

    it('returns 400 NO_RECEIPT_AVAILABLE when claimant has not elected payment yet', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Hill House Settlement',
        docketNumber: '1:24-cv-09821',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-UNSELECTED-01',
        firstName: 'Pending',
        lastName: 'Person',
        email: 'pending@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/claim/${token}/receipt`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NO_RECEIPT_AVAILABLE');
    });
  });
});
