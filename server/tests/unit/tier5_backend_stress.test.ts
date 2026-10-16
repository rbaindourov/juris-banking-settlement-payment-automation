import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  Case,
  Claimant,
  NotificationCadence,
  EmailWave,
  SubBatch,
  SuppressionList
} from '../../src/models';
import { CadenceService } from '../../src/services/cadence.service';
import { WaveControlService } from '../../src/services/waveControl.service';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import { executeDispatchWaveSubBatch } from '../../src/jobs/waveDispatchSubbatch.job';
import { executeEvaluateCadenceStages } from '../../src/jobs/cadenceEvaluateStages.job';
import { createAgenda, setAgenda, stopAgenda } from '../../src/config/agenda';

describe('Tier 5 Adversarial Stress Test: Backend Dispatch & Wave Control Robustness', () => {
  let testCase: any;
  let otherCase: any;
  let mockEmailProvider: MockEmailProvider;
  let agenda: any;

  const FIRM_ID = 'FIRM-T5-STRESS';
  const OTHER_FIRM_ID = 'FIRM-T5-OTHER';

  beforeAll(async () => {
    await setupTestDb('tier5_backend_stress');
    agenda = createAgenda();
    setAgenda(agenda);
  });

  afterAll(async () => {
    await stopAgenda();
    await teardownTestDb('tier5_backend_stress');
  });

  beforeEach(async () => {
    await clearTestDb('tier5_backend_stress');

    mockEmailProvider = new MockEmailProvider();
    EmailService.setProvider(mockEmailProvider);

    testCase = await Case.create({
      name: 'Adversarial Tier 5 Stress Matter',
      docketNumber: '5:26-cv-77777',
      lawFirmId: FIRM_ID,
      settlementFundTotal: 2500000,
      disbursementDeadline: new Date(Date.now() + 45 * 86400000), // 45 days future
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    otherCase = await Case.create({
      name: 'Unrelated Settlement Matter',
      docketNumber: '5:26-cv-88888',
      lawFirmId: OTHER_FIRM_ID,
      settlementFundTotal: 1000000,
      disbursementDeadline: new Date(Date.now() + 60 * 86400000),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    EmailService.resetProvider();
    if (agenda) {
      try {
        await agenda.cancel({ name: 'wave:dispatch-subbatch' });
      } catch {}
    }
  });

  // Helper to quickly create test claimants
  async function createClaimants(
    count: number,
    caseId: mongoose.Types.ObjectId,
    overrides: Partial<any> = {}
  ): Promise<any[]> {
    const claimants = [];
    for (let i = 0; i < count; i++) {
      claimants.push({
        caseId,
        claimId: `CLM-T5-${Math.random().toString(36).substring(2, 8)}-${i}`,
        firstName: `Claimant${i}`,
        lastName: `Test${i}`,
        email: `claimant${i}_${Date.now()}@domain.com`,
        settlementAmount: 250 + i * 10,
        status: 'pending_selection',
        bounced: false,
        emailSent: false,
        paymentSelectionToken: `token_${Math.random().toString(36).substring(2, 10)}`,
        ...overrides
      });
    }
    return Claimant.insertMany(claimants);
  }

  // =========================================================================
  // 1. RAPID STATE TRANSITION RACES & WAVE OPERATIONAL CONTROLS
  // =========================================================================
  describe('1. Rapid State Transition Races & Wave Operational Controls', () => {
    it('1.1 survives rapid consecutive state transitions without corrupting wave or sub-batches', async () => {
      await createClaimants(15, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d', {
        throttling: { batchSize: 5, intervalMinutes: 10, quietHoursEnabled: false }
      });
      const subBatches = await CadenceService.partitionWaveSubBatches(wave.waveId, {
        batchSize: 5,
        intervalMinutes: 10,
        agenda
      });
      expect(subBatches.length).toBe(3);

      // Rapid consecutive transition sequence:
      // Scheduled -> Pause
      const pausedWave = await WaveControlService.pauseWave(wave.waveId, 'admin_1', 'Testing pause');
      expect(pausedWave.status).toBe('paused');
      expect(pausedWave.controlState.isPaused).toBe(true);

      const pausedBatches = await SubBatch.find({ waveId: wave._id });
      expect(pausedBatches.every((b) => b.status === 'paused')).toBe(true);

      // Pause -> Resume
      const resumedWave = await WaveControlService.resumeWave(wave.waveId, 'admin_1', { newIntervalMinutes: 20 });
      expect(resumedWave.status).toBe('in_progress');
      expect(resumedWave.controlState.isPaused).toBe(false);

      const resumedBatches = await SubBatch.find({ waveId: wave._id }).sort({ chunkIndex: 1 });
      expect(resumedBatches.every((b) => b.status === 'pending')).toBe(true);
      // Verify interval spacing updated (within 100ms tolerance for loop execution latency)
      const diffMs = resumedBatches[1].scheduledAt.getTime() - resumedBatches[0].scheduledAt.getTime();
      expect(Math.abs(diffMs - 20 * 60 * 1000)).toBeLessThan(100);

      // Resume -> Pause again
      await WaveControlService.pauseWave(wave.waveId, 'admin_1', 'Second pause');
      const rePausedWave = await EmailWave.findById(wave._id);
      expect(rePausedWave?.status).toBe('paused');

      // Pause -> Reschedule to future
      const futureDate = new Date(Date.now() + 7 * 86400000); // 7 days later
      const rescheduledWave = await WaveControlService.rescheduleWave(wave.waveId, futureDate, 'admin_1', 'Shift 7 days');
      expect(rescheduledWave.status).toBe('rescheduled');
      expect(rescheduledWave.scheduledDate.getTime()).toBe(futureDate.getTime());

      // Rescheduled -> Resume
      const reResumedWave = await WaveControlService.resumeWave(wave.waveId, 'admin_1');
      expect(reResumedWave.status).toBe('in_progress');

      // In_Progress -> Cancel
      const cancelledWave = await WaveControlService.cancelWave(wave.waveId, 'Emergency termination', 'admin_1');
      expect(cancelledWave.status).toBe('cancelled');
      expect(cancelledWave.controlState.cancelReason).toBe('Emergency termination');

      const cancelledBatches = await SubBatch.find({ waveId: wave._id });
      expect(cancelledBatches.every((b) => b.status === 'cancelled')).toBe(true);
    });

    it('1.2 strictly enforces idempotency and invalid state machine transition guards', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');

      // Idempotency: Pausing already paused wave returns wave cleanly
      await WaveControlService.pauseWave(wave.waveId);
      const secondPause = await WaveControlService.pauseWave(wave.waveId);
      expect(secondPause.status).toBe('paused');

      // Idempotency: Cancelling already cancelled wave returns wave cleanly
      await WaveControlService.cancelWave(wave.waveId, 'Cancelled');
      const secondCancel = await WaveControlService.cancelWave(wave.waveId, 'Cancelled again');
      expect(secondCancel.status).toBe('cancelled');

      // Prohibited transition: Cannot pause a cancelled wave
      await expect(WaveControlService.pauseWave(wave.waveId)).rejects.toThrow(/Cannot pause wave in status 'cancelled'/);

      // Prohibited transition: Cannot resume a cancelled wave
      await expect(WaveControlService.resumeWave(wave.waveId)).rejects.toThrow(/Cannot resume wave in status 'cancelled'/);

      // Prohibited transition: Cannot reschedule a cancelled wave
      await expect(
        WaveControlService.rescheduleWave(wave.waveId, new Date(Date.now() + 86400000))
      ).rejects.toThrow(/Cannot reschedule wave in status 'cancelled'/);

      // Prohibited transition: Cannot reschedule with a past date
      const pastDate = new Date(Date.now() - 3600000);
      const wave2 = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d');
      await expect(WaveControlService.rescheduleWave(wave2.waveId, pastDate)).rejects.toThrow(
        /must be a valid future date/
      );

      // Prohibited transition: Cannot resume an already in_progress wave
      wave2.status = 'in_progress';
      await wave2.save();
      await expect(WaveControlService.resumeWave(wave2.waveId)).rejects.toThrow(
        /Cannot resume wave already in progress/
      );
    });

    it('1.3 maintains consistency under concurrent racing pause and resume requests', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'urgent_warning_7d');
      await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Fire 4 simultaneous pause operations
      const pauseResults = await Promise.allSettled([
        WaveControlService.pauseWave(wave.waveId, 'admin_1'),
        WaveControlService.pauseWave(wave.waveId, 'admin_2'),
        WaveControlService.pauseWave(wave.waveId, 'admin_3'),
        WaveControlService.pauseWave(wave.waveId, 'admin_4')
      ]);

      expect(pauseResults.every((r) => r.status === 'fulfilled')).toBe(true);

      const freshWave = await EmailWave.findById(wave._id);
      expect(freshWave?.status).toBe('paused');
      expect(freshWave?.controlState.isPaused).toBe(true);

      // Sub-batches must all be paused
      const batches = await SubBatch.find({ waveId: wave._id });
      expect(batches.every((b) => b.status === 'paused')).toBe(true);
    });

    it('1.4 atomically completes wave when multiple sub-batches complete concurrently', async () => {
      await createClaimants(15, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d', {
        throttling: { batchSize: 3, intervalMinutes: 5, quietHoursEnabled: false }
      });
      const subBatches = await CadenceService.partitionWaveSubBatches(wave.waveId, {
        batchSize: 3,
        intervalMinutes: 5
      });
      expect(subBatches.length).toBe(5);

      // Execute all 5 sub-batches concurrently
      const dispatchPromises = subBatches.map((sb) =>
        executeDispatchWaveSubBatch({ waveId: wave.waveId, subBatchId: sb.subBatchId })
      );

      const results = await Promise.all(dispatchPromises);
      expect(results.every((r) => r.status === 'completed')).toBe(true);

      // Verify wave is atomically marked completed and all counters are exact
      const finalWave = await EmailWave.findById(wave._id);
      expect(finalWave?.status).toBe('completed');
      expect(finalWave?.completedSubBatches).toBe(5);
      expect(finalWave?.totalSubBatches).toBe(5);
      expect(finalWave?.completedDate).toBeDefined();
      expect(finalWave?.telemetry.dispatched).toBe(15);
      expect(finalWave?.telemetry.queued).toBe(0);
    });
  });

  // =========================================================================
  // 2. FAULT INJECTION, RETRY BACKOFF & NETWORK FAILURE SIMULATION
  // =========================================================================
  describe('2. Fault Injection, Retry Backoff & Network Simulation', () => {
    it('2.1 catches transient database connection drops during sub-batch loop, calculates exponential backoff and sets pending status', async () => {
      await createClaimants(4, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Simulate a database connection drop during the loop when checking wave state on recipient #2
      let findCount = 0;
      const originalFindById = EmailWave.findById;
      vi.spyOn(EmailWave, 'findById').mockImplementation(function (...args: any[]) {
        findCount++;
        // On 2nd recipient in loop, simulate connection drop
        if (findCount === 2) {
          throw new Error('MongoNetworkError: connection closed by remote peer');
        }
        return (originalFindById as any).apply(EmailWave, args);
      });

      // Dispatch should catch the DB drop in the outer catch block, increment retryCount, and re-throw
      await expect(
        executeDispatchWaveSubBatch({ waveId: wave.waveId, subBatchId: subBatch.subBatchId })
      ).rejects.toThrow('MongoNetworkError: connection closed by remote peer');

      // Verify sub-batch retry state in database
      const failedBatch = await SubBatch.findById(subBatch._id);
      expect(failedBatch?.status).toBe('pending'); // Reset to pending for retry
      expect(failedBatch?.retryCount).toBe(1);
      expect(failedBatch?.lastError).toBe('MongoNetworkError: connection closed by remote peer');

      // Verify backoff scheduledAt: 2^1 = 2 minutes in future
      const expectedMinTime = Date.now() + 1.8 * 60 * 1000;
      const expectedMaxTime = Date.now() + 2.2 * 60 * 1000;
      expect(failedBatch?.scheduledAt.getTime()).toBeGreaterThanOrEqual(expectedMinTime);
      expect(failedBatch?.scheduledAt.getTime()).toBeLessThanOrEqual(expectedMaxTime);

      // Verify execution log recorded warning
      const log = failedBatch?.executionLogs.find((l) => l.level === 'warn');
      expect(log?.message).toContain('failed on attempt 1/5');
      expect(log?.message).toContain('Rescheduled with exponential backoff');
    });

    it('2.2 marks sub-batch as permanently failed when maxRetries is exhausted', async () => {
      await createClaimants(2, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Pre-set retryCount to 4 (so next failure hits maxRetries = 5)
      subBatch.retryCount = 4;
      subBatch.maxRetries = 5;
      await subBatch.save();

      // Force failure during dispatch loop via DB connection drop
      vi.spyOn(EmailWave, 'findById').mockImplementation(() => {
        throw new Error('Persistent Socket Hang Up');
      });

      await expect(
        executeDispatchWaveSubBatch({ waveId: wave.waveId, subBatchId: subBatch.subBatchId })
      ).rejects.toThrow('Persistent Socket Hang Up');

      const exhaustedBatch = await SubBatch.findById(subBatch._id);
      expect(exhaustedBatch?.status).toBe('failed');
      expect(exhaustedBatch?.retryCount).toBe(5);
      expect(exhaustedBatch?.error).toContain('Max retries (5) exceeded');
    });

    it('2.3 guarantees idempotent retry execution without duplicate email dispatches', async () => {
      await createClaimants(5, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Attempt 1: Allow 1st recipient to dispatch, then drop DB connection on 2nd recipient
      let findCount = 0;
      const originalFindById = EmailWave.findById;
      vi.spyOn(EmailWave, 'findById').mockImplementation(function (...args: any[]) {
        findCount++;
        if (findCount === 2) {
          throw new Error('Transient network drop during batch loop');
        }
        return (originalFindById as any).apply(EmailWave, args);
      });

      await expect(
        executeDispatchWaveSubBatch({ waveId: wave.waveId, subBatchId: subBatch.subBatchId })
      ).rejects.toThrow('Transient network drop during batch loop');

      // Verify attempt 1 state: recipient 0 was dispatched, others queued
      const batchAfterAttempt1 = await SubBatch.findById(subBatch._id);
      expect(batchAfterAttempt1?.dispatchedCount).toBe(1);
      expect(batchAfterAttempt1?.recipients[0].status).toBe('dispatched');
      expect(batchAfterAttempt1?.recipients[1].status).toBe('queued');
      expect(batchAfterAttempt1?.recipients[2].status).toBe('queued');
      expect(mockEmailProvider.sentEmails.length).toBe(1);

      // Attempt 2: Restore DB and run retry
      vi.restoreAllMocks();
      const retryResult = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(retryResult.status).toBe('completed');
      expect(retryResult.dispatchedCount).toBe(5);

      // Total mock emails sent across both attempts:
      // Recipient 0 must NOT have been sent a second time!
      expect(mockEmailProvider.sentEmails.length).toBe(5);
      const uniqueRecipientEmails = new Set(mockEmailProvider.sentEmails.map((e) => e.to));
      expect(uniqueRecipientEmails.size).toBe(5); // Exactly 5 unique recipients, 0 duplicate sends!

      // Check wave telemetry is exactly 5 dispatched, 0 queued
      const finalWave = await EmailWave.findById(wave._id);
      expect(finalWave?.telemetry.dispatched).toBe(5);
      expect(finalWave?.telemetry.queued).toBe(0);
    });

    it('2.4 handles individual email provider failure with claimant cooldown backoff', async () => {
      const [claimant] = await createClaimants(1, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Email provider returns failure response (e.g. rate limit / SMTP rejection)
      mockEmailProvider.send = async () => ({
        success: false,
        error: '550 5.4.5 Daily user sending quota exceeded',
        provider: 'mock',
        recipient: claimant.email,
        timestamp: new Date()
      });

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.failedCount).toBe(1);
      expect(result.dispatchedCount).toBe(0);

      const freshClaimant = await Claimant.findById(claimant._id);
      expect(freshClaimant?.deliveryAttempts).toBe(1);
      expect(freshClaimant?.lastDeliveryError).toBe('550 5.4.5 Daily user sending quota exceeded');
      expect(freshClaimant?.nextRetryAt).toBeDefined();
      expect(freshClaimant?.bounced).toBe(false); // Transient quota is not a permanent bounce

      const finalWave = await EmailWave.findById(wave._id);
      expect(finalWave?.telemetry.failed).toBe(1);
      expect(finalWave?.telemetry.queued).toBe(0);
    });

    it('2.5 immediately pauses mid-subbatch when parent wave status transitions to paused', async () => {
      await createClaimants(10, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Intercept send to pause wave after 2nd recipient
      let sentCount = 0;
      const originalSend = mockEmailProvider.send.bind(mockEmailProvider);
      mockEmailProvider.send = async (options) => {
        sentCount++;
        if (sentCount === 2) {
          // Parent wave is paused concurrently by administrator
          await WaveControlService.pauseWave(wave.waveId, 'admin_1', 'Mid-batch pause');
        }
        return originalSend(options);
      };

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('paused');
      expect(result.dispatchedCount).toBe(2);

      const pausedBatch = await SubBatch.findById(subBatch._id);
      expect(pausedBatch?.status).toBe('paused');

      // Remaining recipients should still be queued
      const remainingQueued = pausedBatch?.recipients.filter((r) => r.status === 'queued');
      expect(remainingQueued?.length).toBe(8);
    });
  });

  // =========================================================================
  // 3. ORPHANED AND CORRUPTED CLAIMANTS IN SUB-BATCH COHORTS
  // =========================================================================
  describe('3. Orphaned and Corrupted Claimants in Sub-Batch Cohorts', () => {
    it('3.1 handles completely orphaned claimant records deleted from database without crashing', async () => {
      const claimants = await createClaimants(3, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Delete claimant #1 from database to simulate an orphaned reference
      await Claimant.findByIdAndDelete(claimants[1]._id);

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.dispatchedCount).toBe(2);
      expect(result.failedCount).toBe(1);

      const updatedBatch = await SubBatch.findById(subBatch._id);
      expect(updatedBatch?.recipients[1].status).toBe('failed');
      expect(updatedBatch?.recipients[1].error).toBe('Claimant record not found');

      // Wave telemetry must account for 2 dispatched and 1 failed
      const finalWave = await EmailWave.findById(wave._id);
      expect(finalWave?.telemetry.dispatched).toBe(2);
      expect(finalWave?.telemetry.failed).toBe(1);
      expect(finalWave?.telemetry.queued).toBe(0);
    });

    it('3.2 skips claimants whose payment selection status mutated to selected after batch generation', async () => {
      const claimants = await createClaimants(4, testCase._id);
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'urgent_warning_7d', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Claimant #0 completed payment preference selection between batch partition and dispatch
      await Claimant.updateOne(
        { _id: claimants[0]._id },
        { $set: { status: 'selected', selectedPaymentMethod: 'direct_deposit' } }
      );

      // Claimant #2 was marked disbursed
      await Claimant.updateOne(
        { _id: claimants[2]._id },
        { $set: { status: 'disbursed', selectedPaymentMethod: 'physical_check' } }
      );

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.skippedCompletedCount).toBe(2);
      expect(result.dispatchedCount).toBe(2);

      const updatedBatch = await SubBatch.findById(subBatch._id);
      expect(updatedBatch?.recipients[0].status).toBe('skipped_completed');
      expect(updatedBatch?.recipients[0].skipReason).toContain('Payment selection already completed');
      expect(updatedBatch?.recipients[2].status).toBe('skipped_completed');
      expect(updatedBatch?.recipients[1].status).toBe('dispatched');
      expect(updatedBatch?.recipients[3].status).toBe('dispatched');

      // Zero emails sent to completed claimants
      expect(mockEmailProvider.sentEmails.length).toBe(2);
      expect(mockEmailProvider.sentEmails.map((e) => e.to)).not.toContain(claimants[0].email);
      expect(mockEmailProvider.sentEmails.map((e) => e.to)).not.toContain(claimants[2].email);
    });
  });

  // =========================================================================
  // 4. LARGE-SCALE SUPPRESSION ENGINE, MIXED-CASE HASHING & DEDUPLICATION
  // =========================================================================
  describe('4. Large-Scale Suppression Engine, Mixed-Case Hashing & Deduplication', () => {
    it('4.1 matches mixed-case claimant emails against lowercased suppression list entries', async () => {
      // Create suppression entry with lowercase email
      await SuppressionList.create({
        email: 'suppressed.victim@example.com',
        reason: 'opt_out',
        source: 'claimant_opt_out',
        caseId: testCase._id
      });

      // Create claimant with uppercase / mixed-case email
      await createClaimants(1, testCase._id, {
        email: 'SUPPRESSED.VICTIM@EXAMPLE.COM'
      });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(1);
      expect(result.dispatchedCount).toBe(0);
      expect(mockEmailProvider.sentEmails.length).toBe(0);

      const updatedBatch = await SubBatch.findById(subBatch._id);
      expect(updatedBatch?.recipients[0].status).toBe('suppressed_bounced');
      expect(updatedBatch?.recipients[0].skipReason).toContain('Suppression list match: opt_out');
    });

    it('4.2 matches uppercase suppression list entries against lowercased claimant emails', async () => {
      // Create suppression entry with uppercase email (Mongoose model normalizes to lowercase)
      const suppDoc = await SuppressionList.create({
        email: 'HARD.BOUNCED.USER@DOMAIN.ORG',
        reason: 'hard_bounce',
        source: 'gmail_dsn'
      });
      expect(suppDoc.email).toBe('hard.bounced.user@domain.org'); // Model normalizer check

      await createClaimants(1, testCase._id, {
        email: 'hard.bounced.user@domain.org'
      });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.suppressedBouncedCount).toBe(1);
      expect(result.dispatchedCount).toBe(0);
    });

    it('4.3 strictly isolates matter-specific suppressions from unrelated cases while applying global suppressions', async () => {
      const emailA = 'case_a_suppressed@juris.com';
      const emailGlobal = 'global_suppressed@juris.com';
      const emailOtherCase = 'other_case_suppressed@juris.com';

      // 1. Case A specific suppression
      await SuppressionList.create({
        email: emailA,
        reason: 'complaint',
        caseId: testCase._id
      });

      // 2. Global suppression (caseId: null)
      await SuppressionList.create({
        email: emailGlobal,
        reason: 'opt_out',
        caseId: null
      });

      // 3. Other case suppression (caseId: otherCase._id)
      await SuppressionList.create({
        email: emailOtherCase,
        reason: 'bounced',
        caseId: otherCase._id
      });

      // Add claimants to testCase for all 3 emails
      await createClaimants(1, testCase._id, { email: emailA });
      await createClaimants(1, testCase._id, { email: emailGlobal });
      await createClaimants(1, testCase._id, { email: emailOtherCase });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(2); // emailA and emailGlobal
      expect(result.dispatchedCount).toBe(1); // emailOtherCase dispatched safely!

      expect(mockEmailProvider.sentEmails.length).toBe(1);
      expect(mockEmailProvider.sentEmails[0].to).toBe(emailOtherCase);
    });

    it('4.4 performs high-volume suppression lookup stress test across 500 entries', async () => {
      // Seed 500 suppression entries
      const suppressionEntries = [];
      for (let i = 0; i < 500; i++) {
        suppressionEntries.push({
          email: `bulk_suppressed_${i}@spam-blocklist.org`,
          reason: 'bounced',
          source: 'smtp_rejection',
          caseId: testCase._id
        });
      }
      await SuppressionList.insertMany(suppressionEntries);

      // Create 10 claimants: 5 on the suppression list, 5 clean
      const testClaimants = [];
      for (let i = 0; i < 5; i++) {
        testClaimants.push({
          caseId: testCase._id,
          claimId: `CLM-SUPP-HIT-${i}`,
          firstName: `Suppressed`,
          lastName: `User${i}`,
          email: `BULK_SUPPRESSED_${i * 10}@SPAM-BLOCKLIST.ORG`, // Mixed case hit
          settlementAmount: 100,
          status: 'pending_selection'
        });
      }
      for (let i = 0; i < 5; i++) {
        testClaimants.push({
          caseId: testCase._id,
          claimId: `CLM-CLEAN-${i}`,
          firstName: `Clean`,
          lastName: `User${i}`,
          email: `clean_recipient_${i}@legitimate-domain.com`,
          settlementAmount: 100,
          status: 'pending_selection'
        });
      }
      await Claimant.insertMany(testClaimants);

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      const startTime = Date.now();
      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });
      const elapsed = Date.now() - startTime;

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(5);
      expect(result.dispatchedCount).toBe(5);
      expect(elapsed).toBeLessThan(2000); // Must execute rapidly (< 2 seconds)

      expect(mockEmailProvider.sentEmails.length).toBe(5);
      expect(mockEmailProvider.sentEmails.every((e) => e.to.includes('legitimate-domain.com'))).toBe(true);
    });

    it('4.5 automatically traps RFC 5322 syntax failures and logs them into SuppressionList', async () => {
      // Create claimants using raw collection insert to bypass Mongoose schema validation for malformed emails
      const rawInvalidClaimants = [
        {
          caseId: testCase._id,
          claimId: 'CLM-SYN-1',
          firstName: 'Bad',
          lastName: 'Syntax1',
          email: 'invalid-email-no-at',
          settlementAmount: 100,
          status: 'pending_selection',
          bounced: false,
          emailSent: false
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-SYN-2',
          firstName: 'Bad',
          lastName: 'Syntax2',
          email: '@missing-local-part.com',
          settlementAmount: 100,
          status: 'pending_selection',
          bounced: false,
          emailSent: false
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-SYN-3',
          firstName: 'Bad',
          lastName: 'Syntax3',
          email: 'user..name@domain.com', // Consecutive dots fail RFC 5322
          settlementAmount: 100,
          status: 'pending_selection',
          bounced: false,
          emailSent: false
        },
        {
          caseId: testCase._id,
          claimId: 'CLM-SYN-4',
          firstName: 'Bad',
          lastName: 'Syntax4',
          email: 'user@-domain.com', // Leading hyphen in domain fails RFC 5322
          settlementAmount: 100,
          status: 'pending_selection',
          bounced: false,
          emailSent: false
        }
      ];

      await Claimant.collection.insertMany(rawInvalidClaimants);

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice', {
        throttling: { quietHoursEnabled: false }
      });
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId);

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(4);
      expect(result.dispatchedCount).toBe(0);

      const updatedBatch = await SubBatch.findById(subBatch._id);
      expect(updatedBatch?.recipients.every((r) => r.skipReason === 'RFC 5322 syntax failure')).toBe(true);

      const allClaimants = await Claimant.find({ caseId: testCase._id });
      expect(allClaimants.every((c) => c.bounced === true && c.bounceReason === 'RFC 5322 syntax failure')).toBe(true);
    });
  });

  // =========================================================================
  // 5. ZERO RECIPIENT WAVES & BOUNDARY CONDITIONS
  // =========================================================================
  describe('5. Zero Recipient Waves & Boundary Conditions', () => {
    it('5.1 handles partitioning for a case with 0 eligible claimants without creating orphan sub-batches', async () => {
      // 0 claimants created
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d');
      const batches = await CadenceService.partitionWaveSubBatches(wave.waveId);

      expect(batches.length).toBe(0);

      const updatedWave = await EmailWave.findById(wave._id);
      expect(updatedWave?.totalSubBatches).toBe(0);
      expect(updatedWave?.subBatches.length).toBe(0);
      expect(updatedWave?.telemetry.eligible).toBe(0);
      expect(updatedWave?.telemetry.queued).toBe(0);
    });

    it('5.2 resumes a zero-recipient wave and immediately marks it completed safely', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'final_notice_48h');
      await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Pause the wave
      await WaveControlService.pauseWave(wave.waveId);

      // Resume: should see 0 paused batches and completedSubBatches (0) >= totalSubBatches (0)
      const resumed = await WaveControlService.resumeWave(wave.waveId);
      expect(resumed.status).toBe('completed');
      expect(resumed.completedDate).toBeDefined();
    });

    it('5.3 previews schedule for empty case roster without division by zero or NaN values', async () => {
      const projection = await CadenceService.previewSchedule(testCase._id.toString());

      expect(projection.caseId).toBe(testCase._id.toString());
      expect(projection.estimatedTotalRecipients).toBe(0);
      expect(projection.estimatedTotalSubBatches).toBe(0);
      expect(projection.totalEligibleClaimants).toBe(0);

      for (const stage of projection.stages) {
        expect(stage.estimatedRecipients).toBe(0);
        expect(stage.subBatchCount).toBe(0);
        expect(stage.estimatedDurationMinutes).toBe(0);
        expect(isNaN(stage.estimatedRecipients)).toBe(false);
        expect(isNaN(stage.subBatchCount)).toBe(false);
      }
    });

    it('5.4 allows pause, reschedule and cancel operations on zero-recipient waves without errors', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'post_deadline_fallback');
      await CadenceService.partitionWaveSubBatches(wave.waveId);

      // Pause
      const paused = await WaveControlService.pauseWave(wave.waveId);
      expect(paused.status).toBe('paused');

      // Reschedule
      const future = new Date(Date.now() + 86400000 * 3);
      const rescheduled = await WaveControlService.rescheduleWave(wave.waveId, future);
      expect(rescheduled.status).toBe('rescheduled');

      // Cancel
      const cancelled = await WaveControlService.cancelWave(wave.waveId, 'Zero claimant cancel');
      expect(cancelled.status).toBe('cancelled');
    });
  });

  // =========================================================================
  // 6. END-TO-END CADENCE STAGE EVALUATION WITH ADVERSARIAL MULTI-STAGE RACING
  // =========================================================================
  describe('6. End-to-End Cadence Stage Evaluation with Multi-Stage Racing', () => {
    it('6.1 evaluates active cadence stages idempotently under consecutive evaluation passes', async () => {
      await createClaimants(20, testCase._id);

      // Create an active cadence document with a date_fixed stage scheduled in the past
      await NotificationCadence.create({
        caseId: testCase._id,
        lawFirmId: FIRM_ID,
        name: 'Evaluation Test Cadence',
        status: 'active',
        stages: [
          {
            stageKey: 'initial_notice',
            stageName: 'Initial Court-Approved Notice',
            enabled: true,
            triggerType: 'date_fixed',
            fixedDate: new Date(Date.now() - 3600000), // 1 hour ago (ready to trigger)
            templates: {
              en: { subject: 'Notice: {{case_name}}', bodyHtml: '<p>Hello {{claimant_first_name}}</p>' }
            },
            status: 'draft'
          }
        ]
      });

      // Pass 1: Should evaluate and create 1 wave (passing undefined data evaluates all active cadences)
      const pass1 = await executeEvaluateCadenceStages(undefined, { agenda });
      expect(pass1.wavesCreated).toBe(1);
      expect(pass1.subBatchesCreated).toBeGreaterThan(0);

      // Pass 2: Immediately run again - should detect existing wave / stage scheduled and NOT create duplicate waves
      const pass2 = await executeEvaluateCadenceStages(undefined, { agenda });
      expect(pass2.wavesCreated).toBe(0);
      expect(pass2.subBatchesCreated).toBe(0);

      // Verify exactly 1 wave exists in database for this case & stage
      const waveCount = await EmailWave.countDocuments({
        caseId: testCase._id,
        stage: 'initial_notice'
      });
      expect(waveCount).toBe(1);
    });
  });
});
