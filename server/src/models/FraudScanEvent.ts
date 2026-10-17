import mongoose, { Schema, Document } from 'mongoose';
import {
  FraudRiskTier,
  FRAUD_RISK_TIERS,
  FraudReviewStatus,
  FRAUD_REVIEW_STATUSES
} from './Claimant';

export type FraudScanType =
  | 'portal_submission'
  | 'ingestion_prescan'
  | 'manual_rescan'
  | 'pre_sftp_gate';

export const FRAUD_SCAN_TYPES: readonly FraudScanType[] = [
  'portal_submission',
  'ingestion_prescan',
  'manual_rescan',
  'pre_sftp_gate'
] as const;

export interface IFraudScanEvent extends Document {
  scanType: FraudScanType;
  caseId: mongoose.Types.ObjectId | string;
  lawFirmId?: string;
  claimantId?: mongoose.Types.ObjectId | string;
  claimId: string;
  fraudScore: number;
  riskTier: FraudRiskTier;
  reviewStatus: FraudReviewStatus;
  signalsTriggered: string[];
  scanDurationMs: number;
  ipAddress?: string;
  ipSubnet?: string;
  emailDomain?: string;
  deviceFingerprintHash?: string;
  payoutEndpointHash?: string;
  settlementAmount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const FraudScanEventSchema = new Schema<IFraudScanEvent>(
  {
    scanType: {
      type: String,
      enum: {
        values: FRAUD_SCAN_TYPES,
        message: 'Invalid fraud scan type: {VALUE}'
      },
      default: 'portal_submission',
      required: [true, 'Scan type is required'],
      index: true
    },
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required'],
      index: true
    },
    lawFirmId: {
      type: String,
      trim: true,
      index: true
    },
    claimantId: {
      type: Schema.Types.Mixed,
      ref: 'Claimant',
      index: true
    },
    claimId: {
      type: String,
      required: [true, 'Claim ID is required'],
      trim: true
    },
    fraudScore: {
      type: Number,
      required: [true, 'Fraud score is required'],
      min: [0, 'Fraud score cannot be less than 0'],
      max: [100, 'Fraud score cannot exceed 100']
    },
    riskTier: {
      type: String,
      enum: {
        values: FRAUD_RISK_TIERS,
        message: 'Invalid fraud risk tier: {VALUE}'
      },
      required: [true, 'Risk tier is required'],
      index: true
    },
    reviewStatus: {
      type: String,
      enum: {
        values: FRAUD_REVIEW_STATUSES,
        message: 'Invalid fraud review status: {VALUE}'
      },
      required: [true, 'Review status is required'],
      index: true
    },
    signalsTriggered: {
      type: [String],
      default: []
    },
    scanDurationMs: {
      type: Number,
      default: 1,
      min: [0, 'Scan duration cannot be negative']
    },
    ipAddress: {
      type: String,
      trim: true
    },
    ipSubnet: {
      type: String,
      trim: true,
      index: true
    },
    emailDomain: {
      type: String,
      lowercase: true,
      trim: true,
      index: true
    },
    deviceFingerprintHash: {
      type: String,
      trim: true,
      index: true
    },
    payoutEndpointHash: {
      type: String,
      trim: true,
      index: true
    },
    settlementAmount: {
      type: Number,
      default: 0,
      min: [0, 'Settlement amount cannot be negative']
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
        if (ret.claimantId && typeof ret.claimantId === 'object' && ret.claimantId._id) {
          ret.claimantId = ret.claimantId._id.toString();
        } else if (ret.claimantId && typeof ret.claimantId !== 'string') {
          ret.claimantId = ret.claimantId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound indexes for real-time scanning metrics and sliding-window velocity queries
FraudScanEventSchema.index({ caseId: 1, createdAt: -1 });
FraudScanEventSchema.index({ lawFirmId: 1, createdAt: -1 });
FraudScanEventSchema.index({ ipSubnet: 1, createdAt: -1 });
FraudScanEventSchema.index({ deviceFingerprintHash: 1, createdAt: -1 });
FraudScanEventSchema.index({ payoutEndpointHash: 1, createdAt: -1 });

export const FraudScanEvent =
  (mongoose.models.FraudScanEvent as mongoose.Model<IFraudScanEvent>) ||
  mongoose.model<IFraudScanEvent>('FraudScanEvent', FraudScanEventSchema);
