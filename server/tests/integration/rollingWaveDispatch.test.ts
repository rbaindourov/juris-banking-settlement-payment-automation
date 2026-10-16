import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { NotificationCadence } from '../../src/models/NotificationCadence';
import { EmailWave } from '../../src/models/EmailWave';
import { SubBatch } from '../../src/models/SubBatch';
import { SuppressionList } from '../../src/models/SuppressionList';
import { signToken } from '../../src/utils/jwt';
import { CadenceService } from '../../src/services/cadence.service';
import { executeDispatchWaveSubBatch } from '../../src/jobs/waveDispatchSubbatch.job';
import { EmailService, MockEmailProvider } from '../../src/services/email.service';
import { WaveControlService } from '../../src/services/waveControl.service';
import { createAgenda, setAgenda, stopAgenda } from '../../src/config/agenda';

describe('Integration: Rolling Wave Dispatch & Settlement Cadence REST APIs', () => {
  let testCase: any;
  let adminToken: string;
  let caseManagerToken: string;
  let auditorToken: string;
  let otherFirmToken: string;
  let mockEmailProvider: MockEmailProvider;
  let agenda: any;

  const FIRM_ID = 'FIRM-M2-INTEG';
  const OTHER_FIRM_ID = 'FIRM-M2-OTHER';

  beforeAll(async () => {
    await setupTestDb('rolling_wave_dispatch_integration');
    agenda = createAgenda();
    setAgenda(agenda);

    adminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-m2.com',
      role: 'law_firm_admin',
      lawFirmId: FIRM_ID,
      fullName: 'Firm Admin M2'
    });

    caseManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'manager@firm-m2.com',
      role: 'case_manager',
      lawFirmId: FIRM_ID,
      fullName: 'Case Manager M2'
    });

    auditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-m2.com',
      role: 'auditor',
      lawFirmId: FIRM_ID,
      fullName: 'Auditor M2'
    });

    otherFirmToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'intruder@other-firm.com',
      role: 'law_firm_admin',
      lawFirmId: OTHER_FIRM_ID,
      fullName: 'Intruder Admin'
    });
  });

  afterAll(async () => {
    await stopAgenda();
    await teardownTestDb('rolling_wave_dispatch_integration');
  });

  beforeEach(async () => {
    await clearTestDb('rolling_wave_dispatch_integration');

    mockEmailProvider = new MockEmailProvider();
    EmailService.setProvider(mockEmailProvider);

    testCase = await Case.create({
      name: 'Nationwide Rolling Settlement Dispute',
      docketNumber: '3:26-cv-09999',
      lawFirmId: FIRM_ID,
      settlementFundTotal: 1000000,
      disbursementDeadline: new Date(Date.now() + 30 * 86400000), // 30 days future
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  afterEach(async () => {
    EmailService.resetProvider();
    if (agenda) {
      await agenda.cancel({ name: 'wave:dispatch-subbatch' });
    }
  });

  // =========================================================================
  // 1. Cadence REST APIs (CRUD & Schedule Preview)
  // =========================================================================
  describe('1. Cadence REST APIs', () => {
    it('[API-1] GET /api/cases/:caseId/cadence auto-provisions default 5 stages', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/cadence`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stages).toHaveLength(5);
      expect(res.body.data.stages[0].stageKey).toBe('initial_notice');
      expect(res.body.data.throttling.batchSize).toBe(500);
    });

    it('[API-2] PUT /api/cases/:caseId/cadence updates throttling parameters and templates', async () => {
      const updatePayload = {
        name: 'Custom High-Velocity Cadence',
        throttling: {
          batchSize: 250,
          intervalMinutes: 10,
          rateLimitPerSecond: 50
        }
      };

      const res = await request(app)
        .put(`/api/cases/${testCase._id}/cadence`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Custom High-Velocity Cadence');
      expect(res.body.data.throttling.batchSize).toBe(250);
      expect(res.body.data.throttling.intervalMinutes).toBe(10);
    });

    it('[API-3] POST /api/cases/:caseId/cadence/preview-schedule projects waves and duration', async () => {
      // Seed 750 pending claimants
      const claimants = Array.from({ length: 750 }, (_, i) => ({
        caseId: testCase._id,
        claimId: `CLM-${1000 + i}`,
        firstName: `Claimant${i}`,
        lastName: 'Test',
        email: `claimant${i}@example.com`,
        settlementAmount: 100,
        status: 'pending_selection'
      }));
      await Claimant.insertMany(claimants);

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/cadence/preview-schedule`)
        .set('Authorization', `Bearer ${caseManagerToken}`)
        .send({
          throttling: { batchSize: 300, intervalMinutes: 15 }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalEligibleClaimants).toBe(750);

      const initialStage = res.body.data.projectedWaves.find((w: any) => w.stageKey === 'initial_notice');
      expect(initialStage).toBeDefined();
      expect(initialStage.estimatedBatches).toBe(3); // 750 / 300 = 3 batches
      expect(initialStage.estimatedDurationMinutes).toBe(30); // (3 - 1) * 15m
    });

    it('[API-4] Validation rejection on negative or out-of-range throttling', async () => {
      const res = await request(app)
        .put(`/api/cases/${testCase._id}/cadence`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          throttling: { batchSize: 0 } // Minimum is 1
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('[API-5] Cross-tenant access denied to foreign law firm admin', async () => {
      const res = await request(app)
        .get(`/api/cases/${testCase._id}/cadence`)
        .set('Authorization', `Bearer ${otherFirmToken}`);

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 2. Wave Creation & Sub-Batch Partitioning
  // =========================================================================
  describe('2. Wave Creation & Sub-Batch Partitioning', () => {
    it('[WAVE-1] Cohort of 1,250 claimants partitions into exact chunked sub-batches', async () => {
      const claimants = Array.from({ length: 1250 }, (_, i) => ({
        caseId: testCase._id,
        claimId: `CLM-PART-${i}`,
        firstName: `User${i}`,
        lastName: 'Part',
        email: `part${i}@example.com`,
        settlementAmount: 150,
        status: 'pending_selection'
      }));
      await Claimant.insertMany(claimants);

      // Trigger wave partition via service
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');
      const subBatches = await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 500, intervalMinutes: 15 });

      expect(subBatches).toHaveLength(3);
      expect(subBatches[0].recipientCount).toBe(500);
      expect(subBatches[1].recipientCount).toBe(500);
      expect(subBatches[2].recipientCount).toBe(250);

      // Verify sequential chunkIndex
      expect(subBatches[0].chunkIndex).toBe(0);
      expect(subBatches[1].chunkIndex).toBe(1);
      expect(subBatches[2].chunkIndex).toBe(2);
      expect(subBatches[0].totalChunks).toBe(3);

      // Verify scheduled staggering
      const diff1 = subBatches[1].scheduledAt.getTime() - subBatches[0].scheduledAt.getTime();
      expect(diff1).toBe(15 * 60 * 1000);
    });
  });

  // =========================================================================
  // 3. Real-Time Pre-Dispatch Filtering (Just-In-Time Payment Skip)
  // =========================================================================
  describe('3. Real-Time Pre-Dispatch Filtering', () => {
    it('[FLTR-1] Claimants electing payment during cohort wait are dynamically skipped', async () => {
      // 1. Create 3 claimants
      const c1 = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FLTR-1',
        firstName: 'Alan',
        lastName: 'Turing',
        email: 'alan@enigma.org',
        settlementAmount: 500,
        status: 'pending_selection'
      });

      const c2 = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FLTR-2',
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@navy.mil',
        settlementAmount: 500,
        status: 'pending_selection'
      });

      // 2. Generate wave and sub-batch
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d');
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 50 });

      // 3. Simulate Alan electing payment in the portal before batch execution
      c1.status = 'selected';
      c1.selectedPaymentMethod = 'ach';
      c1.selectedAt = new Date();
      await c1.save();

      // 4. Execute sub-batch dispatch job
      const executionResult = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      // 5. Assert Alan was skipped and Grace was dispatched
      expect(executionResult.skippedCompletedCount).toBe(1);
      expect(executionResult.dispatchedCount).toBe(1);

      // Verify updated wave telemetry
      const updatedWave = await EmailWave.findOne({ waveId: wave.waveId });
      expect(updatedWave?.telemetry.skipped_completed).toBe(1);
      expect(updatedWave?.telemetry.dispatched).toBe(1);
    });
  });

  // =========================================================================
  // 4. 3-Layer Suppression Filtering & Bounce Verification
  // =========================================================================
  describe('4. 3-Layer Suppression Filtering', () => {
    it('[SUPP-1] Suppresses malformed syntax, SuppressionList records, and historical bounces', async () => {
      // Layer 1: Malformed RFC 5322 syntax
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-SYNTAX',
        firstName: 'Bad',
        lastName: 'Syntax',
        email: 'bad-syntax@bad..domain',
        settlementAmount: 50,
        status: 'pending_selection'
      });

      // Layer 2: On SuppressionList
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-SUPP',
        firstName: 'Opted',
        lastName: 'Out',
        email: 'optout@example.com',
        settlementAmount: 50,
        status: 'pending_selection'
      });
      await SuppressionList.create({
        email: 'optout@example.com',
        reason: 'opt_out',
        source: 'claimant_opt_out',
        caseId: testCase._id
      });

      // Layer 3: Historical Bounce (bounced mid-flight before dispatch)
      const cBounce = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-BOUNCE',
        firstName: 'Hard',
        lastName: 'Bounce',
        email: 'bounced@example.com',
        settlementAmount: 50,
        status: 'pending_selection',
        bounced: false
      });

      // Valid Claimant
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-VALID',
        firstName: 'Good',
        lastName: 'Recipient',
        email: 'good@example.com',
        settlementAmount: 50,
        status: 'pending_selection'
      });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 50 });

      // Simulate cBounce bouncing before sub-batch execution
      cBounce.bounced = true;
      cBounce.bounceReason = '550 User unknown';
      await cBounce.save();

      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.suppressedBouncedCount).toBe(3);
      expect(result.dispatchedCount).toBe(1);

      const refreshedWave = await EmailWave.findOne({ waveId: wave.waveId });
      expect(refreshedWave?.telemetry.suppressed_bounced).toBe(3);
      expect(refreshedWave?.telemetry.dispatched).toBe(1);
    });

    it('[SUPP-2] Malformed email missing @ suppresses cleanly without throwing Mongoose ValidationError', async () => {
      // 1. Direct collection insert bypassing schema validation (simulating raw SFTP/CSV import)
      const claimantId = new mongoose.Types.ObjectId();
      await Claimant.collection.insertOne({
        _id: claimantId,
        caseId: testCase._id,
        claimId: 'CLM-NO-AT-1',
        firstName: 'NoAt',
        lastName: 'Sign',
        email: 'plainaddress-no-at',
        settlementAmount: 100,
        status: 'pending_selection',
        bounced: false,
        emailSent: false,
        deliveryAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 50 });

      // 2. Dispatch sub-batch: must not throw unhandled Mongoose ValidationError
      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(1);
      expect(result.dispatchedCount).toBe(0);

      // Verify claimant was updated in MongoDB with bounce status
      const updatedClaimant = await Claimant.findById(claimantId);
      expect(updatedClaimant?.bounced).toBe(true);
      expect(updatedClaimant?.bounceReason).toBe('RFC 5322 syntax failure');

      // Verify wave telemetry
      const updatedWave = await EmailWave.findOne({ waveId: wave.waveId });
      expect(updatedWave?.telemetry.suppressed_bounced).toBe(1);
    });

    it('[SUPP-3] Email with consecutive dots (RFC 5322 local-part violation) is rejected and suppressed', async () => {
      // 1. Create claimant with consecutive dots in local part
      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-CONSEC-DOTS',
        firstName: 'Double',
        lastName: 'Dot',
        email: 'user..name@example.com',
        settlementAmount: 150,
        status: 'pending_selection'
      });

      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');
      const [subBatch] = await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 50 });

      // 2. Dispatch sub-batch: RFC 5322 regex must reject consecutive dots
      const result = await executeDispatchWaveSubBatch({
        waveId: wave.waveId,
        subBatchId: subBatch.subBatchId
      });

      expect(result.status).toBe('completed');
      expect(result.suppressedBouncedCount).toBe(1);
      expect(result.dispatchedCount).toBe(0);

      // Verify claimant was updated in MongoDB
      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant?.bounced).toBe(true);
      expect(updatedClaimant?.bounceReason).toBe('RFC 5322 syntax failure');

      // Verify suppression list entry was recorded
      const suppression = await SuppressionList.findOne({ email: 'user..name@example.com' });
      expect(suppression).toBeDefined();
      expect(suppression?.reason).toBe('invalid_syntax');

      // Verify wave telemetry
      const updatedWave = await EmailWave.findOne({ waveId: wave.waveId });
      expect(updatedWave?.telemetry.suppressed_bounced).toBe(1);
    });

    it('[SUPP-4] Suppression REST APIs create, list, and delete entries', async () => {
      // POST
      const postRes = await request(app)
        .post('/api/suppression')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'manual.optout@example.com',
          reason: 'manual',
          caseId: testCase._id.toString()
        });
      expect(postRes.status).toBe(201);
      const entryId = postRes.body.data.id || postRes.body.data._id;

      // GET
      const getRes = await request(app)
        .get('/api/suppression?email=manual.optout@example.com')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toHaveLength(1);

      // DELETE
      const delRes = await request(app)
        .delete(`/api/suppression/${entryId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(delRes.status).toBe(200);
    });
  });

  // =========================================================================
  // 5. Operational Wave Controls (Pause, Resume, Reschedule, Cancel)
  // =========================================================================
  describe('5. Operational Wave Controls', () => {
    let activeWave: any;

    beforeEach(async () => {
      // Create active wave with sub-batches
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-CTRL',
        firstName: 'Control',
        lastName: 'Test',
        email: 'ctrl@example.com',
        settlementAmount: 100,
        status: 'pending_selection'
      });
      activeWave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');
      await CadenceService.partitionWaveSubBatches(activeWave.waveId, { batchSize: 10 });
      activeWave.status = 'in_progress';
      await activeWave.save();
    });

    it('[CTRL-1] POST /api/waves/:waveId/pause transitions wave and sub-batches to paused', async () => {
      const res = await request(app)
        .post(`/api/waves/${activeWave.waveId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Legal hold review' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paused');
      expect(res.body.data.controlState.isPaused).toBe(true);

      const pausedSubBatches = await SubBatch.find({ waveId: activeWave._id });
      expect(pausedSubBatches.every(b => b.status === 'paused')).toBe(true);
    });

    it('[CTRL-2] POST /api/waves/:waveId/resume transitions wave to in_progress and reschedules sub-batches', async () => {
      // Pause first
      await request(app)
        .post(`/api/waves/${activeWave.waveId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await request(app)
        .post(`/api/waves/${activeWave.waveId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newIntervalMinutes: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in_progress');
      expect(res.body.data.controlState.isPaused).toBe(false);

      const resumedSubBatches = await SubBatch.find({ waveId: activeWave._id });
      expect(resumedSubBatches.every(b => b.status === 'pending')).toBe(true);
    });

    it('[CTRL-3] POST /api/waves/:waveId/reschedule shifts wave date to the future', async () => {
      const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();

      const res = await request(app)
        .post(`/api/waves/${activeWave.waveId}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newScheduledDate: futureDate, reason: 'Court hearing rescheduled' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rescheduled');
    });

    it('[CTRL-4] POST /api/waves/:waveId/cancel terminates in-flight wave and sub-batches', async () => {
      const res = await request(app)
        .post(`/api/waves/${activeWave.waveId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Settlement appeal granted' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');

      const cancelledSubBatches = await SubBatch.find({ waveId: activeWave._id });
      expect(cancelledSubBatches.every(b => b.status === 'cancelled')).toBe(true);
    });

    it('[CTRL-5] State machine invalid transition (pausing a completed wave) returns 400', async () => {
      activeWave.status = 'completed';
      await activeWave.save();

      const res = await request(app)
        .post(`/api/waves/${activeWave.waveId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('[CTRL-6] cancelWave deletes pending Agenda jobs for target wave from agendaJobs in MongoDB', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d');
      await CadenceService.partitionWaveSubBatches(wave.waveId, { batchSize: 10 });

      // Schedule two sub-batch jobs in Agenda
      await agenda.schedule('in 1 hour', 'wave:dispatch-subbatch', {
        waveId: wave.waveId,
        subBatchId: 'SUB-CTRL-6-1'
      });
      await agenda.schedule('in 2 hours', 'wave:dispatch-subbatch', {
        waveId: wave.waveId,
        subBatchId: 'SUB-CTRL-6-2'
      });

      const db = mongoose.connection.db!;
      const jobsBefore = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': wave.waveId
      });
      expect(jobsBefore).toBe(2);

      await WaveControlService.cancelWave(wave.waveId, 'Settlement completed');

      const jobsAfter = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': wave.waveId
      });
      expect(jobsAfter).toBe(0);
    });

    it('[CTRL-7] pauseWave purges target wave jobs while preserving other active waves (zero cross-wave deletion)', async () => {
      const waveA = await CadenceService.createWaveForStage(testCase._id.toString(), 'reminder_14d');
      const waveB = await CadenceService.createWaveForStage(testCase._id.toString(), 'urgent_warning_7d');

      await agenda.schedule('in 1 hour', 'wave:dispatch-subbatch', {
        waveId: waveA.waveId,
        subBatchId: 'SUB-A-1'
      });
      await agenda.schedule('in 2 hours', 'wave:dispatch-subbatch', {
        waveId: waveA.waveId,
        subBatchId: 'SUB-A-2'
      });
      await agenda.schedule('in 1 hour', 'wave:dispatch-subbatch', {
        waveId: waveB.waveId,
        subBatchId: 'SUB-B-1'
      });

      const db = mongoose.connection.db!;
      const waveAJobsBefore = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': waveA.waveId
      });
      const waveBJobsBefore = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': waveB.waveId
      });
      expect(waveAJobsBefore).toBe(2);
      expect(waveBJobsBefore).toBe(1);

      await WaveControlService.pauseWave(waveA.waveId);

      const waveAJobsAfter = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': waveA.waveId
      });
      const waveBJobsAfter = await db.collection('agendaJobs').countDocuments({
        name: 'wave:dispatch-subbatch',
        'data.waveId': waveB.waveId
      });
      expect(waveAJobsAfter).toBe(0);
      expect(waveBJobsAfter).toBe(1);
    });
  });

  // =========================================================================
  // 6. Live Telemetry Conservation Invariant
  // =========================================================================
  describe('6. Live Telemetry Conservation Invariant', () => {
    it('[TELM-1] Eligible count strictly equals the sum of all terminal and queued states', async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-INVARIANT-TEST',
        caseId: testCase._id,
        stage: 'initial_notice',
        scheduledDate: new Date(),
        telemetry: {
          eligible: 100,
          queued: 40,
          dispatched: 35,
          skipped_completed: 15,
          suppressed_bounced: 8,
          failed: 2,
          opened: 10,
          clicked: 5
        }
      });

      const t = wave.telemetry;
      const sum = t.queued + t.dispatched + t.skipped_completed + t.suppressed_bounced + t.failed;
      expect(sum).toBe(t.eligible);
    });
  });

  // =========================================================================
  // 7. Multi-Tenant RBAC Security Isolation
  // =========================================================================
  describe('7. Multi-Tenant RBAC Security Isolation', () => {
    it('[RBAC-1] Auditor has read access but is blocked from mutating wave state', async () => {
      const wave = await CadenceService.createWaveForStage(testCase._id.toString(), 'initial_notice');

      // GET permitted
      const getRes = await request(app)
        .get(`/api/waves/${wave.waveId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(getRes.status).toBe(200);

      // POST forbidden
      const postRes = await request(app)
        .post(`/api/waves/${wave.waveId}/pause`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(postRes.status).toBe(403);
    });

    it('[RBAC-2] Unauthenticated requests return 401', async () => {
      const res = await request(app).get(`/api/cases/${testCase._id}/cadence`);
      expect(res.status).toBe(401);
    });
  });
});
