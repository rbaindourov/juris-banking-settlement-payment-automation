import mongoose, { Schema, Document } from 'mongoose';
import { FraudRiskTier, FRAUD_RISK_TIERS } from './Claimant';

export type ThreatIndicatorType =
  | 'payout_hash'
  | 'device_fingerprint'
  | 'ip_subnet'
  | 'email_domain';

export const THREAT_INDICATOR_TYPES: readonly ThreatIndicatorType[] = [
  'payout_hash',
  'device_fingerprint',
  'ip_subnet',
  'email_domain'
] as const;

export interface IMultiTenantThreatIndicator extends Document {
  indicatorType: ThreatIndicatorType;
  indicatorValue: string;
  severity: FraudRiskTier;
  hitCount: number;
  caseIds: string[];
  lawFirmIds: string[];
  distinctCasesCount: number;
  distinctTenantsCount: number;
  blocked: boolean;
  description?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MultiTenantThreatIndicatorSchema = new Schema<IMultiTenantThreatIndicator>(
  {
    indicatorType: {
      type: String,
      enum: {
        values: THREAT_INDICATOR_TYPES,
        message: 'Invalid threat indicator type: {VALUE}'
      },
      required: [true, 'Indicator type is required'],
      index: true
    },
    indicatorValue: {
      type: String,
      required: [true, 'Indicator value is required'],
      trim: true,
      index: true
    },
    severity: {
      type: String,
      enum: {
        values: FRAUD_RISK_TIERS,
        message: 'Invalid threat severity tier: {VALUE}'
      },
      default: 'medium',
      index: true
    },
    hitCount: {
      type: Number,
      default: 1,
      min: [1, 'Hit count must be at least 1']
    },
    caseIds: {
      type: [String],
      default: []
    },
    lawFirmIds: {
      type: [String],
      default: []
    },
    distinctCasesCount: {
      type: Number,
      default: 1,
      min: [1, 'Distinct cases count must be at least 1']
    },
    distinctTenantsCount: {
      type: Number,
      default: 1,
      min: [1, 'Distinct tenants count must be at least 1']
    },
    blocked: {
      type: Boolean,
      default: false,
      index: true
    },
    description: {
      type: String,
      trim: true
    },
    firstSeenAt: {
      type: Date,
      default: Date.now
    },
    lastSeenAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound unique index on (indicatorType, indicatorValue)
MultiTenantThreatIndicatorSchema.index({ indicatorType: 1, indicatorValue: 1 }, { unique: true });
MultiTenantThreatIndicatorSchema.index({ indicatorType: 1, distinctCasesCount: -1 });
MultiTenantThreatIndicatorSchema.index({ indicatorType: 1, hitCount: -1 });

export const MultiTenantThreatIndicator =
  (mongoose.models.MultiTenantThreatIndicator as mongoose.Model<IMultiTenantThreatIndicator>) ||
  mongoose.model<IMultiTenantThreatIndicator>(
    'MultiTenantThreatIndicator',
    MultiTenantThreatIndicatorSchema
  );
