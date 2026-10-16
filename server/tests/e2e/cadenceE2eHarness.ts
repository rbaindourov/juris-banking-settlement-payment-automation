import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { Case, ICase } from '../../src/models/Case';
import { Claimant, IClaimant } from '../../src/models/Claimant';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import {
  sanitizeEmailHtml,
  escapeHtml,
  sanitizeLinkUrl,
  resolveMergeTags
} from '../../src/services/template.service';

export type CadenceStageKey =
  | 'initial_notice'
  | 'reminder_14d'
  | 'urgent_warning_7d'
  | 'final_notice_48h'
  | 'post_deadline_fallback';

export type WaveStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'paused'
  | 'rescheduled'
  | 'completed'
  | 'cancelled';

export interface ILocalizedTemplate {
  subject: string;
  bodyHtml: string;
}

export interface IThrottlingConfig {
  batchSize: number;
  intervalMinutes: number;
  rateLimitPerSecond: number;
  dailyCap: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}

export interface IWaveTelemetry {
  eligible: number;
  queued: number;
  dispatched: number;
  skipped_completed: number;
  suppressed_bounced: number;
  failed: number;
}

export interface INotificationWave {
  waveId: string;
  caseId: string;
  stage: CadenceStageKey;
  status: WaveStatus;
  scheduledDate: Date;
  throttling: IThrottlingConfig;
  templates: Record<string, ILocalizedTemplate>;
  telemetry: IWaveTelemetry;
  subBatches?: any[];
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
  rescheduledAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
}

export interface INotificationCadence {
  caseId: string;
  stages: Array<{
    stageKey: CadenceStageKey;
    enabled: boolean;
    offsetHours: number;
    templates: Record<string, ILocalizedTemplate>;
  }>;
  throttling: IThrottlingConfig;
  suppression: {
    skipCompletedPayments: boolean;
    suppressBounced: boolean;
    checkGlobalSuppression: boolean;
  };
}

export function makeAuthToken(role: string = 'law_firm_admin', firmId: string = 'firm-test-alpha', userId: string = 'usr-e2e-1'): string {
  return signToken({
    id: userId,
    email: `${role}@test-firm.com`,
    fullName: `E2E ${role}`,
    role: role as any,
    lawFirmId: firmId
  });
}

export const standardSuperAdminToken = makeAuthToken('super_admin', 'firm-admin', 'usr-super');
export const standardFirmAdminToken = makeAuthToken('law_firm_admin', 'firm-test-alpha', 'usr-firm-admin');
export const standardCaseManagerToken = makeAuthToken('case_manager', 'firm-test-alpha', 'usr-case-mgr');
export const unauthorizedFirmToken = makeAuthToken('law_firm_admin', 'firm-other-beta', 'usr-other');

export const defaultTemplates: Record<string, ILocalizedTemplate> = {
  en: {
    subject: 'Court Notice: In re Nationwide Consumer Settlement',
    bodyHtml: '<h1>Class Notice</h1><p>Dear {{claimant_first_name}}, you are eligible for {{settlement_amount}} in {{case_name}}. Select your payment by {{selection_deadline}} at <a href="{{payment_selection_link}}">Claim Portal</a>.</p>'
  },
  es: {
    subject: 'Notificación Judicial: In re Nationwide Consumer Settlement',
    bodyHtml: '<h1>Aviso Legal</h1><p>Estimado(a) {{claimant_first_name}}, es elegible para recibir {{settlement_amount}} en {{case_name}}. Elija su método de pago antes del {{selection_deadline}} en <a href="{{payment_selection_link}}">Portal de Reclamos</a>.</p>'
  },
  zh: {
    subject: '法院和解通知: In re Nationwide Consumer Settlement',
    bodyHtml: '<h1>和解通知</h1><p>尊敬的 {{claimant_first_name}}，您在 {{case_name}} 中有权获得 {{settlement_amount}}。请在 {{selection_deadline}} 之前点击 <a href="{{payment_selection_link}}">领取入口</a> 选择支付方式。</p>'
  },
  vi: {
    subject: 'Thông Báo Tòa Án: In re Nationwide Consumer Settlement',
    bodyHtml: '<h1>Thông Báo Giải Quyết</h1><p>Kính gửi {{claimant_first_name}}, bạn đủ điều kiện nhận {{settlement_amount}} trong vụ {{case_name}}. Vui lòng chọn phương thức thanh toán trước ngày {{selection_deadline}} tại <a href="{{payment_selection_link}}">Cổng Nhận Tiền</a>.</p>'
  }
};

export const defaultThrottling: IThrottlingConfig = {
  batchSize: 50,
  intervalMinutes: 15,
  rateLimitPerSecond: 10,
  dailyCap: 10000,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  timezone: 'America/New_York'
};

/**
 * Creates an active class action settlement case for E2E testing
 */
export async function createTestCase(overrides: Partial<any> = {}): Promise<any> {
  const deadline = overrides.disbursementDeadline || new Date(Date.now() + 30 * 86400000);
  return await Case.create({
    name: overrides.name || 'In re Nationwide Consumer Privacy Settlement',
    docketNumber: overrides.docketNumber || '1:24-cv-09876-JURIS',
    lawFirmId: overrides.lawFirmId || 'firm-test-alpha',
    settlementFundTotal: overrides.settlementFundTotal ?? 500000.0,
    disbursementDeadline: deadline,
    fallbackPaymentMethod: overrides.fallbackPaymentMethod || 'physical_check',
    status: overrides.status || 'active',
    defaultLanguage: overrides.defaultLanguage || 'en',
    supportedLanguages: overrides.supportedLanguages || ['en', 'es', 'zh', 'vi'],
    emailTemplate: overrides.emailTemplate || {
      subject: 'Court-Approved Class Settlement Notice',
      bodyHtml: '<h1>Notice</h1><p>Claim {{settlement_amount}}.</p>'
    },
    ...overrides
  });
}

export class FailableMockEmailProvider extends MockEmailProvider {
  public shouldFail: boolean = false;
  public failError: Error = new Error('421 4.7.0 Try again later, closing transmission channel');

  override async send(options: any): Promise<any> {
    if (this.shouldFail) {
      throw this.failError;
    }
    return super.send(options);
  }
}

/**
 * Creates a batch of test claimants with realistic class action parameters
 */
export async function createTestClaimants(
  caseId: any,
  count: number,
  options: {
    prefix?: string;
    statusDistribution?: { status: string; count: number }[];
    bouncedCount?: number;
    languageDistribution?: { lang: string; percentage: number }[];
    baseAmount?: number;
    optedOutCount?: number;
    invalidEmailCount?: number;
  } = {}
): Promise<any[]> {
  const prefix = options.prefix || 'CLM';
  const claimantsToInsert: any[] = [];
  const baseAmount = options.baseAmount || 450.0;

  let assignedCount = 0;
  const statusQueue: string[] = [];
  if (options.statusDistribution) {
    for (const dist of options.statusDistribution) {
      for (let i = 0; i < dist.count; i++) {
        statusQueue.push(dist.status);
      }
    }
  }

  const langs = options.languageDistribution || [
    { lang: 'en', percentage: 70 },
    { lang: 'es', percentage: 15 },
    { lang: 'zh', percentage: 10 },
    { lang: 'vi', percentage: 5 }
  ];

  for (let i = 1; i <= count; i++) {
    const paddedIndex = String(i).padStart(4, '0');
    const claimId = `${prefix}-${paddedIndex}`;
    const status = statusQueue.length > 0 ? statusQueue.shift()! : 'pending_selection';
    const isBounced = options.bouncedCount ? i <= options.bouncedCount : false;
    const isOptedOut = options.optedOutCount ? i > (options.bouncedCount || 0) && i <= (options.bouncedCount || 0) + options.optedOutCount : false;
    const isInvalidEmail = options.invalidEmailCount
      ? i > count - options.invalidEmailCount
      : false;

    // Determine language based on distribution
    let lang = 'en';
    const rand = (i % 100);
    let cumulative = 0;
    for (const item of langs) {
      cumulative += item.percentage;
      if (rand < cumulative) {
        lang = item.lang;
        break;
      }
    }

    let email = `claimant.${paddedIndex}@example.com`;
    if (isInvalidEmail) {
      email = `invalid-claimant-${paddedIndex}@bad..domain`;
    }

    claimantsToInsert.push({
      caseId,
      claimId,
      firstName: `FirstName${paddedIndex}`,
      lastName: `LastName${paddedIndex}`,
      email,
      settlementAmount: baseAmount + (i % 50) * 10,
      status,
      paymentSelectionToken: `token-${claimId.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      emailSent: false,
      bounced: isBounced,
      bounceReason: isBounced ? '550 5.1.1 User unknown' : undefined,
      paymentDetails: { preferredLanguage: lang },
      deliveryAttempts: 0,
      cadenceHistory: []
    });
  }

  return await Claimant.insertMany(claimantsToInsert);
}

/**
 * Checks whether a given timestamp in a specified timezone falls within quiet hours
 */
export function isWithinQuietHours(
  date: Date,
  quietHoursStart: string = '21:00',
  quietHoursEnd: string = '08:00',
  timezone: string = 'America/New_York'
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;

  // Format the time in the target timezone as HH:mm
  const timeStr = date.toLocaleTimeString('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });

  const [currH, currM] = timeStr.split(':').map(Number);
  const currentMinutes = currH * 60 + currM;

  const [startH, startM] = quietHoursStart.split(':').map(Number);
  const startMinutes = startH * 60 + startM;

  const [endH, endM] = quietHoursEnd.split(':').map(Number);
  const endMinutes = endH * 60 + endM;

  if (startMinutes > endMinutes) {
    // Crosses midnight, e.g. 21:00 to 08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    // Within same day, e.g. 01:00 to 05:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}

/**
 * Calculates the next available window date after quiet hours
 */
export function calculateNextSendWindow(
  currentDate: Date,
  quietHoursEnd: string = '08:00',
  timezone: string = 'America/New_York'
): Date {
  const [endH, endM] = quietHoursEnd.split(':').map(Number);
  const nextDate = new Date(currentDate);

  // Approximate next morning at quietHoursEnd in target timezone
  nextDate.setHours(endH, endM, 0, 0);
  if (nextDate.getTime() <= currentDate.getTime()) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  return nextDate;
}

/**
 * RFC 5322 Email Syntax Validator
 */
export function validateEmailSyntax(email: string): boolean {
  if (!email || email.length > 254) return false;
  const regex =
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(email);
}

/**
 * Opaque-box driver that executes wave dispatch according to the exact specification
 * in ORIGINAL_REQUEST.md and PROJECT.md.
 */
export async function executeOpaqueWaveDispatch(options: {
  caseRecord: any;
  stage: CadenceStageKey;
  throttling?: Partial<IThrottlingConfig>;
  templates?: Record<string, ILocalizedTemplate>;
  suppressionList?: string[];
  currentTime?: Date;
  mockEmailProvider?: MockEmailProvider;
}): Promise<{
  telemetry: IWaveTelemetry;
  dispatchedClaimants: string[];
  skippedClaimants: string[];
  suppressedClaimants: string[];
  subBatchCount: number;
  deferredDueToQuietHours: boolean;
}> {
  const caseId = options.caseRecord._id || options.caseRecord.id;
  const stage = options.stage;
  const throttling: IThrottlingConfig = { ...defaultThrottling, ...(options.throttling || {}) };
  const templates = options.templates || defaultTemplates;
  const now = options.currentTime || new Date();
  const globalSuppression = new Set((options.suppressionList || []).map((e) => e.toLowerCase()));

  // 1. Check Quiet Hours
  if (
    throttling.quietHoursStart &&
    throttling.quietHoursEnd &&
    isWithinQuietHours(now, throttling.quietHoursStart, throttling.quietHoursEnd, throttling.timezone)
  ) {
    return {
      telemetry: {
        eligible: 0,
        queued: 0,
        dispatched: 0,
        skipped_completed: 0,
        suppressed_bounced: 0,
        failed: 0
      },
      dispatchedClaimants: [],
      skippedClaimants: [],
      suppressedClaimants: [],
      subBatchCount: 0,
      deferredDueToQuietHours: true
    };
  }

  // 2. Query target cohort in database
  const query: any = { caseId };
  if (stage === 'initial_notice') {
    // Initial notice targets all active pending claimants who haven't received initial notice
    query.status = 'pending_selection';
    query.bounced = { $ne: true };
    query.emailSent = { $ne: true };
  } else if (stage === 'post_deadline_fallback') {
    // Post-deadline targets claimants who transitioned or finalized
    query.status = { $in: ['deadline_expired', 'selected', 'queued_for_sftp', 'disbursed'] };
  } else {
    // Reminder stages (T-14d, T-7d, T-48h) target pending claimants
    query.status = 'pending_selection';
    query.bounced = { $ne: true };
  }

  const allEligible = await Claimant.find(query).exec();
  const totalEligible = allEligible.length;

  const telemetry: IWaveTelemetry = {
    eligible: totalEligible,
    queued: totalEligible,
    dispatched: 0,
    skipped_completed: 0,
    suppressed_bounced: 0,
    failed: 0
  };

  const dispatchedClaimants: string[] = [];
  const skippedClaimants: string[] = [];
  const suppressedClaimants: string[] = [];

  // Partition into sub-batches
  const batchSize = Math.max(1, throttling.batchSize || 50);
  const chunks: any[][] = [];
  for (let i = 0; i < allEligible.length; i += batchSize) {
    chunks.push(allEligible.slice(i, i + batchSize));
  }

  let totalDailySent = 0;
  const dailyCap = throttling.dailyCap || 10000;

  for (const chunk of chunks) {
    for (const claimant of chunk) {
      if (totalDailySent >= dailyCap) {
        continue;
      }

      // Re-fetch claimant from database immediately prior to send (Pre-dispatch check)
      const freshClaimant = await Claimant.findById(claimant._id).exec();
      if (!freshClaimant) continue;

      // Check 1: Dynamic payment status filter
      if (stage !== 'post_deadline_fallback' && freshClaimant.status !== 'pending_selection') {
        telemetry.skipped_completed++;
        skippedClaimants.push(freshClaimant.claimId);
        continue;
      }

      // Check 2: Dynamic 3-Layer Preflight Bounce & Syntax Check
      const email = (freshClaimant.email || '').trim().toLowerCase();
      const validSyntax = validateEmailSyntax(email);
      const isHistoricalBounce = freshClaimant.bounced === true;
      const isGlobalSuppressed = globalSuppression.has(email);

      if (!validSyntax || isHistoricalBounce || isGlobalSuppressed) {
        telemetry.suppressed_bounced++;
        suppressedClaimants.push(freshClaimant.claimId);
        freshClaimant.bounced = true;
        freshClaimant.bounceReason = !validSyntax
          ? 'RFC 5322 syntax failure'
          : isGlobalSuppressed
          ? 'Global suppression registry match'
          : 'Historical bounce recorded';
        await freshClaimant.save();
        continue;
      }

      // Check 3: Language resolution
      const claimantLang =
        (freshClaimant as any).preferredLanguage ||
        (freshClaimant.paymentDetails as any)?.preferredLanguage ||
        options.caseRecord.defaultLanguage ||
        'en';
      const template = templates[claimantLang] || templates.en || defaultTemplates.en;

      // Check 4: Merge tag interpolation
      const deadlineStr = options.caseRecord.disbursementDeadline
        ? new Date(options.caseRecord.disbursementDeadline).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'November 30, 2026';

      const tags: Record<string, string> = {
        claimant_first_name: freshClaimant.firstName || '',
        claimant_last_name: freshClaimant.lastName || '',
        settlement_amount: `$${(freshClaimant.settlementAmount || 0).toFixed(2)}`,
        case_name: options.caseRecord.name || 'Juris Settlement',
        selection_deadline: deadlineStr,
        payment_selection_link: `https://portal.juris-banking.com/claim/${freshClaimant.paymentSelectionToken}`
      };

      const resolvedSubject = resolveMergeTags(template.subject, tags);
      const resolvedHtml = resolveMergeTags(sanitizeEmailHtml(template.bodyHtml), tags);

      // Transmit email
      try {
        await EmailService.sendEmail({
          to: freshClaimant.email,
          subject: resolvedSubject,
          html: resolvedHtml
        });

        freshClaimant.emailSent = true;
        freshClaimant.emailSentAt = now;
        freshClaimant.deliveryAttempts = (freshClaimant.deliveryAttempts || 0) + 1;
        await freshClaimant.save();

        telemetry.dispatched++;
        totalDailySent++;
        dispatchedClaimants.push(freshClaimant.claimId);
      } catch (err) {
        telemetry.failed++;
        freshClaimant.deliveryAttempts = (freshClaimant.deliveryAttempts || 0) + 1;
        await freshClaimant.save();
      }
    }
  }

  telemetry.queued = Math.max(0, totalEligible - telemetry.dispatched - telemetry.skipped_completed - telemetry.suppressed_bounced - telemetry.failed);

  return {
    telemetry,
    dispatchedClaimants,
    skippedClaimants,
    suppressedClaimants,
    subBatchCount: chunks.length,
    deferredDueToQuietHours: false
  };
}
