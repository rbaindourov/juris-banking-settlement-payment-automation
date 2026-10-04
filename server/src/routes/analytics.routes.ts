import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { AnalyticsController } from '../controllers/analytics.controller';

const router = Router();

// Protect all analytics endpoints with JWT authentication and RBAC
router.use(authenticateToken);
router.use(
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor'])
);

// 1. Delivery Funnel Analytics
router.get('/:id/analytics/funnel', AnalyticsController.getFunnelAnalytics);

// 2. Payment Method Distribution Breakdown (all 9 rails)
router.get('/:id/analytics/methods', AnalyticsController.getMethodAnalytics);

// 3. Case Financial Summary & Balances
router.get('/:id/analytics/summary', AnalyticsController.getFinancialSummary);

// 4. Audit & Disbursement Ledger CSV Export
router.get('/:id/audit-export', AnalyticsController.exportAuditLedgerCsv);
router.get('/:id/export/ledger', AnalyticsController.exportAuditLedgerCsv);

export default router;
