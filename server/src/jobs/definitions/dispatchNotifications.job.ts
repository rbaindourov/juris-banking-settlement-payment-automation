import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { Case } from '../../models/Case';
import { Claimant } from '../../models/Claimant';
import { EmailService, checkBouncePreflight } from '../../services/email.service';
import { escapeHtml, sanitizeLinkUrl } from '../../services/template.service';
import { config } from '../../config/env';

export interface DispatchNotificationsData {
  caseId?: string;
  batchSize?: number;
  rateLimitPerSecond?: number;
}

export interface DispatchNotificationsResult {
  processedCount: number;
  sentCount: number;
  bouncedCount: number;
  failedCount: number;
}

export function interpolateTemplate(
  templateStr: string,
  variables: Record<string, string>
): string {
  let result = templateStr;
  for (const [key, val] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(regex, val);
  }
  return result;
}

/**
 * Pure business logic for dispatching notification emails.
 * Can be called directly in unit tests without Agenda timers.
 */
export async function executeDispatchNotifications(
  data?: DispatchNotificationsData
): Promise<DispatchNotificationsResult> {
  const batchSize = data?.batchSize || 50;
  let targetCases: any[] = [];

  if (data?.caseId) {
    const caseDoc = mongoose.isValidObjectId(data.caseId)
      ? (await Case.findById(data.caseId)) || (await Case.findOne({ caseId: data.caseId }))
      : await Case.findOne({ caseId: data.caseId });
    if (caseDoc && caseDoc.status === 'active') {
      targetCases = [caseDoc];
    }
  } else {
    targetCases = await Case.find({ status: 'active' });
  }

  let totalProcessed = 0;
  let totalSent = 0;
  let totalBounced = 0;
  let totalFailed = 0;

  for (const caseDoc of targetCases) {
    const caseLookupIds = [caseDoc._id, caseDoc.caseId, caseDoc._id.toString()].filter(Boolean);

    const claimants = await Claimant.find({
      caseId: { $in: caseLookupIds },
      status: 'pending_selection',
      emailSent: { $ne: true },
      bounced: { $ne: true },
      $or: [
        { deliveryAttempts: { $exists: false } },
        { deliveryAttempts: 0 },
        { deliveryAttempts: { $lt: 5 }, nextRetryAt: { $lte: new Date() } }
      ]
    }).limit(batchSize);

    for (const claimant of claimants) {
      totalProcessed++;

      // Pre-flight bounce validation
      const preflight = await checkBouncePreflight(claimant.email);
      if (!preflight.eligible) {
        claimant.bounced = true;
        claimant.bouncedAt = new Date();
        claimant.bounceReason = preflight.reason || 'Failed pre-flight bounce check';
        await claimant.save();
        totalBounced++;
        continue;
      }

      // Prepare merge tags
      const token = claimant.paymentSelectionToken || claimant.claimantToken || claimant.claimId;
      const portalLink = sanitizeLinkUrl(`${config.CLIENT_URL}/claim/${token}`);
      const deadlineStr = caseDoc.disbursementDeadline
        ? new Date(caseDoc.disbursementDeadline).toISOString().slice(0, 10)
        : 'N/A';

      const mergeTags: Record<string, string> = {
        claimant_first_name: escapeHtml(claimant.firstName || ''),
        claimant_last_name: escapeHtml(claimant.lastName || ''),
        case_name: escapeHtml(caseDoc.name || 'Settlement Case'),
        settlement_amount: escapeHtml((claimant.settlementAmount || 0).toFixed(2)),
        selection_deadline: escapeHtml(deadlineStr),
        payment_selection_link: escapeHtml(portalLink)
      };

      const rawSubject = caseDoc.emailTemplate?.subject || `Notice of Settlement Payment: {{case_name}}`;
      const rawBody =
        caseDoc.emailTemplate?.bodyHtml ||
        `<p>Dear {{claimant_first_name}} {{claimant_last_name}},</p><p>You are eligible for a settlement of \${{settlement_amount}} in {{case_name}}.</p><p><a href="{{payment_selection_link}}">Select Your Payment Method</a></p><p>Deadline: {{selection_deadline}}</p>`;

      const subject = interpolateTemplate(rawSubject, mergeTags);
      const html = interpolateTemplate(rawBody, mergeTags);

      if (data?.rateLimitPerSecond && data.rateLimitPerSecond > 0) {
        const delayMs = Math.max(1, Math.floor(1000 / data.rateLimitPerSecond));
        await new Promise((r) => setTimeout(r, delayMs));
      }

      try {
        const sendResult = await EmailService.sendEmail({
          to: claimant.email,
          subject,
          html
        });

        if (sendResult.success) {
          claimant.emailSent = true;
          claimant.emailSentAt = new Date();
          claimant.emailMessageId = sendResult.messageId;
          claimant.deliveryAttempts = (claimant.deliveryAttempts || 0) + 1;
          claimant.nextRetryAt = undefined;
          await claimant.save();
          totalSent++;
        } else {
          claimant.deliveryAttempts = (claimant.deliveryAttempts || 0) + 1;
          claimant.lastDeliveryError = sendResult.error || 'Failed to dispatch email';
          const delayMs = 60000 * Math.pow(2, claimant.deliveryAttempts - 1);
          claimant.nextRetryAt = new Date(Date.now() + delayMs);
          await claimant.save();
          totalFailed++;
        }
      } catch (err: any) {
        claimant.deliveryAttempts = (claimant.deliveryAttempts || 0) + 1;
        claimant.lastDeliveryError = err.message || 'Dispatch exception';
        const delayMs = 60000 * Math.pow(2, claimant.deliveryAttempts - 1);
        claimant.nextRetryAt = new Date(Date.now() + delayMs);
        await claimant.save();
        totalFailed++;
      }
    }
  }

  return {
    processedCount: totalProcessed,
    sentCount: totalSent,
    bouncedCount: totalBounced,
    failedCount: totalFailed
  };
}

export function defineDispatchNotifications(agenda: Agenda): void {
  agenda.define(
    'case:dispatch-notifications',
    async (job: any) => {
      await executeDispatchNotifications(job.attrs?.data as DispatchNotificationsData);
    },
    { concurrency: 5, lockLifetime: 60000 }
  );
}
