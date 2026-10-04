import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import {
  ReconciliationController,
  resolveExceptionSchema
} from '../controllers/reconciliation.controller';

const router = Router();

// Protect all reconciliation and exception endpoints with JWT authentication
router.use(authenticateToken);

// 1. List filterable exceptions for a case
router.get(
  '/:id/exceptions',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
  ReconciliationController.listExceptions
);

// 2. Resolve exception with targeted action
router.post(
  '/:id/exceptions/:exceptionId/resolve',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  validateRequest({ body: resolveExceptionSchema }),
  ReconciliationController.resolveException
);

// 3. Trigger outbound batch compilation and spooling
router.post(
  '/:id/disbursements/batch',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  ReconciliationController.generateBatch
);

// 4. Upload spooled batch file to SFTP
router.post(
  '/:id/disbursements/upload',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  ReconciliationController.uploadBatch
);

// 5. Ingest status report CSV and reconcile claimants
router.post(
  '/:id/disbursements/reconcile',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  ReconciliationController.reconcileStatusReport
);

export default router;
