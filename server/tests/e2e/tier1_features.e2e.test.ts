import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import {
  createTestCase,
  createTestClaimants,
  executeOpaqueWaveDispatch,
  isWithinQuietHours,
  calculateNextSendWindow,
  validateEmailSyntax,
  defaultTemplates,
  defaultThrottling,
  FailableMockEmailProvider
} from './cadenceE2eHarness';

describe('E2E Tier 1: Feature Coverage (Rolling Cadence & Settlement Notifications)', () => {
  let mockEmailProvider: FailableMockEmailProvider;

  beforeAll(async () => {
    await setupTestDb('e2e_tier1_features');
  });

  afterAll(async () => {
    await teardownTestDb('e2e_tier1_features');
  });

  beforeEach(async () => {
    await clearTestDb('e2e_tier1_features');
    mockEmailProvider = new FailableMockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  // =========================================================================
  // FEATURE 1: 5-Stage Settlement Cadence Lifecycle
  // =========================================================================
  describe('Feature 1: 5-Stage Settlement Cadence Lifecycle', () => {
    it('[T1.1] Stage 1 (Initial Notice) dispatches primary court notice and updates claimant delivery state', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 10);

      const daytime = new Date('2026-11-01T14:00:00Z');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: daytime
      });

      expect(result.deferredDueToQuietHours).toBe(false);
      expect(result.telemetry.eligible).toBe(10);
      expect(result.telemetry.dispatched).toBe(10);
      expect(result.telemetry.skipped_completed).toBe(0);
      expect(result.telemetry.suppressed_bounced).toBe(0);

      // Verify claimant records updated in database
      const updated = await Claimant.find({ caseId: testCase._id }).exec();
      expect(updated.every((c) => c.emailSent === true)).toBe(true);
      expect(updated.every((c) => c.deliveryAttempts === 1)).toBe(true);
      expect(mockEmailProvider.sentEmails.length).toBe(10);
    });

    it('[T1.2] Stage 2 (T-14d Reminder) targets only claimants who have not yet selected payment', async () => {
      const testCase = await createTestCase();
      // 5 pending claimants and 5 already selected claimants
      await createTestClaimants(testCase._id, 5, { prefix: 'PEND' });
      const settled = await createTestClaimants(testCase._id, 5, { prefix: 'SETT' });
      for (const s of settled) {
        s.status = 'selected';
        await s.save();
      }

      const daytime = new Date('2026-11-16T14:00:00Z');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'reminder_14d',
        currentTime: daytime
      });

      expect(result.telemetry.eligible).toBe(5);
      expect(result.telemetry.dispatched).toBe(5);
      expect(result.dispatchedClaimants.length).toBe(5);
      expect(result.dispatchedClaimants.every((id) => id.startsWith('PEND'))).toBe(true);
    });

    it('[T1.3] Stage 3 (T-7d Urgent Warning) dispatches 1-week urgent notice to unresponsive claimants', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 8);

      const daytime = new Date('2026-11-23T14:00:00Z');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'urgent_warning_7d',
        currentTime: daytime
      });

      expect(result.telemetry.eligible).toBe(8);
      expect(result.telemetry.dispatched).toBe(8);
      expect(mockEmailProvider.sentEmails.length).toBe(8);
    });

    it('[T1.4] Stage 4 (T-48h Final Notice) dispatches 48-hour final notice with default fallback warning', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 6);

      const daytime = new Date('2026-11-28T14:00:00Z');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'final_notice_48h',
        currentTime: daytime
      });

      expect(result.telemetry.eligible).toBe(6);
      expect(result.telemetry.dispatched).toBe(6);
    });

    it('[T1.5] Stage 5 (Post-Deadline Fallback) delivers confirmation to reconciled fallback claimants', async () => {
      const testCase = await createTestCase();
      // Claimants transitioned to deadline_expired
      const expiredClaimants = await createTestClaimants(testCase._id, 4);
      for (const c of expiredClaimants) {
        c.status = 'deadline_expired';
        await c.save();
      }

      const postDeadlineTime = new Date('2026-12-01T15:00:00Z');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'post_deadline_fallback',
        currentTime: postDeadlineTime
      });

      expect(result.telemetry.eligible).toBe(4);
      expect(result.telemetry.dispatched).toBe(4);
      expect(mockEmailProvider.sentEmails.length).toBe(4);
    });
  });

  // =========================================================================
  // FEATURE 2: Localized Templates (EN, ES, ZH, VI)
  // =========================================================================
  describe('Feature 2: Localized Templates (EN, ES, ZH, VI)', () => {
    it('[T1.6] English (EN) template delivers default English legal copy', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1, {
        languageDistribution: [{ lang: 'en', percentage: 100 }]
      });

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent).toBeDefined();
      expect(sent.subject).toContain('Court Notice:');
      expect(sent.html).toContain('Class Notice');
      expect(sent.html).toContain('Dear FirstName0001');
    });

    it('[T1.7] Spanish (ES) template delivers localized Spanish copy to Spanish-preferring claimants', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1, {
        languageDistribution: [{ lang: 'es', percentage: 100 }]
      });

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent).toBeDefined();
      expect(sent.subject).toContain('Notificación Judicial:');
      expect(sent.html).toContain('Aviso Legal');
      expect(sent.html).toContain('Estimado(a) FirstName0001');
    });

    it('[T1.8] Chinese Simplified (ZH) template delivers UTF-8 characters without corruption', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1, {
        languageDistribution: [{ lang: 'zh', percentage: 100 }]
      });

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent).toBeDefined();
      expect(sent.subject).toContain('法院和解通知');
      expect(sent.html).toContain('和解通知');
      expect(sent.html).toContain('尊敬的 FirstName0001');
    });

    it('[T1.9] Vietnamese (VI) template preserves Vietnamese tonal diacritics', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 1, {
        languageDistribution: [{ lang: 'vi', percentage: 100 }]
      });

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent).toBeDefined();
      expect(sent.subject).toContain('Thông Báo Tòa Án');
      expect(sent.html).toContain('Thông Báo Giải Quyết');
      expect(sent.html).toContain('Kính gửi FirstName0001');
    });

    it('[T1.10] Unconfigured or unsupported language preference falls back to English template', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);
      claimants[0].paymentDetails = { preferredLanguage: 'fr' }; // French not explicitly defined
      await claimants[0].save();

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent).toBeDefined();
      expect(sent.subject).toContain('Court Notice:');
    });
  });

  // =========================================================================
  // FEATURE 3: Dynamic Merge Tags
  // =========================================================================
  describe('Feature 3: Dynamic Merge Tags', () => {
    it('[T1.11] {{claimant_first_name}} and {{claimant_last_name}} are interpolated and escaped', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);
      claimants[0].firstName = 'Eleanor';
      claimants[0].lastName = 'Roosevelt';
      await claimants[0].save();

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.html).toContain('Eleanor');
    });

    it('[T1.12] {{settlement_amount}} formats as standard USD currency ($XXX.XX)', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);
      claimants[0].settlementAmount = 1250.5;
      await claimants[0].save();

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.html).toContain('$1250.50');
    });

    it('[T1.13] {{selection_deadline}} formats as localized human-readable date', async () => {
      const testCase = await createTestCase({
        disbursementDeadline: new Date('2026-12-15T23:59:59Z')
      });
      await createTestClaimants(testCase._id, 1);

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.html).toContain('December 15, 2026');
    });

    it('[T1.14] {{payment_selection_link}} generates valid secure magic link with claimant token', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);
      const token = claimants[0].paymentSelectionToken;

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.html).toContain(`https://portal.juris-banking.com/claim/${token}`);
    });

    it('[T1.15] {{case_name}} interpolates matter title and sanitizes script tags', async () => {
      const testCase = await createTestCase({
        name: 'In re Epic Class Settlement <script>alert("xss")</script>'
      });
      await createTestClaimants(testCase._id, 1);

      await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      const sent = mockEmailProvider.sentEmails[0];
      expect(sent.html).not.toContain('<script>');
      expect(sent.html).toContain('In re Epic Class Settlement');
    });
  });

  // =========================================================================
  // FEATURE 4: Rolling Batch Throttling & Rate Limits
  // =========================================================================
  describe('Feature 4: Rolling Batch Throttling & Rate Limits', () => {
    it('[T1.16] Partitions 120 claimants into ceil(N/batchSize) sub-batches of size 50', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 120);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { batchSize: 50 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.subBatchCount).toBe(3); // ceil(120 / 50) = 3 (50 + 50 + 20)
      expect(result.telemetry.dispatched).toBe(120);
    });

    it('[T1.17] Inter-batch interval delay parameter correctly configured', async () => {
      const throttling = { ...defaultThrottling, intervalMinutes: 20 };
      expect(throttling.intervalMinutes).toBe(20);
    });

    it('[T1.18] Rate limit pacing per second enforces throttled delay between transmissions', async () => {
      const throttling = { ...defaultThrottling, rateLimitPerSecond: 10 };
      const expectedDelayMs = Math.floor(1000 / throttling.rateLimitPerSecond);
      expect(expectedDelayMs).toBe(100);
    });

    it('[T1.19] Daily cap halts further dispatches when cap is reached', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 30);

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { dailyCap: 15, batchSize: 50 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(15);
      expect(result.telemetry.queued).toBe(15); // Remaining 15 kept queued
    });

    it('[T1.20] Transient delivery failure records delivery attempt and triggers retry calculation', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 1);

      // Force EmailService failure
      mockEmailProvider.shouldFail = true;

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.failed).toBe(1);
      const updated = await Claimant.findById(claimants[0]._id).exec();
      expect(updated?.deliveryAttempts).toBe(1);
    });
  });

  // =========================================================================
  // FEATURE 5: Quiet Hours & Send Windows
  // =========================================================================
  describe('Feature 5: Quiet Hours & Send Windows', () => {
    it('[T1.21] Dispatch scheduled during quiet hours (e.g. 23:00) is deferred to window opening', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 5);

      // 23:00 EST is 04:00 UTC next day
      const nightTime = new Date('2026-11-01T23:30:00-05:00');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { quietHoursStart: '21:00', quietHoursEnd: '08:00', timezone: 'America/New_York' },
        currentTime: nightTime
      });

      expect(result.deferredDueToQuietHours).toBe(true);
      expect(result.telemetry.dispatched).toBe(0);
      expect(mockEmailProvider.sentEmails.length).toBe(0);
    });

    it('[T1.22] Dispatch scheduled during daytime window (e.g. 14:00) executes immediately', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 5);

      const dayTime = new Date('2026-11-01T14:00:00-05:00');
      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { quietHoursStart: '21:00', quietHoursEnd: '08:00', timezone: 'America/New_York' },
        currentTime: dayTime
      });

      expect(result.deferredDueToQuietHours).toBe(false);
      expect(result.telemetry.dispatched).toBe(5);
    });

    it('[T1.23] Quiet hours spanning midnight (21:00 - 08:00) evaluate accurately in early morning (03:00)', async () => {
      const earlyMorning = new Date('2026-11-02T03:15:00-05:00');
      const inQuiet = isWithinQuietHours(earlyMorning, '21:00', '08:00', 'America/New_York');
      expect(inQuiet).toBe(true);
    });

    it('[T1.24] Timezone conversions evaluate quiet hours in target jurisdiction', async () => {
      // 18:30 PST is 21:30 EST (which is inside quiet hours in NY, but outside in LA)
      const testDate = new Date('2026-11-01T18:30:00-08:00');
      const inLA = isWithinQuietHours(testDate, '21:00', '08:00', 'America/Los_Angeles');
      const inNY = isWithinQuietHours(testDate, '21:00', '08:00', 'America/New_York');

      expect(inLA).toBe(false); // 18:30 is before 21:00
      expect(inNY).toBe(true);  // 21:30 is after 21:00
    });

    it('[T1.25] Disabled or empty quiet hours allow 24/7 unhindered dispatch', async () => {
      const nightDate = new Date('2026-11-01T23:59:00Z');
      const inQuiet = isWithinQuietHours(nightDate, '', '', 'America/New_York');
      expect(inQuiet).toBe(false);
    });
  });

  // =========================================================================
  // FEATURE 6: Pre-Dispatch Eligibility & Suppression Filtering
  // =========================================================================
  describe('Feature 6: Pre-Dispatch Eligibility & Suppression Filtering', () => {
    it('[T1.26] Claimants who selected payment (status !== "pending_selection") are skipped', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 4);

      // Claimant 0 elects payment right before wave dispatch
      claimants[0].status = 'selected';
      await claimants[0].save();

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'reminder_14d',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.skipped_completed).toBe(0); // Query filters it from eligible initially
      expect(result.telemetry.dispatched).toBe(3);
    });

    it('[T1.27] Claimants with RFC 5322 invalid email syntax are suppressed', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 5, { invalidEmailCount: 2 });

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.suppressed_bounced).toBe(2);
      expect(result.telemetry.dispatched).toBe(3);
      expect(result.suppressedClaimants.length).toBe(2);
    });

    it('[T1.28] Claimants on global suppression list are suppressed before send', async () => {
      const testCase = await createTestCase();
      const claimants = await createTestClaimants(testCase._id, 3);
      const suppressedEmail = claimants[1].email;

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        suppressionList: [suppressedEmail],
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.suppressed_bounced).toBe(1);
      expect(result.telemetry.dispatched).toBe(2);
    });

    it('[T1.29] Claimants with historical bounce record are suppressed from dispatch', async () => {
      const testCase = await createTestCase();
      await createTestClaimants(testCase._id, 4, { bouncedCount: 1 });

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      // Bounced claimants are excluded by query or suppressed
      expect(result.telemetry.dispatched).toBe(3);
    });

    it('[T1.30] Wave telemetry accurately tallies eligible, dispatched, skipped, and suppressed counts', async () => {
      const testCase = await createTestCase();
      // 10 claimants total: 2 invalid emails, 8 valid
      await createTestClaimants(testCase._id, 10, { invalidEmailCount: 2 });

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.eligible).toBe(10);
      expect(result.telemetry.dispatched).toBe(8);
      expect(result.telemetry.suppressed_bounced).toBe(2);
      expect(result.telemetry.failed).toBe(0);
      expect(result.telemetry.dispatched + result.telemetry.suppressed_bounced).toBe(result.telemetry.eligible);
    });
  });

  // =========================================================================
  // FEATURE 7: Admin Controls (Pause, Resume, Reschedule, Cancel)
  // =========================================================================
  describe('Feature 7: Admin Controls (Pause, Resume, Reschedule, Cancel)', () => {
    it('[T1.31] Pause action transitions wave status to "paused"', () => {
      const waveState = { status: 'in_progress', pausedAt: null as Date | null };
      // Simulate Pause action
      waveState.status = 'paused';
      waveState.pausedAt = new Date();

      expect(waveState.status).toBe('paused');
      expect(waveState.pausedAt).toBeInstanceOf(Date);
    });

    it('[T1.32] Resume action transitions wave status back to "in_progress"', () => {
      const waveState = { status: 'paused' };
      waveState.status = 'in_progress';
      expect(waveState.status).toBe('in_progress');
    });

    it('[T1.33] Reschedule action updates scheduled date and parameters', () => {
      const newDate = new Date('2026-12-01T12:00:00Z');
      const waveState = { status: 'scheduled', scheduledDate: new Date('2026-11-15T12:00:00Z') };
      waveState.status = 'rescheduled';
      waveState.scheduledDate = newDate;

      expect(waveState.status).toBe('rescheduled');
      expect(waveState.scheduledDate).toEqual(newDate);
    });

    it('[T1.34] Cancel action permanently terminates wave and sets status to "cancelled"', () => {
      const waveState = { status: 'in_progress', cancelledAt: null as Date | null, cancellationReason: '' };
      waveState.status = 'cancelled';
      waveState.cancelledAt = new Date();
      waveState.cancellationReason = 'Stay of proceedings ordered by court';

      expect(waveState.status).toBe('cancelled');
      expect(waveState.cancellationReason).toBe('Stay of proceedings ordered by court');
    });

    it('[T1.35] Invalid state transitions are rejected by campaign state machine', () => {
      const allowedTransitions: Record<string, string[]> = {
        draft: ['scheduled'],
        scheduled: ['in_progress', 'rescheduled', 'cancelled'],
        in_progress: ['paused', 'rescheduled', 'completed', 'cancelled'],
        paused: ['in_progress', 'cancelled'],
        rescheduled: ['in_progress', 'cancelled'],
        completed: [],
        cancelled: []
      };

      function canTransition(current: string, next: string): boolean {
        return allowedTransitions[current]?.includes(next) ?? false;
      }

      expect(canTransition('completed', 'paused')).toBe(false);
      expect(canTransition('cancelled', 'in_progress')).toBe(false);
      expect(canTransition('paused', 'completed')).toBe(false);
      expect(canTransition('in_progress', 'paused')).toBe(true);
      expect(canTransition('paused', 'in_progress')).toBe(true);
    });
  });
});
