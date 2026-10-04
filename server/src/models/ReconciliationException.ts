import mongoose, { Schema, Document, Model } from 'mongoose';

export type ExceptionType =
  | 'ach_return'
  | 'card_decline'
  | 'check_returned'
  | 'invalid_routing'
  | 'unmatched_claim'
  | 'other';

export const EXCEPTION_TYPES: readonly ExceptionType[] = [
  'ach_return',
  'card_decline',
  'check_returned',
  'invalid_routing',
  'unmatched_claim',
  'other'
] as const;

export type ResolutionStatus =
  | 'open'
  | 'resolved'
  | 'resolved_switched_to_check'
  | 'resolved_requeued'
  | 'resolved_resent_email'
  | 'fallback_assigned';

export const RESOLUTION_STATUSES: readonly ResolutionStatus[] = [
  'open',
  'resolved',
  'resolved_switched_to_check',
  'resolved_requeued',
  'resolved_resent_email',
  'fallback_assigned'
] as const;

export interface IReconciliationException extends Document {
  caseId: mongoose.Types.ObjectId | string;
  claimantId?: mongoose.Types.ObjectId | string | null;
  claimId: string;
  batchId?: string;
  reportId?: string;
  dashReferenceId?: string;
  paymentRail?: string;
  amount: number;
  currency: string;
  status: 'RETURNED' | 'REJECTED' | 'UNMATCHED';
  exceptionType: ExceptionType;
  returnCode: string;
  returnReason?: string;
  rawReportRow?: string | Record<string, any>;

  // Resolution State & Audit Trail
  resolved: boolean;
  resolutionStatus: ResolutionStatus;
  resolvedAt?: Date;
  resolvedBy?: mongoose.Types.ObjectId | string | null;
  resolutionAction?: string;
  resolutionNotes?: string;
  resolutionPayload?: Record<string, any>;

  // Virtuals for E2E Compatibility
  errorCode?: string;
  errorMessage?: string;
  paymentMethod?: string;

  createdAt: Date;
  updatedAt: Date;
}

const ReconciliationExceptionSchema = new Schema<IReconciliationException>(
  {
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required'],
      index: true
    },
    claimantId: {
      type: Schema.Types.ObjectId,
      ref: 'Claimant',
      default: null,
      index: true
    },
    claimId: {
      type: String,
      required: [true, 'Claim ID is required'],
      trim: true,
      index: true
    },
    batchId: {
      type: String,
      trim: true,
      index: true
    },
    reportId: {
      type: String,
      trim: true,
      index: true
    },
    dashReferenceId: {
      type: String,
      trim: true
    },
    paymentRail: {
      type: String,
      trim: true,
      default: 'ach'
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0, 'Amount cannot be negative']
    },
    currency: {
      type: String,
      default: 'USD',
      trim: true
    },
    status: {
      type: String,
      enum: ['RETURNED', 'REJECTED', 'UNMATCHED'],
      required: true,
      default: 'RETURNED',
      index: true
    },
    exceptionType: {
      type: String,
      enum: {
        values: EXCEPTION_TYPES,
        message: 'Invalid exception type: {VALUE}'
      },
      required: true,
      index: true
    },
    returnCode: {
      type: String,
      required: [true, 'Return/Error code is required'],
      trim: true,
      index: true
    },
    returnReason: {
      type: String,
      trim: true
    },
    rawReportRow: {
      type: Schema.Types.Mixed
    },
    resolved: {
      type: Boolean,
      default: false,
      index: true
    },
    resolutionStatus: {
      type: String,
      enum: {
        values: RESOLUTION_STATUSES,
        message: 'Invalid resolution status: {VALUE}'
      },
      default: 'open',
      index: true
    },
    resolvedAt: {
      type: Date
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    resolutionAction: {
      type: String,
      trim: true
    },
    resolutionNotes: {
      type: String,
      trim: true
    },
    resolutionPayload: {
      type: Schema.Types.Mixed
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

// Virtual getter and setter for errorCode alias
ReconciliationExceptionSchema.virtual('errorCode')
  .get(function () {
    return this.returnCode;
  })
  .set(function (val: string) {
    this.returnCode = val;
  });

// Virtual getter and setter for errorMessage alias
ReconciliationExceptionSchema.virtual('errorMessage')
  .get(function () {
    return this.returnReason;
  })
  .set(function (val: string) {
    this.returnReason = val;
  });

// Virtual getter and setter for paymentMethod alias
ReconciliationExceptionSchema.virtual('paymentMethod')
  .get(function () {
    return this.paymentRail;
  })
  .set(function (val: string) {
    this.paymentRail = val;
  });

// Compound indexes
ReconciliationExceptionSchema.index({ caseId: 1, resolved: 1, createdAt: -1 });
ReconciliationExceptionSchema.index({ caseId: 1, returnCode: 1 });
ReconciliationExceptionSchema.index({ caseId: 1, exceptionType: 1 });
ReconciliationExceptionSchema.index({ caseId: 1, resolutionStatus: 1 });

export const ReconciliationException =
  (mongoose.models.ReconciliationException as mongoose.Model<IReconciliationException>) ||
  mongoose.model<IReconciliationException>('ReconciliationException', ReconciliationExceptionSchema);
