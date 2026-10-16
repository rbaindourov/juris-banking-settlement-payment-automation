import { Router } from 'express';
import { authenticateToken, requireRole, requireTenantScope } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import { CadenceController } from '../controllers/cadence.controller';
import {
  caseIdParamSchema,
  waveIdParamSchema,
  suppressionIdParamSchema,
  updateCadenceSchema,
  previewScheduleSchema,
  pauseWaveSchema,
  resumeWaveSchema,
  rescheduleWaveSchema,
  cancelWaveSchema,
  createSuppressionSchema,
  querySuppressionSchema
} from '../validation/cadence.validation';
import { UserRole } from '../types';

const router = Router();

// Standard Role Sets
const READ_ROLES: UserRole[] = [
  'super_admin',
  'platform_admin',
  'law_firm_admin',
  'case_manager',
  'auditor'
];

const WRITE_ROLES: UserRole[] = [
  'super_admin',
  'platform_admin',
  'law_firm_admin',
  'case_manager'
];

// All cadence, wave, and suppression routes require Bearer or Cookie JWT
router.use('/cases', authenticateToken);
router.use('/waves', authenticateToken);
router.use('/suppression', authenticateToken);

// ============================================================================
// 1. Case Cadence Configuration & Projections
// ============================================================================

// GET /api/cases/:caseId/cadence
router.get(
  '/cases/:caseId/cadence',
  requireRole(READ_ROLES),
  requireTenantScope,
  validateRequest({ params: caseIdParamSchema }),
  CadenceController.getCadence
);

// PUT /api/cases/:caseId/cadence
router.put(
  '/cases/:caseId/cadence',
  requireRole(WRITE_ROLES),
  requireTenantScope,
  validateRequest({ params: caseIdParamSchema, body: updateCadenceSchema }),
  CadenceController.updateCadence
);

// POST /api/cases/:caseId/cadence/preview-schedule
router.post(
  '/cases/:caseId/cadence/preview-schedule',
  requireRole(READ_ROLES),
  requireTenantScope,
  validateRequest({ params: caseIdParamSchema, body: previewScheduleSchema }),
  CadenceController.previewSchedule
);

// POST /api/cases/:caseId/preview-schedule (alias)
router.post(
  '/cases/:caseId/preview-schedule',
  requireRole(READ_ROLES),
  requireTenantScope,
  validateRequest({ params: caseIdParamSchema, body: previewScheduleSchema }),
  CadenceController.previewSchedule
);

// GET /api/cases/:caseId/waves
router.get(
  '/cases/:caseId/waves',
  requireRole(READ_ROLES),
  requireTenantScope,
  validateRequest({ params: caseIdParamSchema }),
  CadenceController.getWaves
);

// ============================================================================
// 2. Wave Telemetry & Operational Controls
// ============================================================================

// GET /api/waves/:waveId
router.get(
  '/waves/:waveId',
  requireRole(READ_ROLES),
  validateRequest({ params: waveIdParamSchema }),
  CadenceController.getWaveById
);

// POST /api/waves/:waveId/pause
router.post(
  '/waves/:waveId/pause',
  requireRole(WRITE_ROLES),
  validateRequest({ params: waveIdParamSchema, body: pauseWaveSchema }),
  CadenceController.pauseWave
);

// POST /api/waves/:waveId/resume
router.post(
  '/waves/:waveId/resume',
  requireRole(WRITE_ROLES),
  validateRequest({ params: waveIdParamSchema, body: resumeWaveSchema }),
  CadenceController.resumeWave
);

// POST /api/waves/:waveId/reschedule
router.post(
  '/waves/:waveId/reschedule',
  requireRole(WRITE_ROLES),
  validateRequest({ params: waveIdParamSchema, body: rescheduleWaveSchema }),
  CadenceController.rescheduleWave
);

// POST /api/waves/:waveId/cancel
router.post(
  '/waves/:waveId/cancel',
  requireRole(WRITE_ROLES),
  validateRequest({ params: waveIdParamSchema, body: cancelWaveSchema }),
  CadenceController.cancelWave
);

// ============================================================================
// 3. Suppression List Registry Management
// ============================================================================

// GET /api/suppression
router.get(
  '/suppression',
  requireRole(READ_ROLES),
  validateRequest({ query: querySuppressionSchema }),
  CadenceController.getSuppressionList
);

// POST /api/suppression
router.post(
  '/suppression',
  requireRole(WRITE_ROLES),
  validateRequest({ body: createSuppressionSchema }),
  CadenceController.createSuppression
);

// DELETE /api/suppression/:id
router.delete(
  '/suppression/:id',
  requireRole(WRITE_ROLES),
  validateRequest({ params: suppressionIdParamSchema }),
  CadenceController.deleteSuppression
);

export default router;
