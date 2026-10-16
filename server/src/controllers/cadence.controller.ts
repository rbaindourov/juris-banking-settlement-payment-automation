import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest, AuthTokenPayload } from '../types';
import { Case, ICase } from '../models/Case';
import {
  NotificationCadence,
  createDefaultCadenceStages
} from '../models/NotificationCadence';
import { EmailWave, IEmailWave } from '../models/EmailWave';
import { SubBatch } from '../models/SubBatch';
import { SuppressionList } from '../models/SuppressionList';
import { WaveControlService } from '../services/waveControl.service';
import { CadenceService } from '../services/cadence.service';

/**
 * Helper to fetch a case and verify tenant ownership.
 */
export async function findCaseWithTenantCheck(
  caseIdentifier: string,
  user?: AuthTokenPayload
): Promise<ICase> {
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

  // Cross-tenant access validation
  if (user && user.role !== 'super_admin' && user.role !== 'platform_admin') {
    if (!user.lawFirmId || caseDoc.lawFirmId.toString() !== user.lawFirmId.toString()) {
      const err: any = new Error('Forbidden: Cross-tenant access denied.');
      err.statusCode = 403;
      throw err;
    }
  }

  return caseDoc;
}

/**
 * Helper to fetch an email wave and verify tenant ownership via its parent case.
 */
export async function findWaveWithTenantCheck(
  waveIdentifier: string,
  user?: AuthTokenPayload
): Promise<{ wave: IEmailWave; caseDoc: ICase }> {
  let wave: IEmailWave | null = null;
  if (mongoose.isValidObjectId(waveIdentifier)) {
    wave = await EmailWave.findById(waveIdentifier);
  }
  if (!wave) {
    wave = await EmailWave.findOne({ waveId: waveIdentifier });
  }

  if (!wave) {
    const err: any = new Error(`Wave not found: ${waveIdentifier}`);
    err.statusCode = 404;
    throw err;
  }

  const caseDoc = await findCaseWithTenantCheck(wave.caseId.toString(), user);
  return { wave, caseDoc };
}

export class CadenceController {
  /**
   * GET /api/cases/:caseId/cadence
   * Retrieves the case notification cadence configuration.
   * Auto-initializes default 5-stage cadence if none exists.
   */
  static async getCadence(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req.params.caseId as string, req.user);

      let cadence = await NotificationCadence.findOne({
        $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
      });

      if (!cadence) {
        cadence = await NotificationCadence.create({
          caseId: caseDoc._id,
          lawFirmId: caseDoc.lawFirmId,
          name: `${caseDoc.name} Settlement Cadence`,
          status: 'draft',
          stages: createDefaultCadenceStages(),
          throttling: {
            batchSize: 500,
            intervalMinutes: 15,
            rateLimitPerSecond: 25,
            dailyCap: 10000,
            quietHoursEnabled: true,
            quietHoursStart: '22:00',
            quietHoursEnd: '07:00',
            timezone: 'UTC'
          },
          suppression: {
            skipCompletedPayments: true,
            suppressBounced: true,
            checkGlobalSuppression: true,
            skipUnsubscribed: true
          }
        });
      }

      res.status(200).json({
        success: true,
        data: cadence
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/cases/:caseId/cadence
   * Updates cadence configuration, localized templates, throttling, and suppression settings.
   */
  static async updateCadence(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req.params.caseId as string, req.user);

      let cadence = await NotificationCadence.findOne({
        $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
      });

      if (!cadence) {
        cadence = new NotificationCadence({
          caseId: caseDoc._id,
          lawFirmId: caseDoc.lawFirmId,
          name: `${caseDoc.name} Settlement Cadence`,
          status: 'draft',
          stages: createDefaultCadenceStages()
        });
      }

      if (req.body.name !== undefined) cadence.name = req.body.name;
      if (req.body.status !== undefined) cadence.status = req.body.status;
      if (req.body.stages !== undefined) cadence.stages = req.body.stages;
      if (req.body.throttling !== undefined) {
        cadence.throttling = {
          ...((cadence.throttling as any)?.toObject?.() || cadence.throttling || {}),
          ...req.body.throttling
        };
      }
      if (req.body.suppression !== undefined) {
        cadence.suppression = {
          ...((cadence.suppression as any)?.toObject?.() || cadence.suppression || {}),
          ...req.body.suppression
        };
      }

      await cadence.save();

      res.status(200).json({
        success: true,
        data: cadence,
        message: 'Notification cadence updated successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/cases/:caseId/cadence/preview-schedule
   * Calculates projected wave timeline, recipient counts, sub-batches, and estimated completion dates.
   */
  static async previewSchedule(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req.params.caseId as string, req.user);

      const projection = await CadenceService.previewSchedule(caseDoc._id.toString(), {
        throttling: req.body?.throttling,
        stages: req.body?.stages
      });

      res.status(200).json({
        success: true,
        data: projection
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/cases/:caseId/waves
   * Lists all email waves generated for a settlement case.
   */
  static async getWaves(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req.params.caseId as string, req.user);

      const waves = await EmailWave.find({
        $or: [{ caseId: caseDoc._id }, { caseId: caseDoc.caseId }]
      })
        .sort({ scheduledDate: 1 })
        .lean();

      res.status(200).json({
        success: true,
        data: waves
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/waves/:waveId
   * Retrieves single wave details, telemetry funnels, control state, and populated sub-batches.
   */
  static async getWaveById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wave } = await findWaveWithTenantCheck(req.params.waveId as string, req.user);

      const subBatches = await SubBatch.find({ waveId: wave._id })
        .sort({ chunkIndex: 1 })
        .lean();

      res.status(200).json({
        success: true,
        data: {
          ...wave.toJSON(),
          subBatches
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/waves/:waveId/pause
   * Operational Pause halting in-flight and pending sub-batches.
   */
  static async pauseWave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wave } = await findWaveWithTenantCheck(req.params.waveId as string, req.user);

      const updatedWave = await WaveControlService.pauseWave(
        wave.waveId,
        req.user?.id,
        req.body?.reason
      );

      res.status(200).json({
        success: true,
        data: updatedWave,
        message: 'Wave paused successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/waves/:waveId/resume
   * Operational Resume re-scheduling paused sub-batches starting immediately with interval spacing.
   */
  static async resumeWave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wave } = await findWaveWithTenantCheck(req.params.waveId as string, req.user);

      const updatedWave = await WaveControlService.resumeWave(
        wave.waveId,
        req.user?.id,
        req.body
      );

      res.status(200).json({
        success: true,
        data: updatedWave,
        message: 'Wave resumed successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/waves/:waveId/reschedule
   * Operational Reschedule moving future dispatch date and re-spacing Agenda jobs.
   */
  static async rescheduleWave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wave } = await findWaveWithTenantCheck(req.params.waveId as string, req.user);

      const updatedWave = await WaveControlService.rescheduleWave(
        wave.waveId,
        new Date(req.body.newScheduledDate),
        req.user?.id,
        req.body?.reason
      );

      res.status(200).json({
        success: true,
        data: updatedWave,
        message: 'Wave rescheduled successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/waves/:waveId/cancel
   * Operational Cancel terminating all pending sub-batches and purging Agenda queue.
   */
  static async cancelWave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { wave } = await findWaveWithTenantCheck(req.params.waveId as string, req.user);

      const updatedWave = await WaveControlService.cancelWave(
        wave.waveId,
        req.body.reason,
        req.user?.id
      );

      res.status(200).json({
        success: true,
        data: updatedWave,
        message: 'Wave cancelled successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/suppression
   * Queries suppression list with filtering (email, reason, caseId) and pagination.
   */
  static async getSuppressionList(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      // Tenant isolation: non-super-admins only view their firm's records
      if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
        filter.$or = [
          { lawFirmId: user.lawFirmId },
          { lawFirmId: null },
          { lawFirmId: { $exists: false } }
        ];
      }

      if (req.query.email) {
        filter.email = (req.query.email as string).toLowerCase().trim();
      }
      if (req.query.reason) {
        filter.reason = req.query.reason;
      }
      if (req.query.caseId) {
        filter.caseId = req.query.caseId;
      }

      const page = Number(req.query.page) || 1;
      const limit = Math.min(100, Number(req.query.limit) || 20);
      const skip = (page - 1) * limit;

      const [total, entries] = await Promise.all([
        SuppressionList.countDocuments(filter),
        SuppressionList.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
      ]);

      res.status(200).json({
        success: true,
        data: entries,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/suppression
   * Records a new email suppression entry.
   */
  static async createSuppression(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const normalizedEmail = req.body.email.toLowerCase().trim();
      let targetLawFirmId = user.lawFirmId || null;

      if (req.body.caseId) {
        const caseDoc = await findCaseWithTenantCheck(req.body.caseId, user);
        targetLawFirmId = caseDoc.lawFirmId;
      }

      const entry = await SuppressionList.findOneAndUpdate(
        { email: normalizedEmail, caseId: req.body.caseId || null },
        {
          $set: {
            reason: req.body.reason,
            source: 'admin_manual',
            diagnosticMessage: req.body.diagnosticMessage,
            lawFirmId: targetLawFirmId,
            metadata: req.body.metadata || {}
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.status(201).json({
        success: true,
        data: entry,
        message: 'Suppression entry recorded successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/suppression/:id
   * Removes a suppression entry, un-suppressing the recipient address.
   */
  static async deleteSuppression(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const entry = await SuppressionList.findById(req.params.id as string);
      if (!entry) {
        res.status(404).json({ error: 'Suppression entry not found' });
        return;
      }

      // Tenant validation
      if (req.user!.role !== 'super_admin' && req.user!.role !== 'platform_admin') {
        if (entry.lawFirmId && entry.lawFirmId !== req.user!.lawFirmId) {
          res.status(403).json({ error: 'Forbidden: Access denied to suppression record' });
          return;
        }
      }

      await SuppressionList.findByIdAndDelete(req.params.id as string);

      res.status(200).json({
        success: true,
        message: 'Suppression entry removed successfully'
      });
    } catch (err) {
      next(err);
    }
  }
}
