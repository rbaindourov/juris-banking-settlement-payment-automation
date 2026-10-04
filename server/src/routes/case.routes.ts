import { Router } from 'express';
import multer from 'multer';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';
import {
  CaseController,
  createCaseSchema,
  updateCaseSchema,
  previewTemplateSchema
} from '../controllers/case.controller';

const router = Router();

// Configure in-memory multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
});

// Protect all case endpoints with JWT authentication
router.use(authenticateToken);

// 1. Create case
router.post(
  '/',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin']),
  validateRequest({ body: createCaseSchema }),
  CaseController.createCase
);

// 2. List cases
router.get(
  '/',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
  CaseController.listCases
);

// 3. Get single case details
router.get(
  '/:id',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
  CaseController.getCase
);

// 4. Update case details, deadline, and templates
router.patch(
  '/:id',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  validateRequest({ body: updateCaseSchema }),
  CaseController.updateCase
);

// 5. Stage claimant roster upload (CSV or XLSX)
router.post(
  '/:id/claimants/stage-upload',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  upload.single('file'),
  CaseController.stageClaimantUpload
);

// 6. Commit staged claimant roster to database
router.post(
  '/:id/claimants/commit-upload',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
  upload.single('file'),
  CaseController.commitClaimantUpload
);

// 7. List claimants for a case
router.get(
  '/:id/claimants',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
  CaseController.listClaimants
);

// 8. Preview sanitized Quill template with sample merge tags
router.post(
  '/:id/templates/preview',
  requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
  validateRequest({ body: previewTemplateSchema }),
  CaseController.previewTemplate
);

export default router;
