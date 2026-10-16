import mongoose from 'mongoose';
import { Case, ICase } from '../models/Case';
import {
  NotificationCadence,
  INotificationCadence,
  createDefaultCadenceStages,
  ICadenceStage
} from '../models/NotificationCadence';
import { EmailWave, IEmailWave } from '../models/EmailWave';
import { SubBatch, ISubBatch } from '../models/SubBatch';
import { Claimant } from '../models/Claimant';
import {
  executeEvaluateCadenceStages,
  calculateTriggerDate
} from '../jobs/cadenceEvaluateStages.job';

export interface StagePreview {
  stageKey: string;
  stageName: string;
  triggerType: string;
  offsetHours: number;
  triggerDate: Date | null;
  estimatedRecipients: number;
  batchSize: number;
  subBatchCount: number;
  intervalMinutes: number;
  estimatedDurationMinutes: number;
  estimatedCompletionDate: Date | null;
}

export interface ScheduleProjection {
  caseId: string;
  caseName: string;
  disbursementDeadline: Date | null;
  throttling: any;
  stages: StagePreview[];
  projectedWaves?: StagePreview[];
  totalEligibleClaimants?: number;
  estimatedTotalRecipients: number;
  estimatedTotalSubBatches: number;
  estimatedCompletionDate: Date | null;
}

export class CadenceService {
  /**
   * Helper to locate a Case by MongoDB ObjectId or caseId string.
   */
  public static async findCase(caseIdentifier: string): Promise<ICase> {
    let caseDoc: ICase | null = null;
    if (mongoose.isValidObjectId(caseIdentifier)) {
      caseDoc = await Case.findById(caseIdentifier);
    }
    if (!caseDoc) {
      caseDoc = await Case.findOne({ caseId: caseIdentifier });
    }
    if (!caseDoc) {
      const err: any = new Error(`Case not found: ${caseIdentifier}`);
      err.statusCode = 404;
      throw err;
    }
    return caseDoc;
  }

  /**
   * Evaluates all cadence stages for a given case and schedules waves as necessary.
   */
  static async evaluateCaseStages(caseId: string): Promise<IEmailWave[]> {
    const caseDoc = await this.findCase(caseId);
    await executeEvaluateCadenceStages({ caseId: caseDoc._id.toString() });

    return EmailWave.find({
      $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
    })
      .sort({ scheduledDate: 1 })
      .exec();
  }

  /**
   * Computes schedule preview and projections without persisting changes to the database.
   */
  static async previewSchedule(
    caseId: string,
    customConfig?: {
      throttling?: any;
      stages?: any[];
    }
  ): Promise<ScheduleProjection> {
    const caseDoc = await this.findCase(caseId);

    let cadence = await NotificationCadence.findOne({
      $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
    });

    const defaultThrottling = {
      batchSize: 500,
      intervalMinutes: 15,
      rateLimitPerSecond: 25,
      dailyCap: 10000,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'UTC'
    };

    const effectiveThrottling = {
      ...defaultThrottling,
      ...((cadence?.throttling as any)?.toObject?.() || cadence?.throttling || {}),
      ...(customConfig?.throttling || {})
    };

    const effectiveStages: ICadenceStage[] = customConfig?.stages && customConfig.stages.length > 0
      ? customConfig.stages.map((s: any) => ({
          stageKey: s.stageKey,
          stageName: s.stageName || s.name || s.stageKey,
          enabled: s.enabled !== false,
          triggerType: s.triggerType || 'deadline_relative',
          offsetHours: s.offsetHours != null ? s.offsetHours : (s.offsetDays ? s.offsetDays * 24 : 0),
          fixedDate: s.fixedDate ? new Date(s.fixedDate) : undefined,
          templates: s.templates || { en: { subject: '', bodyHtml: '' } },
          status: 'draft' as const
        }))
      : (cadence?.stages?.length ? cadence.stages : createDefaultCadenceStages());

    const batchSize = Math.max(1, effectiveThrottling.batchSize || 500);
    const intervalMinutes = Math.max(1, effectiveThrottling.intervalMinutes || 15);

    const projectedStages: StagePreview[] = [];
    let estimatedTotalRecipients = 0;
    let estimatedTotalSubBatches = 0;
    let latestCompletionDate: Date | null = null;

    for (const stage of effectiveStages) {
      if (stage.enabled === false) continue;

      const triggerDate = calculateTriggerDate(stage, caseDoc, cadence);

      // Count eligible recipients for this stage
      let recipientCount = 0;
      const countFilter: any = { caseId: { $in: [caseDoc._id, caseDoc.caseId] } };

      if (stage.stageKey === 'post_deadline_fallback') {
        countFilter.status = { $in: ['deadline_expired', 'selected', 'queued_for_sftp', 'disbursed'] };
        countFilter.bounced = { $ne: true };
      } else {
        countFilter.status = 'pending_selection';
        countFilter.bounced = { $ne: true };
      }

      recipientCount = await Claimant.countDocuments(countFilter);

      const subBatchCount = recipientCount > 0 ? Math.ceil(recipientCount / batchSize) : 0;
      const durationMinutes = subBatchCount > 0 ? (subBatchCount - 1) * intervalMinutes : 0;

      let estimatedCompletionDate: Date | null = null;
      if (triggerDate) {
        estimatedCompletionDate = new Date(triggerDate.getTime() + durationMinutes * 60 * 1000);
        if (!latestCompletionDate || estimatedCompletionDate > latestCompletionDate) {
          latestCompletionDate = estimatedCompletionDate;
        }
      }

      estimatedTotalRecipients += recipientCount;
      estimatedTotalSubBatches += subBatchCount;

      projectedStages.push({
        stageKey: stage.stageKey,
        stageName: stage.stageName,
        triggerType: stage.triggerType,
        offsetHours: stage.offsetHours,
        triggerDate,
        estimatedRecipients: recipientCount,
        batchSize,
        subBatchCount,
        estimatedBatches: subBatchCount,
        intervalMinutes,
        estimatedDurationMinutes: durationMinutes,
        estimatedCompletionDate
      } as any);
    }

    const totalUniqueEligible = await Claimant.countDocuments({
      caseId: { $in: [caseDoc._id, caseDoc.caseId] },
      status: 'pending_selection',
      bounced: { $ne: true }
    });

    return {
      caseId: caseDoc._id.toString(),
      caseName: caseDoc.name,
      disbursementDeadline: caseDoc.disbursementDeadline ? new Date(caseDoc.disbursementDeadline) : null,
      throttling: effectiveThrottling,
      stages: projectedStages,
      projectedWaves: projectedStages,
      totalEligibleClaimants: totalUniqueEligible,
      estimatedTotalRecipients,
      estimatedTotalSubBatches,
      estimatedCompletionDate: latestCompletionDate
    };
  }

  /**
   * Helper to instantiate a wave for a specific stage.
   */
  static async createWaveForStage(
    caseId: string,
    stageKey: string,
    options?: { throttling?: any; stageName?: string; currentTime?: Date }
  ): Promise<IEmailWave> {
    const caseDoc = await this.findCase(caseId);
    const now = options?.currentTime || new Date();

    const waveId = `wave_${stageKey}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const cadence = await NotificationCadence.findOne({
      $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
    });

    const throttling = options?.throttling || cadence?.throttling || {
      batchSize: 500,
      intervalMinutes: 15,
      rateLimitPerSecond: 25,
      dailyCap: 10000,
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'UTC'
    };

    const stageObj = cadence?.stages?.find((s: any) => s.stageKey === stageKey);
    const stageName = options?.stageName || stageObj?.stageName || stageKey;

    const wave = new EmailWave({
      waveId,
      caseId: caseDoc._id,
      cadenceId: cadence?._id,
      stage: stageKey,
      stageName,
      status: 'scheduled',
      scheduledDate: now,
      actualStartTime: now,
      totalSubBatches: 0,
      completedSubBatches: 0,
      throttlingConfig: throttling,
      telemetry: {
        eligible: 0,
        queued: 0,
        dispatched: 0,
        skipped_completed: 0,
        suppressed_bounced: 0,
        failed: 0,
        opened: 0,
        clicked: 0
      },
      controlState: { isPaused: false },
      subBatches: []
    });

    await wave.save();
    return wave;
  }

  /**
   * Partitions a wave's eligible claimants into SubBatch records with interval scheduling.
   */
  static async partitionWaveSubBatches(
    waveId: string,
    options?: { batchSize?: number; intervalMinutes?: number; agenda?: any; currentTime?: Date }
  ): Promise<ISubBatch[]> {
    const now = options?.currentTime || new Date();
    const agenda = options?.agenda;

    let wave: IEmailWave | null = null;
    if (mongoose.isValidObjectId(waveId)) {
      wave = await EmailWave.findById(waveId);
    }
    if (!wave) {
      wave = await EmailWave.findOne({ waveId });
    }
    if (!wave) {
      const err: any = new Error(`EmailWave not found for identifier: ${waveId}`);
      err.statusCode = 404;
      throw err;
    }

    // If sub-batches are already created for this wave, return them
    const existingBatches = await SubBatch.find({ waveId: wave._id }).sort({ chunkIndex: 1 });
    if (existingBatches.length > 0) {
      return existingBatches;
    }

    const caseDoc = await Case.findById(wave.caseId);
    if (!caseDoc) {
      const err: any = new Error(`Case not found: ${wave.caseId}`);
      err.statusCode = 404;
      throw err;
    }

    // Determine eligible cohort
    const claimantQuery: any = { caseId: { $in: [caseDoc._id, caseDoc.caseId] } };
    if (wave.stage === 'initial_notice') {
      claimantQuery.status = 'pending_selection';
      claimantQuery.bounced = { $ne: true };
      claimantQuery.emailSent = { $ne: true };
    } else if (wave.stage === 'post_deadline_fallback') {
      claimantQuery.status = { $in: ['deadline_expired', 'selected', 'queued_for_sftp', 'disbursed'] };
      claimantQuery.bounced = { $ne: true };
    } else {
      claimantQuery.status = 'pending_selection';
      claimantQuery.bounced = { $ne: true };
    }

    const eligibleClaimants = await Claimant.find(claimantQuery).lean();
    const totalEligible = eligibleClaimants.length;

    const throttling: any = wave.throttlingConfig || {};
    const batchSize = Math.max(1, options?.batchSize || throttling.batchSize || 500);
    const intervalMinutes = Math.max(1, options?.intervalMinutes || throttling.intervalMinutes || 15);
    const totalChunks = totalEligible > 0 ? Math.ceil(totalEligible / batchSize) : 0;

    const createdBatches: ISubBatch[] = [];
    const subBatchIds: any[] = [];

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const chunk = eligibleClaimants.slice(chunkIndex * batchSize, (chunkIndex + 1) * batchSize);
      const subBatchScheduledAt = new Date(now.getTime() + chunkIndex * intervalMinutes * 60 * 1000);
      const subBatchId = `sub_${wave.waveId}_${chunkIndex}_${Math.random().toString(36).substring(2, 8)}`;

      const recipients = chunk.map((c: any) => ({
        claimantId: c._id,
        claimId: c.claimId,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        settlementAmount: c.settlementAmount,
        paymentSelectionToken: c.paymentSelectionToken || c.claimantToken,
        preferredLanguage: c.paymentDetails?.preferredLanguage || c.preferredLanguage || caseDoc.defaultLanguage || 'en',
        status: 'queued' as const
      }));

      const subBatch = new SubBatch({
        subBatchId,
        waveId: wave._id,
        caseId: caseDoc._id,
        chunkIndex,
        totalChunks,
        claimantIds: chunk.map((c: any) => c._id),
        recipients,
        status: 'pending',
        scheduledAt: subBatchScheduledAt,
        recipientCount: chunk.length,
        dispatchedCount: 0,
        skippedCompletedCount: 0,
        suppressedBouncedCount: 0,
        failedCount: 0,
        retryCount: 0,
        maxRetries: 5,
        executionLogs: [
          {
            timestamp: now,
            level: 'info',
            message: `SubBatch ${chunkIndex + 1}/${totalChunks} partitioned with ${chunk.length} claimants scheduled for ${subBatchScheduledAt.toISOString()}`
          }
        ]
      });

      if (agenda) {
        try {
          const job = await agenda.schedule(subBatchScheduledAt, 'wave:dispatch-subbatch', {
            waveId: wave.waveId,
            subBatchId: subBatch.subBatchId
          });
          subBatch.agendaJobId = job?.attrs?._id ? job.attrs._id.toString() : undefined;
        } catch {}
      }

      await subBatch.save();
      createdBatches.push(subBatch);
      subBatchIds.push(subBatch._id);
    }

    wave.subBatches = subBatchIds;
    wave.totalSubBatches = totalChunks;
    wave.telemetry.eligible = totalEligible;
    wave.telemetry.queued = totalEligible;
    await wave.save();

    return createdBatches;
  }
}
