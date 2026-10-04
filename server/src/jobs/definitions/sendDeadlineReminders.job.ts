import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { Case } from '../../models/Case';
import { Claimant } from '../../models/Claimant';
import { EmailService } from '../../services/email.service';
import { escapeHtml, sanitizeLinkUrl } from '../../services/template.service';
import { config } from '../../config/env';

export interface SendDeadlineRemindersData {
  caseId?: string;
}

export interface SendDeadlineRemindersResult {
  processedCases: number;
  sentReminders: number;
}

export const DEADLINE_REMINDER_INTERVALS = [
  { label: '7_days', hoursBeforeDeadline: 168 },
  { label: '48_hours', hoursBeforeDeadline: 48 }
] as const;

export async function executeSendDeadlineReminders(
  data?: SendDeadlineRemindersData
): Promise<SendDeadlineRemindersResult> {
  const now = new Date();
  let targetCases: any[] = [];

  if (data?.caseId) {
    const caseDoc = mongoose.isValidObjectId(data.caseId)
      ? (await Case.findById(data.caseId)) || (await Case.findOne({ caseId: data.caseId }))
      : await Case.findOne({ caseId: data.caseId });
    if (caseDoc && caseDoc.disbursementDeadline && new Date(caseDoc.disbursementDeadline) > now) {
      targetCases = [caseDoc];
    }
  } else {
    targetCases = await Case.find({
      status: 'active',
      disbursementDeadline: { $gt: now }
    });
  }

  let sentReminders = 0;

  for (const caseDoc of targetCases) {
    const deadline = new Date(caseDoc.disbursementDeadline).getTime();
    const hoursRemaining = (deadline - now.getTime()) / (1000 * 60 * 60);

    // Determine applicable reminder window
    let activeInterval: string | null = null;
    if (hoursRemaining <= 48 && hoursRemaining > 0) {
      activeInterval = '48_hours';
    } else if (hoursRemaining <= 168 && hoursRemaining > 0) {
      activeInterval = '7_days';
    }

    if (!activeInterval) {
      continue;
    }

    const caseLookupIds = [caseDoc._id, caseDoc.caseId, caseDoc._id.toString()].filter(Boolean);

    const claimants = await Claimant.find({
      caseId: { $in: caseLookupIds },
      status: 'pending_selection',
      bounced: { $ne: true }
    });

    for (const claimant of claimants) {
      const existingReminders: string[] = claimant.receiptDetails?.remindersSent || [];
      if (existingReminders.includes(activeInterval)) {
        continue; // Idempotent: already sent
      }

      const token = claimant.paymentSelectionToken || claimant.claimantToken || claimant.claimId;
      const portalLink = sanitizeLinkUrl(`${config.CLIENT_URL}/claim/${token}`);
      const safeFirstName = escapeHtml(claimant.firstName || '');
      const safeLastName = escapeHtml(claimant.lastName || '');
      const safeCaseName = escapeHtml(caseDoc.name || 'Settlement Case');

      const subject =
        activeInterval === '48_hours'
          ? `[FINAL NOTICE] 48 Hours Left: ${safeCaseName} Settlement Payment Selection`
          : `[REMINDER] 7 Days Remaining to Select Payment: ${safeCaseName}`;

      const html = `
        <p>Dear ${safeFirstName} ${safeLastName},</p>
        <p>This is an automated reminder regarding your pending settlement disbursement for <strong>${safeCaseName}</strong>.</p>
        <p>Your settlement amount is <strong>$${(claimant.settlementAmount || 0).toFixed(2)}</strong>.</p>
        <p>The deadline to elect your preferred payment method is <strong>${new Date(caseDoc.disbursementDeadline).toUTCString()}</strong>.</p>
        <p><a href="${portalLink}" style="padding: 10px 18px; background-color: #1e3a8a; color: #ffffff; text-decoration: none; border-radius: 4px; display: inline-block;">Select Your Payment Method Now</a></p>
      `;

      try {
        const sendResult = await EmailService.sendEmail({
          to: claimant.email,
          subject,
          html
        });

        if (sendResult.success) {
          claimant.receiptDetails = {
            ...(claimant.receiptDetails || {}),
            remindersSent: [...existingReminders, activeInterval],
            lastReminderAt: new Date()
          };
          claimant.markModified('receiptDetails');
          await claimant.save();
          sentReminders++;
        }
      } catch (err: any) {
        console.warn(`[SendDeadlineReminders] Error emailing ${claimant.email}:`, err.message);
      }
    }
  }

  return {
    processedCases: targetCases.length,
    sentReminders
  };
}

export function defineSendDeadlineReminders(agenda: Agenda): void {
  agenda.define(
    'case:send-deadline-reminders',
    async (job: any) => {
      await executeSendDeadlineReminders(job.attrs?.data as SendDeadlineRemindersData);
    },
    { concurrency: 5, lockLifetime: 60000 }
  );
}
