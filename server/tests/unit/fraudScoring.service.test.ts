import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { FraudScoringService } from '../../src/services/fraudScoring.service';
import { encryptAes256Gcm } from '../../src/services/portalValidation.service';
import {
  Case,
  Claimant,
  FraudScanEvent,
  MultiTenantThreatIndicator,
  SuppressionList
} from '../../src/models';

describe('Unit: FraudScoringService (4-Vector Scoring, HMAC Payout Hashing & Multi-Tenant Correlation)', () => {
  let caseAlpha: any;
  let caseBeta: any;

  beforeAll(async () => {
    await setupTestDb('fraud_scoring_unit');
  });

  afterAll(async () => {
    await teardownTestDb('fraud_scoring_unit');
  });

  beforeEach(async () => {
    await clearTestDb('fraud_scoring_unit');

    caseAlpha = await Case.create({
      name: 'In re Alpha Consumer Privacy Litigation',
      docketNumber: '1:26-cv-10101',
      lawFirmId: 'FIRM-ALPHA',
      settlementFundTotal: 250000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    caseBeta = await Case.create({
      name: 'In re Beta Telecom Settlement',
      docketNumber: '2:26-cv-20202',
      lawFirmId: 'FIRM-BETA',
      settlementFundTotal: 500000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  describe('1. Canonical Payout Endpoint Normalization & Salted HMAC-SHA256 Hashing (All 9 Rails)', () => {
    it('1.1 normalizes and hashes ACH / direct_deposit identically for raw and AES-256-GCM encrypted account numbers', () => {
      const routingNumber = '021000021';
      const accountNumber = '9876543210';
      const encryptedAccountNumber = encryptAes256Gcm(accountNumber);

      const rawHash = FraudScoringService.computePayoutEndpointHash('ach', {
        routingNumber,
        accountNumber
      });

      const encryptedHash = FraudScoringService.computePayoutEndpointHash('direct_deposit', {
        routingNumber,
        encryptedAccountNumber
      });

      expect(rawHash).toBeDefined();
      expect(rawHash).toMatch(/^[a-f0-9]{64}$/);
      expect(encryptedHash).toBe(rawHash);
    });

    it('1.2 normalizes and hashes debit_card / push_to_debit by PAN, tokenRef, or cardLast4', () => {
      const h1 = FraudScoringService.computePayoutEndpointHash('debit_card', {
        cardNumber: '4111-1111-1111-1111'
      });
      const h2 = FraudScoringService.computePayoutEndpointHash('push_to_debit', {
        cardNumber: '4111111111111111',
        tokenRef: 'tok_random_123'
      });
      const hToken = FraudScoringService.computePayoutEndpointHash('debit_card', {
        tokenRef: 'tok_fixed_999'
      });

      expect(h1).toBeDefined();
      expect(h1).toBe(h2);
      expect(hToken).toBeDefined();
      expect(hToken).not.toBe(h1);
    });

    it('1.3 normalizes and hashes PayPal, Venmo, Zelle, Bitcoin, Physical Check, and Digital Card rails deterministically', () => {
      // PayPal case-insensitivity
      const pp1 = FraudScoringService.computePayoutEndpointHash('paypal', {
        paypalAccount: 'PayoutUser@Example.COM '
      });
      const pp2 = FraudScoringService.computePayoutEndpointHash('paypal', {
        paypalEmail: 'payoutuser@example.com'
      });
      expect(pp1).toBe(pp2);

      // Venmo handle @-stripping and case-insensitivity
      const v1 = FraudScoringService.computePayoutEndpointHash('venmo', {
        venmoIdentifier: '@BotSyndicateWallet'
      });
      const v2 = FraudScoringService.computePayoutEndpointHash('venmo', {
        venmoHandle: 'botsyndicatewallet'
      });
      expect(v1).toBe(v2);

      // Zelle
      const z1 = FraudScoringService.computePayoutEndpointHash('zelle', {
        zelleRecipient: 'RingLeader@Example.org'
      });
      const z2 = FraudScoringService.computePayoutEndpointHash('zelle', {
        zelleContact: 'ringleader@example.org'
      });
      expect(z1).toBe(z2);

      // Bitcoin
      const btc1 = FraudScoringService.computePayoutEndpointHash('bitcoin', {
        bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
      });
      expect(btc1).toMatch(/^[a-f0-9]{64}$/);

      // Physical Check / Fallback Check
      const chk1 = FraudScoringService.computePayoutEndpointHash('physical_check', {
        street1: '742 Evergreen Terrace',
        zip: '62704'
      });
      const chk2 = FraudScoringService.computePayoutEndpointHash('court_fallback', {
        street: '742 evergreen terrace ',
        zip: '62704'
      });
      expect(chk1).toBe(chk2);

      // Digital Card
      const dc1 = FraudScoringService.computePayoutEndpointHash('digital_card', {
        recipientEmail: 'CardHolder@Example.com'
      });
      const dc2 = FraudScoringService.computePayoutEndpointHash('prepaid', {
        email: 'cardholder@example.com'
      });
      expect(dc1).toBe(dc2);
    });
  });

  describe('2. Disposable Domain, IPv4 Subnet & Signature Token Helpers', () => {
    it('2.1 detects disposable/burner email domains accurately while clearing standard domains', () => {
      expect(FraudScoringService.isDisposableEmailDomain('bot99@mailinator.com')).toBe(true);
      expect(FraudScoringService.isDisposableEmailDomain('syndicate@guerrillamail.com')).toBe(true);
      expect(FraudScoringService.isDisposableEmailDomain('fake@yopmail.com')).toBe(true);
      expect(FraudScoringService.isDisposableEmailDomain('10minutemail.com')).toBe(true);

      expect(FraudScoringService.isDisposableEmailDomain('jane.doe@gmail.com')).toBe(false);
      expect(FraudScoringService.isDisposableEmailDomain('counsel@lawfirm.com')).toBe(false);
    });

    it('2.2 extracts /24 subnet from public IPv4 addresses while ignoring loopback addresses', () => {
      expect(FraudScoringService.extractIpSubnet('127.0.0.1')).toBeUndefined();
      expect(FraudScoringService.extractIpSubnet('::1')).toBeUndefined();
      expect(FraudScoringService.extractIpSubnet('::ffff:127.0.0.1')).toBeUndefined();

      expect(FraudScoringService.extractIpSubnet('198.51.100.42')).toBe('198.51.100.0/24');
      expect(FraudScoringService.extractIpSubnet('::ffff:203.0.113.88')).toBe('203.0.113.0/24');
    });

    it('2.3 detects electronic perjury signature mismatch only when zero name tokens (>=2 chars) overlap', () => {
      expect(
        FraudScoringService.hasSignatureNameMismatch('Eleanor Vance', 'Eleanor', 'Vance')
      ).toBe(false);
      expect(
        FraudScoringService.hasSignatureNameMismatch('E. Vance', 'Eleanor', 'Vance')
      ).toBe(false);
      expect(
        FraudScoringService.hasSignatureNameMismatch('John Doe', 'John', 'Doe')
      ).toBe(false);

      // Completely unrelated name typed by bot script
      expect(
        FraudScoringService.hasSignatureNameMismatch('Automated Bot Script', 'Eleanor', 'Vance')
      ).toBe(true);
    });

    it('2.4 maps numeric scores deterministically to riskTier and reviewStatus', () => {
      expect(FraudScoringService.classifyScore(0)).toEqual({
        fraudScore: 0,
        riskTier: 'low',
        reviewStatus: 'auto_cleared'
      });
      expect(FraudScoringService.classifyScore(29)).toEqual({
        fraudScore: 29,
        riskTier: 'low',
        reviewStatus: 'auto_cleared'
      });
      expect(FraudScoringService.classifyScore(30)).toEqual({
        fraudScore: 30,
        riskTier: 'medium',
        reviewStatus: 'auto_cleared'
      });
      expect(FraudScoringService.classifyScore(59)).toEqual({
        fraudScore: 59,
        riskTier: 'medium',
        reviewStatus: 'auto_cleared'
      });
      expect(FraudScoringService.classifyScore(60)).toEqual({
        fraudScore: 60,
        riskTier: 'high',
        reviewStatus: 'flagged_for_review'
      });
      expect(FraudScoringService.classifyScore(79)).toEqual({
        fraudScore: 79,
        riskTier: 'high',
        reviewStatus: 'flagged_for_review'
      });
      expect(FraudScoringService.classifyScore(80)).toEqual({
        fraudScore: 80,
        riskTier: 'critical',
        reviewStatus: 'quarantined_blocked'
      });
      expect(FraudScoringService.classifyScore(135)).toEqual({
        fraudScore: 100,
        riskTier: 'critical',
        reviewStatus: 'quarantined_blocked'
      });
    });
  });

  describe('3. 4-Vector Scoring Evaluation & Multi-Tenant Correlation', () => {
    it('3.1 scores a legitimate claimant without telemetry as 0 (low / auto_cleared) preserving backward compatibility', async () => {
      const claimant = await Claimant.create({
        caseId: caseAlpha._id,
        claimId: 'CLM-CLEAN-01',
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah.connor@example.com',
        settlementAmount: 450
      });

      const res = await FraudScoringService.evaluateClaimSubmission({
        claimant,
        caseDoc: caseAlpha,
        method: 'paypal',
        details: { paypalAccount: 'sarah.connor@example.com' },
        signature: 'Sarah Connor',
        ipAddress: '127.0.0.1'
      });

      expect(res.fraudScore).toBe(0);
      expect(res.riskTier).toBe('low');
      expect(res.reviewStatus).toBe('auto_cleared');
      expect(res.shieldStatus).toBe('verified');
      expect(res.signals).toHaveLength(0);
    });

    it('3.2 triggers CROSS_TENANT_PAYOUT_COLLISION (+35), HEADLESS_WEBDRIVER_DETECTED (+20), SUBMISSION_SPEED_BOT (+15), DISPOSABLE_EMAIL_DOMAIN (+18) => 88 critical', async () => {
      const sharedVenmo = '@syndicate-collector-99';

      // Existing claimant in Case Alpha using sharedVenmo
      const firstClaimant = await Claimant.create({
        caseId: caseAlpha._id,
        claimId: 'CLM-ALPHA-01',
        firstName: 'First',
        lastName: 'Harvester',
        email: 'first@example.com',
        settlementAmount: 500
      });

      await FraudScoringService.evaluateClaimSubmission({
        claimant: firstClaimant,
        caseDoc: caseAlpha,
        method: 'venmo',
        details: { venmoIdentifier: sharedVenmo },
        signature: 'First Harvester'
      });

      // Second claimant in Case Beta (different tenant law firm) using same Venmo + bot telemetry + burner email
      const secondClaimant = await Claimant.create({
        caseId: caseBeta._id,
        claimId: 'CLM-BETA-01',
        firstName: 'Second',
        lastName: 'Harvester',
        email: 'bot2@mailinator.com',
        settlementAmount: 900
      });

      const evalResult = await FraudScoringService.evaluateClaimSubmission({
        claimant: secondClaimant,
        caseDoc: caseBeta,
        method: 'venmo',
        details: { venmoIdentifier: sharedVenmo },
        signature: 'Second Harvester',
        telemetry: {
          dwellTimeMs: 850,
          interactionCount: 4,
          keystrokeCount: 2,
          webdriverDetected: true,
          deviceFingerprint: 'headless-chromium-farm-01'
        }
      });

      // 35 (cross-tenant payout) + 20 (webdriver) + 15 (dwellTime < 4000) + 18 (disposable domain) = 88
      expect(evalResult.fraudScore).toBe(88);
      expect(evalResult.riskTier).toBe('critical');
      expect(evalResult.reviewStatus).toBe('quarantined_blocked');
      expect(evalResult.shieldStatus).toBe('quarantined');

      const codes = evalResult.signals.map((s) => s.code);
      expect(codes).toContain('CROSS_TENANT_PAYOUT_COLLISION');
      expect(codes).toContain('HEADLESS_WEBDRIVER_DETECTED');
      expect(codes).toContain('SUBMISSION_SPEED_BOT');
      expect(codes).toContain('DISPOSABLE_EMAIL_DOMAIN');

      // Verify MultiTenantThreatIndicator was recorded
      const payoutIndicators = await MultiTenantThreatIndicator.find({
        indicatorType: 'payout_hash'
      });
      expect(payoutIndicators.length).toBe(1);
      expect(payoutIndicators[0].severity).toBe('critical');
      expect(payoutIndicators[0].blocked).toBe(true);
    });

    it('3.3 triggers SUPPRESSION_OR_BOUNCE_HIT (+15) and ZERO_INTERACTION_ENTROPY (+12) and SIGNATURE_NAME_MISMATCH (+15)', async () => {
      await SuppressionList.create({
        email: 'suppressed.claimant@example.com',
        reason: 'hard_bounce',
        source: 'gmail_dsn'
      });

      const claimant = await Claimant.create({
        caseId: caseAlpha._id,
        claimId: 'CLM-SUPP-01',
        firstName: 'authentic',
        lastName: 'person',
        email: 'suppressed.claimant@example.com',
        settlementAmount: 300
      });

      const res = await FraudScoringService.evaluateClaimSubmission({
        claimant,
        caseDoc: caseAlpha,
        method: 'zelle',
        details: { zelleRecipient: 'suppressed.claimant@example.com' },
        signature: 'Unrelated Signer XYZ',
        telemetry: {
          dwellTimeMs: 9000,
          interactionCount: 0,
          keystrokeCount: 0,
          webdriverDetected: false
        }
      });

      // 15 (suppression) + 12 (zero interaction) + 15 (signature mismatch) = 42 (medium)
      expect(res.fraudScore).toBe(42);
      expect(res.riskTier).toBe('medium');
      expect(res.reviewStatus).toBe('auto_cleared');
      expect(res.signals.map((s) => s.code)).toEqual(
        expect.arrayContaining([
          'SUPPRESSION_OR_BOUNCE_HIT',
          'ZERO_INTERACTION_ENTROPY',
          'SIGNATURE_NAME_MISMATCH'
        ])
      );
    });
  });
});
