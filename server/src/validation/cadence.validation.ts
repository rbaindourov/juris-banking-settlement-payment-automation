import { z } from 'zod';
import mongoose from 'mongoose';
import { CADENCE_STAGE_KEYS } from '../models/NotificationCadence';
import { SUPPRESSION_REASONS } from '../models/SuppressionList';

/**
 * Validates a standard 24-character hex MongoDB ObjectId string.
 */
export const objectIdSchema = z
  .string()
  .trim()
  .refine((val) => mongoose.isValidObjectId(val), {
    message: 'Invalid MongoDB ObjectId'
  });

/**
 * Validates 24-hour time string in HH:mm format (00:00 - 23:59).
 */
export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a valid 24-hour time in HH:mm format (e.g. "22:00")');

/**
 * Reusable email schema with automatic lowercase transformation and trimming.
 */
export const normalizedEmailSchema = z
  .string()
  .email('Valid email address required')
  .max(255, 'Email must not exceed 255 characters')
  .transform((val) => val.toLowerCase().trim());

export const cadenceStageKeySchema = z.enum(CADENCE_STAGE_KEYS as unknown as [string, ...string[]]);

/**
 * Localized Quill WYSIWYG template schema (subject + bodyHtml).
 */
export const localizedEmailTemplateSchema = z.object({
  subject: z
    .string()
    .min(1, 'Email subject is required')
    .trim()
    .max(255, 'Email subject must not exceed 255 characters'),
  bodyHtml: z
    .string()
    .min(1, 'Email body HTML is required')
    .trim()
});

/**
 * Localized templates map supporting EN, ES, ZH, VI with fallback.
 */
export const stageTemplatesMapSchema = z
  .object({
    en: localizedEmailTemplateSchema,
    es: localizedEmailTemplateSchema.optional(),
    zh: localizedEmailTemplateSchema.optional(),
    vi: localizedEmailTemplateSchema.optional()
  })
  .catchall(localizedEmailTemplateSchema.optional());

/**
 * Single stage configuration base schema (unrefined ZodObject).
 */
export const cadenceStageConfigBaseSchema = z.object({
  stageKey: cadenceStageKeySchema,
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().default(true),
  triggerType: z.enum(['date_fixed', 'deadline_relative']).default('deadline_relative'),
  offsetHours: z.number().int().default(0),
  fixedDate: z
    .union([z.string(), z.date()])
    .transform((val) => new Date(val))
    .refine((date) => !isNaN(date.getTime()), { message: 'Invalid fixedDate' })
    .optional(),
  templates: stageTemplatesMapSchema
});

/**
 * Single stage configuration schema with refinement.
 */
export const cadenceStageConfigSchema = cadenceStageConfigBaseSchema.refine(
  (stage) => {
    if (stage.triggerType === 'date_fixed' && !stage.fixedDate) {
      return false;
    }
    return true;
  },
  {
    message: 'fixedDate is required when triggerType is "date_fixed"',
    path: ['fixedDate']
  }
);

/**
 * Rolling batch throttling parameters.
 */
export const cadenceThrottlingSchema = z.object({
  batchSize: z
    .number()
    .int()
    .min(1, 'Batch size must be at least 1')
    .max(10000, 'Batch size cannot exceed 10,000 recipients per batch')
    .default(500),
  intervalMinutes: z
    .number()
    .int()
    .min(1, 'Interval must be at least 1 minute')
    .max(1440, 'Interval cannot exceed 24 hours (1440 minutes)')
    .default(15),
  rateLimitPerSecond: z
    .number()
    .int()
    .min(1, 'Rate limit must be at least 1 message per second')
    .max(100, 'Rate limit cannot exceed 100 messages per second')
    .default(25),
  dailyCap: z
    .number()
    .int()
    .min(0, 'Daily cap cannot be negative')
    .max(1000000, 'Daily cap cannot exceed 1,000,000')
    .optional(),
  quietHoursEnabled: z.boolean().default(false),
  quietHoursStart: timeStringSchema.optional().default('22:00'),
  quietHoursEnd: timeStringSchema.optional().default('07:00'),
  timezone: z.string().default('UTC')
});

/**
 * Pre-dispatch suppression filtering flags.
 */
export const cadenceSuppressionSchema = z.object({
  skipCompletedPayments: z.boolean().default(true),
  suppressBounced: z.boolean().default(true),
  checkGlobalSuppression: z.boolean().default(true)
});

/**
 * Create cadence schema (POST /api/cases/:caseId/cadence).
 */
export const createCadenceSchema = z.object({
  name: z.string().min(1).max(100).optional().default('Settlement Notification Cadence'),
  stages: z
    .array(cadenceStageConfigSchema)
    .min(1, 'At least one stage configuration is required'),
  throttling: cadenceThrottlingSchema.default(() => ({
    batchSize: 500,
    intervalMinutes: 15,
    rateLimitPerSecond: 25,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC'
  })),
  suppression: cadenceSuppressionSchema.default(() => ({
    skipCompletedPayments: true,
    suppressBounced: true,
    checkGlobalSuppression: true
  }))
});

/**
 * Update cadence schema (PUT or PATCH /api/cases/:caseId/cadence).
 */
export const updateCadenceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']).optional(),
  stages: z.array(cadenceStageConfigSchema).optional(),
  throttling: cadenceThrottlingSchema.partial().optional(),
  suppression: cadenceSuppressionSchema.partial().optional()
});

/**
 * Schedule preview calculation schema (POST /api/cases/:caseId/cadence/preview-schedule).
 */
export const previewScheduleSchema = z.object({
  throttling: cadenceThrottlingSchema.partial().optional(),
  stages: z.array(cadenceStageConfigBaseSchema.partial()).optional()
});

/**
 * Pause wave schema (POST /api/waves/:waveId/pause).
 */
export const pauseWaveSchema = z.object({
  reason: z.string().max(500, 'Reason must not exceed 500 characters').optional()
});

/**
 * Resume wave schema (POST /api/waves/:waveId/resume).
 */
export const resumeWaveSchema = z.object({
  rescheduleRemaining: z.boolean().default(true),
  newIntervalMinutes: z.number().int().min(1).max(1440).optional()
});

/**
 * Reschedule wave schema (POST /api/waves/:waveId/reschedule).
 */
export const rescheduleWaveSchema = z.object({
  newScheduledDate: z
    .union([z.string(), z.date()])
    .transform((val) => new Date(val))
    .refine((date) => !isNaN(date.getTime()), { message: 'Invalid date format' })
    .refine((date) => date.getTime() > Date.now(), {
      message: 'New scheduled date must be in the future'
    }),
  reason: z.string().max(500, 'Reason must not exceed 500 characters').optional()
});

/**
 * Cancel wave schema (POST /api/waves/:waveId/cancel).
 */
export const cancelWaveSchema = z.object({
  reason: z
    .string()
    .min(1, 'Cancellation reason is required')
    .trim()
    .max(500, 'Reason must not exceed 500 characters')
});

/**
 * Create suppression entry schema (POST /api/suppression).
 */
export const createSuppressionSchema = z.object({
  email: normalizedEmailSchema,
  reason: z.enum(SUPPRESSION_REASONS as unknown as [string, ...string[]]),
  caseId: objectIdSchema.optional().nullable(),
  diagnosticMessage: z.string().max(500).optional(),
  metadata: z.record(z.any()).optional()
});

/**
 * Query suppression list schema (GET /api/suppression).
 */
export const querySuppressionSchema = z.object({
  email: z.string().optional(),
  reason: z.enum(SUPPRESSION_REASONS as unknown as [string, ...string[]]).optional(),
  caseId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

/**
 * Route Parameter Schemas
 */
export const caseIdParamSchema = z.object({
  caseId: objectIdSchema
});

export const waveIdParamSchema = z.object({
  waveId: z.string().min(1, 'Wave ID is required').trim()
});

export const suppressionIdParamSchema = z.object({
  id: objectIdSchema
});

// TypeScript Inferred Types
export type ICreateCadenceInput = z.infer<typeof createCadenceSchema>;
export type IUpdateCadenceInput = z.infer<typeof updateCadenceSchema>;
export type ICadenceThrottlingConfig = z.infer<typeof cadenceThrottlingSchema>;
export type ICadenceSuppressionConfig = z.infer<typeof cadenceSuppressionSchema>;
export type ICadenceStageConfig = z.infer<typeof cadenceStageConfigSchema>;
export type IPauseWaveInput = z.infer<typeof pauseWaveSchema>;
export type IResumeWaveInput = z.infer<typeof resumeWaveSchema>;
export type IRescheduleWaveInput = z.infer<typeof rescheduleWaveSchema>;
export type ICancelWaveInput = z.infer<typeof cancelWaveSchema>;
export type ICreateSuppressionInput = z.infer<typeof createSuppressionSchema>;
export type IQuerySuppressionInput = z.infer<typeof querySuppressionSchema>;
