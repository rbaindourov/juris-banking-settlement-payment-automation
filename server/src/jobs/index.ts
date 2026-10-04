import { Agenda } from 'agenda';
import { defineDispatchNotifications, executeDispatchNotifications } from './definitions/dispatchNotifications.job';
import { defineSendDeadlineReminders, executeSendDeadlineReminders } from './definitions/sendDeadlineReminders.job';
import { defineEnforceDeadlineFallback, executeDeadlineFallback } from './definitions/enforceDeadlineFallback.job';
import { defineGenerateAndUploadBatch, executeGenerateAndUploadBatch } from './definitions/generateAndUploadBatch.job';
import { definePollReconciliationReports, executePollReconciliationReports } from './definitions/pollReconciliationReports.job';
import { defineScanGmailBounces, executeScanGmailBounces } from './definitions/scanGmailBounces.job';

export * from './definitions/dispatchNotifications.job';
export * from './definitions/sendDeadlineReminders.job';
export * from './definitions/enforceDeadlineFallback.job';
export * from './definitions/generateAndUploadBatch.job';
export * from './definitions/pollReconciliationReports.job';
export * from './definitions/scanGmailBounces.job';

/**
 * Registers all 6 scheduled Agenda background jobs on the provided Agenda instance.
 */
export function registerAllJobs(agenda: Agenda): void {
  defineDispatchNotifications(agenda);
  defineSendDeadlineReminders(agenda);
  defineEnforceDeadlineFallback(agenda);
  defineGenerateAndUploadBatch(agenda);
  definePollReconciliationReports(agenda);
  defineScanGmailBounces(agenda);
}

/**
 * Schedules recurring intervals for background jobs in production / long-running environments.
 * Must ONLY be called when Agenda is actively started in non-test mode.
 */
export async function scheduleDefaultRecurringJobs(agenda: Agenda): Promise<void> {
  // 1. Dispatch notification sweep (every 5 minutes)
  await agenda.every('5 minutes', 'case:dispatch-notifications');

  // 2. Deadline reminders (daily at 09:00 UTC)
  await agenda.every('0 9 * * *', 'case:send-deadline-reminders');

  // 3. Deadline fallback enforcement (every 15 minutes)
  await agenda.every('15 minutes', 'case:enforce-deadline-fallback');

  // 4. Batch generation & SFTP upload (daily at 17:00 UTC)
  await agenda.every('0 17 * * *', 'sftp:generate-and-upload-batch');

  // 5. Inbound SFTP reconciliation report polling (every 2 hours)
  await agenda.every('2 hours', 'sftp:poll-reconciliation-reports');

  // 6. Gmail bounce scanner (every 30 minutes)
  await agenda.every('30 minutes', 'email:scan-gmail-bounces');
}
