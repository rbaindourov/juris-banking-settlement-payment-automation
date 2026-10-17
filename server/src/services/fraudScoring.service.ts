import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../config/env';
import {
  Claimant,
  IClaimant,
  IFraudSignal,
  FraudRiskTier,
  FraudReviewStatus,
  IPortalSessionMetrics
} from '../models/Claimant';
import { Case, ICase } from '../models/Case';
import { FraudScanEvent, FraudScanType, IFraudScanEvent } from '../models/FraudScanEvent';
import {
  MultiTenantThreatIndicator,
  IMultiTenantThreatIndicator,
  ThreatIndicatorType
} from '../models/MultiTenantThreatIndicator';
import { SuppressionList } from '../models/SuppressionList';
import { decryptAes256Gcm } from './portalValidation.service';
import { PortalTelemetryInput } from '../validation/fraud.validation';

export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'dispostable.com',
  'maildrop.cc',
  'fakeinbox.com',
  'throwawaymail.com',
  'getnada.com',
  'temp-mail.org',
  'mohmal.com',
  'mailnesia.com',
  'burner.kiwi'
]);

export interface EvaluateClaimSubmissionParams {
  claimant: IClaimant;
  caseDoc?: ICase | null;
  method?: string;
  details?: Record<string, any>;
  rawDetails?: Record<string, any>;
  signature?: string;
  ipAddress?: string;
  xForwardedFor?: string;
  userAgent?: string;
  telemetry?: PortalTelemetryInput;
  scanType?: FraudScanType;
  preserveManualReview?: boolean;
}

export interface EvaluationResult {
  scanId: string;
  fraudScore: number;
  riskTier: FraudRiskTier;
  reviewStatus: FraudReviewStatus;
  signals: IFraudSignal[];
  scanDurationMs: number;
  payoutEndpointHash?: string;
  deviceFingerprintHash?: string;
  ipSubnet?: string;
  emailDomain?: string;
  verifiedAt: string;
  shieldStatus: 'verified' | 'flagged_for_review' | 'quarantined';
}

export class FraudScoringService {
  /**
   * Computes a salted HMAC-SHA256 digest for privacy-preserving cross-tenant correlation.
   */
  public static hmacSha256(value: string): string {
    const salt = config.JWT_SECRET || 'jurisshield-salt';
    return crypto.createHmac('sha256', salt).update(value).digest('hex');
  }

  /**
   * Normalizes and hashes a device fingerprint string using HMAC-SHA256.
   */
  public static computeDeviceFingerprintHash(rawFingerprint?: string): string | undefined {
    if (!rawFingerprint || typeof rawFingerprint !== 'string') {
      return undefined;
    }
    const trimmed = rawFingerprint.trim();
    if (!trimmed) {
      return undefined;
    }
    return this.hmacSha256(`device:${trimmed.toLowerCase()}`);
  }

  /**
   * Extracts lowercase domain from an email address.
   */
  public static extractEmailDomain(email?: string): string | undefined {
    if (!email || typeof email !== 'string') return undefined;
    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2 || !parts[1]) return undefined;
    return parts[1];
  }

  /**
   * Checks whether an email address or domain belongs to a known disposable/burner provider.
   */
  public static isDisposableEmailDomain(emailOrDomain?: string): boolean {
    if (!emailOrDomain || typeof emailOrDomain !== 'string') return false;
    const cleaned = emailOrDomain.trim().toLowerCase();
    const domain = cleaned.includes('@') ? this.extractEmailDomain(cleaned) : cleaned;
    if (!domain) return false;
    return DISPOSABLE_EMAIL_DOMAINS.has(domain);
  }

  /**
   * Extracts the /24 IPv4 subnet (or /64 IPv6 prefix) from an IP address.
   * Loopback addresses (127.0.0.1, ::1) return undefined unless allowLoopback is true.
   */
  public static extractIpSubnet(ip?: string, allowLoopback = false): string | undefined {
    if (!ip || typeof ip !== 'string') return undefined;
    let cleaned = ip.split(',')[0].trim();
    if (!cleaned || cleaned === 'unknown') return undefined;

    if (cleaned.startsWith('::ffff:')) {
      cleaned = cleaned.substring(7);
    }

    const isLoopback =
      cleaned === '127.0.0.1' ||
      cleaned === '::1' ||
      cleaned === 'localhost' ||
      cleaned === '0.0.0.0' ||
      cleaned.startsWith('127.');

    if (isLoopback && !allowLoopback) {
      return undefined;
    }

    const ipv4Match = cleaned.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      return `${ipv4Match[1]}.${ipv4Match[2]}.${ipv4Match[3]}.0/24`;
    }

    if (cleaned.includes(':')) {
      const blocks = cleaned.split(':').filter(Boolean);
      if (blocks.length >= 2) {
        return `${blocks.slice(0, 4).join(':')}::/64`;
      }
    }

    return undefined;
  }

  /**
   * Canonical Payout Endpoint Normalization & Salted HMAC-SHA256 Hashing across all 9 payment rails.
   */
  public static computePayoutEndpointHash(
    method?: string,
    details?: Record<string, any>,
    claimant?: Partial<IClaimant> | null
  ): string | undefined {
    if (!method || typeof method !== 'string') return undefined;
    const normalizedMethod = method.toLowerCase().trim();
    const d = details || {};

    let canonical = '';

    switch (normalizedMethod) {
      case 'ach':
      case 'direct_deposit': {
        const routing = String(d.routingNumber || '').trim();
        let account = String(d.accountNumber || '').trim();
        if (!account && d.encryptedAccountNumber) {
          try {
            account = decryptAes256Gcm(String(d.encryptedAccountNumber)).trim();
          } catch {
            account = String(d.accountNumberMasked || d.encryptedAccountNumber || '').trim();
          }
        }
        if (!account && d.accountNumberMasked) {
          account = String(d.accountNumberMasked).trim();
        }
        if (!routing && !account) return undefined;
        canonical = `ach:${routing}:${account}`;
        break;
      }

      case 'debit_card':
      case 'push_to_debit': {
        const cleanPan = d.cardNumber ? String(d.cardNumber).replace(/\D/g, '') : '';
        const target = cleanPan || String(d.tokenRef || d.cardLast4 || '').trim();
        if (!target) return undefined;
        canonical = `debit:${target}`;
        break;
      }

      case 'paypal': {
        const target = String(
          d.paypalEmail || d.paypalAccount || d.recipient || claimant?.email || ''
        )
          .toLowerCase()
          .trim();
        if (!target) return undefined;
        canonical = `paypal:${target}`;
        break;
      }

      case 'venmo': {
        const target = String(
          d.venmoHandle || d.venmoIdentifier || d.handle || d.phone || claimant?.phone || ''
        )
          .toLowerCase()
          .trim()
          .replace(/^@/, '');
        if (!target) return undefined;
        canonical = `venmo:${target}`;
        break;
      }

      case 'zelle': {
        const target = String(
          d.zelleRecipient ||
            d.zelleContact ||
            d.recipient ||
            d.email ||
            d.phone ||
            claimant?.email ||
            claimant?.phone ||
            ''
        )
          .toLowerCase()
          .trim();
        if (!target) return undefined;
        canonical = `zelle:${target}`;
        break;
      }

      case 'bitcoin':
      case 'btc': {
        const target = String(d.bitcoinAddress || d.address || '').trim();
        if (!target) return undefined;
        canonical = `btc:${target}`;
        break;
      }

      case 'physical_check':
      case 'check':
      case 'court_fallback':
      case 'fallback_check': {
        const street = String(
          d.street || d.street1 || claimant?.address?.street || ''
        )
          .toLowerCase()
          .trim();
        const zip = String(d.zip || claimant?.address?.zip || '').trim();
        if (!street && !zip) return undefined;
        canonical = `check:${street}:${zip}`;
        break;
      }

      case 'digital_card':
      case 'prepaid': {
        const target = String(
          d.recipientEmail || d.recipientPhone || d.email || claimant?.email || ''
        )
          .toLowerCase()
          .trim();
        if (!target) return undefined;
        canonical = `dcard:${target}`;
        break;
      }

      default:
        return undefined;
    }

    return this.hmacSha256(canonical);
  }

  /**
   * Maps a numeric 0-100 fraud score to deterministic RiskTier and default FraudReviewStatus.
   */
  public static classifyScore(score: number): {
    fraudScore: number;
    riskTier: FraudRiskTier;
    reviewStatus: FraudReviewStatus;
  } {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    if (clamped >= 80) {
      return {
        fraudScore: clamped,
        riskTier: 'critical',
        reviewStatus: 'quarantined_blocked'
      };
    }
    if (clamped >= 60) {
      return {
        fraudScore: clamped,
        riskTier: 'high',
        reviewStatus: 'flagged_for_review'
      };
    }
    if (clamped >= 30) {
      return {
        fraudScore: clamped,
        riskTier: 'medium',
        reviewStatus: 'auto_cleared'
      };
    }
    return {
      fraudScore: clamped,
      riskTier: 'low',
      reviewStatus: 'auto_cleared'
    };
  }

  /**
   * Checks whether typed electronic signature shares at least one name token (>= 2 chars)
   * with claimant's firstName or lastName.
   */
  public static hasSignatureNameMismatch(
    signature?: string,
    firstName?: string,
    lastName?: string
  ): boolean {
    if (!signature || typeof signature !== 'string' || !signature.trim()) {
      return false;
    }
    const sigLower = signature.toLowerCase().trim();
    const rawTokens = `${firstName || ''} ${lastName || ''}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);

    if (rawTokens.length === 0) {
      return false;
    }

    return !rawTokens.some((token) => sigLower.includes(token));
  }

  /**
   * Upserts a MultiTenantThreatIndicator document when a cross-tenant or velocity signal triggers.
   */
  public static async recordThreatIndicator(params: {
    indicatorType: ThreatIndicatorType;
    indicatorValue: string;
    severity: FraudRiskTier;
    caseId?: string;
    lawFirmId?: string;
    description?: string;
    blocked?: boolean;
  }): Promise<void> {
    if (!params.indicatorValue || mongoose.connection.readyState !== 1) {
      return;
    }

    try {
      const now = new Date();
      const existing = await MultiTenantThreatIndicator.findOne({
        indicatorType: params.indicatorType,
        indicatorValue: params.indicatorValue
      });

      const severityOrder: Record<FraudRiskTier, number> = {
        low: 1,
        medium: 2,
        high: 3,
        critical: 4
      };

      if (!existing) {
        const caseIds = params.caseId ? [String(params.caseId)] : [];
        const lawFirmIds = params.lawFirmId ? [String(params.lawFirmId)] : [];
        await MultiTenantThreatIndicator.create({
          indicatorType: params.indicatorType,
          indicatorValue: params.indicatorValue,
          severity: params.severity === 'low' ? 'medium' : params.severity,
          hitCount: 1,
          caseIds,
          lawFirmIds,
          distinctCasesCount: Math.max(1, caseIds.length),
          distinctTenantsCount: Math.max(1, lawFirmIds.length),
          blocked: Boolean(params.blocked || params.severity === 'critical'),
          description: params.description,
          firstSeenAt: now,
          lastSeenAt: now
        });
      } else {
        const caseSet = new Set<string>(existing.caseIds || []);
        if (params.caseId) caseSet.add(String(params.caseId));
        const firmSet = new Set<string>(existing.lawFirmIds || []);
        if (params.lawFirmId) firmSet.add(String(params.lawFirmId));

        existing.hitCount = (existing.hitCount || 1) + 1;
        existing.caseIds = Array.from(caseSet);
        existing.lawFirmIds = Array.from(firmSet);
        existing.distinctCasesCount = Math.max(1, existing.caseIds.length);
        existing.distinctTenantsCount = Math.max(1, existing.lawFirmIds.length);
        existing.lastSeenAt = now;

        const incomingSev = params.severity === 'low' ? 'medium' : params.severity;
        if (severityOrder[incomingSev] > severityOrder[existing.severity || 'medium']) {
          existing.severity = incomingSev;
        }
        if (existing.distinctCasesCount > 1 && existing.severity === 'medium') {
          existing.severity = 'high';
        }
        if (params.blocked || existing.severity === 'critical') {
          existing.blocked = true;
        }
        if (params.description) {
          existing.description = params.description;
        }
        await existing.save();
      }
    } catch {
      // Non-fatal if concurrent upsert occurs
    }
  }

  /**
   * 4-Vector Real-Time Fraud Scoring Engine for Claimant Submissions & Rescans.
   */
  public static async evaluateClaimSubmission(
    params: EvaluateClaimSubmissionParams
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    const {
      claimant,
      method,
      details,
      rawDetails,
      signature,
      ipAddress,
      xForwardedFor,
      telemetry,
      scanType = 'portal_submission',
      preserveManualReview = true
    } = params;

    let caseDoc = params.caseDoc;
    if (!caseDoc && claimant.caseId && mongoose.connection.readyState === 1) {
      try {
        caseDoc = await Case.findById(claimant.caseId);
      } catch {
        caseDoc = null;
      }
    }

    const caseIdStr = String(
      (caseDoc && caseDoc._id) || claimant.caseId || ''
    );
    const lawFirmIdStr = caseDoc?.lawFirmId || 'FIRM-DEFAULT';

    const effectiveMethod = method || claimant.selectedPaymentMethod;
    const mergedDetails = {
      ...(claimant.paymentDetails || {}),
      ...(details || {}),
      ...(rawDetails || {})
    };

    const signals: IFraudSignal[] = [];
    const now = new Date();

    // -------------------------------------------------------------------------
    // Vector 1: Multi-Tenant Payout Endpoint Collision (Cap: 35 pts)
    // -------------------------------------------------------------------------
    const payoutEndpointHash =
      this.computePayoutEndpointHash(effectiveMethod, mergedDetails, claimant) ||
      claimant.payoutEndpointHash;

    if (payoutEndpointHash && mongoose.connection.readyState === 1) {
      const collidingClaimants = await Claimant.find({
        _id: { $ne: claimant._id },
        payoutEndpointHash
      })
        .select('caseId claimId')
        .lean();

      if (collidingClaimants.length > 0) {
        const crossTenantMatches = collidingClaimants.filter(
          (c) => String(c.caseId) !== String(claimant.caseId)
        );

        if (crossTenantMatches.length > 0) {
          signals.push({
            code: 'CROSS_TENANT_PAYOUT_COLLISION',
            category: 'payout_collision',
            severity: 'critical',
            scoreContribution: 35,
            description: `Payout destination hash matches ${collidingClaimants.length} other claim(s) across multiple settlement cases/tenants.`,
            detectedAt: now
          });

          await this.recordThreatIndicator({
            indicatorType: 'payout_hash',
            indicatorValue: payoutEndpointHash,
            severity: 'critical',
            caseId: caseIdStr,
            lawFirmId: lawFirmIdStr,
            blocked: true,
            description: `Cross-tenant duplicate ${effectiveMethod || 'payout'} endpoint detected across multiple dockets`
          });
        } else {
          signals.push({
            code: 'SAME_CASE_PAYOUT_COLLISION',
            category: 'payout_collision',
            severity: 'high',
            scoreContribution: 30,
            description: `Payout destination hash matches ${collidingClaimants.length} other claim(s) within the same settlement case.`,
            detectedAt: now
          });

          await this.recordThreatIndicator({
            indicatorType: 'payout_hash',
            indicatorValue: payoutEndpointHash,
            severity: 'high',
            caseId: caseIdStr,
            lawFirmId: lawFirmIdStr,
            blocked: false,
            description: `Duplicate ${effectiveMethod || 'payout'} endpoint shared by multiple claimants in case`
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // Vector 2: Device Fingerprint & IP Subnet Velocity
    // -------------------------------------------------------------------------
    const rawDeviceFp =
      telemetry?.deviceFingerprintHash ||
      telemetry?.deviceFingerprint ||
      claimant.deviceFingerprintHash;

    const deviceFingerprintHash = rawDeviceFp
      ? rawDeviceFp.length === 64 && /^[a-f0-9]{64}$/i.test(rawDeviceFp)
        ? rawDeviceFp
        : this.computeDeviceFingerprintHash(rawDeviceFp)
      : undefined;

    if (deviceFingerprintHash && mongoose.connection.readyState === 1) {
      const otherDeviceMatches = await Claimant.countDocuments({
        _id: { $ne: claimant._id },
        deviceFingerprintHash
      });

      if (otherDeviceMatches >= 2) {
        signals.push({
          code: 'DEVICE_FINGERPRINT_COLLISION',
          category: 'velocity_device',
          severity: 'high',
          scoreContribution: 25,
          description: `Device hardware fingerprint reused across ${otherDeviceMatches + 1} distinct claimant submissions.`,
          detectedAt: now
        });

        await this.recordThreatIndicator({
          indicatorType: 'device_fingerprint',
          indicatorValue: deviceFingerprintHash,
          severity: 'high',
          caseId: caseIdStr,
          lawFirmId: lawFirmIdStr,
          description: `Device fingerprint reused across ${otherDeviceMatches + 1} claims`
        });
      }
    }

    const effectiveIp = xForwardedFor
      ? xForwardedFor.split(',')[0].trim()
      : ipAddress || claimant.signatureIp;
    const ipSubnet = this.extractIpSubnet(effectiveIp, false);

    if (ipSubnet && mongoose.connection.readyState === 1) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentSubnetScans = await FraudScanEvent.countDocuments({
        ipSubnet,
        createdAt: { $gte: tenMinutesAgo }
      });

      // Trigger when >= 5 claims (i.e. >= 4 prior scans + current submission) arrive from the same non-loopback /24 subnet within 10 minutes
      if (recentSubnetScans >= 4) {
        signals.push({
          code: 'IP_SUBNET_VELOCITY_BURST',
          category: 'velocity_device',
          severity: 'high',
          scoreContribution: 20,
          description: `High-velocity submission burst (${recentSubnetScans + 1} claims in 10m) from subnet ${ipSubnet}.`,
          detectedAt: now
        });

        await this.recordThreatIndicator({
          indicatorType: 'ip_subnet',
          indicatorValue: ipSubnet,
          severity: 'high',
          caseId: caseIdStr,
          lawFirmId: lawFirmIdStr,
          description: `/24 subnet velocity burst (${recentSubnetScans + 1} claims within 10m window)`
        });
      }
    }

    // -------------------------------------------------------------------------
    // Vector 3: Behavioral & Bot Automation Telemetry
    // (CRITICAL BACKWARD-COMPATIBILITY INVARIANT: only evaluate telemetry if explicitly provided)
    // -------------------------------------------------------------------------
    const effectiveTelemetry: IPortalSessionMetrics | undefined = telemetry
      ? {
          dwellTimeMs: telemetry.dwellTimeMs,
          interactionCount: telemetry.interactionCount,
          keystrokeCount: telemetry.keystrokeCount,
          webdriverDetected: telemetry.webdriverDetected,
          timezoneOffset: telemetry.timezoneOffset,
          screenResolution: telemetry.screenResolution
        }
      : claimant.portalSessionMetrics;

    if (effectiveTelemetry) {
      if (effectiveTelemetry.webdriverDetected === true) {
        signals.push({
          code: 'HEADLESS_WEBDRIVER_DETECTED',
          category: 'behavioral_bot',
          severity: 'high',
          scoreContribution: 20,
          description: 'Headless browser automation (navigator.webdriver) detected during payment election.',
          detectedAt: now
        });
      }

      if (
        typeof effectiveTelemetry.dwellTimeMs === 'number' &&
        effectiveTelemetry.dwellTimeMs < 4000
      ) {
        signals.push({
          code: 'SUBMISSION_SPEED_BOT',
          category: 'behavioral_bot',
          severity: 'medium',
          scoreContribution: 15,
          description: `Form completed in ${effectiveTelemetry.dwellTimeMs}ms (< 4,000ms human interaction threshold).`,
          detectedAt: now
        });
      }

      if (
        effectiveTelemetry.interactionCount !== undefined &&
        effectiveTelemetry.keystrokeCount !== undefined &&
        effectiveTelemetry.interactionCount === 0 &&
        effectiveTelemetry.keystrokeCount === 0
      ) {
        signals.push({
          code: 'ZERO_INTERACTION_ENTROPY',
          category: 'behavioral_bot',
          severity: 'medium',
          scoreContribution: 12,
          description: 'Zero pointer/touch interactions and zero keystroke cadence events recorded.',
          detectedAt: now
        });
      }
    }

    const effectiveSignature = signature ?? claimant.digitalSignature;
    if (
      effectiveSignature &&
      this.hasSignatureNameMismatch(effectiveSignature, claimant.firstName, claimant.lastName)
    ) {
      signals.push({
        code: 'SIGNATURE_NAME_MISMATCH',
        category: 'identity_domain',
        severity: 'medium',
        scoreContribution: 15,
        description: `Typed signature "${effectiveSignature}" has zero token overlap with claimant roster name "${claimant.firstName} ${claimant.lastName}".`,
        detectedAt: now
      });
    }

    // -------------------------------------------------------------------------
    // Vector 4: Email Domain, Spam & Identity Integrity
    // -------------------------------------------------------------------------
    const emailDomain = this.extractEmailDomain(claimant.email);
    if (emailDomain && this.isDisposableEmailDomain(emailDomain)) {
      signals.push({
        code: 'DISPOSABLE_EMAIL_DOMAIN',
        category: 'identity_domain',
        severity: 'high',
        scoreContribution: 18,
        description: `Claimant email uses known disposable/burner provider domain (${emailDomain}).`,
        detectedAt: now
      });

      await this.recordThreatIndicator({
        indicatorType: 'email_domain',
        indicatorValue: emailDomain,
        severity: 'high',
        caseId: caseIdStr,
        lawFirmId: lawFirmIdStr,
        blocked: true,
        description: `Disposable burner email domain (${emailDomain}) intercepted`
      });
    }

    let isSuppressedOrBounced = Boolean(claimant.bounced);
    if (!isSuppressedOrBounced && claimant.email && mongoose.connection.readyState === 1) {
      const suppressedCount = await SuppressionList.countDocuments({
        email: claimant.email.toLowerCase().trim()
      });
      if (suppressedCount > 0) {
        isSuppressedOrBounced = true;
      }
    }

    if (isSuppressedOrBounced) {
      signals.push({
        code: 'SUPPRESSION_OR_BOUNCE_HIT',
        category: 'identity_domain',
        severity: 'medium',
        scoreContribution: 15,
        description: 'Claimant email address appears on global suppression list or has a prior hard bounce.',
        detectedAt: now
      });
    }

    // -------------------------------------------------------------------------
    // Composite Score Calculation & Tier Mapping
    // -------------------------------------------------------------------------
    const rawTotal = signals.reduce((sum, sig) => sum + sig.scoreContribution, 0);
    const classification = this.classifyScore(rawTotal);

    let finalReviewStatus = classification.reviewStatus;
    if (
      preserveManualReview &&
      (claimant.fraudReviewStatus === 'manually_approved' ||
        claimant.fraudReviewStatus === 'manually_rejected')
    ) {
      finalReviewStatus = claimant.fraudReviewStatus;
    }

    const scanDurationMs = Math.max(1, Date.now() - startTime);

    // Update claimant fields in memory and persist if it is a Mongoose document
    claimant.fraudScore = classification.fraudScore;
    claimant.fraudRiskTier = classification.riskTier;
    claimant.fraudReviewStatus = finalReviewStatus;
    claimant.fraudSignals = signals;
    claimant.fraudScannedAt = now;
    if (deviceFingerprintHash) {
      claimant.deviceFingerprintHash = deviceFingerprintHash;
    }
    if (payoutEndpointHash) {
      claimant.payoutEndpointHash = payoutEndpointHash;
    }
    if (effectiveTelemetry) {
      claimant.portalSessionMetrics = effectiveTelemetry;
    }

    let scanId = `SCAN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    if (mongoose.connection.readyState === 1) {
      if (typeof (claimant as any).save === 'function') {
        await claimant.save();
      } else if (claimant._id) {
        await Claimant.findByIdAndUpdate(claimant._id, {
          $set: {
            fraudScore: claimant.fraudScore,
            fraudRiskTier: claimant.fraudRiskTier,
            fraudReviewStatus: claimant.fraudReviewStatus,
            fraudSignals: claimant.fraudSignals,
            fraudScannedAt: claimant.fraudScannedAt,
            deviceFingerprintHash: claimant.deviceFingerprintHash,
            payoutEndpointHash: claimant.payoutEndpointHash,
            portalSessionMetrics: claimant.portalSessionMetrics
          }
        });
      }

      try {
        const eventDoc = await FraudScanEvent.create({
          scanType,
          caseId: claimant.caseId,
          lawFirmId: lawFirmIdStr,
          claimantId: claimant._id,
          claimId: claimant.claimId,
          fraudScore: classification.fraudScore,
          riskTier: classification.riskTier,
          reviewStatus: finalReviewStatus,
          signalsTriggered: signals.map((s) => s.code),
          scanDurationMs,
          ipAddress: effectiveIp,
          ipSubnet,
          emailDomain,
          deviceFingerprintHash,
          payoutEndpointHash,
          settlementAmount: claimant.settlementAmount || 0
        });
        scanId = eventDoc._id.toString();
      } catch {
        // Non-fatal if scan event logging fails
      }
    }

    const shieldStatus =
      finalReviewStatus === 'quarantined_blocked' || finalReviewStatus === 'manually_rejected'
        ? 'quarantined'
        : finalReviewStatus === 'flagged_for_review'
        ? 'flagged_for_review'
        : 'verified';

    return {
      scanId,
      fraudScore: classification.fraudScore,
      riskTier: classification.riskTier,
      reviewStatus: finalReviewStatus,
      signals,
      scanDurationMs,
      payoutEndpointHash,
      deviceFingerprintHash,
      ipSubnet,
      emailDomain,
      verifiedAt: now.toISOString(),
      shieldStatus
    };
  }

  /**
   * Evaluates a single claimant upon ingestion commit.
   */
  public static async prescanClaimantOnIngestion(
    claimantDoc: IClaimant,
    caseDoc?: ICase | null
  ): Promise<EvaluationResult> {
    return this.evaluateClaimSubmission({
      claimant: claimantDoc,
      caseDoc,
      scanType: 'ingestion_prescan',
      preserveManualReview: true
    });
  }

  /**
   * Re-evaluates all claimants in a case and returns summary counts.
   */
  public static async rescanCaseClaimants(caseIdentifier: string): Promise<{
    caseId: string;
    scannedCount: number;
    totalScanned: number;
    flaggedCount: number;
    quarantinedCount: number;
    autoClearedCount: number;
    riskTierBreakdown: Record<FraudRiskTier, number>;
  }> {
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      throw new Error('Case not found');
    }

    const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseIdentifier].filter(Boolean);
    const claimants = await Claimant.find({ caseId: { $in: caseLookupIds } });

    let flaggedCount = 0;
    let quarantinedCount = 0;
    let autoClearedCount = 0;
    const riskTierBreakdown: Record<FraudRiskTier, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    for (const claimant of claimants) {
      const result = await this.evaluateClaimSubmission({
        claimant,
        caseDoc,
        scanType: 'manual_rescan',
        preserveManualReview: true
      });

      riskTierBreakdown[result.riskTier] = (riskTierBreakdown[result.riskTier] || 0) + 1;
      if (result.reviewStatus === 'flagged_for_review') flaggedCount++;
      else if (result.reviewStatus === 'quarantined_blocked') quarantinedCount++;
      else if (result.reviewStatus === 'auto_cleared') autoClearedCount++;
    }

    return {
      caseId: caseDoc._id.toString(),
      scannedCount: claimants.length,
      totalScanned: claimants.length,
      flaggedCount,
      quarantinedCount,
      autoClearedCount,
      riskTierBreakdown
    };
  }

  /**
   * Adjudicates a flagged or quarantined claimant ('approve' or 'reject').
   */
  public static async reviewClaimant(
    caseIdentifier: string,
    claimantIdentifier: string,
    payload: { action: 'approve' | 'reject'; notes: string; reviewedBy: string }
  ): Promise<IClaimant> {
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      throw new Error('Case not found');
    }

    const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseIdentifier].filter(Boolean);

    const claimantQuery: Record<string, any> = {
      caseId: { $in: caseLookupIds }
    };

    if (mongoose.isValidObjectId(claimantIdentifier)) {
      claimantQuery.$or = [{ _id: claimantIdentifier }, { claimId: claimantIdentifier }];
    } else {
      claimantQuery.claimId = claimantIdentifier;
    }

    const claimant = await Claimant.findOne(claimantQuery);
    if (!claimant) {
      throw new Error('Claimant not found');
    }

    const now = new Date();
    claimant.fraudReviewStatus =
      payload.action === 'approve' ? 'manually_approved' : 'manually_rejected';
    claimant.fraudReviewedBy = payload.reviewedBy;
    claimant.fraudReviewedAt = now;
    claimant.fraudReviewNotes = payload.notes;

    await claimant.save();
    return claimant;
  }

  /**
   * Computes real-time scanning & protection metrics for a specific case.
   */
  public static async getCaseFraudMetrics(caseIdentifier: string): Promise<any> {
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      throw new Error('Case not found');
    }

    const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseIdentifier].filter(Boolean);
    const claimants = await Claimant.find({ caseId: { $in: caseLookupIds } }).lean();

    const totalClaimants = claimants.length;
    let scannedClaimants = 0;
    let totalProtectedAmount = 0;
    let totalProtectedClaimants = 0;
    let crossTenantThreatHits = 0;

    const riskTierBreakdown: Record<FraudRiskTier, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    const reviewStatusBreakdown: Record<FraudReviewStatus, number> = {
      unscanned: 0,
      auto_cleared: 0,
      flagged_for_review: 0,
      quarantined_blocked: 0,
      manually_approved: 0,
      manually_rejected: 0
    };

    const signalMap = new Map<
      string,
      { code: string; count: number; category: string; description: string }
    >();

    for (const c of claimants) {
      const status: FraudReviewStatus = (c.fraudReviewStatus as FraudReviewStatus) || 'unscanned';
      const tier: FraudRiskTier = (c.fraudRiskTier as FraudRiskTier) || 'low';

      reviewStatusBreakdown[status] = (reviewStatusBreakdown[status] || 0) + 1;
      riskTierBreakdown[tier] = (riskTierBreakdown[tier] || 0) + 1;

      if (status !== 'unscanned' || c.fraudScannedAt) {
        scannedClaimants++;
      }

      if (
        status === 'flagged_for_review' ||
        status === 'quarantined_blocked' ||
        status === 'manually_rejected'
      ) {
        totalProtectedAmount += Number(c.settlementAmount || 0);
        totalProtectedClaimants++;
      }

      if (Array.isArray(c.fraudSignals)) {
        for (const sig of c.fraudSignals) {
          if (
            sig.code === 'CROSS_TENANT_PAYOUT_COLLISION' ||
            sig.code === 'DEVICE_FINGERPRINT_COLLISION' ||
            sig.code === 'DISPOSABLE_EMAIL_DOMAIN'
          ) {
            crossTenantThreatHits++;
          }
          const existing = signalMap.get(sig.code);
          if (existing) {
            existing.count++;
          } else {
            signalMap.set(sig.code, {
              code: sig.code,
              count: 1,
              category: sig.category,
              description: sig.description
            });
          }
        }
      }
    }

    totalProtectedAmount = Math.round(totalProtectedAmount * 100) / 100;
    const scanCoveragePercent =
      totalClaimants > 0 ? Math.round((scannedClaimants / totalClaimants) * 1000) / 10 : 100;

    const recentEventsDocs = await FraudScanEvent.find({ caseId: { $in: caseLookupIds } })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    const avgScanLatencyMs =
      recentEventsDocs.length > 0
        ? Math.max(
            1,
            Math.round(
              recentEventsDocs.reduce((sum, e) => sum + (e.scanDurationMs || 1), 0) /
                recentEventsDocs.length
            )
          )
        : 2;

    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const scansLastMinute = await FraudScanEvent.countDocuments({
      caseId: { $in: caseLookupIds },
      createdAt: { $gte: oneMinuteAgo }
    });
    const scansPerMinute = Math.max(scansLastMinute, recentEventsDocs.length > 0 ? 1 : 0);

    const topSignals = Array.from(signalMap.values()).sort((a, b) => b.count - a.count);

    const recentScanEvents = recentEventsDocs.map((e: any) => ({
      id: e._id.toString(),
      _id: e._id.toString(),
      scanType: e.scanType,
      claimId: e.claimId,
      fraudScore: e.fraudScore,
      riskTier: e.riskTier,
      reviewStatus: e.reviewStatus,
      scanDurationMs: e.scanDurationMs,
      signalsTriggered: e.signalsTriggered || [],
      triggeredSignalCodes: e.signalsTriggered || [],
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString()
    }));

    return {
      caseId: caseDoc._id.toString(),
      totalClaimants,
      scannedClaimants,
      totalScanned: scannedClaimants,
      unscannedCount: reviewStatusBreakdown.unscanned,
      scanCoveragePercent,
      avgScanLatencyMs,
      avgLatencyMs: avgScanLatencyMs,
      scansPerMinute,
      totalProtectedAmount,
      settlementDollarsProtected: totalProtectedAmount,
      fundsProtected: totalProtectedAmount,
      totalProtectedClaimants,
      quarantinedOrFlaggedCount:
        reviewStatusBreakdown.flagged_for_review + reviewStatusBreakdown.quarantined_blocked,
      flaggedForReviewCount: reviewStatusBreakdown.flagged_for_review,
      quarantinedBlockedCount: reviewStatusBreakdown.quarantined_blocked,
      manuallyApprovedCount: reviewStatusBreakdown.manually_approved,
      manuallyRejectedCount: reviewStatusBreakdown.manually_rejected,
      autoClearedCount: reviewStatusBreakdown.auto_cleared,
      crossTenantThreatHits,
      riskTierBreakdown,
      riskTierDistribution: riskTierBreakdown,
      reviewStatusBreakdown,
      topSignals,
      recentScanEvents
    };
  }

  /**
   * Computes global cross-tenant threat intelligence across all cases and law firms.
   */
  public static async getNetworkIntelligence(): Promise<any> {
    const [
      allCases,
      totalScanEvents,
      protectedClaimantsAgg,
      indicators
    ] = await Promise.all([
      Case.find({}).select('_id lawFirmId').lean(),
      FraudScanEvent.countDocuments({}),
      Claimant.aggregate([
        {
          $match: {
            fraudReviewStatus: {
              $in: ['flagged_for_review', 'quarantined_blocked', 'manually_rejected']
            }
          }
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$settlementAmount' },
            count: { $sum: 1 }
          }
        }
      ]),
      MultiTenantThreatIndicator.find({})
        .sort({ distinctCasesCount: -1, hitCount: -1, lastSeenAt: -1 })
        .limit(50)
        .lean()
    ]);

    const distinctTenants = new Set(
      allCases.map((c: any) => c.lawFirmId || 'FIRM-DEFAULT').filter(Boolean)
    );

    const networkProtectedAmount =
      protectedClaimantsAgg.length > 0
        ? Math.round((protectedClaimantsAgg[0].totalAmount || 0) * 100) / 100
        : 0;

    const byType = {
      payout_hash: 0,
      email_domain: 0,
      ip_subnet: 0,
      device_fingerprint: 0
    };

    for (const ind of indicators) {
      if (ind.indicatorType in byType) {
        byType[ind.indicatorType as keyof typeof byType]++;
      }
    }

    const formattedIndicators = indicators.map((ind: any) => ({
      id: ind._id.toString(),
      _id: ind._id.toString(),
      indicatorType: ind.indicatorType,
      indicatorValue: ind.indicatorValue,
      severity: ind.severity,
      hitCount: ind.hitCount,
      caseIds: ind.caseIds || [],
      lawFirmIds: ind.lawFirmIds || [],
      distinctCasesCount: ind.distinctCasesCount || 1,
      distinctTenantsCount: ind.distinctTenantsCount || 1,
      blocked: Boolean(ind.blocked),
      description: ind.description,
      firstSeenAt: ind.firstSeenAt,
      lastSeenAt: ind.lastSeenAt
    }));

    return {
      totalCasesMonitored: allCases.length,
      totalTenantsMonitored: Math.max(1, distinctTenants.size),
      totalScanEvents,
      totalNetworkScans: totalScanEvents,
      totalIndicators: formattedIndicators.length,
      networkProtectedAmount,
      networkFundsProtected: networkProtectedAmount,
      crossTenantPayoutCollisions: byType.payout_hash,
      crossDocketPayoutCollisions: byType.payout_hash,
      duplicatePayoutEndpointsBlocked: byType.payout_hash,
      disposableDomainsBlocked: byType.email_domain,
      disposableEmailDomainsBlocked: byType.email_domain,
      spamDomainsIntercepted: byType.email_domain,
      deviceFingerprintCollisions: byType.device_fingerprint,
      ipVelocityClusters: byType.ip_subnet,
      highVelocityIpSubnets: byType.ip_subnet,
      byType,
      recentIndicators: formattedIndicators,
      topIndicators: formattedIndicators,
      indicators: formattedIndicators
    };
  }
}
