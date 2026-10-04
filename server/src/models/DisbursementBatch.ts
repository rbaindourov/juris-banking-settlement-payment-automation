import mongoose, { Schema, Document } from 'mongoose';

export type DisbursementBatchStatus =
  | 'spooled'
  | 'uploaded'
  | 'reconciled'
  | 'failed';

export const DISBURSEMENT_BATCH_STATUSES: readonly DisbursementBatchStatus[] = [
  'spooled',
  'uploaded',
  'reconciled',
  'failed'
] as const;

export interface IDisbursementBatch extends Document {
  batchId: string;
  caseId: mongoose.Types.ObjectId | string;
  filename: string;
  filePath: string;
  sha256: string;
  totalRecords: number;
  totalAmount: number;
  claimantIds: mongoose.Types.ObjectId[];
  railBreakdown: Record<string, { count: number; amount: number }>;
  status: DisbursementBatchStatus;
  generatedBy?: mongoose.Types.ObjectId | string;
  generatedAt: Date;
  uploadedAt?: Date;
  reconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DisbursementBatchSchema = new Schema<IDisbursementBatch>(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: true,
      index: true
    },
    filename: {
      type: String,
      required: true,
      trim: true
    },
    filePath: {
      type: String,
      required: true,
      trim: true
    },
    sha256: {
      type: String,
      required: true,
      trim: true
    },
    totalRecords: {
      type: Number,
      required: true,
      min: 1
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    claimantIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Claimant'
      }
    ],
    railBreakdown: {
      type: Schema.Types.Mixed,
      default: () => ({})
    },
    status: {
      type: String,
      enum: {
        values: DISBURSEMENT_BATCH_STATUSES,
        message: 'Invalid batch status: {VALUE}'
      },
      default: 'spooled',
      index: true
    },
    generatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    generatedAt: {
      type: Date,
      default: Date.now
    },
    uploadedAt: {
      type: Date
    },
    reconciledAt: {
      type: Date
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

export const DisbursementBatch =
  (mongoose.models.DisbursementBatch as mongoose.Model<IDisbursementBatch>) ||
  mongoose.model<IDisbursementBatch>('DisbursementBatch', DisbursementBatchSchema);
