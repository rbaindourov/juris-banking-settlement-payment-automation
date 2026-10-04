import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { createAgenda, stopAgenda } from '../../src/config/agenda';
import {
  registerAllJobs,
  executeDispatchNotifications,
  executeSendDeadlineReminders,
  executeDeadlineFallback,
  executeGenerateAndUploadBatch,
  executePollReconciliationReports,
  executeScanGmailBounces
} from '../../src/jobs';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import { GmailService } from '../../src/services/gmailService';
import { SftpService } from '../../src/services/sftp.service';

describe('Unit: Milestone 5 Scheduled Background Jobs', () => {
  let mockEmailProvider: MockEmailProvider;

  beforeEach(async () => {
    await setupTestDb('m5_jobs_unit');
    await clearTestDb('m5_jobs_unit');
    mockEmailProvider = new MockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
    await teardownTestDb('m5_jobs_unit');
  });

  describe('1. Agenda Job Registration', () => {
    it('registers all 6 background jobs on an Agenda scheduler instance', () => {
      const agenda = createAgenda();
      registerAllJobs(agenda);

      // Verify that definitions exist for all 6 jobs
      const jobDefinitions = (agenda as any).definitions || (agenda as any)._definitions;
      expect(jobDefinitions).toBeDefined();
      expect(jobDefinitions['case:dispatch-notifications']).toBeDefined();
      expect(jobDefinitions['case:send-deadline-reminders']).toBeDefined();
      expect(jobDefinitions['case:enforce-deadline-fallback']).toBeDefined();
      expect(jobDefinitions['sftp:generate-and-upload-batch']).toBeDefined();
      expect(jobDefinitions['sftp:poll-reconciliation-reports']).toBeDefined();
      expect(jobDefinitions['email:scan-gmail-bounces']).toBeDefined();
    });
  });

  describe('2. case:dispatch-notifications', () => {
    it('dispatches throttled emails, interpolates merge tags, and sets emailSent=true', async () => {
      const testCase = await Case.create({
        name: 'Nexus Privacy Settlement',
        docketNumber: '3:24-cv-001',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Payment Notice for {{claimant_first_name}} in {{case_name}}',
          bodyHtml: '<p>Hello {{claimant_first_name}}, amount: ${{settlement_amount}}, link: {{payment_selection_link}}</p>'
        }
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-001',
        firstName: 'Alice',
        lastName: 'Walker',
        email: 'alice@example.com',
        settlementAmount: 250.0,
        status: 'pending_selection',
        paymentSelectionToken: 'tok_alice_123'
      });

      const result = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(result.processedCount).toBe(1);
      expect(result.sentCount).toBe(1);
      expect(result.bouncedCount).toBe(0);

      const updated = await Claimant.findOne({ claimId: 'CLM-001' });
      expect(updated?.emailSent).toBe(true);
      expect(updated?.emailSentAt).toBeDefined();
      expect(updated?.deliveryAttempts).toBe(1);

      expect(mockEmailProvider.sentEmails.length).toBe(1);
      expect(mockEmailProvider.sentEmails[0].to).toBe('alice@example.com');
      expect(mockEmailProvider.sentEmails[0].subject).toContain('Alice in Nexus Privacy Settlement');
      expect(mockEmailProvider.sentEmails[0].html).toContain('$250.00');
    });

    it('marks claimant as bounced if pre-flight bounce check detects invalid or suppressed email', async () => {
      const testCase = await Case.create({
        name: 'Nexus Privacy Settlement',
        docketNumber: '3:24-cv-002',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // Historical bounced record in system
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-HISTORICAL-001',
        firstName: 'Prior',
        lastName: 'Bounced',
        email: 'bounced@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection',
        bounced: true,
        bounceReason: 'Mailbox does not exist'
      });

      // Target claimant with same email address
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-002',
        firstName: 'Bob',
        lastName: 'Invalid',
        email: 'bounced@example.com',
        settlementAmount: 150.0,
        status: 'pending_selection'
      });

      const result = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(result.bouncedCount).toBe(1);
      expect(result.sentCount).toBe(0);

      const updated = await Claimant.findOne({ claimId: 'CLM-002' });
      expect(updated?.bounced).toBe(true);
      expect(updated?.bounceReason).toContain('Mailbox does not exist');
      expect(updated?.emailSent).toBeFalsy();
    });

    it('escapes HTML in dynamic merge tags and sanitizes portal links to neutralize XSS vectors', async () => {
      const testCase = await Case.create({
        name: 'Malicious <script>alert("case")</script> Settlement',
        docketNumber: '3:24-cv-009',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Notice for {{claimant_first_name}} in {{case_name}}',
          bodyHtml: '<p>Hello {{claimant_first_name}} {{claimant_last_name}}, case: {{case_name}}, link: {{payment_selection_link}}</p>'
        }
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-XSS-001',
        firstName: '<img src=x onerror=alert("XSS")>',
        lastName: 'O\'Connor & Sons <script>',
        email: 'xss-target@example.com',
        settlementAmount: 300.0,
        status: 'pending_selection',
        paymentSelectionToken: 'tok_clean_999'
      });

      const result = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(result.sentCount).toBe(1);

      expect(mockEmailProvider.sentEmails.length).toBe(1);
      const email = mockEmailProvider.sentEmails[0];
      // HTML escaping checks
      expect(email.html).toContain('&lt;img src=x onerror=alert(&quot;XSS&quot;)&gt;');
      expect(email.html).toContain('O&#39;Connor &amp; Sons &lt;script&gt;');
      expect(email.html).toContain('Malicious &lt;script&gt;alert(&quot;case&quot;)&lt;/script&gt; Settlement');
      // Must not contain raw XSS tags
      expect(email.html).not.toContain('<img src=x');
      expect(email.html).not.toContain('<script>alert("case")</script>');
      expect(email.html).toContain('/claim/tok_clean_999');
    });

    it('ignores cases in draft status during notification dispatch sweeps', async () => {
      const draftCase = await Case.create({
        name: 'Unapproved Draft Settlement',
        docketNumber: '3:24-cv-DRAFT',
        lawFirmId: 'firm_001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'draft'
      });

      await Claimant.create({
        caseId: draftCase._id,
        claimId: 'CLM-DRAFT-01',
        firstName: 'Draft',
        lastName: 'User',
        email: 'draft-user@example.com',
        settlementAmount: 500.0,
        status: 'pending_selection'
      });

      // 1. Explicit caseId invocation on draft case
      const explicitResult = await executeDispatchNotifications({ caseId: draftCase._id.toString() });
      expect(explicitResult.processedCount).toBe(0);
      expect(explicitResult.sentCount).toBe(0);

      // 2. Automated general sweep invocation
      const sweepResult = await executeDispatchNotifications();
      expect(sweepResult.processedCount).toBe(0);
      expect(sweepResult.sentCount).toBe(0);

      // Verify claimant was never emailed or modified
      const draftClaimant = await Claimant.findOne({ claimId: 'CLM-DRAFT-01' });
      expect(draftClaimant?.emailSent).toBeFalsy();
      expect(draftClaimant?.deliveryAttempts).toBe(0);
      expect(mockEmailProvider.sentEmails).toHaveLength(0);
    });

    it('enforces email rate throttling pacing delay when rateLimitPerSecond is configured', async () => {
      const testCase = await Case.create({
        name: 'Pacing Settlement',
        docketNumber: '3:24-cv-PACE',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-PACE-01',
        firstName: 'Paced1',
        lastName: 'User',
        email: 'paced1@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-PACE-02',
        firstName: 'Paced2',
        lastName: 'User',
        email: 'paced2@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const startTime = Date.now();
      // 20 emails/sec = 50ms pacing delay per message
      const result = await executeDispatchNotifications({
        caseId: testCase._id.toString(),
        rateLimitPerSecond: 20
      });
      const elapsed = Date.now() - startTime;

      expect(result.sentCount).toBe(2);
      // 2 messages * 50ms = 100ms total pacing delay (allow 75ms minimum threshold for timer granularity)
      expect(elapsed).toBeGreaterThanOrEqual(75);
      expect(mockEmailProvider.sentEmails).toHaveLength(2);
    });

    it('calculates exponential backoff nextRetryAt on failure and respects max 5 retry attempts', async () => {
      const testCase = await Case.create({
        name: 'Backoff Settlement',
        docketNumber: '3:24-cv-BACKOFF',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-RETRY-01',
        firstName: 'Retry',
        lastName: 'Claimant',
        email: 'retry@example.com',
        settlementAmount: 200.0,
        status: 'pending_selection'
      });

      // Force EmailService failure
      mockEmailProvider.send = async (options) => ({
        success: false,
        error: 'SMTP Connection Refused',
        provider: 'mock',
        recipient: options.to,
        timestamp: new Date()
      });

      // Attempt 1: Should fail and set deliveryAttempts=1, nextRetryAt ~ 60s
      const res1 = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(res1.failedCount).toBe(1);

      const updated1 = await Claimant.findById(claimant._id);
      expect(updated1?.deliveryAttempts).toBe(1);
      expect(updated1?.nextRetryAt).toBeDefined();
      const delay1 = updated1!.nextRetryAt!.getTime() - Date.now();
      expect(delay1).toBeGreaterThan(50000);
      expect(delay1).toBeLessThanOrEqual(60000);

      // Immediate second sweep: Cooldown has not elapsed, claimant must NOT be queried
      const resCooldown = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(resCooldown.processedCount).toBe(0);

      // Simulate cooldown expiry: set nextRetryAt to past
      updated1!.nextRetryAt = new Date(Date.now() - 1000);
      await updated1!.save();

      // Attempt 2: Should process again, deliveryAttempts=2, nextRetryAt ~ 120s
      const res2 = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(res2.failedCount).toBe(1);

      const updated2 = await Claimant.findById(claimant._id);
      expect(updated2?.deliveryAttempts).toBe(2);
      const delay2 = updated2!.nextRetryAt!.getTime() - Date.now();
      expect(delay2).toBeGreaterThan(110000);
      expect(delay2).toBeLessThanOrEqual(120000);

      // Simulate hitting max 5 attempts: set deliveryAttempts=5 and nextRetryAt to past
      updated2!.deliveryAttempts = 5;
      updated2!.nextRetryAt = new Date(Date.now() - 1000);
      await updated2!.save();

      // Attempt 6 (exceeded max retries): claimant must be excluded from sweep
      const resMax = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(resMax.processedCount).toBe(0);
      expect(resMax.failedCount).toBe(0);
    });
  });

  describe('3. case:send-deadline-reminders', () => {
    it('sweeps claimants approaching deadline and records reminder idempotency', async () => {
      // 30 hours until deadline (triggers 48_hours window)
      const nearDeadline = new Date(Date.now() + 30 * 3600 * 1000);
      const testCase = await Case.create({
        name: 'Expiring Settlement',
        docketNumber: '3:24-cv-003',
        lawFirmId: 'firm_001',
        settlementFundTotal: 5000,
        disbursementDeadline: nearDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-REM-01',
        firstName: 'Charlie',
        lastName: 'Pending',
        email: 'charlie@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection',
        emailSent: true
      });

      const result1 = await executeSendDeadlineReminders({ caseId: testCase._id.toString() });
      expect(result1.sentReminders).toBe(1);

      const updated1 = await Claimant.findById(claimant._id);
      expect(updated1?.receiptDetails?.remindersSent).toContain('48_hours');

      // Second execution: must be idempotent and send 0 additional emails
      const result2 = await executeSendDeadlineReminders({ caseId: testCase._id.toString() });
      expect(result2.sentReminders).toBe(0);
    });

    it('escapes HTML in template literals and sanitizes portal link to prevent XSS in reminders', async () => {
      const nearDeadline = new Date(Date.now() + 24 * 3600 * 1000); // 24 hours (triggers 48_hours)
      const testCase = await Case.create({
        name: 'Malicious <script>alert("case")</script> Action',
        docketNumber: '3:24-cv-XSS-REM',
        lawFirmId: 'firm_001',
        settlementFundTotal: 5000,
        disbursementDeadline: nearDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-REM-XSS',
        firstName: '<b onmouseover=evil()>Eve</b>',
        lastName: '<img src=x onerror=bad()>',
        email: 'rem-xss@example.com',
        settlementAmount: 150.0,
        status: 'pending_selection',
        paymentSelectionToken: 'tok_rem_xss',
        emailSent: true
      });

      const result = await executeSendDeadlineReminders({ caseId: testCase._id.toString() });
      expect(result.sentReminders).toBe(1);

      expect(mockEmailProvider.sentEmails).toHaveLength(1);
      const email = mockEmailProvider.sentEmails[0];
      expect(email.html).toContain('&lt;b onmouseover=evil()&gt;Eve&lt;/b&gt;');
      expect(email.html).toContain('&lt;img src=x onerror=bad()&gt;');
      expect(email.html).toContain('Malicious &lt;script&gt;alert(&quot;case&quot;)&lt;/script&gt; Action');
      expect(email.html).not.toContain('<b onmouseover');
      expect(email.html).not.toContain('<script>alert');
      expect(email.html).toContain('/claim/tok_rem_xss');
    });
  });

  describe('4. case:enforce-deadline-fallback', () => {
    it('sweeps claimants past deadline, transitions status to deadline_expired, and assigns fallback method', async () => {
      const pastDeadline = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      const testCase = await Case.create({
        name: 'Past Deadline Case',
        docketNumber: '3:24-cv-004',
        lawFirmId: 'firm_001',
        settlementFundTotal: 5000,
        disbursementDeadline: pastDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FALLBACK-01',
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana@example.com',
        address: { street: '123 Main St', city: 'Metropolis', state: 'NY', zip: '10001' },
        settlementAmount: 300.0,
        status: 'pending_selection'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-SETTLED-02',
        firstName: 'Clark',
        lastName: 'Kent',
        email: 'clark@example.com',
        settlementAmount: 300.0,
        status: 'selected',
        selectedPaymentMethod: 'ach'
      });

      const result = await executeDeadlineFallback({ caseId: testCase._id.toString() });
      expect(result.modifiedCount).toBe(1);

      const fallbackClaimant = await Claimant.findOne({ claimId: 'CLM-FALLBACK-01' });
      expect(fallbackClaimant?.status).toBe('deadline_expired');
      expect(fallbackClaimant?.selectedPaymentMethod).toBe('physical_check');
      expect(fallbackClaimant?.fallbackReason).toBe('DEADLINE_PASSED_UNRESPONSIVE');
      expect(fallbackClaimant?.paymentDetails?.method).toBe('physical_check');

      // Untouched claimant
      const settledClaimant = await Claimant.findOne({ claimId: 'CLM-SETTLED-02' });
      expect(settledClaimant?.status).toBe('selected');
      expect(settledClaimant?.selectedPaymentMethod).toBe('ach');

      // Case status transitioned to deadline_passed
      const updatedCase = await Case.findById(testCase._id);
      expect(updatedCase?.status).toBe('deadline_passed');
    });
  });

  describe('5. sftp:generate-and-upload-batch', () => {
    it('returns clean message when case has zero eligible claimants pending disbursement', async () => {
      const testCase = await Case.create({
        name: 'Empty Batch Case',
        docketNumber: '3:24-cv-005',
        lawFirmId: 'firm_001',
        settlementFundTotal: 1000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const result = await executeGenerateAndUploadBatch({ caseId: testCase._id.toString() });
      expect(result.batchesProcessed).toBe(0);
      expect(result.summaries.length).toBe(1);
      expect(result.summaries[0].uploaded).toBe(false);
      expect(result.summaries[0].message).toContain('No eligible claimants');
    });
  });

  describe('6. email:scan-gmail-bounces', () => {
    it('handles offline gmail service gracefully with fail-open status', async () => {
      // Mock GmailService.isHealthy to return false
      const origIsHealthy = GmailService.isHealthy;
      GmailService.isHealthy = async () => false;

      try {
        const result = await executeScanGmailBounces();
        expect(result.healthy).toBe(false);
        expect(result.bouncesDetected).toBe(0);
        expect(result.message).toContain('fail-open');
      } finally {
        GmailService.isHealthy = origIsHealthy;
      }
    });

    it('updates matching claimants when bounce records are returned', async () => {
      const testCase = await Case.create({
        name: 'Bounce Scan Case',
        docketNumber: '3:24-cv-006',
        lawFirmId: 'firm_001',
        settlementFundTotal: 1000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-BOUNCE-01',
        firstName: 'Eve',
        lastName: 'Bounced',
        email: 'eve@bounced-domain.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const origIsHealthy = GmailService.isHealthy;
      const origScanBounces = GmailService.scanBounces;

      GmailService.isHealthy = async () => true;
      GmailService.scanBounces = async () => ({
        success: true,
        data: {
          scanned: 10,
          bouncesDetected: 1,
          newBounces: [
            {
              recipient: 'eve@bounced-domain.com',
              bounceType: 'hard',
              diagnosticMessage: '550 5.1.1 User unknown'
            }
          ]
        }
      });

      try {
        const result = await executeScanGmailBounces();
        expect(result.healthy).toBe(true);
        expect(result.bouncesDetected).toBe(1);
        expect(result.updatedClaimantCount).toBe(1);

        const updated = await Claimant.findOne({ claimId: 'CLM-BOUNCE-01' });
        expect(updated?.bounced).toBe(true);
        expect(updated?.bounceReason).toContain('550 5.1.1 User unknown');
      } finally {
        GmailService.isHealthy = origIsHealthy;
        GmailService.scanBounces = origScanBounces;
      }
    });
  });

  describe('7. sftp:poll-reconciliation-reports', () => {
    it('treats unmapped bank reports as unresolvable exceptions without associating with an arbitrary active case', async () => {
      // Create an existing active case in the database
      const existingActiveCase = await Case.create({
        name: 'Untouched Active Case',
        docketNumber: '3:24-cv-UNTOUCHED',
        lawFirmId: 'firm_001',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const unmappedCsv =
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON\n' +
        'REP-999,BATCH-UNMAPPED-999,CLM-UNMAPPED-999,REF-999,ach,500.00,USD,PAID,DASH-999,2026-10-04,2026-10-04,,,\n';

      const origListReports = SftpService.prototype.listReports;
      const origDownloadReport = SftpService.prototype.downloadReport;

      SftpService.prototype.listReports = async () => [
        {
          name: 'unmapped_report_20261004.csv',
          size: unmappedCsv.length,
          modifyTime: new Date(),
          remotePath: '/reports/unmapped_report_20261004.csv'
        }
      ];

      SftpService.prototype.downloadReport = async (filename: string) => ({
        remoteFilename: filename,
        localPath: `/tmp/${filename}`,
        bytesDownloaded: unmappedCsv.length,
        content: unmappedCsv
      });

      try {
        const result = await executePollReconciliationReports();

        expect(result.reportsFound).toBe(1);
        expect(result.reportsProcessed).toBe(0);
        expect(result.summaries).toHaveLength(1);
        expect(result.summaries[0].processed).toBe(false);
        expect(result.summaries[0].message).toBe('Could not resolve target case for report');

        // Verify that the existing active case was never touched or associated
        const untouchedCase = await Case.findById(existingActiveCase._id);
        expect(untouchedCase?.status).toBe('active');

        // Verify no claimants were created or reconciled under this case
        const claimants = await Claimant.find({ caseId: existingActiveCase._id });
        expect(claimants).toHaveLength(0);
      } finally {
        SftpService.prototype.listReports = origListReports;
        SftpService.prototype.downloadReport = origDownloadReport;
      }
    });
  });

  describe('8. Agenda Scheduler Lifecycle', () => {
    it('stops Agenda and cleanly disconnects backend socket handles without unhandled rejections', async () => {
      await expect(stopAgenda()).resolves.toBeUndefined();
    });
  });
});
