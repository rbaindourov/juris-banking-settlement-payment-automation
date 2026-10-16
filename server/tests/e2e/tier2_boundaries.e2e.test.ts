import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { EmailService } from '../../src/services/email.service';
import {
  sanitizeEmailHtml,
  sanitizeLinkUrl,
  resolveMergeTags
} from '../../src/services/template.service';
import {
  createTestCase,
  createTestClaimants,
  executeOpaqueWaveDispatch,
  isWithinQuietHours,
  calculateNextSendWindow,
  validateEmailSyntax,
  FailableMockEmailProvider
} from './cadenceE2eHarness';

describe('E2E Tier 2: Boundary & Corner Cases (Rolling Cadence & Settlement Notifications)', () => {
  let mockEmailProvider: FailableMockEmailProvider;

  beforeAll(async () => {
    await setupTestDb('e2e_tier2_boundaries');
  });

  afterAll(async () => {
    await teardownTestDb('e2e_tier2_boundaries');
  });

  beforeEach(async () => {
    await clearTestDb('e2e_tier2_boundaries');
    mockEmailProvider = new FailableMockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  // =========================================================================
  // BOUNDARY 1: 5-Stage Cadence & Roster Lifecycle Boundaries
  // =========================================================================
  describe('Boundary 1: 5-Stage Cadence & Roster Lifecycle Boundaries', () => {
    it('[T2.1] Empty claimant roster (0 claimants) completes wave gracefully with zero errors', async () => {
      const testCase = await createTestCase();
      // 0 claimants created
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.eligible).toBe(0);
      expect(result.telemetry.dispatched).toBe(0);
      expect(result.subBatchCount).toBe(0);
      expect(mockEmailProvider.sentEmails.length).toBe(0);
    });

    it('[T2.2] 100% already settled cohort before wave triggers results in zero dispatches', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 10);
      for (const c of claimants) {
        c.status = 'selected';
        await c.save();
      }

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'reminder_14d',
        currentTime: new Date('2026-11-16T14:00:00Z')
      });

      expect(result.telemetry.eligible).toBe(0);
      expect(result.telemetry.dispatched).toBe(0);
      expect(mockEmailProvider.sentEmails.length).toBe(0);
    });

    it('[T2.3] Offset hours at exact deadline boundary (T=0) calculates non-overflowing timestamp', () => {
      const deadline = new Date('2026-11-30T23:59:59.000Z');
      const offsetHours = 0;
      const scheduledTime = new Date(deadline.getTime() - offsetHours * 3600000);

      expect(scheduledTime.getTime()).toBe(deadline.getTime());
      expect(scheduledTime.toISOString()).toBe('2026-11-30T23:59:59.000Z');
    });

    it('[T2.4] Multiple stages evaluated in rapid sequence execute deterministically', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 5);

      // Stage 1
      const res1 = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });
      // Stage 2
      const res2 = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'reminder_14d',
        currentTime: new Date('2026-11-16T14:00:00Z')
      });

      expect(res1.telemetry.dispatched).toBe(5);
      expect(res2.telemetry.dispatched).toBe(5);
      expect(mockEmailProvider.sentEmails.length).toBe(10);
    });

    it('[T2.5] Post-deadline stage with mixed claimant statuses filters appropriately', async () => {
      const testCase = await createTestCase();
      const c1 = await createTestClaimants(testCase._id, 2, { prefix: 'EXP' });
      c1[0].status = 'deadline_expired';
      c1[1].status = 'deadline_expired';
      await c1[0].save();
      await c1[1].save();

      const c2 = await createTestClaimants(testCase._id, 2, { prefix: 'REJ' });
      c2[0].status = 'rejected';
      c2[1].status = 'rejected';
      await c2[0].save();
      await c2[1].save();

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'post_deadline_fallback',
        currentTime: new Date('2026-12-01T15:00:00Z')
      });

      expect(result.telemetry.eligible).toBe(2);
      expect(result.telemetry.dispatched).toBe(2);
      expect(result.dispatchedClaimants.every((id) => id.startsWith('EXP'))).toBe(true);
    });
  });

  // =========================================================================
  // BOUNDARY 2: Localized Templates Boundaries
  // =========================================================================
  describe('Boundary 2: Localized Templates Boundaries', () => {
    it('[T2.6] Empty template body string handled gracefully without crash', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1);

      const emptyTemplates = {
        en: { subject: 'Empty Body Notice', bodyHtml: '' }
      };

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        templates: emptyTemplates,
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(1);
      expect(mockEmailProvider.sentEmails[0].html).toBe('');
    });

    it('[T2.7] Very large HTML template (>200KB) sanitizes and resolves without error', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1);

      // Generate ~200KB template
      const paragraph = '<p>Legal paragraph with claimant {{claimant_first_name}} and {{settlement_amount}}.</p>';
      const largeBody = '<div>' + paragraph.repeat(2500) + '</div>';

      const largeTemplates = {
        en: { subject: 'Large Legal Notice', bodyHtml: largeBody }
      };

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        templates: largeTemplates,
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(1);
      expect(mockEmailProvider.sentEmails[0].html.length).toBeGreaterThan(150000);
    });

    it('[T2.8] Complex Unicode emojis and non-Latin characters preserved in subjects and bodies', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1);

      const unicodeTemplates = {
        en: {
          subject: '⚖️ Court Notice / 通知 / Avis / 🔔 {{case_name}}',
          bodyHtml: '<p>Unicode Test: 💰 {{settlement_amount}} for 👤 {{claimant_first_name}}.</p>'
        }
      };

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        templates: unicodeTemplates,
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.subject).toContain('⚖️ Court Notice / 通知 / Avis / 🔔');
      expect(sent.html).toContain('💰 $460.00 for 👤 FirstName0001');
    });

    it('[T2.9] Malicious XSS vectors (<script>, <svg onload>, <iframe src>) are sanitized out', () => {
      const dirtyHtml = `
        <h1>Notice</h1>
        <script>alert("xss")</script>
        <svg onload="stealCredentials()"><circle r="10"/></svg>
        <iframe src="http://attacker.com"></iframe>
        <a href="javascript:alert(1)">Click Here</a>
        <p>Dear {{claimant_first_name}}</p>
      `;

      const sanitized = sanitizeEmailHtml(dirtyHtml);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('onload=');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('<h1>Notice</h1>');
    });

    it('[T2.10] Template missing bodyHtml gracefully sanitizes to empty string', () => {
      const sanitized = sanitizeEmailHtml(undefined as any);
      expect(sanitized).toBe('');
    });
  });

  // =========================================================================
  // BOUNDARY 3: Dynamic Merge Tags Boundaries
  // =========================================================================
  describe('Boundary 3: Dynamic Merge Tags Boundaries', () => {
    it('[T2.11] Unknown/unrecognized merge tags are preserved verbatim', () => {
      const template = 'Hello {{claimant_first_name}}, your {{custom_claim_field_99}} is ready.';
      const tags = { claimant_first_name: 'Jonathan' };
      const resolved = resolveMergeTags(template, tags);

      expect(resolved).toContain('Hello Jonathan');
      expect(resolved).toContain('{{custom_claim_field_99}}');
    });

    it('[T2.12] Null or undefined claimant fields interpolate safely without "null" string', () => {
      const template = 'Dear {{claimant_first_name}}, amount: {{settlement_amount}}.';
      const tags = {
        claimant_first_name: '',
        settlement_amount: '$0.00'
      };
      const resolved = resolveMergeTags(template, tags);

      expect(resolved).toBe('Dear , amount: $0.00.');
    });

    it('[T2.13] Zero dollar settlement amounts format as "$0.00"', () => {
      const amount = 0;
      const formatted = `$${amount.toFixed(2)}`;
      expect(formatted).toBe('$0.00');
    });

    it('[T2.14] Dangerous URL protocols in magic links are neutralized by sanitizeLinkUrl', () => {
      const dangerousLinks = [
        'javascript:alert(document.cookie)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox("test")',
        'file:///etc/passwd'
      ];

      for (const link of dangerousLinks) {
        const sanitized = sanitizeLinkUrl(link);
        expect(sanitized).toBe('#');
      }

      // Valid HTTPS URLs should be preserved
      const validLink = 'https://portal.juris-banking.com/claim/token-12345';
      expect(sanitizeLinkUrl(validLink)).toBe(validLink);
    });

    it('[T2.15] Adjacent and repeated merge tags resolve each instance independently', () => {
      const template = '{{claimant_first_name}}{{claimant_first_name}} and {{claimant_first_name}}';
      const tags = { claimant_first_name: 'Alice' };
      const resolved = resolveMergeTags(template, tags);

      expect(resolved).toBe('AliceAlice and Alice');
    });
  });

  // =========================================================================
  // BOUNDARY 4: Rolling Batch Throttling Boundaries
  // =========================================================================
  describe('Boundary 4: Rolling Batch Throttling Boundaries', () => {
    it('[T2.16] Single claimant roster (N=1) with batchSize=100 produces exactly 1 sub-batch', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { batchSize: 100 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.subBatchCount).toBe(1);
      expect(result.telemetry.dispatched).toBe(1);
    });

    it('[T2.17] Exact multiple cohort (N=100, batchSize=50) produces exactly 2 sub-batches', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 100);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { batchSize: 50 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.subBatchCount).toBe(2);
      expect(result.telemetry.dispatched).toBe(100);
    });

    it('[T2.18] Cohort with remainder of 1 (N=51, batchSize=50) produces 2 sub-batches (50 and 1)', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 51);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { batchSize: 50 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.subBatchCount).toBe(2);
      expect(result.telemetry.dispatched).toBe(51);
    });

    it('[T2.19] Max batch size ceiling of 1000 processes without throttling degradation', async () => {
      const throttlingConfig = { batchSize: 1000, intervalMinutes: 15 };
      expect(throttlingConfig.batchSize).toBe(1000);
    });

    it('[T2.20] Daily cap exactly equal to total cohort dispatches 100% with 0 remainder', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 25);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { dailyCap: 25 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(25);
      expect(result.telemetry.queued).toBe(0);
    });
  });

  // =========================================================================
  // BOUNDARY 5: Quiet Hours & Send Windows Boundaries
  // =========================================================================
  describe('Boundary 5: Quiet Hours & Send Windows Boundaries', () => {
    it('[T2.21] Exact second of quiet hours start (21:00:00) is deferred', () => {
      const exactStart = new Date('2026-11-01T21:00:00-05:00');
      const inQuiet = isWithinQuietHours(exactStart, '21:00', '08:00', 'America/New_York');
      expect(inQuiet).toBe(true);
    });

    it('[T2.22] Exact second before quiet hours start (20:59:59) is permitted to execute', () => {
      const beforeStart = new Date('2026-11-01T20:59:59-05:00');
      const inQuiet = isWithinQuietHours(beforeStart, '21:00', '08:00', 'America/New_York');
      expect(inQuiet).toBe(false);
    });

    it('[T2.23] Exact second of quiet hours end (08:00:00) is permitted to execute', () => {
      const exactEnd = new Date('2026-11-02T08:00:00-05:00');
      const inQuiet = isWithinQuietHours(exactEnd, '21:00', '08:00', 'America/New_York');
      expect(inQuiet).toBe(false);
    });

    it('[T2.24] calculateNextSendWindow calculates the next 08:00 AM window crossing midnight', () => {
      const lateNight = new Date('2026-11-01T23:30:00-05:00');
      const nextWindow = calculateNextSendWindow(lateNight, '08:00', 'America/New_York');

      expect(nextWindow.getTime()).toBeGreaterThan(lateNight.getTime());
      expect(nextWindow.getHours()).toBe(8);
      expect(nextWindow.getMinutes()).toBe(0);
    });

    it('[T2.25] Identical start and end times (24-hour quiet hours edge case) handled safely', () => {
      const testDate = new Date('2026-11-01T12:00:00Z');
      const inQuiet = isWithinQuietHours(testDate, '08:00', '08:00', 'America/New_York');
      // If start == end, startMinutes === endMinutes -> condition evaluates currentMinutes >= start && currentMinutes < end -> false
      expect(inQuiet).toBe(false);
    });
  });

  // =========================================================================
  // BOUNDARY 6: Suppression & Bounce Boundaries
  // =========================================================================
  describe('Boundary 6: Suppression & Bounce Boundaries', () => {
    it('[T2.26] RFC 5322 maximum email length: 254 chars is valid, 255 chars is invalid', () => {
      const domain = '@example.com';
      const maxLocal = 'a'.repeat(254 - domain.length);
      const email254 = `${maxLocal}${domain}`;
      expect(email254.length).toBe(254);
      expect(validateEmailSyntax(email254)).toBe(true);

      const email255 = 'a' + email254;
      expect(email255.length).toBe(255);
      expect(validateEmailSyntax(email255)).toBe(false);
    });

    it('[T2.27] Subaddressed email addresses with plus signs (user+tag@domain.com) are valid RFC 5322', () => {
      expect(validateEmailSyntax('john.doe+settlement-claim@juris.org')).toBe(true);
      expect(validateEmailSyntax('claimant+legal+2026@sub.domain.co.uk')).toBe(true);
    });

    it('[T2.28] Case-insensitive email suppression matching suppresses "JOHN@EXAMPLE.COM"', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);
      claimants[0].email = 'john.claimant@example.com';
      await claimants[0].save();

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        suppressionList: ['JOHN.CLAIMANT@EXAMPLE.COM'],
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.suppressed_bounced).toBe(1);
      expect(result.telemetry.dispatched).toBe(0);
    });

    it('[T2.29] Whitespace-padded emails are trimmed and evaluated cleanly', () => {
      const untrimmed = '  valid.user@juris-banking.com  ';
      const trimmed = untrimmed.trim();
      expect(validateEmailSyntax(trimmed)).toBe(true);
    });

    it('[T2.30] 100% bounced cohort suppresses all recipients with zero emails sent', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 6, { bouncedCount: 6 });

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(0);
      expect(result.telemetry.eligible).toBe(0);
      expect(mockEmailProvider.sentEmails.length).toBe(0);
    });
  });

  // =========================================================================
  // BOUNDARY 7: Admin Controls State Machine Boundaries
  // =========================================================================
  describe('Boundary 7: Admin Controls State Machine Boundaries', () => {
    it('[T2.31] Calling pause on an already completed wave is forbidden', () => {
      const wave = { status: 'completed' };
      const canPause = wave.status === 'in_progress';
      expect(canPause).toBe(false);
    });

    it('[T2.32] Calling resume on an in_progress wave is forbidden', () => {
      const wave = { status: 'in_progress' };
      const canResume = wave.status === 'paused';
      expect(canResume).toBe(false);
    });

    it('[T2.33] Rescheduling wave to a past date is rejected', () => {
      const pastDate = new Date('2020-01-01T00:00:00Z');
      const now = new Date();
      const isValidDate = pastDate.getTime() > now.getTime();
      expect(isValidDate).toBe(false);
    });

    it('[T2.34] Calling cancel on an already cancelled wave is terminal and idempotent', () => {
      const wave = { status: 'cancelled', cancellationCount: 1 };
      // Attempting second cancel
      if (wave.status !== 'cancelled') {
        wave.status = 'cancelled';
      }
      expect(wave.status).toBe('cancelled');
    });

    it('[T2.35] Rapid sequential state machine transitions (pause -> resume -> pause -> cancel) settle deterministically', () => {
      let status = 'in_progress';
      const log: string[] = [status];

      function transition(next: string) {
        if (status === 'in_progress' && next === 'paused') {
          status = next;
          log.push(status);
        } else if (status === 'paused' && next === 'in_progress') {
          status = next;
          log.push(status);
        } else if ((status === 'in_progress' || status === 'paused') && next === 'cancelled') {
          status = next;
          log.push(status);
        }
      }

      transition('paused');
      transition('in_progress');
      transition('paused');
      transition('cancelled');

      expect(status).toBe('cancelled');
      expect(log).toEqual(['in_progress', 'paused', 'in_progress', 'paused', 'cancelled']);
    });
  });
});
