import mongoose from 'mongoose';
import { EmailWave, IEmailWave } from '../models/EmailWave';
import { SubBatch } from '../models/SubBatch';
import { getAgenda } from '../config/agenda';

export class WaveControlService {
  /**
   * Helper to locate an EmailWave by waveId string or MongoDB ObjectId.
   */
  private static async findWave(waveId: string): Promise<IEmailWave> {
    let wave: IEmailWave | null = null;
    if (mongoose.isValidObjectId(waveId)) {
      wave = await EmailWave.findById(waveId);
    }
    if (!wave) {
      wave = await EmailWave.findOne({ waveId });
    }
    if (!wave) {
      const err: any = new Error(`Wave not found for identifier: ${waveId}`);
      err.statusCode = 404;
      throw err;
    }
    return wave;
  }

  /**
   * Pauses an active or scheduled wave, canceling pending Agenda jobs and marking in-flight sub-batches paused.
   */
  static async pauseWave(waveId: string, _adminUserId?: string, _reason?: string): Promise<IEmailWave> {
    const wave = await this.findWave(waveId);

    // Idempotent return if already paused
    if (wave.status === 'paused') {
      return wave;
    }

    if (wave.status === 'completed' || wave.status === 'cancelled') {
      const err: any = new Error(`Cannot pause wave in status '${wave.status}'`);
      err.statusCode = 400;
      throw err;
    }

    wave.status = 'paused';
    wave.controlState = wave.controlState || { isPaused: false };
    wave.controlState.isPaused = true;
    wave.controlState.pausedAt = new Date();
    await wave.save();

    await SubBatch.updateMany(
      { waveId: wave._id, status: { $in: ['pending', 'queued', 'in_progress', 'processing'] } },
      { $set: { status: 'paused' } }
    );

    try {
      const agenda = getAgenda();
      await agenda.cancel({
        name: 'wave:dispatch-subbatch',
        data: { waveId: wave.waveId }
      });
      if (wave._id && wave._id.toString() !== wave.waveId) {
        await agenda.cancel({
          name: 'wave:dispatch-subbatch',
          data: { waveId: wave._id.toString() }
        });
      }
    } catch {
      // Non-fatal if Agenda is not running or mock
    }

    return wave;
  }

  /**
   * Resumes a paused or rescheduled wave, re-spacing remaining sub-batches and queuing Agenda jobs.
   */
  static async resumeWave(
    waveId: string,
    _adminUserId?: string,
    options?: { newIntervalMinutes?: number; rescheduleRemaining?: boolean }
  ): Promise<IEmailWave> {
    const wave = await this.findWave(waveId);

    if (wave.status === 'in_progress') {
      const err: any = new Error('Cannot resume wave already in progress');
      err.statusCode = 400;
      throw err;
    }

    if (wave.status !== 'paused' && wave.status !== 'rescheduled') {
      const err: any = new Error(`Cannot resume wave in status '${wave.status}'`);
      err.statusCode = 400;
      throw err;
    }

    wave.status = 'in_progress';
    wave.controlState = wave.controlState || { isPaused: false };
    wave.controlState.isPaused = false;
    wave.controlState.resumedAt = new Date();
    await wave.save();

    const pausedBatches = await SubBatch.find({
      waveId: wave._id,
      status: 'paused'
    }).sort({ chunkIndex: 1 });

    if (pausedBatches.length === 0) {
      if (wave.completedSubBatches >= wave.totalSubBatches) {
        wave.status = 'completed';
        wave.completedDate = new Date();
        await wave.save();
      }
      return wave;
    }

    const intervalMinutes = options?.newIntervalMinutes || wave.throttlingConfig?.intervalMinutes || 15;
    const intervalMs = intervalMinutes * 60 * 1000;

    let agenda: any = null;
    try {
      agenda = getAgenda();
    } catch {}

    for (let i = 0; i < pausedBatches.length; i++) {
      const batch = pausedBatches[i];
      const scheduledTime = new Date(Date.now() + i * intervalMs);
      batch.status = 'pending';
      batch.scheduledAt = scheduledTime;
      batch.executionLogs.push({
        timestamp: new Date(),
        level: 'info',
        message: `SubBatch resumed and scheduled for ${scheduledTime.toISOString()}`
      });
      await batch.save();

      if (agenda) {
        try {
          const job = await agenda.schedule(scheduledTime, 'wave:dispatch-subbatch', {
            waveId: wave.waveId,
            subBatchId: batch.subBatchId
          });
          batch.agendaJobId = job?.attrs?._id ? job.attrs._id.toString() : batch.agendaJobId;
          await batch.save();
        } catch {}
      }
    }

    return wave;
  }

  /**
   * Reschedules an active, scheduled, or paused wave to a future date, recalculating staggered intervals.
   */
  static async rescheduleWave(
    waveId: string,
    newDate: Date,
    _adminUserId?: string,
    reason?: string
  ): Promise<IEmailWave> {
    if (!(newDate instanceof Date) || isNaN(newDate.getTime()) || newDate.getTime() <= Date.now()) {
      const err: any = new Error('New scheduled date must be a valid future date');
      err.statusCode = 400;
      throw err;
    }

    const wave = await this.findWave(waveId);

    if (wave.status === 'completed' || wave.status === 'cancelled') {
      const err: any = new Error(`Cannot reschedule wave in status '${wave.status}'`);
      err.statusCode = 400;
      throw err;
    }

    wave.controlState = wave.controlState || { isPaused: false };
    wave.controlState.originalScheduledDate = wave.controlState.originalScheduledDate || wave.scheduledDate;
    wave.controlState.rescheduledAt = new Date();
    wave.scheduledDate = newDate;
    wave.status = 'rescheduled';
    await wave.save();

    let agenda: any = null;
    try {
      agenda = getAgenda();
      await agenda.cancel({
        name: 'wave:dispatch-subbatch',
        data: { waveId: wave.waveId }
      });
      if (wave._id && wave._id.toString() !== wave.waveId) {
        await agenda.cancel({
          name: 'wave:dispatch-subbatch',
          data: { waveId: wave._id.toString() }
        });
      }
    } catch {}

    const pendingBatches = await SubBatch.find({
      waveId: wave._id,
      status: { $in: ['pending', 'paused'] }
    }).sort({ chunkIndex: 1 });

    const intervalMinutes = wave.throttlingConfig?.intervalMinutes || 15;
    const intervalMs = intervalMinutes * 60 * 1000;

    for (let i = 0; i < pendingBatches.length; i++) {
      const batch = pendingBatches[i];
      const scheduledTime = new Date(newDate.getTime() + i * intervalMs);
      batch.scheduledAt = scheduledTime;
      batch.executionLogs.push({
        timestamp: new Date(),
        level: 'info',
        message: `SubBatch rescheduled for ${scheduledTime.toISOString()} (${reason || 'Rescheduled by administrator'})`
      });
      await batch.save();

      if (agenda) {
        try {
          const job = await agenda.schedule(scheduledTime, 'wave:dispatch-subbatch', {
            waveId: wave.waveId,
            subBatchId: batch.subBatchId
          });
          batch.agendaJobId = job?.attrs?._id ? job.attrs._id.toString() : batch.agendaJobId;
          await batch.save();
        } catch {}
      }
    }

    return wave;
  }

  /**
   * Permanently terminates a wave and cancels all pending/paused sub-batches and scheduled Agenda jobs.
   */
  static async cancelWave(waveId: string, reason: string, _adminUserId?: string): Promise<IEmailWave> {
    const wave = await this.findWave(waveId);

    // Idempotent return if already cancelled
    if (wave.status === 'cancelled') {
      return wave;
    }

    if (wave.status === 'completed') {
      const err: any = new Error('Cannot cancel an already completed wave');
      err.statusCode = 400;
      throw err;
    }

    wave.status = 'cancelled';
    wave.controlState = wave.controlState || { isPaused: false };
    wave.controlState.cancelledAt = new Date();
    wave.controlState.cancelReason = reason || 'Cancelled by administrator';
    wave.completedDate = new Date();
    await wave.save();

    await SubBatch.updateMany(
      { waveId: wave._id, status: { $in: ['pending', 'paused', 'processing', 'in_progress', 'queued'] } },
      { $set: { status: 'cancelled' } }
    );

    try {
      const agenda = getAgenda();
      await agenda.cancel({
        name: 'wave:dispatch-subbatch',
        data: { waveId: wave.waveId }
      });
      if (wave._id && wave._id.toString() !== wave.waveId) {
        await agenda.cancel({
          name: 'wave:dispatch-subbatch',
          data: { waveId: wave._id.toString() }
        });
      }
    } catch {}

    return wave;
  }
}
