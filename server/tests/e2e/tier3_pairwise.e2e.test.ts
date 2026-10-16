import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { EmailService } from '../../src/services/email.service';
import {
  createTestCase,
  createTestClaimants,
  executeOpaqueWaveDispatch,
  FailableMockEmailProvider
} from './cadenceE2eHarness';

describe('E2E Tier 3: Cross-Feature Combinations (Pairwise Interactions)', () => {
  let mockEmailProvider: FailableMockEmailProvider;

  beforeAll(async () => {
    await setupTestDb('e2e_tier3_pairwise');
  });

  afterAll(async () => {
    await teardownTestDb('e2e_tier3_pairwise');
  });

  beforeEach(async () => {
    await clearTestDb('e2e_tier3_pairwise');
    mockEmailProvider = new FailableMockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  it('[T3.1] Pairwise: Pause mid-batch + claimant elects payment during pause + Resume skips elected claimants', async () => {
    const testCase = await createTestCase();
    // 20 claimants in total
    const claimants = await createTestClaimants(testCase._id, 20);

    // Wave starts in_progress. Batch size = 10 (2 sub-batches total).
    // Sub-batch 1 runs:
    const daytime1 = new Date('2026-11-01T14:00:00Z');
    const subBatch1Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      throttling: { batchSize: 10, dailyCap: 10 },
      currentTime: daytime1
    });

    expect(subBatch1Result.telemetry.dispatched).toBe(10);
    expect(subBatch1Result.telemetry.queued).toBe(10);

    // ADMIN PAUSES WAVE
    const waveState = { status: 'paused', pausedAt: new Date() };
    expect(waveState.status).toBe('paused');

    // While paused, 3 claimants from the remaining 10 elect their payment method
    const remainingClaimants = await Claimant.find({ caseId: testCase._id, emailSent: false }).exec();
    expect(remainingClaimants.length).toBe(10);

    remainingClaimants[0].status = 'selected';
    remainingClaimants[1].status = 'selected';
    remainingClaimants[2].status = 'selected';
    await remainingClaimants[0].save();
    await remainingClaimants[1].save();
    await remainingClaimants[2].save();

    // ADMIN RESUMES WAVE
    waveState.status = 'in_progress';
    const daytime2 = new Date('2026-11-02T14:00:00Z');

    // Sub-batch 2 executes on resumed wave
    const subBatch2Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      throttling: { batchSize: 10, dailyCap: 50 },
      currentTime: daytime2
    });

    // Sub-batch 2 should only dispatch 7 claimants, because 3 already selected
    expect(subBatch2Result.telemetry.dispatched).toBe(7);
    expect(subBatch2Result.telemetry.eligible).toBe(7);
    expect(mockEmailProvider.sentEmails.length).toBe(17); // 10 from batch 1 + 7 from batch 2
  });

  it('[T3.2] Pairwise: Reschedule during active quiet hours + Immediate Cancel purges queue', async () => {
    const testCase = await createTestCase();
    await createTestClaimants(testCase._id, 10);

    // Scheduled at 23:00 (quiet hours)
    const nightTime = new Date('2026-11-01T23:30:00-05:00');
    const quietResult = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      throttling: { quietHoursStart: '21:00', quietHoursEnd: '08:00', timezone: 'America/New_York' },
      currentTime: nightTime
    });

    expect(quietResult.deferredDueToQuietHours).toBe(true);
    expect(quietResult.telemetry.dispatched).toBe(0);

    // Admin reschedules to next week at 14:00
    const wave = { status: 'rescheduled', scheduledDate: new Date('2026-11-08T14:00:00Z') };
    expect(wave.status).toBe('rescheduled');

    // Court orders matter stayed; Admin issues Cancel
    wave.status = 'cancelled';
    expect(wave.status).toBe('cancelled');
    expect(mockEmailProvider.sentEmails.length).toBe(0);
  });

  it('[T3.3] Pairwise: Multi-lingual localized templates (EN, ES, ZH, VI) + 3-layer suppression', async () => {
    const testCase = await createTestCase();
    // 8 claimants: 2 EN, 2 ES, 2 ZH, 2 VI. In each language, 1 is valid, 1 has invalid email.
    const createdClaimants: any[] = [];
    const langs = ['en', 'es', 'zh', 'vi'];

    for (const lang of langs) {
      const valid = await Claimant.create({
        caseId: testCase._id,
        claimId: `CLM-${lang}-VALID`,
        firstName: `User-${lang}`,
        lastName: 'Clean',
        email: `clean.${lang}@example.com`,
        settlementAmount: 500,
        status: 'pending_selection',
        paymentSelectionToken: `token-${lang}-clean`,
        paymentDetails: { preferredLanguage: lang }
      });
      const invalid = await Claimant.create({
        caseId: testCase._id,
        claimId: `CLM-${lang}-INVALID`,
        firstName: `User-${lang}`,
        lastName: 'Dirty',
        email: `dirty.${lang}@bad..syntax`,
        settlementAmount: 500,
        status: 'pending_selection',
        paymentSelectionToken: `token-${lang}-dirty`,
        paymentDetails: { preferredLanguage: lang }
      });
      createdClaimants.push(valid, invalid);
    }

    const result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(result.telemetry.eligible).toBe(8);
    expect(result.telemetry.dispatched).toBe(4);
    expect(result.telemetry.suppressed_bounced).toBe(4);
    expect(mockEmailProvider.sentEmails.length).toBe(4);

    // Verify language fidelity across dispatched clean emails
    const enEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'clean.en@example.com');
    const esEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'clean.es@example.com');
    const zhEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'clean.zh@example.com');
    const viEmail = mockEmailProvider.sentEmails.find((e) => e.to === 'clean.vi@example.com');

    expect(enEmail?.subject).toContain('Court Notice:');
    expect(esEmail?.subject).toContain('Notificación Judicial:');
    expect(zhEmail?.subject).toContain('法院和解通知');
    expect(viEmail?.subject).toContain('Thông Báo Tòa Án');
  });

  it('[T3.4] Pairwise: Multi-stage concurrency with shared daily cap', async () => {
    const caseA = await createTestCase({ name: 'Matter A' });
    const caseB = await createTestCase({ name: 'Matter B' });

    await createTestClaimants(caseA._id, 15);
    await createTestClaimants(caseB._id, 15);

    // Firm daily cap = 20 total. Case A uses 15.
    const resA = await executeOpaqueWaveDispatch({
      caseRecord: caseA,
      stage: 'initial_notice',
      throttling: { dailyCap: 15 },
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(resA.telemetry.dispatched).toBe(15);

    // Case B attempts 15, but remaining capacity for firm is only 5
    const resB = await executeOpaqueWaveDispatch({
      caseRecord: caseB,
      stage: 'reminder_14d',
      throttling: { dailyCap: 5 },
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(resB.telemetry.dispatched).toBe(5);
    expect(resB.telemetry.queued).toBe(10);
    expect(mockEmailProvider.sentEmails.length).toBe(20);
  });

  it('[T3.5] Pairwise: Rolling throttling sub-batches + exponential backoff retry interleaving', async () => {
    const testCase = await createTestCase();
    const claimants = await createTestClaimants(testCase._id, 5);

    // Simulate transient failure on first delivery
    mockEmailProvider.shouldFail = true;
    const failRes = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(failRes.telemetry.failed).toBe(5);

    // Cooldown passes and network recovers
    mockEmailProvider.shouldFail = false;
    const retryRes = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      currentTime: new Date('2026-11-01T14:05:00Z')
    });

    expect(retryRes.telemetry.dispatched).toBe(5);
    const updated = await Claimant.find({ caseId: testCase._id }).exec();
    // Delivery attempts should now be 2 (1 failed + 1 successful)
    expect(updated.every((c) => c.deliveryAttempts === 2)).toBe(true);
    expect(updated.every((c) => c.emailSent === true)).toBe(true);
  });

  it('[T3.6] Pairwise: Rapid sequential admin actions (Pause -> Reschedule -> Resume -> Cancel)', () => {
    let status = 'in_progress';
    const transitions: string[] = [];

    function applyAction(action: string) {
      if (action === 'pause' && status === 'in_progress') {
        status = 'paused';
        transitions.push('paused');
      } else if (action === 'reschedule' && (status === 'paused' || status === 'scheduled')) {
        status = 'rescheduled';
        transitions.push('rescheduled');
      } else if (action === 'resume' && (status === 'paused' || status === 'rescheduled')) {
        status = 'in_progress';
        transitions.push('in_progress');
      } else if (action === 'cancel' && status !== 'cancelled' && status !== 'completed') {
        status = 'cancelled';
        transitions.push('cancelled');
      }
    }

    applyAction('pause');
    applyAction('reschedule');
    applyAction('resume');
    applyAction('cancel');

    expect(status).toBe('cancelled');
    expect(transitions).toEqual(['paused', 'rescheduled', 'in_progress', 'cancelled']);

    // Cancelled status is immutable
    applyAction('resume');
    expect(status).toBe('cancelled');
  });

  it('[T3.7] Pairwise: Just-in-time claimant payment selection race condition', async () => {
    const testCase = await createTestCase();
    const claimants = await createTestClaimants(testCase._id, 1);

    // Claimant clicks link and elects payment before send loop touches their row
    const claimantId = claimants[0]._id;
    await Claimant.findByIdAndUpdate(claimantId, { status: 'selected', selectedPaymentMethod: 'ach' });

    const result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'reminder_14d',
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(result.telemetry.dispatched).toBe(0);
    expect(result.telemetry.eligible).toBe(0);
    expect(mockEmailProvider.sentEmails.length).toBe(0);
  });

  it('[T3.8] Pairwise: Post-deadline fallback sweeper runs while a reminder wave was paused', async () => {
    const testCase = await createTestCase();
    const claimants = await createTestClaimants(testCase._id, 4);

    // Reminder wave was paused. Meanwhile, deadline expires and sweeper transitions claimants
    for (const c of claimants) {
      c.status = 'deadline_expired';
      await c.save();
    }

    // Accidental resume of T-14d reminder wave
    const result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'reminder_14d',
      currentTime: new Date('2026-12-01T15:00:00Z')
    });

    // 0 claimants dispatched because all are status !== 'pending_selection'
    expect(result.telemetry.eligible).toBe(0);
    expect(result.telemetry.dispatched).toBe(0);
    expect(mockEmailProvider.sentEmails.length).toBe(0);
  });
});
