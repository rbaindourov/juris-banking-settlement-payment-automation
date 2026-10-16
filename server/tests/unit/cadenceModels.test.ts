import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  NotificationCadence,
  EmailWave,
  SubBatch,
  SuppressionList,
  Case
} from '../../src/models';

describe('Milestone 1: Cadence Data Models & Schema Invariants', () => {
  let testCaseId: mongoose.Types.ObjectId;
  let otherCaseId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    // 1. Establish isolated dynamic MongoDB database per-suite
    await setupTestDb('cadence_models');

    // 2. Synchronize native MongoDB indexes for new models
    await Promise.all([
      NotificationCadence.init(),
      EmailWave.init(),
      SubBatch.init(),
      SuppressionList.init()
    ]);
  });

  afterAll(async () => {
    await teardownTestDb('cadence_models');
  });

  beforeEach(async () => {
    await clearTestDb('cadence_models');

    // Seed parent cases for relational references
    testCaseId = new mongoose.Types.ObjectId();
    otherCaseId = new mongoose.Types.ObjectId();

    await Case.create({
      _id: testCaseId,
      name: 'In re Class Action Settlement',
      docketNumber: '1:26-cv-00123',
      lawFirmId: 'FIRM-001',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  // =========================================================================
  // 1. NotificationCadence Model
  // =========================================================================
  describe('1. NotificationCadence Model', () => {
    it('1.1 creates with valid minimal parameters and applies schema defaults', async () => {
      const cadence = await NotificationCadence.create({
        caseId: testCaseId,
        lawFirmId: 'FIRM-001'
      });

      expect(cadence._id).toBeDefined();
      expect(cadence.status).toBe('draft');
      expect(cadence.throttling.batchSize).toBe(500);
      expect(cadence.throttling.intervalMinutes).toBe(15);
      expect(cadence.throttling.rateLimitPerSecond).toBe(25);
      expect(cadence.suppression.skipCompletedPayments).toBe(true);
      expect(cadence.suppression.suppressBounced).toBe(true);
      expect(cadence.suppression.checkGlobalSuppression).toBe(true);
    });

    it('1.2 saves full 5-stage cadence with localized templates (EN, ES, ZH, VI) and merge tags', async () => {
      const fullCadence = await NotificationCadence.create({
        caseId: testCaseId,
        lawFirmId: 'FIRM-001',
        name: '5-Stage Rolling Cadence',
        status: 'active',
        stages: [
          {
            stageKey: 'initial_notice',
            stageName: 'Initial Notice',
            enabled: true,
            triggerType: 'date_fixed',
            fixedDate: new Date('2026-11-01T00:00:00Z'),
            templates: {
              en: {
                subject: 'Notice of Settlement - Action Required',
                bodyHtml: '<p>Dear {{claimant_first_name}}, claim {{settlement_amount}}.</p>'
              },
              es: {
                subject: 'Aviso de Liquidación - Acción Requerida',
                bodyHtml: '<p>Estimado/a {{claimant_first_name}}, reclame {{settlement_amount}}.</p>'
              },
              zh: {
                subject: '和解通知 - 需要处理',
                bodyHtml: '<p>尊敬的 {{claimant_first_name}}，请领取 {{settlement_amount}}。</p>'
              },
              vi: {
                subject: 'Thông Báo Giải Quyết Bồi Thường',
                bodyHtml: '<p>Kính gửi {{claimant_first_name}}, nhận {{settlement_amount}}.</p>'
              }
            }
          },
          {
            stageKey: 'reminder_14d',
            stageName: 'T-14 Days Reminder',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: -336,
            templates: {
              en: {
                subject: 'Reminder: 14 Days Remaining',
                bodyHtml: '<p><a href="{{payment_selection_link}}">Select Payment</a> before {{selection_deadline}}</p>'
              }
            }
          },
          {
            stageKey: 'urgent_warning_7d',
            stageName: 'T-7 Days Warning',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: -168,
            templates: {
              en: { subject: 'Urgent: 7 Days Remaining', bodyHtml: '<p>Action required.</p>' }
            }
          },
          {
            stageKey: 'final_notice_48h',
            stageName: 'T-48 Hours Notice',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: -48,
            templates: {
              en: { subject: 'Final Notice: 48 Hours Left', bodyHtml: '<p>Last chance.</p>' }
            }
          },
          {
            stageKey: 'post_deadline_fallback',
            stageName: 'Post Deadline Fallback',
            enabled: true,
            triggerType: 'deadline_relative',
            offsetHours: 24,
            templates: {
              en: { subject: 'Disbursement Confirmation', bodyHtml: '<p>Check mailed.</p>' }
            }
          }
        ],
        throttling: {
          batchSize: 200,
          intervalMinutes: 10,
          rateLimitPerSecond: 15,
          dailyCap: 10000,
          quietHoursStart: '22:00',
          quietHoursEnd: '06:00',
          timezone: 'America/Chicago'
        }
      });

      const found = await NotificationCadence.findById(fullCadence._id);
      expect(found).not.toBeNull();
      expect(found?.stages.length).toBe(5);
      expect(found?.stages[0].templates.zh?.subject).toBe('和解通知 - 需要处理');
      expect(found?.stages[0].templates.vi?.subject).toBe('Thông Báo Giải Quyết Bồi Thường');
      expect(found?.stages[0].templates.es?.subject).toBe('Aviso de Liquidación - Acción Requerida');
      expect(found?.stages[1].offsetHours).toBe(-336);
      expect(found?.throttling.batchSize).toBe(200);
    });

    it('1.3 rejects documents missing required caseId or lawFirmId', async () => {
      await expect(
        NotificationCadence.create({ lawFirmId: 'FIRM-001' })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        NotificationCadence.create({ caseId: testCaseId })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('1.4 rejects invalid enum values for status and stageKey', async () => {
      await expect(
        NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-001',
          status: 'invalid_status_enum' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-001',
          stages: [{ stageKey: 'unauthorized_stage' as any, stageName: 'Bad Stage' }]
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('1.5 rejects non-positive throttling values', async () => {
      await expect(
        NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-001',
          throttling: { batchSize: 0, intervalMinutes: 15 }
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-001',
          throttling: { batchSize: 500, intervalMinutes: -5 }
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('1.6 enforces compound unique index on caseId', async () => {
      await NotificationCadence.create({
        caseId: testCaseId,
        lawFirmId: 'FIRM-001'
      });

      await expect(
        NotificationCadence.create({
          caseId: testCaseId,
          lawFirmId: 'FIRM-002'
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });
  });

  // =========================================================================
  // 2. EmailWave Model & Telemetry Funnel
  // =========================================================================
  describe('2. EmailWave Model & Telemetry Funnel', () => {
    it('2.1 creates wave with valid parameters and initializes telemetry to 0', async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-CASE1-INIT-001',
        caseId: testCaseId,
        stage: 'initial_notice',
        stageName: 'Initial Notice',
        scheduledDate: new Date('2026-11-01T10:00:00Z')
      });

      expect(wave._id).toBeDefined();
      expect(wave.status).toBe('draft');
      expect(wave.telemetry.eligible).toBe(0);
      expect(wave.telemetry.queued).toBe(0);
      expect(wave.telemetry.dispatched).toBe(0);
      expect(wave.telemetry.skipped_completed).toBe(0);
      expect(wave.telemetry.suppressed_bounced).toBe(0);
      expect(wave.telemetry.failed).toBe(0);
      expect(wave.telemetry.opened).toBe(0);
      expect(wave.telemetry.clicked).toBe(0);
      expect(wave.controlState.isPaused).toBe(false);
    });

    it('2.2 rejects documents missing required fields or having invalid enums', async () => {
      await expect(
        EmailWave.create({
          caseId: testCaseId,
          stage: 'initial_notice'
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        EmailWave.create({
          waveId: 'WAVE-BAD-STATUS',
          caseId: testCaseId,
          stage: 'initial_notice',
          scheduledDate: new Date(),
          status: 'exploding' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('2.3 enforces uniqueness constraint on waveId', async () => {
      await EmailWave.create({
        waveId: 'WAVE-UNIQUE-101',
        caseId: testCaseId,
        stage: 'initial_notice',
        scheduledDate: new Date()
      });

      await expect(
        EmailWave.create({
          waveId: 'WAVE-UNIQUE-101',
          caseId: otherCaseId,
          stage: 'reminder_14d',
          scheduledDate: new Date()
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('2.4 updates operational control states (Pause, Resume, Reschedule, Cancel)', async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-CONTROL-TEST',
        caseId: testCaseId,
        stage: 'reminder_14d',
        status: 'scheduled',
        scheduledDate: new Date()
      });

      // Pause
      const pausedAt = new Date();
      const paused = await EmailWave.findByIdAndUpdate(
        wave._id,
        {
          $set: {
            status: 'paused',
            'controlState.isPaused': true,
            'controlState.pausedAt': pausedAt
          }
        },
        { new: true }
      );
      expect(paused?.status).toBe('paused');
      expect(paused?.controlState.isPaused).toBe(true);

      // Resume
      const resumed = await EmailWave.findByIdAndUpdate(
        wave._id,
        {
          $set: {
            status: 'in_progress',
            'controlState.isPaused': false,
            'controlState.resumedAt': new Date()
          }
        },
        { new: true }
      );
      expect(resumed?.status).toBe('in_progress');
      expect(resumed?.controlState.isPaused).toBe(false);

      // Reschedule
      const newDate = new Date(Date.now() + 86400000);
      const rescheduled = await EmailWave.findByIdAndUpdate(
        wave._id,
        {
          $set: {
            status: 'rescheduled',
            scheduledDate: newDate,
            'controlState.rescheduledAt': new Date()
          }
        },
        { new: true }
      );
      expect(rescheduled?.status).toBe('rescheduled');
      expect(rescheduled?.scheduledDate.getTime()).toBe(newDate.getTime());

      // Cancel
      const cancelled = await EmailWave.findByIdAndUpdate(
        wave._id,
        {
          $set: {
            status: 'cancelled',
            'controlState.cancelledAt': new Date(),
            'controlState.cancelReason': 'Case manager cancelled'
          }
        },
        { new: true }
      );
      expect(cancelled?.status).toBe('cancelled');
      expect(cancelled?.controlState.cancelReason).toBe('Case manager cancelled');
    });
  });

  // =========================================================================
  // 3. SubBatch Model & Partitioning Invariants
  // =========================================================================
  describe('3. SubBatch Model & Partitioning Invariants', () => {
    let waveId: mongoose.Types.ObjectId;

    beforeEach(async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-PARENT-001',
        caseId: testCaseId,
        stage: 'initial_notice',
        scheduledDate: new Date()
      });
      waveId = wave._id as mongoose.Types.ObjectId;
    });

    it('3.1 creates sub-batch with valid parameters and defaults', async () => {
      const subBatch = await SubBatch.create({
        subBatchId: 'SB-WAVE-001-0',
        waveId,
        caseId: testCaseId,
        chunkIndex: 0,
        totalChunks: 5,
        claimantIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
        recipientCount: 2,
        scheduledAt: new Date('2026-11-01T12:00:00Z')
      });

      expect(subBatch._id).toBeDefined();
      expect(subBatch.status).toBe('pending');
      expect(subBatch.dispatchedCount).toBe(0);
      expect(subBatch.skippedCompletedCount).toBe(0);
      expect(subBatch.suppressedBouncedCount).toBe(0);
      expect(subBatch.failedCount).toBe(0);
    });

    it('3.2 rejects missing required fields and negative chunkIndex or totalChunks', async () => {
      await expect(
        SubBatch.create({
          waveId,
          caseId: testCaseId,
          chunkIndex: 0
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        SubBatch.create({
          subBatchId: 'SB-NEG-INDEX',
          waveId,
          caseId: testCaseId,
          chunkIndex: -1,
          totalChunks: 5,
          scheduledAt: new Date()
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        SubBatch.create({
          subBatchId: 'SB-ZERO-TOTAL',
          waveId,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 0,
          scheduledAt: new Date()
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('3.3 enforces compound unique index on (waveId, chunkIndex)', async () => {
      await SubBatch.create({
        subBatchId: 'SB-WAVE-001-0',
        waveId,
        caseId: testCaseId,
        chunkIndex: 0,
        totalChunks: 3,
        scheduledAt: new Date()
      });

      await expect(
        SubBatch.create({
          subBatchId: 'SB-WAVE-001-0-DUP',
          waveId,
          caseId: testCaseId,
          chunkIndex: 0,
          totalChunks: 3,
          scheduledAt: new Date()
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('3.4 tracks status lifecycle and execution logs', async () => {
      const subBatch = await SubBatch.create({
        subBatchId: 'SB-LIFECYCLE-1',
        waveId,
        caseId: testCaseId,
        chunkIndex: 1,
        totalChunks: 3,
        scheduledAt: new Date()
      });

      const started = await SubBatch.findByIdAndUpdate(
        subBatch._id,
        {
          $set: {
            status: 'processing',
            startedAt: new Date()
          }
        },
        { new: true }
      );
      expect(started?.status).toBe('processing');
      expect(started?.startedAt).toBeDefined();

      const completed = await SubBatch.findByIdAndUpdate(
        subBatch._id,
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            dispatchedCount: 150,
            skippedCompletedCount: 5,
            suppressedBouncedCount: 2
          },
          $push: {
            executionLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Dispatched 150 emails'
            }
          }
        },
        { new: true }
      );
      expect(completed?.status).toBe('completed');
      expect(completed?.dispatchedCount).toBe(150);
      expect(completed?.skippedCompletedCount).toBe(5);
      expect(completed?.executionLogs.length).toBe(1);
      expect(completed?.executionLogs[0].message).toBe('Dispatched 150 emails');
    });
  });

  // =========================================================================
  // 4. SuppressionList Model & Email Normalization
  // =========================================================================
  describe('4. SuppressionList Model & Email Normalization', () => {
    it('4.1 automatically normalizes email to lowercase and trims whitespace', async () => {
      const entry = await SuppressionList.create({
        email: '  BOUNCED.USER+TEST@Domain.COM  ',
        reason: 'bounced',
        source: 'smtp_rejection'
      });

      expect(entry.email).toBe('bounced.user+test@domain.com');
      const found = await SuppressionList.findOne({ email: 'bounced.user+test@domain.com' });
      expect(found).not.toBeNull();
    });

    it('4.2 rejects missing email or invalid reason enum', async () => {
      await expect(
        SuppressionList.create({ reason: 'bounced' })
      ).rejects.toThrow(mongoose.Error.ValidationError);

      await expect(
        SuppressionList.create({
          email: 'valid@example.com',
          reason: 'unauthorized_reason' as any
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });

    it('4.3 enforces uniqueness constraint on email', async () => {
      await SuppressionList.create({
        email: 'duplicate.bounce@example.com',
        reason: 'bounced'
      });

      await expect(
        SuppressionList.create({
          email: 'DUPLICATE.BOUNCE@EXAMPLE.COM',
          reason: 'opt_out'
        })
      ).rejects.toThrow(/duplicate key|E11000/);
    });

    it('4.4 supports pre-dispatch filtering query across global and case scopes', async () => {
      // Global suppression
      await SuppressionList.create({
        email: 'global@bounced.com',
        reason: 'bounced'
      });

      // Case-scoped suppression
      await SuppressionList.create({
        email: 'casespecific@optout.com',
        caseId: testCaseId,
        reason: 'opt_out'
      });

      // Helper query simulating pre-dispatch filter
      async function checkSuppressed(email: string, caseScope: mongoose.Types.ObjectId): Promise<boolean> {
        const normalized = email.toLowerCase().trim();
        const found = await SuppressionList.findOne({
          email: normalized,
          $or: [{ caseId: null }, { caseId: caseScope }, { caseId: { $exists: false } }]
        });
        return !!found;
      }

      expect(await checkSuppressed('GLOBAL@bounced.com', testCaseId)).toBe(true);
      expect(await checkSuppressed('casespecific@optout.com', testCaseId)).toBe(true);
      expect(await checkSuppressed('casespecific@optout.com', otherCaseId)).toBe(false);
      expect(await checkSuppressed('clean.claimant@example.com', testCaseId)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Telemetry Atomic Increments & Concurrency
  // =========================================================================
  describe('5. Telemetry Atomic Increments & Concurrency', () => {
    it('5.1 increments wave telemetry counters atomically via $inc', async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-INC-TEST',
        caseId: testCaseId,
        stage: 'initial_notice',
        scheduledDate: new Date()
      });

      await EmailWave.findByIdAndUpdate(wave._id, {
        $inc: {
          'telemetry.dispatched': 250,
          'telemetry.skipped_completed': 15,
          'telemetry.suppressed_bounced': 5,
          'telemetry.failed': 1
        }
      });

      const updated = await EmailWave.findById(wave._id);
      expect(updated?.telemetry.dispatched).toBe(250);
      expect(updated?.telemetry.skipped_completed).toBe(15);
      expect(updated?.telemetry.suppressed_bounced).toBe(5);
      expect(updated?.telemetry.failed).toBe(1);
    });

    it('5.2 handles concurrent atomic increments without race-condition data loss', async () => {
      const wave = await EmailWave.create({
        waveId: 'WAVE-CONCURRENCY-TEST',
        caseId: testCaseId,
        stage: 'initial_notice',
        scheduledDate: new Date()
      });

      // 10 concurrent sub-batch update operations
      const operations = Array.from({ length: 10 }, () =>
        EmailWave.findByIdAndUpdate(wave._id, {
          $inc: {
            'telemetry.dispatched': 50,
            'telemetry.skipped_completed': 2,
            'telemetry.suppressed_bounced': 1
          }
        })
      );

      await Promise.all(operations);

      const finalWave = await EmailWave.findById(wave._id);
      expect(finalWave?.telemetry.dispatched).toBe(500); // 10 * 50
      expect(finalWave?.telemetry.skipped_completed).toBe(20); // 10 * 2
      expect(finalWave?.telemetry.suppressed_bounced).toBe(10); // 10 * 1
    });
  });

  // =========================================================================
  // 6. Model Barrel Exports & TypeScript Type Contracts
  // =========================================================================
  describe('6. Model Barrel Exports', () => {
    it('6.1 exports all models cleanly from server/src/models/index.ts', () => {
      expect(NotificationCadence).toBeDefined();
      expect(EmailWave).toBeDefined();
      expect(SubBatch).toBeDefined();
      expect(SuppressionList).toBeDefined();
      expect(Case).toBeDefined();
    });
  });
});
