import mongoose, { Schema, Document } from 'mongoose';

export type SuppressionReason =
  | 'bounced'
  | 'hard_bounce'
  | 'soft_bounce_max_retries'
  | 'opt_out'
  | 'complaint'
  | 'invalid_syntax'
  | 'manual';

export const SUPPRESSION_REASONS: readonly SuppressionReason[] = [
  'bounced',
  'hard_bounce',
  'soft_bounce_max_retries',
  'opt_out',
  'complaint',
  'invalid_syntax',
  'manual'
] as const;

export type SuppressionSource =
  | 'gmail_dsn'
  | 'smtp_rejection'
  | 'claimant_opt_out'
  | 'admin_manual'
  | 'preflight_syntax';

export const SUPPRESSION_SOURCES: readonly SuppressionSource[] = [
  'gmail_dsn',
  'smtp_rejection',
  'claimant_opt_out',
  'admin_manual',
  'preflight_syntax'
] as const;

export interface ISuppressionList extends Document {
  email: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  diagnosticMessage?: string;
  caseId?: mongoose.Types.ObjectId | string | null;
  lawFirmId?: string | null;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SuppressionListSchema = new Schema<ISuppressionList>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address']
    },
    reason: {
      type: String,
      enum: {
        values: SUPPRESSION_REASONS,
        message: 'Invalid suppression reason: {VALUE}'
      },
      default: 'manual',
      required: [true, 'Suppression reason is required']
    },
    source: {
      type: String,
      enum: {
        values: SUPPRESSION_SOURCES,
        message: 'Invalid suppression source: {VALUE}'
      },
      default: 'admin_manual',
      index: true
    },
    diagnosticMessage: {
      type: String,
      trim: true
    },
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      default: null
    },
    lawFirmId: {
      type: String,
      trim: true,
      default: null
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        if (ret.caseId && typeof ret.caseId === 'object' && ret.caseId._id) {
          ret.caseId = ret.caseId._id.toString();
        } else if (ret.caseId && typeof ret.caseId !== 'string') {
          ret.caseId = ret.caseId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Indexes
SuppressionListSchema.index({ email: 1, caseId: 1 }, { unique: true });
SuppressionListSchema.index({ email: 1 });
SuppressionListSchema.index({ reason: 1 });
SuppressionListSchema.index({ lawFirmId: 1 });

export const SuppressionList =
  (mongoose.models.SuppressionList as mongoose.Model<ISuppressionList>) ||
  mongoose.model<ISuppressionList>('SuppressionList', SuppressionListSchema);
