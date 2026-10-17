import { Router } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { UserRole } from '../types';
import { FraudController } from '../controllers/fraud.controller';

const router = Router();

const READ_ROLES: UserRole[] = ['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor'];
const WRITE_ROLES: UserRole[] = ['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager'];

// 1. Real-Time Case Fraud Scanning Metrics
router.get(
  '/cases/:caseId/fraud/metrics',
  authenticateToken,
  requireRole(READ_ROLES),
  FraudController.getCaseFraudMetrics
);

// 2. Paginated & Filterable Claimant Fraud Scores
router.get(
  '/cases/:caseId/fraud/claimants',
  authenticateToken,
  requireRole(READ_ROLES),
  FraudController.listCaseFraudClaimants
);

// 3. Manual Administrator Adjudication (Approve & Release to SFTP / Quarantine & Reject)
router.post(
  '/cases/:caseId/fraud/claimants/:claimantId/review',
  authenticateToken,
  requireRole(WRITE_ROLES),
  FraudController.reviewClaimant
);

// 4. Full Case Fraud Rescan
router.post(
  '/cases/:caseId/fraud/rescan',
  authenticateToken,
  requireRole(WRITE_ROLES),
  FraudController.rescanCase
);

// 5. Multi-Tenant Internet Spam & Fraud Visibility Radar
router.get(
  '/fraud/network-intelligence',
  authenticateToken,
  requireRole(READ_ROLES),
  FraudController.getNetworkIntelligence
);

export default router;
