import { Agenda } from 'agenda';
import mongoose from 'mongoose';
import { Case } from '../models/Case';
import { NotificationCadence, ICadenceStage } from '../models/NotificationCadence';
import { EmailWave } from '../models/EmailWave';
import { SubBatch } from '../models/SubBatch';
import { Claimant } from '../models/Claimant';

export interface CadenceEvaluateStagesData {
  caseId?: string;
}

export interface CadenceEvaluateStagesOptions {
  agenda?: Agenda;
  currentTime?: Date;
}

export interface CadenceEvaluateStagesResult {
  evaluatedCases: number;
  stagesEvaluated: number;
  wavesCreated: number;
  subBatchesCreated: number;
  details: Array<{
    caseId: string;
    stageKey: string;
    waveId: string;
    subBatchCount: number;
    scheduledDate: Date;
  }>;
}

export function calculateTriggerDate(stage: ICadenceStage, caseDoc: any, cadenceDoc: any): Date | null {
  if (stage.triggerType === 'date_fixed') {
    if (stage.fixedDate) return new Date(stage.fixedDate);
    return new Date(cadenceDoc?.createdAt || Date.now());
  }

  if (stage.triggerType === 'deadline_relative') {
    if (!caseDoc.disbursementDeadline) return null;
    const deadlineMs = new Date(caseDoc.disbursementDeadline).getTime();
    const offsetHours = stage.offsetHours != null ? stage.offsetHours : (stage.offsetDays ? stage.offsetDays * 24 : 0);
    return new Date(deadlineMs + offsetHours * 3600 * 1000);
  }

  return null;
}

export async function executeEvaluateCadenceStages(
  data?: CadenceEvaluateStagesData,
  options?: CadenceEvaluateStagesOptions
): Promise<CadenceEvaluateStagesResult> {
  const now = options?.currentTime || new Date();
  const agenda = options?.agenda;

  let targetCadences: any[] = [];
  if (data?.caseId) {
    const cadence = await NotificationCadence.findOne({
      $or: [
        { caseId: data.caseId },
        ...(mongoose.isValidObjectId(data.caseId) ? [{ _id: data.caseId }] : [])
      ],
      status: 'active'
    });
    if (cadence) targetCadences = [cadence];
  } else {
    targetCadences = await NotificationCadence.find({ status: 'active' });
  }

  let totalStagesEvaluated = 0;
  let totalWavesCreated = 0;
  let totalSubBatchesCreated = 0;
  const details: CadenceEvaluateStagesResult['details'] = [];

  for (const cadence of targetCadences) {
    const caseDoc = await Case.findOne({
      $or: [
        { _id: cadence.caseId },
        { caseId: cadence.caseId }
      ],
      status: 'active'
    });

    if (!caseDoc) continue;

    for (const stage of cadence.stages) {
      if (!stage.enabled) continue;
      if (['scheduled', 'in_progress', 'completed'].includes(stage.status)) continue;

      totalStagesEvaluated++;
      const triggerDate = calculateTriggerDate(stage, caseDoc, cadence);
      if (!triggerDate || now < triggerDate) continue;

      // Idempotency check in EmailWave
      const existingWave = await EmailWave.findOne({
        caseId: caseDoc._id,
        stage: stage.stageKey,
        status: { $in: ['scheduled', 'in_progress', 'completed'] }
      }).lean();

      if (existingWave) continue;

      // Determine eligible cohort for this stage
      const claimantQuery: any = { caseId: { $in: [caseDoc._id, caseDoc.caseId] } };
      if (stage.stageKey === 'initial_notice') {
        claimantQuery.status = 'pending_selection';
        claimantQuery.bounced = { $ne: true };
        claimantQuery.emailSent = { $ne: true };
      } else if (stage.stageKey === 'post_deadline_fallback') {
        claimantQuery.status = { $in: ['deadline_expired', 'selected', 'queued_for_sftp', 'disbursed'] };
        claimantQuery.bounced = { $ne: true };
      } else {
        claimantQuery.status = 'pending_selection';
        claimantQuery.bounced = { $ne: true };
      }

      const eligibleClaimants = await Claimant.find(claimantQuery).lean();
      const totalEligible = eligibleClaimants.length;

      const throttling = cadence.throttling || {};
      const batchSize = throttling.batchSize || 500;
      const intervalMinutes = throttling.intervalMinutes || 15;
      const totalChunks = totalEligible > 0 ? Math.ceil(totalEligible / batchSize) : 0;

      const waveId = `wave_${stage.stageKey}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const scheduledDate = triggerDate <= now ? now : triggerDate;

      const wave = new EmailWave({
        waveId,
        caseId: caseDoc._id,
        cadenceId: cadence._id,
        stage: stage.stageKey,
        stageName: stage.stageName,
        status: 'scheduled',
        scheduledDate,
        actualStartTime: now,
        totalSubBatches: totalChunks,
        completedSubBatches: 0,
        throttlingConfig: throttling,
        telemetry: {
          eligible: totalEligible,
          queued: totalEligible,
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
      totalWavesCreated++;

      const subBatchIds: any[] = [];
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const chunk = eligibleClaimants.slice(chunkIndex * batchSize, (chunkIndex + 1) * batchSize);
        const subBatchScheduledAt = new Date(now.getTime() + chunkIndex * intervalMinutes * 60 * 1000);
        const subBatchId = `sub_${waveId}_${chunkIndex}_${Math.random().toString(36).substring(2, 8)}`;

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
              message: `SubBatch ${chunkIndex + 1}/${totalChunks} created with ${chunk.length} claimants scheduled for ${subBatchScheduledAt.toISOString()}`
            }
          ]
        });

        if (agenda) {
          const job = await agenda.schedule(subBatchScheduledAt, 'wave:dispatch-subbatch', {
            waveId: wave.waveId,
            subBatchId: subBatch.subBatchId
          });
          subBatch.agendaJobId = job?.attrs?._id ? job.attrs._id.toString() : undefined;
        }

        await subBatch.save();
        subBatchIds.push(subBatch._id);
        totalSubBatchesCreated++;
      }

      wave.subBatches = subBatchIds;
      await wave.save();

      stage.status = 'scheduled';
      stage.activeWaveId = wave.waveId;
      stage.lastEvaluatedAt = now;
      cadence.markModified('stages');
      await cadence.save();

      details.push({
        caseId: caseDoc._id.toString(),
        stageKey: stage.stageKey,
        waveId: wave.waveId,
        subBatchCount: totalChunks,
        scheduledDate
      });
    }
  }

  return {
    evaluatedCases: targetCadences.length,
    stagesEvaluated: totalStagesEvaluated,
    wavesCreated: totalWavesCreated,
    subBatchesCreated: totalSubBatchesCreated,
    details
  };
}

export function defineCadenceEvaluateStages(agenda: Agenda): void {
  agenda.define(
    'cadence:evaluate-stages',
    async (job: any) => {
      await executeEvaluateCadenceStages(job.attrs?.data, { agenda });
    },
    { concurrency: 2, lockLifetime: 120000 }
  );
}
