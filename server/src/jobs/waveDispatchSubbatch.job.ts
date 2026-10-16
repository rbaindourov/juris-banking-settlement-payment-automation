import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { SubBatch } from '../models/SubBatch';
import { EmailWave } from '../models/EmailWave';
import { Case } from '../models/Case';
import { NotificationCadence } from '../models/NotificationCadence';
import { Claimant } from '../models/Claimant';
import { SuppressionList } from '../models/SuppressionList';
import { EmailService } from '../services/email.service';
import { sanitizeEmailHtml, resolveMergeTags, formatDate, formatCurrency } from '../services/template.service';
import { config } from '../config/env';

export interface WaveDispatchSubbatchData {
  waveId: string;
  subBatchId: string;
}

export interface WaveDispatchSubbatchOptions {
  agenda?: Agenda;
  currentTime?: Date;
}

export interface WaveDispatchSubbatchResult {
  subBatchId: string;
  waveId: string;
  status: 'completed' | 'deferred_quiet_hours' | 'paused' | 'cancelled' | 'failed';
  recipientCount: number;
  dispatchedCount: number;
  skippedCompletedCount: number;
  suppressedBouncedCount: number;
  failedCount: number;
  deferred?: boolean;
  nextRunAt?: Date;
  error?: string;
}

export function validateEmailSyntax(email: string): boolean {
  if (!email || email.length > 254) return false;
  const regex =
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(email);
}

export function isWithinQuietHours(
  date: Date,
  quietHoursStart: string = '22:00',
  quietHoursEnd: string = '07:00',
  timezone: string = 'UTC'
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;

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
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}

export function calculateNextSendWindow(
  currentDate: Date,
  arg1: string = '22:00',
  arg2: string = '07:00',
  arg3: string = 'UTC'
): Date {
  let quietHoursStart = '22:00';
  let quietHoursEnd = '07:00';
  let timezone = 'UTC';

  if (arg1.includes(':') && arg2.includes(':')) {
    quietHoursStart = arg1;
    quietHoursEnd = arg2;
    timezone = arg3 || 'UTC';
  } else if (arg1.includes(':')) {
    quietHoursEnd = arg1;
    timezone = arg2 || 'UTC';
  }

  const [startH, startM] = quietHoursStart.split(':').map(Number);
  const [endH, endM] = quietHoursEnd.split(':').map(Number);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(currentDate);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  const y = parseInt(p.year, 10);
  const m = parseInt(p.month, 10);
  const d = parseInt(p.day, 10);
  const curH = parseInt(p.hour, 10);
  const curM = parseInt(p.minute, 10);

  const curMinutes = curH * 60 + curM;
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  let daysToAdd = 0;
  if (startMinutes > endMinutes) {
    if (curMinutes >= startMinutes) daysToAdd = 1;
  } else {
    if (curMinutes >= endMinutes) daysToAdd = 1;
  }

  const baseUtc = new Date(Date.UTC(y, m - 1, d + daysToAdd, endH, endM, 0));

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
  });

  let guess = baseUtc.getTime();
  for (let iter = 0; iter < 4; iter++) {
    const guessDate = new Date(guess);
    const guessParts: Record<string, string> = {};
    for (const gp of tzFormatter.formatToParts(guessDate)) guessParts[gp.type] = gp.value;
    const guessUtc = Date.UTC(
      parseInt(guessParts.year, 10),
      parseInt(guessParts.month, 10) - 1,
      parseInt(guessParts.day, 10),
      parseInt(guessParts.hour, 10),
      parseInt(guessParts.minute, 10),
      parseInt(guessParts.second, 10)
    );
    const diff = baseUtc.getTime() - guessUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

export async function executeDispatchWaveSubBatch(
  data: WaveDispatchSubbatchData,
  options?: WaveDispatchSubbatchOptions
): Promise<WaveDispatchSubbatchResult> {
  const now = options?.currentTime || new Date();
  const agenda = options?.agenda;

  const subBatch = await SubBatch.findOne({
    $or: [
      { subBatchId: data.subBatchId },
      ...(mongoose.isValidObjectId(data.subBatchId) ? [{ _id: data.subBatchId }] : [])
    ]
  });

  if (!subBatch) {
    throw new Error(`SubBatch not found for identifier: ${data.subBatchId}`);
  }

  if (subBatch.status === 'completed') {
    return {
      subBatchId: subBatch.subBatchId,
      waveId: data.waveId,
      status: 'completed',
      recipientCount: subBatch.recipientCount,
      dispatchedCount: subBatch.dispatchedCount,
      skippedCompletedCount: subBatch.skippedCompletedCount,
      suppressedBouncedCount: subBatch.suppressedBouncedCount,
      failedCount: subBatch.failedCount
    };
  }

  const wave = await EmailWave.findOne({
    $or: [
      { waveId: data.waveId },
      { _id: subBatch.waveId },
      ...(mongoose.isValidObjectId(data.waveId) ? [{ _id: data.waveId }] : [])
    ]
  });

  if (!wave) {
    throw new Error(`EmailWave not found for identifier: ${data.waveId}`);
  }

  // 1. Check Wave Operational State
  if (wave.status === 'paused' || wave.controlState?.isPaused) {
    subBatch.status = 'paused';
    subBatch.executionLogs.push({
      timestamp: now,
      level: 'info',
      message: 'SubBatch dispatch suspended: parent wave is paused'
    });
    await subBatch.save();
    return {
      subBatchId: subBatch.subBatchId,
      waveId: wave.waveId,
      status: 'paused',
      recipientCount: subBatch.recipientCount,
      dispatchedCount: subBatch.dispatchedCount,
      skippedCompletedCount: subBatch.skippedCompletedCount,
      suppressedBouncedCount: subBatch.suppressedBouncedCount,
      failedCount: subBatch.failedCount
    };
  }

  if (wave.status === 'cancelled') {
    subBatch.status = 'cancelled';
    subBatch.executionLogs.push({
      timestamp: now,
      level: 'warn',
      message: 'SubBatch cancelled: parent wave was cancelled'
    });
    await subBatch.save();
    return {
      subBatchId: subBatch.subBatchId,
      waveId: wave.waveId,
      status: 'cancelled',
      recipientCount: subBatch.recipientCount,
      dispatchedCount: subBatch.dispatchedCount,
      skippedCompletedCount: subBatch.skippedCompletedCount,
      suppressedBouncedCount: subBatch.suppressedBouncedCount,
      failedCount: subBatch.failedCount
    };
  }

  const caseDoc = await Case.findById(subBatch.caseId);
  const cadence = wave.cadenceId
    ? await NotificationCadence.findById(wave.cadenceId)
    : await NotificationCadence.findOne({ caseId: subBatch.caseId });

  const throttling = wave.throttlingConfig || cadence?.throttling || {
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC',
    rateLimitPerSecond: 25,
    dailyCap: 10000
  };

  // 2. Quiet Hours Check
  if (throttling.quietHoursEnabled !== false && throttling.quietHoursStart && throttling.quietHoursEnd) {
    const inQuiet = isWithinQuietHours(
      now,
      throttling.quietHoursStart,
      throttling.quietHoursEnd,
      throttling.timezone || 'UTC'
    );

    if (inQuiet) {
      const nextWindow = calculateNextSendWindow(
        now,
        throttling.quietHoursStart,
        throttling.quietHoursEnd,
        throttling.timezone || 'UTC'
      );

      subBatch.status = 'pending';
      subBatch.scheduledAt = nextWindow;
      subBatch.executionLogs.push({
        timestamp: now,
        level: 'info',
        message: `Quiet hours active [${throttling.quietHoursStart}-${throttling.quietHoursEnd} ${throttling.timezone}]. Deferring dispatch to ${nextWindow.toISOString()}`
      });
      await subBatch.save();

      if (agenda) {
        await agenda.schedule(nextWindow, 'wave:dispatch-subbatch', {
          waveId: wave.waveId,
          subBatchId: subBatch.subBatchId
        });
      }

      return {
        subBatchId: subBatch.subBatchId,
        waveId: wave.waveId,
        status: 'deferred_quiet_hours',
        deferred: true,
        nextRunAt: nextWindow,
        recipientCount: subBatch.recipientCount,
        dispatchedCount: subBatch.dispatchedCount,
        skippedCompletedCount: subBatch.skippedCompletedCount,
        suppressedBouncedCount: subBatch.suppressedBouncedCount,
        failedCount: subBatch.failedCount
      };
    }
  }

  // 3. Mark in progress
  subBatch.status = 'in_progress';
  subBatch.startedAt = subBatch.startedAt || now;
  await subBatch.save();

  if (wave.status === 'scheduled') {
    wave.status = 'in_progress';
    wave.actualStartTime = wave.actualStartTime || now;
    await wave.save();
  }

  const rateLimitPerSecond = throttling.rateLimitPerSecond || 25;
  const delayMs = Math.max(0, Math.floor(1000 / rateLimitPerSecond));

  const stageConfig = cadence?.stages?.find((s: any) => s.stageKey === wave.stage);

  try {
    for (const recipient of subBatch.recipients) {
      if (recipient.status !== 'queued') continue;

      // Real-time check if wave was paused mid-subbatch
      const freshWave = await EmailWave.findById(wave._id).select('status controlState').lean();
      if (freshWave?.status === 'paused' || (freshWave?.controlState as any)?.isPaused) {
        subBatch.status = 'paused';
        await subBatch.save();
        break;
      }

      const freshClaimant = await Claimant.findById(recipient.claimantId);
      if (!freshClaimant) {
        recipient.status = 'failed';
        recipient.error = 'Claimant record not found';
        subBatch.failedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.failed': 1, 'telemetry.queued': -1 } });
        continue;
      }

      // Pre-Dispatch Check 1: Dynamic payment status check
      if (wave.stage !== 'post_deadline_fallback' && freshClaimant.status !== 'pending_selection') {
        recipient.status = 'skipped_completed';
        recipient.skipReason = `Payment selection already completed (status: ${freshClaimant.status})`;
        subBatch.skippedCompletedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.skipped_completed': 1, 'telemetry.queued': -1 } });
        continue;
      }

      // Pre-Dispatch Check 2: 3-Layer Suppression
      const email = (freshClaimant.email || recipient.email || '').trim().toLowerCase();
      const validSyntax = validateEmailSyntax(email);
      if (!validSyntax) {
        recipient.status = 'suppressed_bounced';
        recipient.skipReason = 'RFC 5322 syntax failure';
        subBatch.suppressedBouncedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.suppressed_bounced': 1, 'telemetry.queued': -1 } });
        freshClaimant.bounced = true;
        freshClaimant.bounceReason = 'RFC 5322 syntax failure';
        await Claimant.updateOne(
          { _id: freshClaimant._id },
          { $set: { bounced: true, bounceReason: 'RFC 5322 syntax failure' } }
        );

        await SuppressionList.updateOne(
          { email, caseId: subBatch.caseId },
          {
            $setOnInsert: {
              email,
              reason: 'invalid_syntax',
              source: 'preflight_syntax',
              caseId: subBatch.caseId,
              lawFirmId: caseDoc?.lawFirmId
            }
          },
          { upsert: true }
        );
        continue;
      }

      const isSuppressedInList = await SuppressionList.findOne({
        email,
        $or: [{ caseId: caseDoc?._id }, { caseId: null }, { caseId: { $exists: false } }]
      }).lean();

      if (isSuppressedInList) {
        recipient.status = 'suppressed_bounced';
        recipient.skipReason = `Suppression list match: ${isSuppressedInList.reason}`;
        subBatch.suppressedBouncedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.suppressed_bounced': 1, 'telemetry.queued': -1 } });
        freshClaimant.bounced = true;
        freshClaimant.bounceReason = `Suppression list: ${isSuppressedInList.reason}`;
        await Claimant.updateOne(
          { _id: freshClaimant._id },
          { $set: { bounced: true, bounceReason: `Suppression list: ${isSuppressedInList.reason}` } }
        );
        continue;
      }

      if (freshClaimant.bounced) {
        recipient.status = 'suppressed_bounced';
        recipient.skipReason = freshClaimant.bounceReason || 'Historical bounce recorded';
        subBatch.suppressedBouncedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.suppressed_bounced': 1, 'telemetry.queued': -1 } });
        continue;
      }

      // Pre-Dispatch Check 3: Retry attempts & cooldown
      if ((freshClaimant.deliveryAttempts || 0) >= 5) {
        recipient.status = 'failed';
        recipient.error = 'Maximum delivery attempts (5) exceeded';
        subBatch.failedCount++;
        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.failed': 1, 'telemetry.queued': -1 } });
        continue;
      }

      if (freshClaimant.nextRetryAt && now < new Date(freshClaimant.nextRetryAt)) {
        // Cooldown in progress - leave queued for future retry
        continue;
      }

      // Template & Merge Tag Interpolation
      const claimantPreferred = (freshClaimant as any).preferredLanguage;
      const lang = (recipient.preferredLanguage || freshClaimant.paymentDetails?.preferredLanguage || claimantPreferred || caseDoc?.defaultLanguage || 'en').toLowerCase().trim();
      const templates = stageConfig?.templates;
      const rawTemplate = (templates && (templates[lang] || templates.en)) || {
        subject: `Notice of Settlement Payment: {{case_name}}`,
        bodyHtml: `<p>Dear {{claimant_first_name}},</p><p>You are eligible for {{settlement_amount}} in {{case_name}}. Deadline: {{selection_deadline}}.</p><p><a href="{{payment_selection_link}}">Select Payment</a></p>`
      };

      const deadlineStr = caseDoc?.disbursementDeadline ? formatDate(caseDoc.disbursementDeadline) : 'N/A';
      const token = freshClaimant.paymentSelectionToken || freshClaimant.claimantToken || freshClaimant.claimId;
      const portalUrl = `${config.CLIENT_URL || 'https://portal.juris-banking.com'}/claim/${token}`;

      const tags: Record<string, string> = {
        claimant_first_name: freshClaimant.firstName || '',
        claimant_last_name: freshClaimant.lastName || '',
        settlement_amount: formatCurrency(freshClaimant.settlementAmount || 0),
        case_name: caseDoc?.name || 'Settlement Case',
        selection_deadline: deadlineStr,
        payment_selection_link: portalUrl
      };

      const subject = resolveMergeTags(rawTemplate.subject, tags);
      const html = resolveMergeTags(sanitizeEmailHtml(rawTemplate.bodyHtml), tags);

      // Pacing delay (skip in test or if delayMs == 0)
      if (delayMs > 0 && config.NODE_ENV !== 'test') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const sendResult = await EmailService.sendEmail({
          to: email,
          subject,
          html
        });

        if (sendResult.success) {
          recipient.status = 'dispatched';
          recipient.dispatchedAt = new Date();
          recipient.messageId = sendResult.messageId;
          subBatch.dispatchedCount++;

          await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.dispatched': 1, 'telemetry.queued': -1 } });

          freshClaimant.emailSent = true;
          freshClaimant.emailSentAt = new Date();
          freshClaimant.emailMessageId = sendResult.messageId;
          freshClaimant.deliveryAttempts = (freshClaimant.deliveryAttempts || 0) + 1;
          freshClaimant.nextRetryAt = undefined;

          // Record cadence history if array exists
          if (Array.isArray((freshClaimant as any).cadenceHistory)) {
            (freshClaimant as any).cadenceHistory.push({
              stage: wave.stage,
              waveId: wave.waveId,
              sentAt: new Date(),
              status: 'sent',
              messageId: sendResult.messageId
            });
          }

          await freshClaimant.save();
        } else {
          recipient.status = 'failed';
          recipient.error = sendResult.error || 'Email dispatch failed';
          subBatch.failedCount++;

          await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.failed': 1, 'telemetry.queued': -1 } });

          freshClaimant.deliveryAttempts = (freshClaimant.deliveryAttempts || 0) + 1;
          freshClaimant.lastDeliveryError = recipient.error;
          const backoffMs = 60000 * Math.pow(2, freshClaimant.deliveryAttempts - 1);
          freshClaimant.nextRetryAt = new Date(Date.now() + backoffMs);
          await freshClaimant.save();
        }
      } catch (sendErr: any) {
        recipient.status = 'failed';
        recipient.error = sendErr.message || 'Dispatch exception';
        subBatch.failedCount++;

        await EmailWave.updateOne({ _id: wave._id }, { $inc: { 'telemetry.failed': 1, 'telemetry.queued': -1 } });

        freshClaimant.deliveryAttempts = (freshClaimant.deliveryAttempts || 0) + 1;
        freshClaimant.lastDeliveryError = recipient.error;
        const backoffMs = 60000 * Math.pow(2, freshClaimant.deliveryAttempts - 1);
        freshClaimant.nextRetryAt = new Date(Date.now() + backoffMs);
        await freshClaimant.save();
      }
    }

    if (subBatch.status !== 'paused') {
      subBatch.status = 'completed';
      subBatch.completedAt = new Date();
      subBatch.executionLogs.push({
        timestamp: new Date(),
        level: 'info',
        message: `SubBatch completed: ${subBatch.dispatchedCount} dispatched, ${subBatch.skippedCompletedCount} skipped, ${subBatch.suppressedBouncedCount} suppressed, ${subBatch.failedCount} failed`
      });
      await subBatch.save();

      const updatedWave = await EmailWave.findByIdAndUpdate(
        wave._id,
        { $inc: { completedSubBatches: 1 } },
        { new: true }
      );

      if (updatedWave && updatedWave.completedSubBatches >= updatedWave.totalSubBatches) {
        updatedWave.status = 'completed';
        updatedWave.completedDate = new Date();
        await updatedWave.save();

        if (cadence) {
          const stageObj = cadence.stages.find((s: any) => s.stageKey === wave.stage);
          if (stageObj) {
            stageObj.status = 'completed';
            cadence.markModified('stages');
            await cadence.save();
          }
        }
      }
    }

    return {
      subBatchId: subBatch.subBatchId,
      waveId: wave.waveId,
      status: subBatch.status as any,
      recipientCount: subBatch.recipientCount,
      dispatchedCount: subBatch.dispatchedCount,
      skippedCompletedCount: subBatch.skippedCompletedCount,
      suppressedBouncedCount: subBatch.suppressedBouncedCount,
      failedCount: subBatch.failedCount
    };
  } catch (batchErr: any) {
    subBatch.retryCount = (subBatch.retryCount || 0) + 1;
    subBatch.lastError = batchErr.message;

    if (subBatch.retryCount < (subBatch.maxRetries || 5)) {
      const backoffMinutes = Math.pow(2, subBatch.retryCount);
      const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      subBatch.status = 'pending';
      subBatch.scheduledAt = retryAt;
      subBatch.executionLogs.push({
        timestamp: new Date(),
        level: 'warn',
        message: `SubBatch failed on attempt ${subBatch.retryCount}/${subBatch.maxRetries}: ${batchErr.message}. Rescheduled with exponential backoff at ${retryAt.toISOString()}`
      });
      await subBatch.save();

      if (agenda) {
        await agenda.schedule(retryAt, 'wave:dispatch-subbatch', {
          waveId: wave.waveId,
          subBatchId: subBatch.subBatchId
        });
      }
    } else {
      subBatch.status = 'failed';
      subBatch.error = `Max retries (${subBatch.maxRetries}) exceeded: ${batchErr.message}`;
      subBatch.executionLogs.push({
        timestamp: new Date(),
        level: 'error',
        message: subBatch.error
      });
      await subBatch.save();
    }
    throw batchErr;
  }
}

export function defineWaveDispatchSubbatch(agenda: Agenda): void {
  agenda.define(
    'wave:dispatch-subbatch',
    async (job: any) => {
      await executeDispatchWaveSubBatch(job.attrs?.data as WaveDispatchSubbatchData, { agenda });
    },
    { concurrency: 5, lockLifetime: 300000 }
  );
}
