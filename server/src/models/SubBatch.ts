import mongoose, { Schema, Document } from 'mongoose';

export type SubBatchStatus =
  | 'pending'
  | 'in_progress'
  | 'processing'
  | 'completed'
  | 'paused'
  | 'cancelled'
  | 'failed';

export const SUB_BATCH_STATUSES: readonly SubBatchStatus[] = [
  'pending',
  'in_progress',
  'processing',
  'completed',
  'paused',
  'cancelled',
  'failed'
] as const;

export type RecipientDispatchStatus =
  | 'queued'
  | 'dispatched'
  | 'skipped_completed'
  | 'suppressed_bounced'
  | 'failed';

export const RECIPIENT_DISPATCH_STATUSES: readonly RecipientDispatchStatus[] = [
  'queued',
  'dispatched',
  'skipped_completed',
  'suppressed_bounced',
  'failed'
] as const;

export interface ISubBatchRecipient {
  claimantId: mongoose.Types.ObjectId | string;
  claimId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  settlementAmount?: number;
  paymentSelectionToken?: string;
  preferredLanguage?: string;
  status: RecipientDispatchStatus;
  skipReason?: string;
  dispatchedAt?: Date;
  messageId?: string;
  error?: string;
}

export interface ISubBatchExecutionLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: Record<string, any>;
}

export interface ISubBatch extends Document {
  subBatchId: string;
  waveId: mongoose.Types.ObjectId | string;
  caseId: mongoose.Types.ObjectId | string;
  chunkIndex: number;
  totalChunks: number;
  claimantIds: Array<mongoose.Types.ObjectId | string>;
  recipients: ISubBatchRecipient[];
  status: SubBatchStatus;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  recipientCount: number;
  dispatchedCount: number;
  skippedCompletedCount: number;
  suppressedBouncedCount: number;
  failedCount: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  error?: string;
  agendaJobId?: string;
  executionLogs: ISubBatchExecutionLog[];
  createdAt: Date;
  updatedAt: Date;
}

const SubBatchRecipientSchema = new Schema<ISubBatchRecipient>(
  {
    claimantId: {
      type: Schema.Types.Mixed,
      ref: 'Claimant',
      required: [true, 'Claimant ID is required']
    },
    claimId: {
      type: String,
      required: [true, 'Claim ID is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Recipient email is required'],
      lowercase: true,
      trim: true
    },
    firstName: {
      type: String,
      trim: true
    },
    lastName: {
      type: String,
      trim: true
    },
    settlementAmount: {
      type: Number
    },
    paymentSelectionToken: {
      type: String,
      trim: true
    },
    preferredLanguage: {
      type: String,
      default: 'en',
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: RECIPIENT_DISPATCH_STATUSES,
        message: 'Invalid recipient dispatch status: {VALUE}'
      },
      default: 'queued',
      index: true
    },
    skipReason: {
      type: String,
      trim: true
    },
    dispatchedAt: {
      type: Date
    },
    messageId: {
      type: String,
      trim: true
    },
    error: {
      type: String
    }
  },
  { _id: false }
);

const SubBatchExecutionLogSchema = new Schema<ISubBatchExecutionLog>(
  {
    timestamp: {
      type: Date,
      default: Date.now
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error'],
      default: 'info'
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    details: {
      type: Schema.Types.Mixed
    }
  },
  { _id: false }
);

const SubBatchSchema = new Schema<ISubBatch>(
  {
    subBatchId: {
      type: String,
      required: [true, 'SubBatch ID is required'],
      trim: true
    },
    waveId: {
      type: Schema.Types.Mixed,
      ref: 'EmailWave',
      required: [true, 'Wave ID is required']
    },
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required']
    },
    chunkIndex: {
      type: Number,
      required: [true, 'Chunk index is required'],
      min: [0, 'Chunk index cannot be negative'],
      validate: {
        validator: function (this: any, val: number) {
          if (this.totalChunks != null && this.totalChunks > 0 && val >= this.totalChunks) {
            return false;
          }
          return true;
        },
        message: 'chunkIndex must be strictly less than totalChunks'
      }
    },
    totalChunks: {
      type: Number,
      required: [true, 'Total chunks is required'],
      min: [1, 'Total chunks must be at least 1']
    },
    claimantIds: [
      {
        type: Schema.Types.Mixed,
        ref: 'Claimant'
      }
    ],
    recipients: {
      type: [SubBatchRecipientSchema],
      default: []
    },
    status: {
      type: String,
      enum: {
        values: SUB_BATCH_STATUSES,
        message: 'Invalid sub-batch status: {VALUE}'
      },
      default: 'pending'
    },
    scheduledAt: {
      type: Date,
      required: [true, 'Scheduled time is required']
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    },
    recipientCount: {
      type: Number,
      default: 0,
      min: 0
    },
    dispatchedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    skippedCompletedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    suppressedBouncedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    failedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0
    },
    lastError: {
      type: String
    },
    error: {
      type: String
    },
    agendaJobId: {
      type: String,
      index: true,
      trim: true
    },
    executionLogs: {
      type: [SubBatchExecutionLogSchema],
      default: []
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
SubBatchSchema.index({ subBatchId: 1 }, { unique: true });
SubBatchSchema.index({ waveId: 1, chunkIndex: 1 }, { unique: true });
SubBatchSchema.index({ waveId: 1, status: 1 });
SubBatchSchema.index({ status: 1, scheduledAt: 1 });
SubBatchSchema.index({ caseId: 1 });

export const SubBatch =
  (mongoose.models.SubBatch as mongoose.Model<ISubBatch>) ||
  mongoose.model<ISubBatch>('SubBatch', SubBatchSchema);
