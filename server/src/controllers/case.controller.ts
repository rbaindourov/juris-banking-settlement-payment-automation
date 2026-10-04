import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { Case, ICase, FALLBACK_PAYMENT_METHODS, CASE_STATUSES } from '../models/Case';
import { Claimant } from '../models/Claimant';
import { IngestionService } from '../services/ingestion.service';
import { TemplateService, sanitizeEmailHtml } from '../services/template.service';

/**
 * Sanitizes landing page text fields (headline, introHtml, faqAccordion items) to prevent stored XSS.
 */
function sanitizeLandingPageContent(content: any): any {
  if (!content || typeof content !== 'object') return content;
  const sanitized = { ...content };
  if (typeof sanitized.headline === 'string') {
    sanitized.headline = sanitizeEmailHtml(sanitized.headline);
  }
  if (typeof sanitized.introHtml === 'string') {
    sanitized.introHtml = sanitizeEmailHtml(sanitized.introHtml);
  }
  if (Array.isArray(sanitized.faqAccordion)) {
    sanitized.faqAccordion = sanitized.faqAccordion.map((item: any) => ({
      question: typeof item?.question === 'string' ? sanitizeEmailHtml(item.question) : item?.question,
      answer: typeof item?.answer === 'string' ? sanitizeEmailHtml(item.answer) : item?.answer
    }));
  }
  return sanitized;
}

/**
 * Sanitizes all localized landing page entries across configured locales.
 */
function sanitizeLocalizedLandingPages(localized: any): any {
  if (!localized || typeof localized !== 'object') return localized;
  const result: Record<string, any> = {};
  for (const [lang, page] of Object.entries(localized)) {
    result[lang] = sanitizeLandingPageContent(page);
  }
  return result;
}

export const createCaseSchema = z.object({
  name: z.string().min(1, 'Case name is required').max(200),
  docketNumber: z.string().min(1, 'Docket number is required').max(100),
  lawFirmId: z.string().optional(),
  settlementFundTotal: z.number().min(0, 'Settlement fund total cannot be negative'),
  disbursementDeadline: z.union([z.string(), z.date()]).transform(val => new Date(val)),
  fallbackPaymentMethod: z.enum(FALLBACK_PAYMENT_METHODS as any).optional(),
  status: z.enum(CASE_STATUSES as any).optional(),
  emailTemplate: z
    .object({
      subject: z.string().optional(),
      bodyHtml: z.string().optional()
    })
    .optional(),
  landingPageText: z
    .object({
      headline: z.string().optional(),
      introHtml: z.string().optional(),
      faqAccordion: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string()
          })
        )
        .optional(),
      supportContact: z.any().optional()
    })
    .optional(),
  defaultLanguage: z.string().optional(),
  supportedLanguages: z.array(z.string()).optional(),
  localizedLandingPageText: z.record(z.any()).optional()
});

export const updateCaseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  docketNumber: z.string().min(1).max(100).optional(),
  settlementFundTotal: z.number().min(0).optional(),
  disbursementDeadline: z
    .union([z.string(), z.date()])
    .transform(val => new Date(val))
    .optional(),
  fallbackPaymentMethod: z.enum(FALLBACK_PAYMENT_METHODS as any).optional(),
  status: z.enum(CASE_STATUSES as any).optional(),
  emailTemplate: z
    .object({
      subject: z.string().optional(),
      bodyHtml: z.string().optional()
    })
    .optional(),
  landingPageText: z
    .object({
      headline: z.string().optional(),
      introHtml: z.string().optional(),
      faqAccordion: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string()
          })
        )
        .optional(),
      supportContact: z.any().optional()
    })
    .optional(),
  defaultLanguage: z.string().optional(),
  supportedLanguages: z.array(z.string()).optional(),
  localizedLandingPageText: z.record(z.any()).optional()
});

export const previewTemplateSchema = z.object({
  template: z.string().optional(),
  sampleData: z.record(z.any()).optional(),
  viewport: z.enum(['desktop', 'mobile']).optional(),
  language: z.string().optional(),
  type: z.enum(['email', 'landing']).optional()
});

/**
 * Helper to fetch a case and enforce tenant isolation.
 */
async function findCaseWithTenantCheck(
  req: AuthenticatedRequest,
  res: Response
): Promise<ICase | null> {
  const { id } = req.params;
  let caseDoc: ICase | null = null;

  if (mongoose.isValidObjectId(id)) {
    caseDoc = await Case.findById(id);
  }
  if (!caseDoc) {
    caseDoc = await Case.findOne({ caseId: id });
  }

  if (!caseDoc) {
    res.status(404).json({ error: 'Case not found' });
    return null;
  }

  // Tenant scoping check: strictly require non-super-admins to have a matching lawFirmId
  const user = req.user;
  if (user && user.role !== 'super_admin' && user.role !== 'platform_admin') {
    if (!user.lawFirmId || caseDoc.lawFirmId.toString() !== user.lawFirmId.toString()) {
      const err = new Error('Forbidden: Access denied to this case.');
      (err as any).statusCode = 403;
      throw err;
    }
  }

  return caseDoc;
}

export class CaseController {
  /**
   * POST /api/cases
   * Create a new settlement case.
   */
  static async createCase(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      let assignedLawFirmId = req.body.lawFirmId;

      // Non-super admins cannot create cases for another law firm
      if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
        if (!user.lawFirmId) {
          res.status(403).json({ error: 'User is not assigned to a law firm' });
          return;
        }
        if (assignedLawFirmId && assignedLawFirmId !== user.lawFirmId) {
          res.status(403).json({
            error: 'Forbidden: Cannot create case for another law firm',
            userFirmId: user.lawFirmId,
            targetFirmId: assignedLawFirmId
          });
          return;
        }
        assignedLawFirmId = user.lawFirmId;
      }

      if (!assignedLawFirmId) {
        res.status(400).json({ error: 'lawFirmId is required' });
        return;
      }

      // Sanitize templates if provided
      const emailTemplate = req.body.emailTemplate || { subject: '', bodyHtml: '' };
      if (emailTemplate.bodyHtml) {
        emailTemplate.bodyHtml = sanitizeEmailHtml(emailTemplate.bodyHtml);
      }

      let landingPageText = req.body.landingPageText || {
        headline: '',
        introHtml: '',
        faqAccordion: [],
        supportContact: ''
      };
      landingPageText = sanitizeLandingPageContent(landingPageText);

      let localizedLandingPageText = req.body.localizedLandingPageText;
      if (localizedLandingPageText) {
        localizedLandingPageText = sanitizeLocalizedLandingPages(localizedLandingPageText);
      }

      const newCase = await Case.create({
        ...req.body,
        lawFirmId: assignedLawFirmId,
        emailTemplate,
        landingPageText,
        ...(localizedLandingPageText !== undefined ? { localizedLandingPageText } : {})
      });

      res.status(201).json({
        message: 'Case created successfully',
        case: newCase
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/cases
   * List cases with tenant isolation, search, and pagination.
   */
  static async listCases(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      // Enforce tenant scoping
      if (user.role !== 'super_admin' && user.role !== 'platform_admin') {
        if (!user.lawFirmId) {
          res.status(403).json({ error: 'User has no law firm tenant assigned' });
          return;
        }
        filter.lawFirmId = user.lawFirmId;
      } else if (req.query.lawFirmId) {
        filter.lawFirmId = req.query.lawFirmId;
      }

      if (req.query.status) {
        filter.status = req.query.status;
      }

      if (req.query.search) {
        const safeSearch = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(safeSearch, 'i');
        filter.$or = [{ name: searchRegex }, { docketNumber: searchRegex }, { caseId: searchRegex }];
      }

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
      const skip = (page - 1) * limit;

      const [cases, total] = await Promise.all([
        Case.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Case.countDocuments(filter)
      ]);

      res.status(200).json({
        cases,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/cases/:id
   * Get case details by ID.
   */
  static async getCase(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      res.status(200).json({ case: caseDoc });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/cases/:id
   * Update case details, disbursement deadline, and templates.
   */
  static async updateCase(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      const updates = { ...req.body };

      // Sanitize templates if updating
      if (updates.emailTemplate) {
        const existingEmail = (caseDoc.emailTemplate as any)?.toObject
          ? (caseDoc.emailTemplate as any).toObject()
          : caseDoc.emailTemplate;
        updates.emailTemplate = {
          ...existingEmail,
          ...updates.emailTemplate
        };
        if (updates.emailTemplate.bodyHtml) {
          updates.emailTemplate.bodyHtml = TemplateService.sanitize(updates.emailTemplate.bodyHtml);
        }
      }

      if (updates.landingPageText) {
        const existingLanding = (caseDoc.landingPageText as any)?.toObject
          ? (caseDoc.landingPageText as any).toObject()
          : caseDoc.landingPageText;
        const mergedLanding = {
          ...existingLanding,
          ...updates.landingPageText
        };
        updates.landingPageText = sanitizeLandingPageContent(mergedLanding);
      }

      if (updates.localizedLandingPageText) {
        const existingLocalized = (caseDoc.localizedLandingPageText as any)?.toObject
          ? (caseDoc.localizedLandingPageText as any).toObject()
          : caseDoc.localizedLandingPageText || {};
        const mergedLocalized = {
          ...existingLocalized,
          ...updates.localizedLandingPageText
        };
        updates.localizedLandingPageText = sanitizeLocalizedLandingPages(mergedLocalized);
      }

      Object.assign(caseDoc, updates);
      await caseDoc.save();

      res.status(200).json({
        message: 'Case updated successfully',
        case: caseDoc
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/cases/:id/claimants/stage-upload
   * Parses uploaded CSV or XLSX and returns validation report without committing.
   */
  static async stageClaimantUpload(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      let buffer: Buffer | string | undefined;
      let filename: string | undefined;

      if ((req as any).file) {
        buffer = (req as any).file.buffer;
        filename = (req as any).file.originalname;
      } else if (req.body?.content) {
        buffer = req.body.content;
        filename = req.body.filename || 'upload.csv';
      } else if (typeof req.body === 'string') {
        buffer = req.body;
      }

      if (!buffer) {
        res.status(400).json({
          error: 'No file uploaded or content provided in request'
        });
        return;
      }

      const stageResult = await IngestionService.stageUpload(caseDoc, buffer, filename);

      res.status(200).json({
        caseId: caseDoc._id.toString(),
        caseName: caseDoc.name,
        ...stageResult
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/cases/:id/claimants/commit-upload
   * Commits staged claimants to the database with generated 64-hex tokens.
   */
  static async commitClaimantUpload(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      let claimantsToCommit = req.body.claimants;

      // If file uploaded directly with commit request
      if (!claimantsToCommit && (req as any).file) {
        const file = (req as any).file;
        const stage = await IngestionService.stageUpload(caseDoc, file.buffer, file.originalname);
        if (!stage.canCommit) {
          res.status(400).json({
            error: 'Uploaded data failed validation and cannot be committed',
            stageResult: stage
          });
          return;
        }
        claimantsToCommit = stage.stagedClaimants;
      }

      if (!claimantsToCommit || !Array.isArray(claimantsToCommit) || claimantsToCommit.length === 0) {
        res.status(400).json({
          error: 'No claimant records provided to commit'
        });
        return;
      }

      const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (let i = 0; i < claimantsToCommit.length; i++) {
        const c = claimantsToCommit[i];
        if (!c || !c.email || typeof c.email !== 'string' || !EMAIL_REGEX.test(c.email)) {
          res.status(400).json({
            error: `Invalid email address in claimant records: '${c?.email ?? ''}'`
          });
          return;
        }
      }

      const commitResult = await IngestionService.commitUpload(caseDoc, claimantsToCommit);

      res.status(201).json({
        message: `Successfully committed ${commitResult.insertedCount} claimants to case`,
        ...commitResult
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/cases/:id/claimants
   * Lists claimants in a case with search, status filtering, and pagination.
   */
  static async listClaimants(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      const caseIdFilter = mongoose.isValidObjectId(caseDoc._id)
        ? { $in: [caseDoc._id, caseDoc._id.toString()] }
        : caseDoc._id;

      const filter: Record<string, any> = {
        caseId: caseIdFilter
      };

      if (req.query.status) {
        filter.status = req.query.status;
      }

      if (req.query.search) {
        const safeSearch = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(safeSearch, 'i');
        filter.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { claimId: searchRegex }
        ];
      }

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
      const skip = (page - 1) * limit;

      const [claimants, total] = await Promise.all([
        Claimant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Claimant.countDocuments(filter)
      ]);

      res.status(200).json({
        caseId: caseDoc._id.toString(),
        claimants,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/cases/:id/templates/preview
   * Renders sanitized and dynamic merge-tag preview.
   */
  static async previewTemplate(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const caseDoc = await findCaseWithTenantCheck(req, res);
      if (!caseDoc) return;

      const language = req.body.language || (req.query.language as string) || caseDoc.defaultLanguage || 'en';
      const type = req.body.type || 'email';

      let template = req.body.template;
      if (!template) {
        if (type === 'landing') {
          const localizedMap = caseDoc.localizedLandingPageText as any;
          const localized = localizedMap?.[language] || (localizedMap?.get ? localizedMap.get(language) : undefined);
          template = localized?.introHtml || caseDoc.landingPageText?.introHtml || '';
        } else {
          template = caseDoc.emailTemplate?.bodyHtml || '';
        }
      }

      const localizedLanding =
        (caseDoc.localizedLandingPageText as any)?.[language] ||
        ((caseDoc.localizedLandingPageText as any)?.get
          ? (caseDoc.localizedLandingPageText as any).get(language)
          : undefined) ||
        caseDoc.landingPageText;

      const sampleData = {
        case_name: caseDoc.name,
        selection_deadline: caseDoc.disbursementDeadline,
        headline: localizedLanding?.headline || caseDoc.landingPageText?.headline,
        ...req.body.sampleData
      };
      const viewport = req.body.viewport || 'desktop';

      const preview = TemplateService.renderPreview(template, sampleData, { viewport });

      res.status(200).json({
        caseId: caseDoc._id.toString(),
        language,
        type,
        landingPageText: localizedLanding,
        ...preview
      });
    } catch (err) {
      next(err);
    }
  }
}
