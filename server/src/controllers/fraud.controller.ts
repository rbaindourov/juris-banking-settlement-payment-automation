import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Case } from '../models/Case';
import { Claimant } from '../models/Claimant';
import { FraudScoringService } from '../services/fraudScoring.service';
import {
  fraudReviewActionSchema,
  fraudClaimantFilterSchema
} from '../validation/fraud.validation';

export class FraudController {
  public static async findCaseWithTenantCheck(caseIdentifier: string, user: any) {
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      return null;
    }

    if (
      user &&
      user.role !== 'super_admin' &&
      user.role !== 'platform_admin' &&
      user.lawFirmId &&
      caseDoc.lawFirmId &&
      caseDoc.lawFirmId.toString() !== user.lawFirmId.toString()
    ) {
      const err: any = new Error('Cross-tenant resource access forbidden');
      err.statusCode = 403;
      throw err;
    }

    return caseDoc;
  }

  /**
   * GET /api/cases/:caseId/fraud/metrics
   */
  public static async getCaseFraudMetrics(req: Request, res: Response): Promise<void> {
    try {
      const caseId = String(req.params.caseId || req.params.id || '');
      if (!caseId) {
        res.status(400).json({ error: 'Case ID is required' });
        return;
      }

      const caseDoc = await FraudController.findCaseWithTenantCheck(caseId, (req as any).user);
      if (!caseDoc) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const metrics = await FraudScoringService.getCaseFraudMetrics(caseId);
      res.status(200).json({
        success: true,
        ...metrics,
        metrics,
        data: metrics
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.message === 'Case not found') {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to compute case fraud metrics' });
    }
  }

  /**
   * GET /api/cases/:caseId/fraud/claimants
   */
  public static async listCaseFraudClaimants(req: Request, res: Response): Promise<void> {
    try {
      const caseId = String(req.params.caseId || req.params.id || '');
      const caseDoc = await FraudController.findCaseWithTenantCheck(caseId, (req as any).user);

      if (!caseDoc) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const normalizedQuery = {
        ...req.query,
        reviewStatus: req.query.reviewStatus || req.query.fraudReviewStatus
      };

      const parsed = fraudClaimantFilterSchema.safeParse(normalizedQuery);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid filter parameters'
        });
        return;
      }

      const { riskTier, reviewStatus, signalCode, minScore, page, limit } = parsed.data;
      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);

      const filter: Record<string, any> = {
        caseId: { $in: caseLookupIds }
      };

      if (riskTier) {
        filter.fraudRiskTier = riskTier;
      }
      if (reviewStatus) {
        filter.fraudReviewStatus = reviewStatus;
      }
      if (signalCode) {
        filter['fraudSignals.code'] = signalCode;
      }
      if (minScore !== undefined) {
        filter.fraudScore = { $gte: minScore };
      }

      const skip = (page - 1) * limit;
      const [claimants, total] = await Promise.all([
        Claimant.find(filter)
          .sort({ fraudScore: -1, updatedAt: -1 })
          .skip(skip)
          .limit(limit),
        Claimant.countDocuments(filter)
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      res.status(200).json({
        success: true,
        claimants,
        total,
        page,
        limit,
        totalPages,
        data: {
          claimants,
          total,
          page,
          limit,
          totalPages
        }
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        res.status(403).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to list case fraud claimants' });
    }
  }

  /**
   * POST /api/cases/:caseId/fraud/claimants/:claimantId/review
   */
  public static async reviewClaimant(req: Request, res: Response): Promise<void> {
    try {
      const caseId = String(req.params.caseId || req.params.id || '');
      const claimantId = String(req.params.claimantId || '');

      const caseDoc = await FraudController.findCaseWithTenantCheck(caseId, (req as any).user);
      if (!caseDoc) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const parsed = fraudReviewActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid review action payload'
        });
        return;
      }

      const user = (req as any).user;
      const reviewedBy =
        user?.email || user?.userId || user?.id || 'admin@jurisbanking.com';

      const claimant = await FraudScoringService.reviewClaimant(caseId, claimantId, {
        action: parsed.data.action,
        notes: parsed.data.notes,
        reviewedBy
      });

      res.status(200).json({
        success: true,
        message: `Claimant fraud review status updated to ${claimant.fraudReviewStatus}`,
        claimant,
        data: claimant
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.message === 'Case not found' || err.message === 'Claimant not found') {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to adjudicate claimant fraud status' });
    }
  }

  /**
   * POST /api/cases/:caseId/fraud/rescan
   */
  public static async rescanCase(req: Request, res: Response): Promise<void> {
    try {
      const caseId = String(req.params.caseId || req.params.id || '');
      const caseDoc = await FraudController.findCaseWithTenantCheck(caseId, (req as any).user);
      if (!caseDoc) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const result = await FraudScoringService.rescanCaseClaimants(caseId);

      res.status(200).json({
        success: true,
        message: 'Case fraud rescan completed',
        ...result,
        data: result
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.message === 'Case not found') {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to rescan case claimants' });
    }
  }

  /**
   * GET /api/fraud/network-intelligence
   */
  public static async getNetworkIntelligence(_req: Request, res: Response): Promise<void> {
    try {
      const intelligence = await FraudScoringService.getNetworkIntelligence();
      res.status(200).json({
        success: true,
        ...intelligence,
        intelligence,
        data: intelligence
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Failed to compute multi-tenant network intelligence'
      });
    }
  }
}
