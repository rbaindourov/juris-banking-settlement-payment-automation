import { Request, Response } from 'express';
import { Claimant } from '../models/Claimant';
import { Case, ICase, ILandingPageText } from '../models/Case';
import { sanitizeEmailHtml, formatCurrency } from './../services/template.service';
import {
  validatePaymentRailPayload,
  generateConfirmationNumber,
  normalizeRailName
} from '../services/portalValidation.service';

const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

function resolveLocalizedLandingText(
  caseDoc: ICase,
  requestedLang?: string
): { currentLanguage: string; landingPageText: ILandingPageText } {
  const supported = (caseDoc.supportedLanguages && caseDoc.supportedLanguages.length > 0)
    ? caseDoc.supportedLanguages
    : ['en'];
  const defaultLang = caseDoc.defaultLanguage || 'en';

  let targetLang = requestedLang ? requestedLang.toLowerCase().trim() : defaultLang;
  if (!supported.includes(targetLang)) {
    targetLang = defaultLang;
  }

  let rawText: ILandingPageText | undefined;
  const localizedMap = caseDoc.localizedLandingPageText as any;

  if (localizedMap) {
    if (typeof localizedMap.get === 'function') {
      rawText = localizedMap.get(targetLang);
    } else if (localizedMap[targetLang]) {
      rawText = localizedMap[targetLang];
    }
  }

  if (!rawText || !rawText.headline) {
    rawText = caseDoc.landingPageText;
  }

  const sanitizedText: ILandingPageText = {
    headline: rawText?.headline || 'Official Settlement Payment Selection Portal',
    introHtml: sanitizeEmailHtml(rawText?.introHtml || '<p>Please select your preferred payment disbursement method below before the court-ordered deadline.</p>'),
    faqAccordion: (rawText?.faqAccordion || []).map((faq) => ({
      question: faq.question || '',
      answer: sanitizeEmailHtml(faq.answer || '')
    })),
    supportContact: rawText?.supportContact || ''
  };

  return {
    currentLanguage: targetLang,
    landingPageText: sanitizedText
  };
}

export class PortalController {
  /**
   * GET /api/public/claim/:token
   */
  public static async getClaim(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token || '');

    if (!token || !TOKEN_REGEX.test(token)) {
      res.status(400).json({
        error: 'INVALID_TOKEN_FORMAT',
        message: 'Token must be a 64-character hexadecimal string.'
      });
      return;
    }

    try {
      const claimant = await Claimant.findOne({ paymentSelectionToken: token });
      if (!claimant) {
        res.status(404).json({
          error: 'CLAIM_NOT_FOUND',
          message: 'No claim record matching this token.'
        });
        return;
      }

      const caseDoc = await Case.findById(claimant.caseId);
      if (!caseDoc) {
        res.status(404).json({
          error: 'CASE_NOT_FOUND',
          message: 'Associated case record not found.'
        });
        return;
      }

      const isExpired = new Date() > new Date(caseDoc.disbursementDeadline);
      let effectiveStatus: string = claimant.status;
      if (claimant.status === 'pending_selection' && isExpired) {
        effectiveStatus = 'expired';
      }

      const langQuery = typeof req.query.lang === 'string' ? req.query.lang : undefined;
      const acceptLangHeader = req.headers['accept-language'];
      const langHeader = acceptLangHeader ? acceptLangHeader.split(',')[0].split('-')[0].trim() : undefined;
      const requestedLang = langQuery || langHeader;

      const { currentLanguage, landingPageText } = resolveLocalizedLandingText(caseDoc, requestedLang);

      const formattedDeadline = new Date(caseDoc.disbursementDeadline).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

      res.status(200).json({
        claim: {
          token: claimant.paymentSelectionToken,
          claimantToken: claimant.paymentSelectionToken,
          selectionToken: claimant.paymentSelectionToken,
          claimId: claimant.claimId,
          firstName: claimant.firstName,
          lastName: claimant.lastName,
          settlementAmount: claimant.settlementAmount,
          formattedAwardAmount: formatCurrency(claimant.settlementAmount),
          status: effectiveStatus,
          isExpired,
          disbursementDeadline: caseDoc.disbursementDeadline,
          formattedDeadline,
          assignedFallbackMethod: caseDoc.fallbackPaymentMethod,
          selectedPaymentMethod: claimant.selectedPaymentMethod || null,
          confirmationNumber: claimant.confirmationNumber || null,
          selectedAt: claimant.selectedAt || null
        },
        case: {
          caseId: caseDoc.caseId || caseDoc._id,
          name: caseDoc.name,
          caseName: caseDoc.name,
          docketNumber: caseDoc.docketNumber,
          settlementFundTotal: caseDoc.settlementFundTotal,
          fallbackPaymentMethod: caseDoc.fallbackPaymentMethod,
          defaultLanguage: caseDoc.defaultLanguage || 'en',
          supportedLanguages: caseDoc.supportedLanguages || ['en'],
          currentLanguage,
          landingPageText
        }
      });
    } catch (err: any) {
      console.error('[PortalController.getClaim] Unexpected error:', err.message);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while fetching the claim details.'
      });
    }
  }

  /**
   * POST /api/public/claim/:token/select-payment
   */
  public static async selectPayment(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token || '');

    if (!token || !TOKEN_REGEX.test(token)) {
      res.status(400).json({
        error: 'INVALID_TOKEN_FORMAT',
        message: 'Token must be a 64-character hexadecimal string.'
      });
      return;
    }

    try {
      const claimant = await Claimant.findOne({ paymentSelectionToken: token });
      if (!claimant) {
        res.status(404).json({
          error: 'CLAIM_NOT_FOUND',
          message: 'No claim record matching this token.'
        });
        return;
      }

      const caseDoc = await Case.findById(claimant.caseId);
      if (!caseDoc) {
        res.status(404).json({
          error: 'CASE_NOT_FOUND',
          message: 'Associated case record not found.'
        });
        return;
      }

      // 1. Deadline Enforcement Check
      const now = new Date();
      if (now > new Date(caseDoc.disbursementDeadline)) {
        res.status(403).json({
          status: 403,
          error: 'DEADLINE_PASSED',
          message: 'Payment election deadline has expired. Default court fallback assigned.',
          assignedFallbackMethod: caseDoc.fallbackPaymentMethod,
          disbursementDeadline: caseDoc.disbursementDeadline
        });
        return;
      }

      // 2. Prevent mutation if already queued, batched, or disbursed
      if (claimant.status === 'disbursed') {
        res.status(400).json({
          error: 'ALREADY_DISBURSED',
          message: 'Settlement funds for this claim have already been disbursed.'
        });
        return;
      }

      if (claimant.status === 'queued_for_sftp' || (claimant.status as string) === 'batched') {
        res.status(400).json({
          error: 'ALREADY_BATCHED',
          message: 'Payment method cannot be changed once disbursement batch processing has begun.'
        });
        return;
      }

      const { method, details, certificationAffirmed, signature } = req.body || {};

      // 3. Legal Perjury Affirmation Check
      if (certificationAffirmed !== true) {
        res.status(400).json({
          error: 'CERTIFICATION_REQUIRED',
          message: 'You must declare under penalty of perjury that all submitted information is accurate.'
        });
        return;
      }

      // 4. Typed Signature Check
      if (!signature || typeof signature !== 'string' || signature.trim().length < 2) {
        res.status(400).json({
          error: 'SIGNATURE_REQUIRED',
          message: 'A valid electronic signature (full legal name, minimum 2 characters) is required.'
        });
        return;
      }

      // 5. Payment Rail Validation
      const claimantFullName = `${claimant.firstName} ${claimant.lastName}`.trim();
      const validation = validatePaymentRailPayload(method, details, claimantFullName);

      if (!validation.valid) {
        res.status(400).json({
          error: 'INVALID_PAYMENT_DETAILS',
          message: validation.error || 'Payment rail validation failed.'
        });
        return;
      }

      const normalizedRail = normalizeRailName(method);

      // 6. Signature Audit Trail
      const signatureIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || '127.0.0.1';
      const signatureUserAgent = (req.headers['user-agent'] as string) || 'unknown';
      const signedAt = new Date();
      const confirmationNumber = generateConfirmationNumber(caseDoc.name || caseDoc.docketNumber, signedAt);

      const receipt = {
        confirmationNumber,
        claimId: claimant.claimId,
        claimantName: claimantFullName,
        caseName: caseDoc.name,
        docketNumber: caseDoc.docketNumber,
        selectedMethod: normalizedRail,
        amount: claimant.settlementAmount,
        formattedAmount: formatCurrency(claimant.settlementAmount),
        timestamp: signedAt.toISOString(),
        digitalSignature: signature.trim(),
        ipAddress: signatureIp,
        maskedDetails: validation.maskedDetails || {},
        assignedFallbackMethod: caseDoc.fallbackPaymentMethod
      };

      // 7. Persist Election State
      claimant.status = 'selected';
      claimant.selectedPaymentMethod = normalizedRail;
      claimant.paymentDetails = validation.sanitizedDetails;
      claimant.confirmationNumber = confirmationNumber;
      claimant.receiptDetails = receipt;
      claimant.selectedAt = signedAt;
      claimant.digitalSignature = signature.trim();
      claimant.certificationAffirmed = true;
      claimant.signedAt = signedAt;
      claimant.signatureIp = signatureIp;
      claimant.signatureUserAgent = signatureUserAgent;

      await claimant.save();

      res.status(200).json({
        success: true,
        confirmationNumber,
        status: 'selected',
        receipt
      });
    } catch (err: any) {
      console.error('[PortalController.selectPayment] Error:', err.message);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while saving your payment election.'
      });
    }
  }

  /**
   * GET /api/public/claim/:token/receipt
   */
  public static async getReceipt(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token || '');

    if (!token || !TOKEN_REGEX.test(token)) {
      res.status(400).json({
        error: 'INVALID_TOKEN_FORMAT',
        message: 'Token must be a 64-character hexadecimal string.'
      });
      return;
    }

    try {
      const claimant = await Claimant.findOne({ paymentSelectionToken: token });
      if (!claimant) {
        res.status(404).json({
          error: 'CLAIM_NOT_FOUND',
          message: 'No claim record matching this token.'
        });
        return;
      }

      if (!claimant.receiptDetails || !claimant.confirmationNumber) {
        res.status(400).json({
          error: 'NO_RECEIPT_AVAILABLE',
          message: 'No completed payment election has been recorded for this claim.'
        });
        return;
      }

      res.status(200).json({
        success: true,
        receipt: claimant.receiptDetails
      });
    } catch (err: any) {
      console.error('[PortalController.getReceipt] Error:', err.message);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while fetching the payment receipt.'
      });
    }
  }
}
