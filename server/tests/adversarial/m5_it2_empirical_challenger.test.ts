import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  executeDispatchNotifications,
  executeSendDeadlineReminders,
  executePollReconciliationReports
} from '../../src/jobs';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { DisbursementBatch } from '../../src/models/DisbursementBatch';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import { SftpService } from '../../src/services/sftp.service';
import { getAgenda, setAgenda, stopAgenda, createAgenda } from '../../src/config/agenda';
import { app } from '../../src/app';
import request from 'supertest';
import { signToken } from '../../src/utils/jwt';

describe('Adversarial & Empirical Challenge: Milestone 5 Iteration 2 Remediations', () => {
  let mockEmailProvider: MockEmailProvider;
  const SUITE_NAME = 'm5_it2_empirical_challenger';

  beforeEach(async () => {
    await setupTestDb(SUITE_NAME);
    await clearTestDb(SUITE_NAME);
    mockEmailProvider = new MockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  afterAll(async () => {
    await teardownTestDb(SUITE_NAME);
  });

  // =========================================================================
  // BATTERY 1: Merge Tag HTML Injection & XSS Resistance
  // =========================================================================
  describe('1. Merge Tag HTML Injection & XSS Resistance', () => {
    it('[XSS-01] Neutralizes script and image onerror tags in claimant firstName and lastName', async () => {
      const activeCase = await Case.create({
        name: 'Safe Settlement',
        docketNumber: '1:24-cv-XSS-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Notice for {{claimant_first_name}} {{claimant_last_name}}',
          bodyHtml: '<p>Hello <b>{{claimant_first_name}} {{claimant_last_name}}</b>, your case is {{case_name}}.</p>'
        }
      });

      await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-XSS-01',
        firstName: '<script>alert("pwned_first")</script>',
        lastName: '<img src="x" onerror="fetch(\'//evil.com\')">',
        email: 'xss-victim1@example.com',
        settlementAmount: 125.5,
        status: 'pending_selection'
      });

      const res = await executeDispatchNotifications({ caseId: activeCase._id.toString() });
      expect(res.sentCount).toBe(1);

      const email = mockEmailProvider.sentEmails[0];
      expect(email).toBeDefined();

      // Subject line verification
      expect(email.subject).toContain('&lt;script&gt;alert(&quot;pwned_first&quot;)&lt;/script&gt;');
      expect(email.subject).not.toContain('<script>');

      // Body HTML verification
      expect(email.html).toContain('&lt;script&gt;alert(&quot;pwned_first&quot;)&lt;/script&gt;');
      expect(email.html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;fetch(&#39;//evil.com&#39;)&quot;&gt;');
      expect(email.html).not.toContain('<script>');
      expect(email.html).not.toContain('<script');
      expect(email.html).not.toContain('<img');
    });

    it('[XSS-02] Neutralizes SVG onload and attribute breakout vectors in case_name', async () => {
      const xssCase = await Case.create({
        name: 'Lawsuit <svg onload=alert(document.cookie)> & Co "quoted"',
        docketNumber: '1:24-cv-XSS-2',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Case Update: {{case_name}}',
          bodyHtml: '<p>Regarding {{case_name}}</p>'
        }
      });

      await Claimant.create({
        caseId: xssCase._id,
        claimId: 'CLM-XSS-02',
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@example.com',
        settlementAmount: 50.0,
        status: 'pending_selection'
      });

      await executeDispatchNotifications({ caseId: xssCase._id.toString() });
      const email = mockEmailProvider.sentEmails[0];

      expect(email.subject).toContain('Lawsuit &lt;svg onload=alert(document.cookie)&gt; &amp; Co &quot;quoted&quot;');
      expect(email.subject).not.toContain('<svg');
      expect(email.html).toContain('Lawsuit &lt;svg onload=alert(document.cookie)&gt; &amp; Co &quot;quoted&quot;');
      expect(email.html).not.toContain('<svg');
    });

    it('[XSS-03] Neutralizes malicious pseudo-protocols and link injection in portal link merge tag', async () => {
      const activeCase = await Case.create({
        name: 'Link Test Settlement',
        docketNumber: '1:24-cv-XSS-3',
        lawFirmId: 'firm_001',
        settlementFundTotal: 25000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Payment Link',
          bodyHtml: '<a href="{{payment_selection_link}}">Claim Money</a>'
        }
      });

      // Claimant with token containing quote breakout and tag closing attempt
      await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-XSS-03',
        paymentSelectionToken: 'tok123"><script>alert("token_xss")</script><a x="',
        firstName: 'Charlie',
        lastName: 'Brown',
        email: 'charlie@example.com',
        settlementAmount: 300.0,
        status: 'pending_selection'
      });

      await executeDispatchNotifications({ caseId: activeCase._id.toString() });
      const email = mockEmailProvider.sentEmails[0];

      expect(email.html).not.toContain('<script>alert("token_xss")</script>');
      expect(email.html).toContain('&quot;&gt;&lt;script&gt;alert(&quot;token_xss&quot;)&lt;/script&gt;');
    });

    it('[XSS-04] Escapes dynamic merge tags and template literals in sendDeadlineReminders', async () => {
      const nearDeadline = new Date(Date.now() + 30 * 3600 * 1000); // 30 hours (triggers 48_hours)
      const testCase = await Case.create({
        name: 'Urgent <iframe src="javascript:alert(1)"> Case',
        docketNumber: '1:24-cv-REM-XSS',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: nearDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-REM-01',
        firstName: 'Malicious <script>alert("reminder")</script>',
        lastName: 'O\'Connor <img src=x onerror=evil()>',
        email: 'rem-victim@example.com',
        settlementAmount: 75.0,
        status: 'pending_selection',
        paymentSelectionToken: 'tok_safe_rem_1',
        emailSent: true
      });

      const res = await executeSendDeadlineReminders({ caseId: testCase._id.toString() });
      expect(res.sentReminders).toBe(1);

      const email = mockEmailProvider.sentEmails[0];
      expect(email.subject).toContain('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt; Case');
      expect(email.subject).not.toContain('<iframe');

      expect(email.html).toContain('Malicious &lt;script&gt;alert(&quot;reminder&quot;)&lt;/script&gt;');
      expect(email.html).toContain('O&#39;Connor &lt;img src=x onerror=evil()&gt;');
      expect(email.html).not.toContain('<script>');
      expect(email.html).not.toContain('<img src=');
    });

    it('[XSS-05] Template prototype injection strings (e.g. {{constructor}}, {{__proto__}}) do not pollute or crash', async () => {
      const activeCase = await Case.create({
        name: 'Prototype Test Case',
        docketNumber: '1:24-cv-PROTO',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        emailTemplate: {
          subject: 'Notice {{constructor}} {{__proto__}} {{toString}}',
          bodyHtml: '<p>Body: {{constructor}} {{__proto__}} {{toString}}</p>'
        }
      });

      await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-PROTO-01',
        firstName: 'Normal',
        lastName: 'User',
        email: 'proto@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const res = await executeDispatchNotifications({ caseId: activeCase._id.toString() });
      expect(res.sentCount).toBe(1);

      const email = mockEmailProvider.sentEmails[0];
      // Undefined tags are preserved or left safely without crashing
      expect(email).toBeDefined();
      expect(({} as any).polluted).toBeUndefined();
    });

    it('[XSS-06] Null byte injection and Unicode RTL overrides in merge tags are handled cleanly', async () => {
      const activeCase = await Case.create({
        name: 'Unicode Null Byte Settlement',
        docketNumber: '1:24-cv-NULLBYTE',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-NULL-01',
        firstName: 'Alice\0<script>alert(1)</script>\u202E',
        lastName: 'Bob\u200B<img src=x onerror=alert(2)>',
        email: 'nullbyte@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const res = await executeDispatchNotifications({ caseId: activeCase._id.toString() });
      expect(res.sentCount).toBe(1);

      const email = mockEmailProvider.sentEmails[0];
      expect(email.html).not.toContain('<script');
      expect(email.html).not.toContain('<img');
      expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // =========================================================================
  // BATTERY 2: Draft Case & Non-Active Case Protection
  // =========================================================================
  describe('2. Draft Case & Non-Active Case Protection', () => {
    it('[DRAFT-01] General sweep strictly ignores draft cases while dispatching active cases', async () => {
      // 1 Draft case with 2 claimants
      const draftCase = await Case.create({
        name: 'Unapproved Draft Settlement',
        docketNumber: '1:24-cv-DRAFT-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 20000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 20),
        fallbackPaymentMethod: 'physical_check',
        status: 'draft'
      });

      const draftClaimant1 = await Claimant.create({
        caseId: draftCase._id,
        claimId: 'CLM-DRAFT-01',
        firstName: 'Draft',
        lastName: 'User1',
        email: 'draft1@example.com',
        settlementAmount: 100,
        status: 'pending_selection',
        emailSent: false
      });

      const draftClaimant2 = await Claimant.create({
        caseId: draftCase._id,
        claimId: 'CLM-DRAFT-02',
        firstName: 'Draft',
        lastName: 'User2',
        email: 'draft2@example.com',
        settlementAmount: 100,
        status: 'pending_selection',
        emailSent: false
      });

      // 1 Active case with 1 claimant
      const activeCase = await Case.create({
        name: 'Approved Active Settlement',
        docketNumber: '1:24-cv-ACTIVE-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 20),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const activeClaimant = await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-ACTIVE-01',
        firstName: 'Active',
        lastName: 'User',
        email: 'active@example.com',
        settlementAmount: 100,
        status: 'pending_selection',
        emailSent: false
      });

      // Execute general sweep without caseId
      const sweepResult = await executeDispatchNotifications();

      expect(sweepResult.sentCount).toBe(1);
      expect(sweepResult.processedCount).toBe(1);

      // Verify active claimant was updated
      const reloadedActive = await Claimant.findById(activeClaimant._id);
      expect(reloadedActive?.emailSent).toBe(true);
      expect(reloadedActive?.emailSentAt).toBeDefined();

      // Verify draft claimants were COMPLETELY untouched
      const reloadedDraft1 = await Claimant.findById(draftClaimant1._id);
      expect(reloadedDraft1?.emailSent).toBe(false);
      expect(reloadedDraft1?.emailSentAt).toBeUndefined();
      expect(reloadedDraft1?.deliveryAttempts).toBe(0);

      const reloadedDraft2 = await Claimant.findById(draftClaimant2._id);
      expect(reloadedDraft2?.emailSent).toBe(false);
      expect(reloadedDraft2?.emailSentAt).toBeUndefined();
      expect(reloadedDraft2?.deliveryAttempts).toBe(0);
    });

    it('[DRAFT-02] Direct dispatch invocation targeting a draft case returns 0 and does not dispatch', async () => {
      const draftCase = await Case.create({
        name: 'Direct Draft Case',
        docketNumber: '1:24-cv-DRAFT-2',
        lawFirmId: 'firm_001',
        settlementFundTotal: 5000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 10),
        fallbackPaymentMethod: 'physical_check',
        status: 'draft'
      });

      const draftClaimant = await Claimant.create({
        caseId: draftCase._id,
        claimId: 'CLM-DRAFT-DIR',
        firstName: 'Protected',
        lastName: 'Claimant',
        email: 'protected@example.com',
        settlementAmount: 50,
        status: 'pending_selection',
        emailSent: false
      });

      const res = await executeDispatchNotifications({ caseId: draftCase._id.toString() });

      expect(res.processedCount).toBe(0);
      expect(res.sentCount).toBe(0);
      expect(res.failedCount).toBe(0);
      expect(res.bouncedCount).toBe(0);
      expect(mockEmailProvider.sentEmails).toHaveLength(0);

      const reloaded = await Claimant.findById(draftClaimant._id);
      expect(reloaded?.emailSent).toBe(false);
      expect(reloaded?.emailSentAt).toBeUndefined();
      expect(reloaded?.deliveryAttempts).toBe(0);
    });

    it('[DRAFT-03] Dispatch invocation ignores closed, disbursed, and deadline_passed cases', async () => {
      for (const terminalStatus of ['closed', 'disbursed', 'deadline_passed']) {
        const terminalCase = await Case.create({
          name: `Case in ${terminalStatus}`,
          docketNumber: `1:24-cv-${terminalStatus}`,
          lawFirmId: 'firm_001',
          settlementFundTotal: 10000,
          disbursementDeadline: new Date(Date.now() - 86400000),
          fallbackPaymentMethod: 'physical_check',
          status: terminalStatus
        });

        await Claimant.create({
          caseId: terminalCase._id,
          claimId: `CLM-${terminalStatus}`,
          firstName: 'User',
          lastName: 'Terminal',
          email: `${terminalStatus}@example.com`,
          settlementAmount: 100,
          status: 'pending_selection',
          emailSent: false
        });

        const res = await executeDispatchNotifications({ caseId: terminalCase._id.toString() });
        expect(res.processedCount).toBe(0);
        expect(res.sentCount).toBe(0);
      }
    });

    it('[DRAFT-04] Direct invocation with non-existent or malformed caseId fails closed safely', async () => {
      const nonExistentOid = new mongoose.Types.ObjectId().toString();
      const res1 = await executeDispatchNotifications({ caseId: nonExistentOid });
      expect(res1.processedCount).toBe(0);
      expect(res1.sentCount).toBe(0);

      const res2 = await executeDispatchNotifications({ caseId: 'not-even-a-valid-object-id' });
      expect(res2.processedCount).toBe(0);
      expect(res2.sentCount).toBe(0);
    });
  });

  // =========================================================================
  // BATTERY 3: Rate Throttling Pacing & Pacing Delay Verification
  // =========================================================================
  describe('3. Rate Throttling Pacing Delay', () => {
    it('[THROTTLE-01] Applies pacing delay between claimant dispatches when rateLimitPerSecond > 0', async () => {
      const activeCase = await Case.create({
        name: 'Rate Throttling Case',
        docketNumber: '1:24-cv-THROTTLE-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // Create 3 claimants
      for (let i = 1; i <= 3; i++) {
        await Claimant.create({
          caseId: activeCase._id,
          claimId: `CLM-THROTTLE-0${i}`,
          firstName: `Claimant${i}`,
          lastName: 'Throttle',
          email: `throttle${i}@example.com`,
          settlementAmount: 100,
          status: 'pending_selection'
        });
      }

      // rateLimitPerSecond: 20 -> delayMs = 1000 / 20 = 50ms per claimant
      // For 3 claimants, expected elapsed time >= 3 * 50ms = 150ms
      const startTime = Date.now();
      const res = await executeDispatchNotifications({
        caseId: activeCase._id.toString(),
        rateLimitPerSecond: 20
      });
      const elapsed = Date.now() - startTime;

      expect(res.sentCount).toBe(3);
      expect(elapsed).toBeGreaterThanOrEqual(130); // 150ms nominal minus clock jitter
    });

    it('[THROTTLE-02] Dispatches with batchSize constraints', async () => {
      const activeCase = await Case.create({
        name: 'Batch Size Throttle Case',
        docketNumber: '1:24-cv-THROTTLE-2',
        lawFirmId: 'firm_001',
        settlementFundTotal: 50000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      for (let i = 1; i <= 5; i++) {
        await Claimant.create({
          caseId: activeCase._id,
          claimId: `CLM-BATCH-0${i}`,
          firstName: `Batch${i}`,
          lastName: 'User',
          email: `batch${i}@example.com`,
          settlementAmount: 50,
          status: 'pending_selection'
        });
      }

      // Request batchSize = 2
      const res1 = await executeDispatchNotifications({
        caseId: activeCase._id.toString(),
        batchSize: 2
      });
      expect(res1.sentCount).toBe(2);
      expect(res1.processedCount).toBe(2);

      // Remaining 3 claimants still pending
      const remaining = await Claimant.countDocuments({
        caseId: activeCase._id,
        emailSent: { $ne: true }
      });
      expect(remaining).toBe(3);
    });

    it('[THROTTLE-03] High rateLimitPerSecond floors delay at 1ms minimum without zero-division or crash', async () => {
      const activeCase = await Case.create({
        name: 'High Throttle Case',
        docketNumber: '1:24-cv-THROTTLE-3',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: activeCase._id,
        claimId: 'CLM-FAST-01',
        firstName: 'Fast',
        lastName: 'Sender',
        email: 'fast@example.com',
        settlementAmount: 100,
        status: 'pending_selection'
      });

      const res = await executeDispatchNotifications({
        caseId: activeCase._id.toString(),
        rateLimitPerSecond: 5000 // Very high rate limit
      });

      expect(res.sentCount).toBe(1);
    });
  });

  // =========================================================================
  // BATTERY 4: Exponential Backoff Cooldown & Max 5 Attempts Cap
  // =========================================================================
  describe('4. Exponential Backoff Cooldown & Max 5 Retry Cap', () => {
    it('[BACKOFF-01] Progressively calculates 60s * 2^(attempts-1) delays on repeated delivery failures', async () => {
      const testCase = await Case.create({
        name: 'Backoff Progression Settlement',
        docketNumber: '1:24-cv-BACKOFF-PROG',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-PROG-01',
        firstName: 'Prog',
        lastName: 'Fail',
        email: 'fail@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      // Configure provider failure
      mockEmailProvider.send = async () => ({
        success: false,
        error: 'SMTP 421 Service not available',
        provider: 'mock',
        recipient: 'fail@example.com',
        timestamp: new Date()
      });

      // Expected exponential backoffs:
      // Attempt 1: 60s * 2^0 = 60s = 60,000ms
      // Attempt 2: 60s * 2^1 = 120s = 120,000ms
      // Attempt 3: 60s * 2^2 = 240s = 240,000ms
      // Attempt 4: 60s * 2^3 = 480s = 480,000ms
      // Attempt 5: 60s * 2^4 = 960s = 960,000ms

      const expectedDelays = [60000, 120000, 240000, 480000, 960000];

      for (let attempt = 1; attempt <= 5; attempt++) {
        const sweepRes = await executeDispatchNotifications({ caseId: testCase._id.toString() });
        expect(sweepRes.failedCount).toBe(1);

        const currentClaimant = await Claimant.findById(claimant._id);
        expect(currentClaimant?.deliveryAttempts).toBe(attempt);
        expect(currentClaimant?.lastDeliveryError).toBe('SMTP 421 Service not available');
        expect(currentClaimant?.nextRetryAt).toBeDefined();

        const delay = currentClaimant!.nextRetryAt!.getTime() - Date.now();
        const expectedDelay = expectedDelays[attempt - 1];
        // Tolerance: +/- 10,000ms
        expect(delay).toBeGreaterThan(expectedDelay - 10000);
        expect(delay).toBeLessThanOrEqual(expectedDelay + 2000);

        if (attempt < 5) {
          // Verify that immediate sweep before nextRetryAt does NOT pick up this claimant
          const prematureSweep = await executeDispatchNotifications({ caseId: testCase._id.toString() });
          expect(prematureSweep.processedCount).toBe(0);

          // Fast-forward cooldown by setting nextRetryAt to past
          currentClaimant!.nextRetryAt = new Date(Date.now() - 5000);
          await currentClaimant!.save();
        }
      }

      // After 5 attempts, even if nextRetryAt is in the past, it must NOT retry
      const finalClaimant = await Claimant.findById(claimant._id);
      expect(finalClaimant?.deliveryAttempts).toBe(5);
      finalClaimant!.nextRetryAt = new Date(Date.now() - 60000); // 1 minute in the past
      await finalClaimant!.save();

      const cappedSweep = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(cappedSweep.processedCount).toBe(0);
      expect(cappedSweep.failedCount).toBe(0);
      expect(cappedSweep.sentCount).toBe(0);
    });

    it('[BACKOFF-02] Successful retry clears nextRetryAt and increments deliveryAttempts', async () => {
      const testCase = await Case.create({
        name: 'Retry Success Case',
        docketNumber: '1:24-cv-RETRY-OK',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-RECOVER-01',
        firstName: 'Recover',
        lastName: 'User',
        email: 'recover@example.com',
        settlementAmount: 150.0,
        status: 'pending_selection',
        deliveryAttempts: 2,
        nextRetryAt: new Date(Date.now() - 1000) // Cooldown passed
      });

      // Provider succeeds on this attempt
      mockEmailProvider.send = async (options) => ({
        success: true,
        messageId: 'msg-recovered-999',
        provider: 'mock',
        recipient: options.to,
        timestamp: new Date()
      });

      const res = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(res.sentCount).toBe(1);
      expect(res.failedCount).toBe(0);

      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded?.emailSent).toBe(true);
      expect(reloaded?.deliveryAttempts).toBe(3);
      expect(reloaded?.emailMessageId).toBe('msg-recovered-999');
      expect(reloaded?.nextRetryAt).toBeUndefined();
    });

    it('[BACKOFF-03] Handles unexpected thrown errors in EmailService and sets nextRetryAt', async () => {
      const testCase = await Case.create({
        name: 'Exception Handling Case',
        docketNumber: '1:24-cv-EXC-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-EXC-01',
        firstName: 'Crash',
        lastName: 'Tester',
        email: 'crash@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      // Provider throws unhandled error
      mockEmailProvider.send = async () => {
        throw new Error('ECONNRESET: Socket hung up abruptly');
      };

      const res = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(res.failedCount).toBe(1);

      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded?.deliveryAttempts).toBe(1);
      expect(reloaded?.lastDeliveryError).toBe('ECONNRESET: Socket hung up abruptly');
      expect(reloaded?.nextRetryAt).toBeDefined();
    });

    it('[BACKOFF-04] Pre-flight bounced claimants are marked bounced and NEVER queued for exponential retries', async () => {
      const testCase = await Case.create({
        name: 'Bounce Isolation Case',
        docketNumber: '1:24-cv-BOUNCE-1',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // Historical hard bounce in the system for this address
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-HIST-BOUNCE',
        firstName: 'Prior',
        lastName: 'Bounced',
        email: 'prior-bounced@example.com',
        settlementAmount: 50.0,
        status: 'pending_selection',
        bounced: true,
        bounceReason: '550 5.1.1 User unknown'
      });

      const bouncedClaimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-BOUNCE-01',
        firstName: 'Bad',
        lastName: 'Email',
        email: 'prior-bounced@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const res = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(res.bouncedCount).toBe(1);
      expect(res.sentCount).toBe(0);
      expect(res.failedCount).toBe(0);

      const reloaded = await Claimant.findById(bouncedClaimant._id);
      expect(reloaded?.bounced).toBe(true);
      expect(reloaded?.bouncedAt).toBeDefined();
      expect(reloaded?.bounceReason).toContain('550 5.1.1 User unknown');
      expect(reloaded?.deliveryAttempts).toBe(0);
      expect(reloaded?.nextRetryAt).toBeUndefined();

      // Subsequent sweep should never pick up bounced claimants
      const sweep2 = await executeDispatchNotifications({ caseId: testCase._id.toString() });
      expect(sweep2.processedCount).toBe(0);
    });
  });

  // =========================================================================
  // BATTERY 5: Multi-Tenant SFTP Bank Reconciliation Report Isolation
  // =========================================================================
  describe('5. Multi-Tenant SFTP Bank Reconciliation Report Isolation', () => {
    it('[ISOLATION-01] Inbound report with unmapped batchId and claimId never associates with arbitrary active cases', async () => {
      // Create two distinct active cases belonging to different law firms
      const firmACase = await Case.create({
        name: 'Firm A Settlement',
        docketNumber: '1:24-cv-FIRMA-01',
        lawFirmId: 'FIRM-AAA',
        settlementFundTotal: 500000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const firmBCase = await Case.create({
        name: 'Firm B Settlement',
        docketNumber: '1:24-cv-FIRMB-01',
        lawFirmId: 'FIRM-BBB',
        settlementFundTotal: 750000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'direct_deposit',
        status: 'active'
      });

      // An unmapped inbound bank report referencing unknown batch and claim
      const unmappedReportCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        'REP-UNKNOWN-01,BATCH-PHANTOM-999,CLM-PHANTOM-888,REF-PHANTOM,ach,1000.00,USD,PAID,DASH-PHANTOM,2026-10-04,2026-10-04,,,'
      ].join('\n');

      const origListReports = SftpService.prototype.listReports;
      const origDownloadReport = SftpService.prototype.downloadReport;

      SftpService.prototype.listReports = async () => [
        {
          name: 'bank_report_unmapped_20261004.csv',
          size: unmappedReportCsv.length,
          modifyTime: new Date(),
          remotePath: '/reports/bank_report_unmapped_20261004.csv'
        }
      ];

      SftpService.prototype.downloadReport = async (filename: string) => ({
        remoteFilename: filename,
        localPath: `/tmp/${filename}`,
        bytesDownloaded: unmappedReportCsv.length,
        content: unmappedReportCsv
      });

      try {
        const pollResult = await executePollReconciliationReports();

        expect(pollResult.reportsFound).toBe(1);
        expect(pollResult.reportsProcessed).toBe(0);
        expect(pollResult.summaries).toHaveLength(1);
        expect(pollResult.summaries[0].processed).toBe(false);
        expect(pollResult.summaries[0].message).toBe('Could not resolve target case for report');

        // Verify FIRM A CASE is 100% untouched
        const reloadedCaseA = await Case.findById(firmACase._id);
        expect(reloadedCaseA?.status).toBe('active');
        const claimantsA = await Claimant.find({ caseId: firmACase._id });
        expect(claimantsA).toHaveLength(0);

        // Verify FIRM B CASE is 100% untouched
        const reloadedCaseB = await Case.findById(firmBCase._id);
        expect(reloadedCaseB?.status).toBe('active');
        const claimantsB = await Claimant.find({ caseId: firmBCase._id });
        expect(claimantsB).toHaveLength(0);

        // Verify zero reconciliation exceptions were logged
        const exceptions = await ReconciliationException.find();
        expect(exceptions).toHaveLength(0);
      } finally {
        SftpService.prototype.listReports = origListReports;
        SftpService.prototype.downloadReport = origDownloadReport;
      }
    });

    it('[ISOLATION-02] Inbound report with valid claimId correctly maps to matching case and isolates others', async () => {
      const firmACase = await Case.create({
        name: 'Firm A Real Case',
        docketNumber: '1:24-cv-FIRMA-REAL',
        lawFirmId: 'FIRM-AAA',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const firmBCase = await Case.create({
        name: 'Firm B Innocent Case',
        docketNumber: '1:24-cv-FIRMB-INNO',
        lawFirmId: 'FIRM-BBB',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimantA = await Claimant.create({
        caseId: firmACase._id,
        claimId: 'CLM-FIRMA-001',
        firstName: 'Target',
        lastName: 'Claimant',
        email: 'target@firm-a.com',
        settlementAmount: 250.0,
        status: 'selected',
        selectedPaymentMethod: 'direct_deposit'
      });

      const matchingReportCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        `REP-MAP-01,BATCH-NO-MATCH,${claimantA.claimId},REF-001,ach,250.00,USD,PAID,DASH-REF-777,2026-10-04,2026-10-04,,,`
      ].join('\n');

      const origListReports = SftpService.prototype.listReports;
      const origDownloadReport = SftpService.prototype.downloadReport;

      SftpService.prototype.listReports = async () => [
        {
          name: 'bank_report_mapped_claim_20261004.csv',
          size: matchingReportCsv.length,
          modifyTime: new Date(),
          remotePath: '/reports/bank_report_mapped_claim_20261004.csv'
        }
      ];

      SftpService.prototype.downloadReport = async (filename: string) => ({
        remoteFilename: filename,
        localPath: `/tmp/${filename}`,
        bytesDownloaded: matchingReportCsv.length,
        content: matchingReportCsv
      });

      try {
        const pollResult = await executePollReconciliationReports();

        expect(pollResult.reportsFound).toBe(1);
        expect(pollResult.reportsProcessed).toBe(1);
        expect(pollResult.summaries[0].processed).toBe(true);
        expect(pollResult.summaries[0].disbursedCount).toBe(1);

        // Claimant A must be transitioned to disbursed
        const reloadedClaimantA = await Claimant.findById(claimantA._id);
        expect(reloadedClaimantA?.status).toBe('disbursed');
        expect(reloadedClaimantA?.dashReferenceId).toBe('DASH-REF-777');

        // Case B must have 0 claimants and remain pristine
        const claimantsB = await Claimant.find({ caseId: firmBCase._id });
        expect(claimantsB).toHaveLength(0);
      } finally {
        SftpService.prototype.listReports = origListReports;
        SftpService.prototype.downloadReport = origDownloadReport;
      }
    });

    it('[ISOLATION-03] Inbound report matching batchId correctly isolates to target case without touching other cases', async () => {
      const firmACase = await Case.create({
        name: 'Firm A Batch Case',
        docketNumber: '1:24-cv-FIRMA-BATCH',
        lawFirmId: 'FIRM-AAA',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const firmBCase = await Case.create({
        name: 'Firm B Batch Case',
        docketNumber: '1:24-cv-FIRMB-BATCH',
        lawFirmId: 'FIRM-BBB',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const batchA = await DisbursementBatch.create({
        batchId: 'BATCH-RESOLVE-A',
        caseId: firmACase._id,
        filename: 'DASH_DISBURSE_A.csv',
        filePath: '/tmp/DASH_DISBURSE_A.csv',
        sha256: 'abcd1234abcd1234',
        totalRecords: 1,
        totalAmount: 100,
        status: 'uploaded',
        generatedAt: new Date()
      });

      const claimantA = await Claimant.create({
        caseId: firmACase._id,
        claimId: 'CLM-BATCH-A1',
        firstName: 'BatchUser',
        lastName: 'One',
        email: 'batchuser1@firm-a.com',
        settlementAmount: 100.0,
        status: 'selected',
        selectedPaymentMethod: 'direct_deposit',
        batchId: batchA.batchId
      });

      const matchingReportCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        `REP-MAP-B01,${batchA.batchId},${claimantA.claimId},REF-B01,ach,100.00,USD,PAID,DASH-REF-888,2026-10-04,2026-10-04,,,`
      ].join('\n');

      const origListReports = SftpService.prototype.listReports;
      const origDownloadReport = SftpService.prototype.downloadReport;

      SftpService.prototype.listReports = async () => [
        {
          name: 'bank_report_mapped_batch_20261004.csv',
          size: matchingReportCsv.length,
          modifyTime: new Date(),
          remotePath: '/reports/bank_report_mapped_batch_20261004.csv'
        }
      ];

      SftpService.prototype.downloadReport = async (filename: string) => ({
        remoteFilename: filename,
        localPath: `/tmp/${filename}`,
        bytesDownloaded: matchingReportCsv.length,
        content: matchingReportCsv
      });

      try {
        const pollResult = await executePollReconciliationReports();
        expect(pollResult.reportsFound).toBe(1);
        expect(pollResult.reportsProcessed).toBe(1);

        const reloadedClaimantA = await Claimant.findById(claimantA._id);
        expect(reloadedClaimantA?.status).toBe('disbursed');

        // Firm B case must have 0 claimants
        const claimantsB = await Claimant.find({ caseId: firmBCase._id });
        expect(claimantsB).toHaveLength(0);
      } finally {
        SftpService.prototype.listReports = origListReports;
        SftpService.prototype.downloadReport = origDownloadReport;
      }
    });

    it('[ISOLATION-04] SFTP service transport error during report download is captured in summary without crashing worker', async () => {
      const origListReports = SftpService.prototype.listReports;
      const origDownloadReport = SftpService.prototype.downloadReport;

      SftpService.prototype.listReports = async () => [
        {
          name: 'corrupted_remote_report.csv',
          size: 100,
          modifyTime: new Date(),
          remotePath: '/reports/corrupted_remote_report.csv'
        }
      ];

      SftpService.prototype.downloadReport = async () => {
        throw new Error('SFTP Transport Timeout: Remote server closed channel');
      };

      try {
        const pollResult = await executePollReconciliationReports();
        expect(pollResult.reportsFound).toBe(1);
        expect(pollResult.reportsProcessed).toBe(0);
        expect(pollResult.summaries[0].processed).toBe(false);
        expect(pollResult.summaries[0].message).toContain('SFTP Transport Timeout');
      } finally {
        SftpService.prototype.listReports = origListReports;
        SftpService.prototype.downloadReport = origDownloadReport;
      }
    });
  });

  // =========================================================================
  // BATTERY 6: Agendash Dynamic Re-Evaluation & Scheduler Lifecycle
  // =========================================================================
  describe('6. Agendash Middleware Dynamic Evaluation & Scheduler Shutdown', () => {
    it('[SCHED-01] stopAgenda safely drains and cancels with zero unhandled rejections', async () => {
      await expect(stopAgenda()).resolves.toBeUndefined();
      // Calling a second time is safe and idempotent
      await expect(stopAgenda()).resolves.toBeUndefined();
    });

    it('[SCHED-02] Agendash endpoint requires admin authentication and re-evaluates cleanly', async () => {
      const superAdminToken = signToken({
        id: new mongoose.Types.ObjectId().toString(),
        email: 'superadmin@platform.gov',
        role: 'super_admin'
      });

      // Anonymous access blocked
      const anonRes = await request(app)
        .get('/agendash')
        .set('Accept', 'application/json');
      expect([401, 403]).toContain(anonRes.status);

      // Super Admin access permitted (status 200 with JSON job registry)
      const adminRes = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.registeredJobs).toBeDefined();
    });

    it('[SCHED-03] Dynamic Agenda instance switching maintains clean Agendash mounting', async () => {
      const initialAgenda = getAgenda();
      const freshAgenda = createAgenda();
      setAgenda(freshAgenda);

      const superAdminToken = signToken({
        id: new mongoose.Types.ObjectId().toString(),
        email: 'superadmin@platform.gov',
        role: 'super_admin'
      });

      const res = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);

      // Restore initial agenda
      setAgenda(initialAgenda);
    });
  });
});
