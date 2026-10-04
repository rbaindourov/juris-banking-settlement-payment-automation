import { Request, Response } from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Case } from '../models/Case';
import { Claimant } from '../models/Claimant';
import { ReconciliationException } from '../models/ReconciliationException';
import { BatchGeneratorService } from '../services/batchGenerator.service';
import { SftpService } from '../services/sftp.service';
import { ReconciliationService } from '../services/reconciliation.service';

export const resolveExceptionSchema = z
  .object({
    action: z.enum(['resend_email', 'switch_to_check', 'requeue_sftp', 'mark_resolved']),
    reason: z.string().optional(),
    updatedAddress: z
      .object({
        street1: z.string().min(1, 'Street address is required'),
        street2: z.string().optional(),
        city: z.string().min(1, 'City is required'),
        state: z.string().regex(/^[A-Za-z]{2}$/, 'State must be a 2-letter uppercase code'),
        zip: z.string().min(3, 'Valid ZIP code required')
      })
      .optional()
  })
  .refine(
    (data) => {
      if (data.action === 'switch_to_check' && !data.updatedAddress) {
        return false;
      }
      return true;
    },
    {
      message: 'updatedAddress is required when action is switch_to_check',
      path: ['updatedAddress']
    }
  );

export class ReconciliationController {
  private static async findCaseWithTenantCheck(caseIdentifier: string, user: any) {
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      return null;
    }

    if (user && user.role !== 'super_admin' && user.role !== 'platform_admin') {
      if (!user.lawFirmId || !caseDoc.lawFirmId || caseDoc.lawFirmId.toString() !== user.lawFirmId.toString()) {
        const err: any = new Error('Cross-tenant resource access forbidden');
        err.statusCode = 403;
        throw err;
      }
    }

    return caseDoc;
  }

  /**
   * GET /api/cases/:id/exceptions
   * Lists filterable, paginated reconciliation exceptions for a case.
   */
  public static async listExceptions(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await ReconciliationController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);
      const query: any = { caseId: { $in: caseLookupIds } };

      const { resolved, status, resolutionStatus, exceptionType, errorCode, returnCode, search } = req.query;

      if (resolved === 'true') {
        query.resolved = true;
      } else if (resolved === 'false') {
        query.resolved = false;
      }

      if (resolutionStatus) {
        query.resolutionStatus = resolutionStatus;
      } else if (status && ['open', 'resolved'].includes(status as string)) {
        query.resolutionStatus = status;
      }

      if (exceptionType) {
        query.exceptionType = exceptionType;
      }

      const codeFilter = errorCode || returnCode;
      if (codeFilter) {
        query.returnCode = codeFilter;
      }

      if (search && typeof search === 'string' && search.trim()) {
        const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { claimId: { $regex: s, $options: 'i' } },
          { dashReferenceId: { $regex: s, $options: 'i' } },
          { returnCode: { $regex: s, $options: 'i' } },
          { returnReason: { $regex: s, $options: 'i' } }
        ];
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const [exceptions, totalRecords] = await Promise.all([
        ReconciliationException.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('claimantId', 'firstName lastName email'),
        ReconciliationException.countDocuments(query)
      ]);

      const [openCount, resolvedCount] = await Promise.all([
        ReconciliationException.countDocuments({ caseId: { $in: caseLookupIds }, resolved: false }),
        ReconciliationException.countDocuments({ caseId: { $in: caseLookupIds }, resolved: true })
      ]);

      return res.status(200).json({
        exceptions,
        pagination: {
          page,
          limit,
          totalRecords,
          totalPages: Math.ceil(totalRecords / limit) || 1
        },
        summary: {
          total: totalRecords,
          openCount,
          resolvedCount
        }
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: 'Forbidden: Access to another law firm case is denied' });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * POST /api/cases/:id/exceptions/:exceptionId/resolve
   * Resolves an exception with targeted administrative action.
   */
  public static async resolveException(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const exceptionId = (Array.isArray(req.params.exceptionId) ? req.params.exceptionId[0] : req.params.exceptionId) as string;
      const user = (req as any).user;

      if (user && user.role === 'auditor') {
        return res.status(403).json({ error: 'Auditors have read-only access and cannot resolve exceptions' });
      }

      const caseDoc = await ReconciliationController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);

      const exception = mongoose.isValidObjectId(exceptionId)
        ? await ReconciliationException.findOne({ _id: exceptionId, caseId: { $in: caseLookupIds } })
        : await ReconciliationException.findOne({
            claimId: exceptionId,
            caseId: { $in: caseLookupIds }
          });

      if (!exception) {
        return res.status(404).json({
          error: 'EXCEPTION_NOT_FOUND',
          message: `Exception with ID "${exceptionId}" does not exist`
        });
      }

      const { action, reason, updatedAddress } = req.body;
      const userId = user?.id || user?._id;

      // Find associated claimant if exists
      const claimant = exception.claimantId
        ? await Claimant.findById(exception.claimantId)
        : await Claimant.findOne({ caseId: { $in: caseLookupIds }, claimId: exception.claimId });

      switch (action) {
        case 'switch_to_check': {
          if (!claimant) {
            return res.status(400).json({ error: 'Cannot switch method for unmatched claim' });
          }
          if (!updatedAddress) {
            return res.status(400).json({ error: 'updatedAddress is required for switch_to_check' });
          }

          claimant.selectedPaymentMethod = 'physical_check';
          const streetFormatted = updatedAddress.street2
            ? `${updatedAddress.street1}, ${updatedAddress.street2}`
            : updatedAddress.street1;

          claimant.address = {
            street: streetFormatted,
            city: updatedAddress.city,
            state: updatedAddress.state.toUpperCase(),
            zip: updatedAddress.zip
          };

          claimant.paymentDetails = {
            ...(claimant.paymentDetails || {}),
            recipientName: `${claimant.firstName} ${claimant.lastName}`.trim(),
            address: claimant.address
          };

          claimant.status = 'selected';
          claimant.requeuedAt = new Date();
          claimant.failureCode = undefined;
          claimant.rejectionReason = undefined;
          await claimant.save();

          exception.resolved = true;
          exception.resolutionStatus = 'resolved_switched_to_check';
          exception.resolutionAction = 'switch_to_check';
          exception.resolutionNotes = reason || 'Switched payment method to physical check';
          exception.resolvedBy = userId;
          exception.resolvedAt = new Date();
          exception.resolutionPayload = { updatedAddress };
          await exception.save();
          break;
        }

        case 'resend_email': {
          if (!claimant) {
            return res.status(400).json({ error: 'Cannot resend email for unmatched claim' });
          }

          claimant.paymentSelectionToken = crypto.randomBytes(32).toString('hex');
          claimant.tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          claimant.status = 'pending_selection';
          claimant.emailSent = false;
          claimant.failureCode = undefined;
          claimant.rejectionReason = undefined;
          await claimant.save();

          exception.resolved = true;
          exception.resolutionStatus = 'resolved_resent_email';
          exception.resolutionAction = 'resend_email';
          exception.resolutionNotes = reason || 'Reset selection token and queued email notification';
          exception.resolvedBy = userId;
          exception.resolvedAt = new Date();
          await exception.save();
          break;
        }

        case 'requeue_sftp': {
          if (!claimant) {
            return res.status(400).json({ error: 'Cannot requeue unmatched claim' });
          }

          claimant.status = 'selected';
          claimant.requeuedAt = new Date();
          await claimant.save();

          exception.resolved = true;
          exception.resolutionStatus = 'resolved_requeued';
          exception.resolutionAction = 'requeue_sftp';
          exception.resolutionNotes = reason || 'Re-queued for outbound SFTP batch';
          exception.resolvedBy = userId;
          exception.resolvedAt = new Date();
          await exception.save();
          break;
        }

        case 'mark_resolved': {
          exception.resolved = true;
          exception.resolutionStatus = 'resolved';
          exception.resolutionAction = 'mark_resolved';
          exception.resolutionNotes = reason || 'Manually marked as resolved';
          exception.resolvedBy = userId;
          exception.resolvedAt = new Date();
          await exception.save();
          break;
        }
      }

      return res.status(200).json({
        message: 'Exception successfully resolved',
        exception,
        claimant
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: 'Forbidden: Access to another law firm case is denied' });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * POST /api/cases/:id/disbursements/batch
   * Triggers outbound batch compilation and outbox spooling.
   */
  public static async generateBatch(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await ReconciliationController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const result = await BatchGeneratorService.compileAndSpoolCaseBatch(caseDoc._id.toString(), {
        requestedBy: user?.id,
        format: req.body?.format || 'v2'
      });

      return res.status(201).json({
        message: 'Disbursement batch spooled successfully',
        batchId: result.batchId,
        filename: result.filename,
        totalRecords: result.totalRecords,
        totalAmount: result.totalAmount,
        sha256: result.sha256
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(400).json({ error: err.message || 'Batch generation failed' });
    }
  }

  /**
   * POST /api/cases/:id/disbursements/upload
   * Uploads spooled batch file to SFTP.
   */
  public static async uploadBatch(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await ReconciliationController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const { localCsvPath, localSha256Path } = req.body;
      if (!localCsvPath) {
        return res.status(400).json({ error: 'localCsvPath is required' });
      }

      const sftp = new SftpService();
      const result = await sftp.uploadBatch(localCsvPath, localSha256Path);

      return res.status(200).json({
        message: 'Batch uploaded to SFTP successfully',
        result
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(500).json({ error: err.message || 'SFTP upload failed' });
    }
  }

  /**
   * POST /api/cases/:id/disbursements/reconcile
   * Ingests status report CSV and reconciles claimants.
   */
  public static async reconcileStatusReport(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await ReconciliationController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const { csvContent, reportFilename, batchId } = req.body;
      if (!csvContent) {
        return res.status(400).json({ error: 'csvContent is required' });
      }

      const result = await ReconciliationService.reconcileCaseStatusReport({
        caseId: caseDoc._id.toString(),
        csvContent,
        reportFilename,
        batchId,
        actorId: user?.id
      });

      return res.status(200).json({
        message: 'Status report reconciled successfully',
        result
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(400).json({ error: err.message || 'Reconciliation failed' });
    }
  }
}
