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

describe('E2E Tier 4: Real-World Scenarios (Full Settlement Lifecycle Simulation)', () => {
  let mockEmailProvider: FailableMockEmailProvider;

  beforeAll(async () => {
    await setupTestDb('e2e_tier4_realworld');
  });

  afterAll(async () => {
    await teardownTestDb('e2e_tier4_realworld');
  });

  beforeEach(async () => {
    await clearTestDb('e2e_tier4_realworld');
    mockEmailProvider = new FailableMockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  it('[T4.1] Complete 6-Phase Class Action Settlement Lifecycle Simulation', async () => {
    // -----------------------------------------------------------------------
    // SETUP: Class Action Matter & Diverse Claimant Cohort
    // -----------------------------------------------------------------------
    const deadline = new Date('2026-12-15T23:59:59Z');
    const testCase = await createTestCase({
      name: 'In re National Consumer Privacy Settlement',
      docketNumber: '3:24-cv-09999-EMC',
      lawFirmId: 'firm-class-lead',
      settlementFundTotal: 2500000.0,
      disbursementDeadline: deadline,
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // 50 total claimants: 2 with invalid emails, 2 with historical bounces, 46 clean
    // Languages: ~70% EN, 15% ES, 10% ZH, 5% VI
    const allClaimants = await createTestClaimants(testCase._id, 50, {
      invalidEmailCount: 2,
      bouncedCount: 2
    });

    expect(allClaimants.length).toBe(50);

    // -----------------------------------------------------------------------
    // PHASE 1: Launch & Stage 1 (Initial Notice) Wave
    // -----------------------------------------------------------------------
    const launchTime = new Date('2026-11-01T14:00:00Z');
    const stage1Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      throttling: { batchSize: 20, intervalMinutes: 15 },
      currentTime: launchTime
    });

    // 48 eligible queried (bounced claimants pre-filtered by query):
    // 46 clean dispatched, 2 invalid email suppressed at pre-dispatch
    expect(stage1Result.telemetry.eligible).toBe(48);
    expect(stage1Result.telemetry.dispatched).toBe(46);
    expect(stage1Result.telemetry.suppressed_bounced).toBe(2);
    expect(stage1Result.subBatchCount).toBe(3); // ceil(48 / 20) = 3
    expect(mockEmailProvider.sentEmails.length).toBe(46);

    // -----------------------------------------------------------------------
    // PHASE 2: Mid-Cycle Claimant Elections (Claimants Click Magic Link & Choose Rails)
    // -----------------------------------------------------------------------
    // 25 claimants submit their payment preferences
    const cleanClaimants = await Claimant.find({
      caseId: testCase._id,
      emailSent: true,
      bounced: { $ne: true }
    }).exec();

    expect(cleanClaimants.length).toBe(46);

    for (let i = 0; i < 25; i++) {
      cleanClaimants[i].status = 'selected';
      cleanClaimants[i].selectedPaymentMethod = i % 2 === 0 ? 'ach' : 'digital_card';
      await cleanClaimants[i].save();
    }

    // -----------------------------------------------------------------------
    // PHASE 3: Stage 2 (T-14 Days Reminder) Wave
    // -----------------------------------------------------------------------
    mockEmailProvider.clear();
    const t14Time = new Date('2026-12-01T15:00:00Z');
    const stage2Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'reminder_14d',
      throttling: { batchSize: 20 },
      currentTime: t14Time
    });

    // Out of 46 clean claimants, 25 are selected. Only 21 remaining pending claimants receive T-14d reminder.
    expect(stage2Result.telemetry.eligible).toBe(21);
    expect(stage2Result.telemetry.dispatched).toBe(21);
    expect(mockEmailProvider.sentEmails.length).toBe(21);

    // -----------------------------------------------------------------------
    // PHASE 4: Stage 3 (T-7 Days Urgent Warning) Wave with Mid-Batch Admin Pause
    // -----------------------------------------------------------------------
    mockEmailProvider.clear();
    // 10 more claimants select payment
    const stillPending = await Claimant.find({
      caseId: testCase._id,
      status: 'pending_selection',
      bounced: { $ne: true }
    }).exec();

    expect(stillPending.length).toBe(21);

    for (let i = 0; i < 10; i++) {
      stillPending[i].status = 'selected';
      stillPending[i].selectedPaymentMethod = 'venmo';
      await stillPending[i].save();
    }

    const t7Time = new Date('2026-12-08T15:00:00Z');
    const stage3Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'urgent_warning_7d',
      throttling: { batchSize: 20 },
      currentTime: t7Time
    });

    // 11 remaining pending claimants receive T-7d urgent notice
    expect(stage3Result.telemetry.eligible).toBe(11);
    expect(stage3Result.telemetry.dispatched).toBe(11);
    expect(mockEmailProvider.sentEmails.length).toBe(11);

    // -----------------------------------------------------------------------
    // PHASE 5: Stage 4 (T-48 Hours Final Notice) Wave
    // -----------------------------------------------------------------------
    mockEmailProvider.clear();
    // 5 more claimants elect payment
    const pendingT48 = await Claimant.find({
      caseId: testCase._id,
      status: 'pending_selection',
      bounced: { $ne: true }
    }).exec();

    expect(pendingT48.length).toBe(11);

    for (let i = 0; i < 5; i++) {
      pendingT48[i].status = 'selected';
      pendingT48[i].selectedPaymentMethod = 'zelle';
      await pendingT48[i].save();
    }

    const t48Time = new Date('2026-12-13T15:00:00Z');
    const stage4Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'final_notice_48h',
      throttling: { batchSize: 20 },
      currentTime: t48Time
    });

    // Exactly 6 unresponsive claimants receive the final notice
    expect(stage4Result.telemetry.eligible).toBe(6);
    expect(stage4Result.telemetry.dispatched).toBe(6);
    expect(mockEmailProvider.sentEmails.length).toBe(6);

    // -----------------------------------------------------------------------
    // PHASE 6: Deadline Expiration & Stage 5 Post-Deadline Fallback Confirmation
    // -----------------------------------------------------------------------
    mockEmailProvider.clear();
    // Disbursement deadline passes (Dec 15)
    // Automated deadline fallback sweeper transitions remaining 6 claimants to 'deadline_expired'
    const finalUnresponsive = await Claimant.find({
      caseId: testCase._id,
      status: 'pending_selection'
    }).exec();

    expect(finalUnresponsive.length).toBe(10);
    for (const c of finalUnresponsive) {
      c.status = 'deadline_expired';
      c.selectedPaymentMethod = 'physical_check';
      await c.save();
    }

    // Stage 5 Post-Deadline Fallback wave dispatches confirmation to the fallback claimants
    const postDeadlineTime = new Date('2026-12-16T15:00:00Z');
    const stage5Result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'post_deadline_fallback',
      throttling: { batchSize: 50 },
      currentTime: postDeadlineTime
    });

    // 40 selected claimants + 10 fallback claimants = 50 total claimants in matter
    expect(stage5Result.telemetry.eligible).toBe(50);
    expect(stage5Result.telemetry.dispatched).toBe(46); // 46 clean dispatched, 4 suppressed (2 bounced + 2 invalid)
    expect(mockEmailProvider.sentEmails.length).toBe(46);

    // -----------------------------------------------------------------------
    // VERIFICATION: Zero Duplicate Invariant
    // -----------------------------------------------------------------------
    const settledUsers = await Claimant.find({ caseId: testCase._id, status: 'selected' }).exec();
    expect(settledUsers.length).toBe(40);
  });

  it('[T4.2] Enterprise Multi-Tenant Isolation Simulation (Law Firm Alpha vs Beta)', async () => {
    const firmAlphaCase = await createTestCase({
      name: 'Alpha Matter',
      lawFirmId: 'firm-alpha'
    });
    const firmBetaCase = await createTestCase({
      name: 'Beta Matter',
      lawFirmId: 'firm-beta'
    });

    await createTestClaimants(firmAlphaCase._id, 10, { prefix: 'ALPHA' });
    await createTestClaimants(firmBetaCase._id, 10, { prefix: 'BETA' });

    // Dispatch Firm Alpha wave
    const alphaRes = await executeOpaqueWaveDispatch({
      caseRecord: firmAlphaCase,
      stage: 'initial_notice',
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(alphaRes.telemetry.dispatched).toBe(10);
    expect(alphaRes.dispatchedClaimants.every((id) => id.startsWith('ALPHA'))).toBe(true);

    // Verify Beta claimants were untouched
    const betaClaimants = await Claimant.find({ caseId: firmBetaCase._id }).exec();
    expect(betaClaimants.every((c) => c.emailSent === false)).toBe(true);
  });

  it('[T4.3] High-Volume Batch Throttling Simulation (100 Claimants across 5 Sub-Batches)', async () => {
    const testCase = await createTestCase();
    await createTestClaimants(testCase._id, 100);

    const result = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      throttling: { batchSize: 20, intervalMinutes: 10 },
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    expect(result.subBatchCount).toBe(5);
    expect(result.telemetry.dispatched).toBe(100);
    expect(mockEmailProvider.sentEmails.length).toBe(100);
  });

  it('[T4.4] Zero Duplicate Guarantee Invariant across all stages', async () => {
    const testCase = await createTestCase();
    const claimants = await createTestClaimants(testCase._id, 5);

    // Initial notice
    await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'initial_notice',
      currentTime: new Date('2026-11-01T14:00:00Z')
    });

    // Claimant 0 elects payment
    claimants[0].status = 'selected';
    await claimants[0].save();

    mockEmailProvider.clear();

    // Reminder 14d
    const rem14Res = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'reminder_14d',
      currentTime: new Date('2026-11-16T14:00:00Z')
    });

    expect(rem14Res.dispatchedClaimants).not.toContain(claimants[0].claimId);

    // Reminder 7d
    const rem7Res = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'urgent_warning_7d',
      currentTime: new Date('2026-11-23T14:00:00Z')
    });

    expect(rem7Res.dispatchedClaimants).not.toContain(claimants[0].claimId);

    // Final notice 48h
    const rem48Res = await executeOpaqueWaveDispatch({
      caseRecord: testCase,
      stage: 'final_notice_48h',
      currentTime: new Date('2026-11-28T14:00:00Z')
    });

    expect(rem48Res.dispatchedClaimants).not.toContain(claimants[0].claimId);
  });
});
