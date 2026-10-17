import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  Case,
  Claimant,
  FraudScanEvent,
  MultiTenantThreatIndicator,
  FRAUD_RISK_TIERS,
  FRAUD_REVIEW_STATUSES,
  FRAUD_SIGNAL_CATEGORIES,
  FRAUD_SCAN_TYPES,
  THREAT_INDICATOR_TYPES
} from '../../src/models';
import {
  portalTelemetrySchema,
  fraudReviewActionSchema,
  fraudClaimantFilterSchema
} from '../../src/validation/fraud.validation';

describe('Workstream 1: JurisShield™ Fraud Data Models, Multi-Tenant Threat Registry & Zod Validation', () => {
  let testCaseId: mongoose.Types.ObjectId;
  let secondCaseId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await setupTestDb('fraud_models');

    await Promise.all([
      Case.init(),
      Claimant.init(),
      FraudScanEvent.init(),
      MultiTenantThreatIndicator.init()
    ]);
  });

  afterAll(async () => {
    await teardownTestDb('fraud_models');
  });

  beforeEach(async () => {
    await clearTestDb('fraud_models');

    testCaseId = new mongoose.Types.ObjectId();
    secondCaseId = new mongoose.Types.ObjectId();

    await Case.create({
      _id: testCaseId,
      name: 'In re Data Breach Settlement',
      docketNumber: '1:26-cv-00999',
      lawFirmId: 'FIRM-ALPHA',
      settlementFundTotal: 500000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  // =========================================================================
  // 1. Claimant Model Fraud Extensions & Negative Controls
  // =========================================================================
  describe('1. Claimant Model Fraud Scoring Extensions', () => {
    it('1.1 initializes new claimants with safe default fraud fields (score 0, tier low, status unscanned)', async () => {
      const claimant = await Claimant.create({
        caseId: testCaseId,
        claimId: 'CLM-FRAUD-001',
        firstName: 'Elena',
        lastName: 'Rostova',
        email: 'elena.rostova@example.com',
        settlementAmount: 250.0
      });

      expect(claimant.fraudScore).toBe(0);
      expect(claimant.fraudRiskTier).toBe('low');
      expect(claimant.fraudReviewStatus).toBe('unscanned');
      expect(claimant.fraudSignals).toEqual([]);
      expect(claimant.deviceFingerprintHash).toBeUndefined();
      expect(claimant.payoutEndpointHash).toBeUndefined();
    });

    it('1.2 persists full fraud scoring signals, review metadata, hashes, and portalSessionMetrics', async () => {
      const scannedAt = new Date();
      const reviewedAt = new Date(scannedAt.getTime() + 60_000);

      const claimant = await Claimant.create({
        caseId: testCaseId,
        claimId: 'CLM-FRAUD-002',
        firstName: 'Marcus',
        lastName: 'Vance',
        email: 'marcus.vance@tempmail.org',
        settlementAmount: 1450.5,
        fraudScore: 84,
        fraudRiskTier: 'critical',
        fraudReviewStatus: 'quarantined_blocked',
        fraudSignals: [
          {
            code: 'CROSS_TENANT_PAYOUT_COLLISION',
            category: 'payout_collision',
            severity: 'critical',
            scoreContribution: 35,
            description: 'Payout destination hash matches 4 distinct claimants across 3 tenant dockets.',
            detectedAt: scannedAt
          },
          {
            code: 'HEADLESS_WEBDRIVER_DETECTED',
            category: 'behavioral_bot',
            severity: 'high',
            scoreContribution: 20,
            description: 'navigator.webdriver flag detected with sub-2s submission speed.',
            detectedAt: scannedAt
          },
          {
            code: 'DISPOSABLE_EMAIL_DOMAIN',
            category: 'identity_domain',
            severity: 'medium',
            scoreContribution: 18,
            description: 'Email domain tempmail.org is a known disposable provider.',
            detectedAt: scannedAt
          },
          {
            code: 'IP_SUBNET_VELOCITY_BURST',
            category: 'velocity_device',
            severity: 'medium',
            scoreContribution: 11,
            description: 'Subnet 198.51.100.0/24 submitted 9 claims in 5 minutes.',
            detectedAt: scannedAt
          }
        ],
        fraudScannedAt: scannedAt,
        fraudReviewedBy: 'admin@firm-alpha.com',
        fraudReviewedAt: reviewedAt,
        fraudReviewNotes: 'Confirmed synthetic bot ring harvesting ACH payouts across cases.',
        deviceFingerprintHash: 'fp_sha256_9a8b7c6d5e4f3a2b1c0d',
        payoutEndpointHash: 'hmac_sha256_ach_routing_acct_e3b0c44298fc1c149afbf4c8996fb924',
        portalSessionMetrics: {
          dwellTimeMs: 1420,
          interactionCount: 2,
          keystrokeCount: 0,
          webdriverDetected: true,
          timezoneOffset: -300,
          screenResolution: '800x600'
        }
      });

      const found = await Claimant.findById(claimant._id);
      expect(found).not.toBeNull();
      expect(found?.fraudScore).toBe(84);
      expect(found?.fraudRiskTier).toBe('critical');
      expect(found?.fraudReviewStatus).toBe('quarantined_blocked');
      expect(found?.fraudSignals).toHaveLength(4);
      expect(found?.fraudSignals?.[0].code).toBe('CROSS_TENANT_PAYOUT_COLLISION');
      expect(found?.fraudSignals?.[0].category).toBe('payout_collision');
      expect(found?.fraudSignals?.[0].scoreContribution).toBe(35);
      expect(found?.deviceFingerprintHash).toBe('fp_sha256_9a8b7c6d5e4f3a2b1c0d');
      expect(found?.payoutEndpointHash).toBe(
        'hmac_sha256_ach_routing_acct_e3b0c44298fc1c149afbf4c8996fb924'
      );
      expect(found?.portalSessionMetrics?.dwellTimeMs).toBe(1420);
      expect(found?.portalSessionMetrics?.webdriverDetected).toBe(true);
      expect(found?.portalSessionMetrics?.screenResolution).toBe('800x600');
      expect(found?.fraudReviewedBy).toBe('admin@firm-alpha.com');
      expect(found?.fraudReviewNotes).toContain('synthetic bot ring');
    });

    it('1.3 [NEGATIVE CONTROL] rejects out-of-range fraudScore (fraudScore: 105 and fraudScore: -5)', async () => {
      await expect(
        Claimant.create({
          caseId: testCaseId,
          claimId: 'CLM-BAD-SCORE-HIGH',
          firstName: 'Bad',
          lastName: 'HighScore',
          email: 'high@example.com',
          settlementAmount: 100,
          fraudScore: 105
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        Claimant.create({
          caseId: testCaseId,
          claimId: 'CLM-BAD-SCORE-LOW',
          firstName: 'Bad',
          lastName: 'LowScore',
          email: 'low@example.com',
          settlementAmount: 100,
          fraudScore: -5
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('1.4 [NEGATIVE CONTROL] rejects invalid fraudRiskTier, fraudReviewStatus, and fraudSignal category', async () => {
      await expect(
        Claimant.create({
          caseId: testCaseId,
          claimId: 'CLM-BAD-TIER',
          firstName: 'Bad',
          lastName: 'Tier',
          email: 'tier@example.com',
          settlementAmount: 100,
          fraudRiskTier: 'catastrophic' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        Claimant.create({
          caseId: testCaseId,
          claimId: 'CLM-BAD-STATUS',
          firstName: 'Bad',
          lastName: 'Status',
          email: 'status@example.com',
          settlementAmount: 100,
          fraudReviewStatus: 'auto_bypassed' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        Claimant.create({
          caseId: testCaseId,
          claimId: 'CLM-BAD-SIGNAL',
          firstName: 'Bad',
          lastName: 'Signal',
          email: 'signal@example.com',
          settlementAmount: 100,
          fraudSignals: [
            {
              code: 'BAD_CAT',
              category: 'unknown_vector' as any,
              severity: 'high',
              scoreContribution: 20,
              description: 'Invalid category'
            }
          ]
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // =========================================================================
  // 2. FraudScanEvent Model & Telemetry Stream
  // =========================================================================
  describe('2. FraudScanEvent Model', () => {
    it('2.1 records a real-time scan event with defaults and indexed correlation metadata', async () => {
      const scanEvent = await FraudScanEvent.create({
        scanType: 'portal_submission',
        caseId: testCaseId,
        lawFirmId: 'FIRM-ALPHA',
        claimId: 'CLM-SCAN-001',
        fraudScore: 68,
        riskTier: 'high',
        reviewStatus: 'flagged_for_review',
        signalsTriggered: ['SAME_CASE_PAYOUT_COLLISION', 'FAST_DWELL_TIME'],
        scanDurationMs: 4,
        ipAddress: '203.0.113.42',
        ipSubnet: '203.0.113.0/24',
        emailDomain: 'mailinator.com',
        deviceFingerprintHash: 'fp_hash_001',
        payoutEndpointHash: 'payout_hash_001',
        settlementAmount: 425.75
      });

      expect(scanEvent._id).toBeDefined();
      expect(scanEvent.scanType).toBe('portal_submission');
      expect(scanEvent.fraudScore).toBe(68);
      expect(scanEvent.riskTier).toBe('high');
      expect(scanEvent.reviewStatus).toBe('flagged_for_review');
      expect(scanEvent.signalsTriggered).toEqual(['SAME_CASE_PAYOUT_COLLISION', 'FAST_DWELL_TIME']);
      expect(scanEvent.scanDurationMs).toBe(4);
      expect(scanEvent.emailDomain).toBe('mailinator.com');
      expect(scanEvent.settlementAmount).toBe(425.75);
      expect(scanEvent.createdAt).toBeInstanceOf(Date);
    });

    it('2.2 [NEGATIVE CONTROL] rejects FraudScanEvent with out-of-range fraudScore or invalid enums', async () => {
      await expect(
        FraudScanEvent.create({
          scanType: 'portal_submission',
          caseId: testCaseId,
          claimId: 'CLM-SCAN-BAD-1',
          fraudScore: 105,
          riskTier: 'critical',
          reviewStatus: 'quarantined_blocked'
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        FraudScanEvent.create({
          scanType: 'portal_submission',
          caseId: testCaseId,
          claimId: 'CLM-SCAN-BAD-2',
          fraudScore: -5,
          riskTier: 'low',
          reviewStatus: 'auto_cleared'
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        FraudScanEvent.create({
          scanType: 'invalid_scan_type' as any,
          caseId: testCaseId,
          claimId: 'CLM-SCAN-BAD-3',
          fraudScore: 25,
          riskTier: 'low',
          reviewStatus: 'auto_cleared'
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // =========================================================================
  // 3. MultiTenantThreatIndicator Model & Cross-Tenant Uniqueness
  // =========================================================================
  describe('3. MultiTenantThreatIndicator Model', () => {
    it('3.1 creates threat indicator with schema defaults and supports cross-tenant updates', async () => {
      const indicator = await MultiTenantThreatIndicator.create({
        indicatorType: 'payout_hash',
        indicatorValue: 'hmac_sha256_venmo_shared_handle_999',
        severity: 'high',
        caseIds: [testCaseId.toString()],
        lawFirmIds: ['FIRM-ALPHA'],
        description: 'Shared Venmo handle observed across multiple claimants'
      });

      expect(indicator._id).toBeDefined();
      expect(indicator.hitCount).toBe(1);
      expect(indicator.distinctCasesCount).toBe(1);
      expect(indicator.distinctTenantsCount).toBe(1);
      expect(indicator.blocked).toBe(false);
      expect(indicator.firstSeenAt).toBeInstanceOf(Date);
      expect(indicator.lastSeenAt).toBeInstanceOf(Date);

      // Simulate second hit from another tenant & case
      const updated = await MultiTenantThreatIndicator.findByIdAndUpdate(
        indicator._id,
        {
          $inc: { hitCount: 1, distinctCasesCount: 1, distinctTenantsCount: 1 },
          $addToSet: {
            caseIds: secondCaseId.toString(),
            lawFirmIds: 'FIRM-BETA'
          },
          $set: {
            severity: 'critical',
            blocked: true,
            lastSeenAt: new Date()
          }
        },
        { new: true }
      );

      expect(updated?.hitCount).toBe(2);
      expect(updated?.distinctCasesCount).toBe(2);
      expect(updated?.distinctTenantsCount).toBe(2);
      expect(updated?.caseIds).toHaveLength(2);
      expect(updated?.lawFirmIds).toEqual(expect.arrayContaining(['FIRM-ALPHA', 'FIRM-BETA']));
      expect(updated?.severity).toBe('critical');
      expect(updated?.blocked).toBe(true);
    });

    it('3.2 enforces compound unique index on { indicatorType: 1, indicatorValue: 1 }', async () => {
      await MultiTenantThreatIndicator.create({
        indicatorType: 'email_domain',
        indicatorValue: 'guerrillamail.com',
        severity: 'high',
        blocked: true
      });

      await expect(
        MultiTenantThreatIndicator.create({
          indicatorType: 'email_domain',
          indicatorValue: 'guerrillamail.com',
          severity: 'critical'
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('3.3 [NEGATIVE CONTROL] rejects invalid indicatorType, invalid severity, or hitCount < 1', async () => {
      await expect(
        MultiTenantThreatIndicator.create({
          indicatorType: 'browser_cookie' as any,
          indicatorValue: 'cookie_123'
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        MultiTenantThreatIndicator.create({
          indicatorType: 'ip_subnet',
          indicatorValue: '192.0.2.0/24',
          severity: 'severe' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        MultiTenantThreatIndicator.create({
          indicatorType: 'device_fingerprint',
          indicatorValue: 'fp_zero_hits',
          hitCount: 0
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // =========================================================================
  // 4. Zod Validation Schemas (fraud.validation.ts)
  // =========================================================================
  describe('4. Fraud Zod Validation Schemas', () => {
    it('4.1 portalTelemetrySchema accepts valid telemetry and optional undefined payload', () => {
      expect(portalTelemetrySchema.safeParse(undefined).success).toBe(true);
      expect(portalTelemetrySchema.safeParse({}).success).toBe(true);

      const validPayload = {
        dwellTimeMs: 14520,
        interactionCount: 24,
        keystrokeCount: 16,
        webdriverDetected: false,
        deviceFingerprint: 'fp_canvas_webgl_99887766',
        timezoneOffset: 420,
        screenResolution: '2560x1440'
      };
      const result = portalTelemetrySchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.dwellTimeMs).toBe(14520);
        expect(result.data?.deviceFingerprint).toBe('fp_canvas_webgl_99887766');
      }
    });

    it('4.2 [NEGATIVE CONTROL] portalTelemetrySchema rejects negative dwellTimeMs or interactionCount', () => {
      expect(portalTelemetrySchema.safeParse({ dwellTimeMs: -250 }).success).toBe(false);
      expect(portalTelemetrySchema.safeParse({ interactionCount: -1 }).success).toBe(false);
      expect(portalTelemetrySchema.safeParse({ keystrokeCount: -3 }).success).toBe(false);
      expect(portalTelemetrySchema.safeParse({ timezoneOffset: 2000 }).success).toBe(false);
    });

    it('4.3 fraudReviewActionSchema validates approve/reject actions and enforces notes length', () => {
      const approveResult = fraudReviewActionSchema.safeParse({
        action: 'approve',
        notes: 'Verified claimant identity via secondary government ID inspection.'
      });
      expect(approveResult.success).toBe(true);

      const rejectResult = fraudReviewActionSchema.safeParse({
        action: 'reject',
        notes: 'Confirmed synthetic identity linked to compromised payout routing account.'
      });
      expect(rejectResult.success).toBe(true);
    });

    it('4.4 [NEGATIVE CONTROL] fraudReviewActionSchema rejects invalid actions or empty/short notes', () => {
      expect(
        fraudReviewActionSchema.safeParse({
          action: 'ignore',
          notes: 'Valid length notes here'
        }).success
      ).toBe(false);

      expect(
        fraudReviewActionSchema.safeParse({
          action: 'approve',
          notes: ''
        }).success
      ).toBe(false);

      expect(
        fraudReviewActionSchema.safeParse({
          action: 'approve',
          notes: '   '
        }).success
      ).toBe(false);

      expect(
        fraudReviewActionSchema.safeParse({
          action: 'reject',
          notes: 'ab'
        }).success
      ).toBe(false);
    });

    it('4.5 fraudClaimantFilterSchema coerces query parameters and rejects invalid filter values', () => {
      const parsed = fraudClaimantFilterSchema.safeParse({
        riskTier: 'high',
        reviewStatus: 'flagged_for_review',
        signalCode: 'CROSS_TENANT_PAYOUT_COLLISION',
        minScore: '60',
        page: '2',
        limit: '50'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.minScore).toBe(60);
        expect(parsed.data.page).toBe(2);
        expect(parsed.data.limit).toBe(50);
      }

      // Defaults when empty query provided
      const defaults = fraudClaimantFilterSchema.parse({});
      expect(defaults.page).toBe(1);
      expect(defaults.limit).toBe(25);

      // Negative controls
      expect(fraudClaimantFilterSchema.safeParse({ riskTier: 'invalid_tier' }).success).toBe(false);
      expect(fraudClaimantFilterSchema.safeParse({ reviewStatus: 'invalid_status' }).success).toBe(false);
      expect(fraudClaimantFilterSchema.safeParse({ minScore: '150' }).success).toBe(false);
      expect(fraudClaimantFilterSchema.safeParse({ minScore: '-10' }).success).toBe(false);
      expect(fraudClaimantFilterSchema.safeParse({ limit: '500' }).success).toBe(false);
    });
  });

  // =========================================================================
  // 5. Barrel Exports Verification
  // =========================================================================
  describe('5. Model Barrel Exports', () => {
    it('5.1 exports all fraud models and constant arrays from server/src/models/index.ts', () => {
      expect(Claimant).toBeDefined();
      expect(FraudScanEvent).toBeDefined();
      expect(MultiTenantThreatIndicator).toBeDefined();
      expect(FRAUD_RISK_TIERS).toEqual(['low', 'medium', 'high', 'critical']);
      expect(FRAUD_REVIEW_STATUSES).toEqual([
        'unscanned',
        'auto_cleared',
        'flagged_for_review',
        'quarantined_blocked',
        'manually_approved',
        'manually_rejected'
      ]);
      expect(FRAUD_SIGNAL_CATEGORIES).toEqual([
        'payout_collision',
        'velocity_device',
        'behavioral_bot',
        'identity_domain'
      ]);
      expect(FRAUD_SCAN_TYPES).toEqual([
        'portal_submission',
        'ingestion_prescan',
        'manual_rescan',
        'pre_sftp_gate'
      ]);
      expect(THREAT_INDICATOR_TYPES).toEqual([
        'payout_hash',
        'device_fingerprint',
        'ip_subnet',
        'email_domain'
      ]);
    });
  });
});
