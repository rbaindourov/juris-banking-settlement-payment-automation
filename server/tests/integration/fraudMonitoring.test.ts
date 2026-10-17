import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case, Claimant } from '../../src/models';
import { signToken } from '../../src/utils/jwt';

describe('Integration: Fraud Monitoring REST APIs & Portal JurisShield™ Verification', () => {
  let adminToken: string;
  let auditorToken: string;
  let otherFirmToken: string;
  let testCase: any;

  beforeAll(async () => {
    await setupTestDb('fraud_monitoring_integration');

    adminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-alpha.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-ALPHA'
    });

    auditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-alpha.com',
      role: 'auditor',
      lawFirmId: 'FIRM-ALPHA'
    });

    otherFirmToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-other.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-OTHER-999'
    });
  });

  afterAll(async () => {
    await teardownTestDb('fraud_monitoring_integration');
  });

  beforeEach(async () => {
    await clearTestDb('fraud_monitoring_integration');

    testCase = await Case.create({
      name: 'In re Apex Fintech Settlement',
      docketNumber: '1:26-cv-55001',
      lawFirmId: 'FIRM-ALPHA',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  it('1. evaluates fraud telemetry on POST /api/public/claim/:token/select-payment and embeds securityVerification seal', async () => {
    const token1 = crypto.randomBytes(32).toString('hex');
    const token2 = crypto.randomBytes(32).toString('hex');

    await Claimant.create([
      {
        caseId: testCase._id,
        claimId: 'CLM-PORTAL-01',
        firstName: 'Alice',
        lastName: 'Walker',
        email: 'alice.walker@example.com',
        settlementAmount: 600,
        status: 'pending_selection',
        paymentSelectionToken: token1
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-PORTAL-02',
        firstName: 'Bob',
        lastName: 'Botter',
        email: 'bob.botter@mailinator.com',
        settlementAmount: 1200,
        status: 'pending_selection',
        paymentSelectionToken: token2
      }
    ]);

    // 1st submission: legitimate human using Venmo @sharedwallet99
    const res1 = await request(app)
      .post(`/api/public/claim/${token1}/select-payment`)
      .send({
        method: 'venmo',
        details: { venmoIdentifier: '@sharedwallet99' },
        certificationAffirmed: true,
        signature: 'Alice Walker',
        telemetry: {
          dwellTimeMs: 14500,
          interactionCount: 18,
          keystrokeCount: 12,
          webdriverDetected: false,
          deviceFingerprint: 'human-macbook-safari-01'
        }
      });

    expect(res1.status).toBe(200);
    expect(res1.body.securityVerification).toBeDefined();
    expect(res1.body.securityVerification.fraudScore).toBe(0);
    expect(res1.body.securityVerification.riskTier).toBe('low');
    expect(res1.body.securityVerification.shieldStatus).toBe('verified');
    expect(res1.body.receipt.securityVerification).toEqual(res1.body.securityVerification);

    // 2nd submission: automated bot using the SAME Venmo @sharedwallet99 + webdriver + speed < 4s + mailinator
    const res2 = await request(app)
      .post(`/api/public/claim/${token2}/select-payment`)
      .send({
        method: 'venmo',
        details: { venmoIdentifier: '@sharedwallet99' },
        certificationAffirmed: true,
        signature: 'Bob Botter',
        telemetry: {
          dwellTimeMs: 750,
          interactionCount: 0,
          keystrokeCount: 0,
          webdriverDetected: true,
          deviceFingerprint: 'headless-bot-rig-99'
        }
      });

    expect(res2.status).toBe(200);
    expect(res2.body.securityVerification).toBeDefined();
    // 30 (same-case payout collision) + 20 (webdriver) + 15 (dwellTime) + 12 (zero interaction) + 18 (mailinator) = 95
    expect(res2.body.securityVerification.fraudScore).toBeGreaterThanOrEqual(80);
    expect(res2.body.securityVerification.riskTier).toBe('critical');
    expect(res2.body.securityVerification.shieldStatus).toBe('quarantined');
  });

  it('2. returns real-time scanning metrics, filterable claimants, manual adjudication, rescan, and network intelligence', async () => {
    const c1 = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-M-01',
      firstName: 'Human',
      lastName: 'Member',
      email: 'human@example.com',
      settlementAmount: 500,
      status: 'selected',
      selectedPaymentMethod: 'paypal',
      paymentDetails: { paypalAccount: 'human@example.com' }
    });

    const c2 = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-M-02',
      firstName: 'Flagged',
      lastName: 'Actor',
      email: 'actor@tempmail.com',
      settlementAmount: 2500,
      status: 'selected',
      selectedPaymentMethod: 'paypal',
      paymentDetails: { paypalAccount: 'human@example.com' },
      portalSessionMetrics: {
        dwellTimeMs: 900,
        interactionCount: 0,
        keystrokeCount: 0,
        webdriverDetected: true
      }
    });

    // 1. TriggerPOST /api/cases/:caseId/fraud/rescan
    const rescanRes = await request(app)
      .post(`/api/cases/${testCase._id}/fraud/rescan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(rescanRes.status).toBe(200);
    expect(rescanRes.body.scannedCount).toBe(2);
    expect(rescanRes.body.quarantinedCount).toBe(1);

    // 2. GET /api/cases/:caseId/fraud/metrics
    const metricsRes = await request(app)
      .get(`/api/cases/${testCase._id}/fraud/metrics`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.totalClaimants).toBe(2);
    expect(metricsRes.body.scannedClaimants).toBe(2);
    expect(metricsRes.body.totalProtectedAmount).toBe(2500);
    expect(metricsRes.body.riskTierBreakdown.critical).toBe(1);
    expect(metricsRes.body.reviewStatusBreakdown.quarantined_blocked).toBe(1);

    // 3. Cross-tenant access control negative check
    const crossTenantRes = await request(app)
      .get(`/api/cases/${testCase._id}/fraud/metrics`)
      .set('Authorization', `Bearer ${otherFirmToken}`);
    expect(crossTenantRes.status).toBe(403);

    // 4. GET /api/cases/:caseId/fraud/claimants with minScore filter
    const listRes = await request(app)
      .get(`/api/cases/${testCase._id}/fraud/claimants?minScore=60&riskTier=critical`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.claimants[0].claimId).toBe('CLM-M-02');

    // 5. Negative control: auditor role cannot adjudicate claims (403)
    const auditorReviewRes = await request(app)
      .post(`/api/cases/${testCase._id}/fraud/claimants/${c2._id}/review`)
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ action: 'approve', notes: 'Auditor attempting manual override' });
    expect(auditorReviewRes.status).toBe(403);

    // 6. Admin adjudicates (approves) the quarantined claim
    const reviewRes = await request(app)
      .post(`/api/cases/${testCase._id}/fraud/claimants/${c2._id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'approve',
        notes: 'Verified identity documents via notarized affidavit.'
      });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.claimant.fraudReviewStatus).toBe('manually_approved');
    expect(reviewRes.body.claimant.fraudReviewedBy).toBe('admin@firm-alpha.com');

    // 7. GET /api/fraud/network-intelligence
    const intelRes = await request(app)
      .get('/api/fraud/network-intelligence')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(intelRes.status).toBe(200);
    expect(intelRes.body.totalCasesMonitored).toBeGreaterThanOrEqual(1);
    expect(intelRes.body.disposableDomainsBlocked).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(intelRes.body.recentIndicators)).toBe(true);
  });
});
