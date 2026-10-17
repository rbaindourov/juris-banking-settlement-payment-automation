import { z } from 'zod';
import { FRAUD_RISK_TIERS, FRAUD_REVIEW_STATUSES } from '../models/Claimant';

/**
 * Validates optional behavioral & device telemetry payload sent from the Claimant Portal landing page widget.
 */
export const portalTelemetryObjectSchema = z.object({
  dwellTimeMs: z.number().min(0, 'dwellTimeMs cannot be negative').max(86_400_000).optional(),
  interactionCount: z.number().int().min(0, 'interactionCount cannot be negative').max(100_000).optional(),
  keystrokeCount: z.number().int().min(0, 'keystrokeCount cannot be negative').max(100_000).optional(),
  webdriverDetected: z.boolean().optional(),
  deviceFingerprint: z.string().trim().min(1).max(256).optional(),
  deviceFingerprintHash: z.string().trim().min(1).max(256).optional(),
  timezoneOffset: z.number().int().min(-840).max(840).optional(),
  screenResolution: z.string().trim().max(64).optional()
});

export const portalTelemetrySchema = portalTelemetryObjectSchema.optional();

/**
 * Validates manual administrator adjudication (`approve` or `reject`) on a flagged/quarantined claim.
 */
export const fraudReviewActionSchema = z.object({
  action: z.enum(['approve', 'reject'], {
    errorMap: () => ({ message: "Review action must be either 'approve' or 'reject'" })
  }),
  notes: z
    .string({ required_error: 'Review justification notes are required' })
    .trim()
    .min(3, 'Review justification notes must be at least 3 characters')
    .max(1000, 'Review justification notes cannot exceed 1000 characters')
});

/**
 * Validates query filter parameters for `GET /api/cases/:caseId/fraud/claimants`.
 */
export const fraudClaimantFilterSchema = z.object({
  riskTier: z.enum(FRAUD_RISK_TIERS as unknown as [string, ...string[]]).optional(),
  reviewStatus: z.enum(FRAUD_REVIEW_STATUSES as unknown as [string, ...string[]]).optional(),
  signalCode: z.string().trim().min(1).max(120).optional(),
  minScore: z.coerce
    .number()
    .min(0, 'minScore cannot be less than 0')
    .max(100, 'minScore cannot exceed 100')
    .optional(),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  limit: z.coerce.number().int().min(1, 'limit must be at least 1').max(200, 'limit cannot exceed 200').default(25)
});

export type PortalTelemetryInput = z.infer<typeof portalTelemetrySchema>;
export type FraudReviewActionInput = z.infer<typeof fraudReviewActionSchema>;
export type FraudClaimantFilterInput = z.infer<typeof fraudClaimantFilterSchema>;
