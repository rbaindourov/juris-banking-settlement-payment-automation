import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Case, ICase } from '../models/Case';
import { AnalyticsService } from '../services/analytics.service';
import { CsvExportService } from '../services/csvExport.service';

export class AnalyticsController {
  public static async findCaseWithTenantCheck(
    caseIdentifier: string,
    user: any
  ): Promise<ICase | null> {
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
   * GET /api/cases/:id/analytics/funnel
   */
  public static async getFunnelAnalytics(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await AnalyticsController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);
      const funnel = await AnalyticsService.calculateFunnel(caseDoc, caseLookupIds);

      return res.status(200).json(funnel);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({ error: err.message || 'Error fetching funnel analytics' });
    }
  }

  /**
   * GET /api/cases/:id/analytics/methods
   */
  public static async getMethodAnalytics(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await AnalyticsController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);
      const methods = await AnalyticsService.calculateMethodDistribution(caseDoc, caseLookupIds);

      return res.status(200).json(methods);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({ error: err.message || 'Error fetching payment method analytics' });
    }
  }

  /**
   * GET /api/cases/:id/analytics/summary
   */
  public static async getFinancialSummary(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await AnalyticsController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);
      const summary = await AnalyticsService.calculateFinancialSummary(caseDoc, caseLookupIds);

      return res.status(200).json(summary);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({ error: err.message || 'Error fetching financial summary' });
    }
  }

  /**
   * GET /api/cases/:id/audit-export (also /export/ledger)
   */
  public static async exportAuditLedgerCsv(req: Request, res: Response) {
    try {
      const caseId = (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) as string;
      const user = (req as any).user;

      const caseDoc = await AnalyticsController.findCaseWithTenantCheck(caseId, user);
      if (!caseDoc) {
        return res.status(404).json({ error: 'Case not found' });
      }

      const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseId].filter(Boolean);
      await CsvExportService.streamAuditLedgerCsv(caseDoc, caseLookupIds, res);
    } catch (err: any) {
      if (!res.headersSent) {
        const statusCode = err.statusCode || 500;
        return res.status(statusCode).json({ error: err.message || 'Error exporting audit ledger' });
      }
      res.end();
    }
  }
}
