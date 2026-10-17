import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  Case,
  Claimant,
  MultiTenantThreatIndicator
} from '../../src/models';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';
import { signToken } from '../../src/utils/jwt';

describe('Adversarial & Negative-Control Suite: Multi-Tenant Bot Farm Attack & SFTP Quarantine Gate', () => {
  let firmAAdminToken: string;
  let firmBAdminToken: string;
  let caseFirmA: any;
  let caseFirmB: any;

  beforeAll(async () => {
    await setupTestDb('fraud_adversarial');

    firmAAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@lawfirm-a.com',
      role: 'law_firm_admin',
      lawFirmId: 'LawFirm-A'
    });

    firmBAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@lawfirm-b.com',
      role: 'law_firm_admin',
      lawFirmId: 'LawFirm-B'
    });
  });

  afterAll(async () => {
    await teardownTestDb('fraud_adversarial');
  });

  beforeEach(async () => {
    await clearTestDb('fraud_adversarial');

    caseFirmA = await Case.create({
      name: 'LawFirm-A Biometric Privacy Docket',
      docketNumber: '1:26-cv-70001',
      lawFirmId: 'LawFirm-A',
      settlementFundTotal: 500000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    caseFirmB = await Case.create({
      name: 'LawFirm-B Antitrust Settlement Docket',
      docketNumber: '2:26-cv-80002',
      lawFirmId: 'LawFirm-B',
      settlementFundTotal: 500000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  it('1. intercepts a coordinated multi-tenant bot farm attack across LawFirm-A and LawFirm-B, quarantines bot claims from Dash Solutions SFTP batches, and releases only manually approved claims', async () => {
    // 1. Seed 2 legitimate human claimants in LawFirm-B
    const humanToken1 = crypto.randomBytes(32).toString('hex');
    const humanToken2 = crypto.randomBytes(32).toString('hex');

    await Claimant.create([
      {
        caseId: caseFirmB._id,
        claimId: 'CLM-HUMAN-01',
        firstName: 'Clara',
        lastName: 'Oswald',
        email: 'clara.oswald@example.org',
        settlementAmount: 425.0,
        status: 'pending_selection',
        paymentSelectionToken: humanToken1
      },
      {
        caseId: caseFirmB._id,
        claimId: 'CLM-HUMAN-02',
        firstName: 'Rory',
        lastName: 'Williams',
        email: 'rory.williams@example.org',
        settlementAmount: 375.0,
        status: 'pending_selection',
        paymentSelectionToken: humanToken2
      }
    ]);

    // Legitimate humans submit normal elections
    const hRes1 = await request(app)
      .post(`/api/public/claim/${humanToken1}/select-payment`)
      .send({
        method: 'ach',
        details: {
          routingNumber: '021000021',
          accountNumber: '111122223333',
          confirmAccountNumber: '111122223333',
          accountType: 'checking',
          bankName: 'Chase'
        },
        certificationAffirmed: true,
        signature: 'Clara Oswald',
        telemetry: {
          dwellTimeMs: 18400,
          interactionCount: 24,
          keystrokeCount: 16,
          webdriverDetected: false,
          deviceFingerprint: 'human-device-clara-01'
        }
      });
    expect(hRes1.status).toBe(200);
    expect(hRes1.body.securityVerification.fraudScore).toBe(0);
    expect(hRes1.body.securityVerification.shieldStatus).toBe('verified');

    const hRes2 = await request(app)
      .post(`/api/public/claim/${humanToken2}/select-payment`)
      .send({
        method: 'paypal',
        details: { paypalAccount: 'rory.williams@example.org' },
        certificationAffirmed: true,
        signature: 'Rory Williams',
        telemetry: {
          dwellTimeMs: 15200,
          interactionCount: 19,
          keystrokeCount: 14,
          webdriverDetected: false,
          deviceFingerprint: 'human-device-rory-02'
        }
      });
    expect(hRes2.status).toBe(200);
    expect(hRes2.body.securityVerification.fraudScore).toBe(0);

    // 2. Simulate Bot Farm seeding 4 claims in LawFirm-A and 4 claims in LawFirm-B
    // sharing the same Venmo & ACH mule accounts, headless WebDriver, < 1000ms dwell time, and 198.51.100.0/24 subnet
    const sharedMuleVenmo = '@syndicate-mule-vault';
    const sharedBotFingerprint = 'headless-puppeteer-cluster-node-7';

    const botClaimsFirmA: Array<{ token: string; claimId: string }> = [];
    for (let i = 1; i <= 4; i++) {
      const token = crypto.randomBytes(32).toString('hex');
      const claimId = `CLM-BOT-A-${i}`;
      botClaimsFirmA.push({ token, claimId });
      await Claimant.create({
        caseId: caseFirmA._id,
        claimId,
        firstName: `SyntheticA${i}`,
        lastName: 'Bot',
        email: `syn.a${i}@mailinator.com`,
        settlementAmount: 1000,
        status: 'pending_selection',
        paymentSelectionToken: token
      });
    }

    const botClaimsFirmB: Array<{ token: string; claimId: string; docId?: string }> = [];
    for (let i = 1; i <= 4; i++) {
      const token = crypto.randomBytes(32).toString('hex');
      const claimId = `CLM-BOT-B-${i}`;
      const doc = await Claimant.create({
        caseId: caseFirmB._id,
        claimId,
        firstName: `SyntheticB${i}`,
        lastName: 'Bot',
        email: `syn.b${i}@guerrillamail.com`,
        settlementAmount: 1500,
        status: 'pending_selection',
        paymentSelectionToken: token
      });
      botClaimsFirmB.push({ token, claimId, docId: doc._id.toString() });
    }

    // Fire rapid submissions across LawFirm-A
    for (let i = 0; i < botClaimsFirmA.length; i++) {
      const res = await request(app)
        .post(`/api/public/claim/${botClaimsFirmA[i].token}/select-payment`)
        .set('X-Forwarded-For', `198.51.100.${10 + i}`)
        .send({
          method: 'venmo',
          details: { venmoIdentifier: sharedMuleVenmo },
          certificationAffirmed: true,
          signature: `SyntheticA${i + 1} Bot`,
          telemetry: {
            dwellTimeMs: 420,
            interactionCount: 0,
            keystrokeCount: 0,
            webdriverDetected: true,
            deviceFingerprint: sharedBotFingerprint
          }
        });
      expect(res.status).toBe(200);
    }

    // Fire rapid submissions across LawFirm-B (cross-tenant docket!)
    for (let i = 0; i < botClaimsFirmB.length; i++) {
      const res = await request(app)
        .post(`/api/public/claim/${botClaimsFirmB[i].token}/select-payment`)
        .set('X-Forwarded-For', `198.51.100.${50 + i}`)
        .send({
          method: 'venmo',
          details: { venmoIdentifier: sharedMuleVenmo },
          certificationAffirmed: true,
          signature: `SyntheticB${i + 1} Bot`,
          telemetry: {
            dwellTimeMs: 380,
            interactionCount: 0,
            keystrokeCount: 0,
            webdriverDetected: true,
            deviceFingerprint: sharedBotFingerprint
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.securityVerification.fraudScore).toBeGreaterThanOrEqual(80);
      expect(res.body.securityVerification.riskTier).toBe('critical');
      expect(res.body.securityVerification.shieldStatus).toBe('quarantined');
    }

    // Verify all 4 bot claims in LawFirm-B have fraudReviewStatus === 'quarantined_blocked' and triggered cross-tenant + velocity signals
    const dbBotClaimsB = await Claimant.find({
      caseId: caseFirmB._id,
      claimId: { $regex: /^CLM-BOT-B-/ }
    });
    expect(dbBotClaimsB).toHaveLength(4);
    for (const botClaim of dbBotClaimsB) {
      expect(botClaim.fraudScore).toBeGreaterThanOrEqual(80);
      expect(botClaim.fraudRiskTier).toBe('critical');
      expect(botClaim.fraudReviewStatus).toBe('quarantined_blocked');
      const codes = (botClaim.fraudSignals || []).map((s) => s.code);
      expect(codes).toContain('CROSS_TENANT_PAYOUT_COLLISION');
      expect(codes).toContain('DEVICE_FINGERPRINT_COLLISION');
      expect(codes).toContain('IP_SUBNET_VELOCITY_BURST');
      expect(codes).toContain('HEADLESS_WEBDRIVER_DETECTED');
      expect(codes).toContain('SUBMISSION_SPEED_BOT');
    }

    // Verify MultiTenantThreatIndicator recorded cross-tenant collision across 2 cases and 2 law firms
    const payoutIndicator = await MultiTenantThreatIndicator.findOne({
      indicatorType: 'payout_hash'
    });
    expect(payoutIndicator).not.toBeNull();
    expect(payoutIndicator!.distinctCasesCount).toBe(2);
    expect(payoutIndicator!.distinctTenantsCount).toBe(2);
    expect(payoutIndicator!.blocked).toBe(true);

    // 3. NEGATIVE CONTROL: Compile Dash Solutions SFTP Batch for LawFirm-B
    // Only the 2 legitimate human claims ($425 + $375 = $800) must enter the batch; all 4 quarantined bot claims ($6,000) MUST be blocked!
    const batch1 = await BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmB._id.toString());
    expect(batch1.totalRecords).toBe(2);
    expect(batch1.totalAmount).toBe(800);
    expect(batch1.csvContent).toContain('CLM-HUMAN-01');
    expect(batch1.csvContent).toContain('CLM-HUMAN-02');
    expect(batch1.csvContent).not.toContain('CLM-BOT-B-1');
    expect(batch1.csvContent).not.toContain('CLM-BOT-B-2');

    // Attempt a second SFTP batch while only quarantined claims remain -> must throw MIN_RECORDS
    await expect(
      BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmB._id.toString())
    ).rejects.toThrow(/MIN_RECORDS/);

    // 4. LawFirm-B Admin manually approves 1 quarantined claim after out-of-band identity verification
    const targetClaimId = botClaimsFirmB[0].docId!;
    const approveRes = await request(app)
      .post(`/api/cases/${caseFirmB._id}/fraud/claimants/${targetClaimId}/review`)
      .set('Authorization', `Bearer ${firmBAdminToken}`)
      .send({
        action: 'approve',
        notes: 'Verified government ID and utility bill matching class member.'
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.claimant.fraudReviewStatus).toBe('manually_approved');

    // 5. Next SFTP batch now includes ONLY the 1 manually approved claim ($1,500), while the other 3 remain quarantined
    const batch2 = await BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmB._id.toString());
    expect(batch2.totalRecords).toBe(1);
    expect(batch2.totalAmount).toBe(1500);
    expect(batch2.csvContent).toContain('CLM-BOT-B-1');
    expect(batch2.csvContent).not.toContain('CLM-BOT-B-2');
  });
});
