import mongoose, { Schema, Document, Model } from 'mongoose';

export type ClaimantStatus =
  | 'pending_selection'
  | 'selected'
  | 'queued_for_sftp'
  | 'disbursed'
  | 'rejected'
  | 'returned'
  | 'expired'
  | 'deadline_expired';

export const CLAIMANT_STATUSES: readonly ClaimantStatus[] = [
  'pending_selection',
  'selected',
  'queued_for_sftp',
  'disbursed',
  'rejected',
  'returned',
  'expired',
  'deadline_expired'
] as const;

export type PaymentRail =
  | 'ach'
  | 'direct_deposit'
  | 'digital_card'
  | 'debit_card'
  | 'push_to_debit'
  | 'physical_check'
  | 'paypal'
  | 'venmo'
  | 'zelle'
  | 'bitcoin'
  | 'court_fallback'
  | 'fallback_check';

export const PAYMENT_RAILS: readonly PaymentRail[] = [
  'ach',
  'direct_deposit',
  'digital_card',
  'debit_card',
  'push_to_debit',
  'physical_check',
  'paypal',
  'venmo',
  'zelle',
  'bitcoin',
  'court_fallback',
  'fallback_check'
] as const;

export interface IClaimantAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export type FraudRiskTier = 'low' | 'medium' | 'high' | 'critical';

export const FRAUD_RISK_TIERS: readonly FraudRiskTier[] = [
  'low',
  'medium',
  'high',
  'critical'
] as const;

export type FraudReviewStatus =
  | 'unscanned'
  | 'auto_cleared'
  | 'flagged_for_review'
  | 'quarantined_blocked'
  | 'manually_approved'
  | 'manually_rejected';

export const FRAUD_REVIEW_STATUSES: readonly FraudReviewStatus[] = [
  'unscanned',
  'auto_cleared',
  'flagged_for_review',
  'quarantined_blocked',
  'manually_approved',
  'manually_rejected'
] as const;

export type FraudSignalCategory =
  | 'payout_collision'
  | 'velocity_device'
  | 'behavioral_bot'
  | 'identity_domain';

export const FRAUD_SIGNAL_CATEGORIES: readonly FraudSignalCategory[] = [
  'payout_collision',
  'velocity_device',
  'behavioral_bot',
  'identity_domain'
] as const;

export interface IFraudSignal {
  code: string;
  category: FraudSignalCategory;
  severity: FraudRiskTier;
  scoreContribution: number;
  description: string;
  detectedAt?: Date;
}

export interface IPortalSessionMetrics {
  dwellTimeMs?: number;
  interactionCount?: number;
  keystrokeCount?: number;
  webdriverDetected?: boolean;
  timezoneOffset?: number;
  screenResolution?: string;
}

export interface IClaimant extends Document {
  caseId: mongoose.Types.ObjectId | string;
  claimId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: IClaimantAddress;
  settlementAmount: number;
  status: ClaimantStatus;
  paymentSelectionToken?: string;
  claimantToken?: string;
  selectionToken?: string;
  tokenExpiresAt?: Date;
  selectedPaymentMethod?: PaymentRail;
  paymentDetails?: any;
  disbursedAt?: Date;
  // Notification & Engagement Tracking
  emailSent?: boolean;
  emailSentAt?: Date;
  emailOpened?: boolean;
  emailOpenedAt?: Date;
  linkClicked?: boolean;
  linkClickedAt?: Date;
  bounced?: boolean;
  bouncedAt?: Date;
  bounceReason?: string;
  emailMessageId?: string;
  deliveryAttempts?: number;
  lastDeliveryError?: string;
  nextRetryAt?: Date;
  // Digital Signature & Receipt
  digitalSignature?: string;
  certificationAffirmed?: boolean;
  signedAt?: Date;
  signatureIp?: string;
  signatureUserAgent?: string;
  confirmationNumber?: string;
  receiptDetails?: any;
  selectedAt?: Date;
  fallbackReason?: string;
  // Batch & Reconciliation (Milestone 4)
  batchId?: string;
  batchFilename?: string;
  batchGeneratedAt?: Date;
  dashReferenceId?: string;
  settlementDate?: Date;
  rejectionReason?: string;
  failureCode?: string;
  requeuedAt?: Date;
  // JurisShield™ Multi-Tenant Fraud Monitoring & Claimant Scoring
  fraudScore?: number;
  fraudRiskTier?: FraudRiskTier;
  fraudReviewStatus?: FraudReviewStatus;
  fraudSignals?: IFraudSignal[];
  fraudScannedAt?: Date;
  fraudReviewedBy?: string;
  fraudReviewedAt?: Date;
  fraudReviewNotes?: string;
  deviceFingerprintHash?: string;
  payoutEndpointHash?: string;
  portalSessionMetrics?: IPortalSessionMetrics;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IClaimantAddress>(
  {
    street: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    zip: { type: String, default: '', trim: true }
  },
  { _id: false }
);

const FraudSignalSchema = new Schema<IFraudSignal>(
  {
    code: { type: String, required: [true, 'Signal code is required'], trim: true },
    category: {
      type: String,
      enum: {
        values: FRAUD_SIGNAL_CATEGORIES,
        message: 'Invalid fraud signal category: {VALUE}'
      },
      required: [true, 'Signal category is required']
    },
    severity: {
      type: String,
      enum: {
        values: FRAUD_RISK_TIERS,
        message: 'Invalid fraud signal severity: {VALUE}'
      },
      required: [true, 'Signal severity is required']
    },
    scoreContribution: {
      type: Number,
      required: [true, 'Score contribution is required'],
      min: [0, 'Score contribution cannot be negative'],
      max: [100, 'Score contribution cannot exceed 100']
    },
    description: { type: String, required: [true, 'Signal description is required'], trim: true },
    detectedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const PortalSessionMetricsSchema = new Schema<IPortalSessionMetrics>(
  {
    dwellTimeMs: { type: Number, min: 0 },
    interactionCount: { type: Number, min: 0 },
    keystrokeCount: { type: Number, min: 0 },
    webdriverDetected: { type: Boolean, default: false },
    timezoneOffset: { type: Number },
    screenResolution: { type: String, trim: true }
  },
  { _id: false }
);

const ClaimantSchema = new Schema<IClaimant>(
  {
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required'],
      index: true
    },
    claimId: {
      type: String,
      required: [true, 'Claim ID is required'],
      trim: true
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
      index: true
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      type: AddressSchema,
      default: () => ({ street: '', city: '', state: '', zip: '' })
    },
    settlementAmount: {
      type: Number,
      required: [true, 'Settlement amount is required'],
      min: [0.01, 'Settlement amount must be positive']
    },
    status: {
      type: String,
      enum: {
        values: CLAIMANT_STATUSES,
        message: 'Invalid claimant status: {VALUE}'
      },
      default: 'pending_selection',
      index: true
    },
    paymentSelectionToken: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
      trim: true
    },
    tokenExpiresAt: {
      type: Date
    },
    selectedPaymentMethod: {
      type: String,
      enum: {
        values: PAYMENT_RAILS,
        message: 'Invalid payment method: {VALUE}'
      }
    },
    paymentDetails: {
      type: Schema.Types.Mixed
    },
    disbursedAt: {
      type: Date
    },
    // Engagement & Notification Tracking
    emailSent: {
      type: Boolean,
      default: false,
      index: true
    },
    emailSentAt: {
      type: Date
    },
    emailOpened: {
      type: Boolean,
      default: false,
      index: true
    },
    emailOpenedAt: {
      type: Date
    },
    linkClicked: {
      type: Boolean,
      default: false,
      index: true
    },
    linkClickedAt: {
      type: Date
    },
    bounced: {
      type: Boolean,
      default: false,
      index: true
    },
    bouncedAt: {
      type: Date
    },
    bounceReason: {
      type: String,
      trim: true
    },
    emailMessageId: {
      type: String,
      trim: true
    },
    deliveryAttempts: {
      type: Number,
      default: 0
    },
    lastDeliveryError: {
      type: String
    },
    nextRetryAt: {
      type: Date,
      index: true
    },
    // Digital Signature & Receipt Audit Trail
    digitalSignature: {
      type: String,
      trim: true
    },
    certificationAffirmed: {
      type: Boolean,
      default: false
    },
    signedAt: {
      type: Date
    },
    signatureIp: {
      type: String,
      trim: true
    },
    signatureUserAgent: {
      type: String,
      trim: true
    },
    confirmationNumber: {
      type: String,
      sparse: true,
      index: true,
      trim: true
    },
    receiptDetails: {
      type: Schema.Types.Mixed
    },
    selectedAt: {
      type: Date
    },
    fallbackReason: {
      type: String,
      trim: true
    },
    // Batch & Reconciliation (Milestone 4)
    batchId: {
      type: String,
      sparse: true,
      index: true,
      trim: true
    },
    batchFilename: {
      type: String,
      trim: true
    },
    batchGeneratedAt: {
      type: Date
    },
    dashReferenceId: {
      type: String,
      sparse: true,
      index: true,
      trim: true
    },
    settlementDate: {
      type: Date
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    failureCode: {
      type: String,
      trim: true
    },
    requeuedAt: {
      type: Date
    },
    // JurisShield™ Multi-Tenant Fraud Monitoring & Claimant Scoring
    fraudScore: {
      type: Number,
      default: 0,
      min: [0, 'Fraud score cannot be less than 0'],
      max: [100, 'Fraud score cannot exceed 100'],
      index: true
    },
    fraudRiskTier: {
      type: String,
      enum: {
        values: FRAUD_RISK_TIERS,
        message: 'Invalid fraud risk tier: {VALUE}'
      },
      default: 'low',
      index: true
    },
    fraudReviewStatus: {
      type: String,
      enum: {
        values: FRAUD_REVIEW_STATUSES,
        message: 'Invalid fraud review status: {VALUE}'
      },
      default: 'unscanned',
      index: true
    },
    fraudSignals: {
      type: [FraudSignalSchema],
      default: []
    },
    fraudScannedAt: {
      type: Date
    },
    fraudReviewedBy: {
      type: String,
      trim: true
    },
    fraudReviewedAt: {
      type: Date
    },
    fraudReviewNotes: {
      type: String,
      trim: true
    },
    deviceFingerprintHash: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    payoutEndpointHash: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    portalSessionMetrics: {
      type: PortalSessionMetricsSchema
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

// Compound unique index: claimId must be unique within a case
ClaimantSchema.index({ caseId: 1, claimId: 1 }, { unique: true });
ClaimantSchema.index({ caseId: 1, fraudScore: -1 });
ClaimantSchema.index({ caseId: 1, fraudRiskTier: 1, fraudReviewStatus: 1 });

// Virtual getter and setter for claimantToken alias
ClaimantSchema.virtual('claimantToken')
  .get(function () {
    return this.paymentSelectionToken;
  })
  .set(function (val: string) {
    this.paymentSelectionToken = val;
  });

// Virtual getter and setter for selectionToken alias
ClaimantSchema.virtual('selectionToken')
  .get(function () {
    return this.paymentSelectionToken;
  })
  .set(function (val: string) {
    this.paymentSelectionToken = val;
  });

export const Claimant = (mongoose.models.Claimant as mongoose.Model<IClaimant>) || mongoose.model<IClaimant>('Claimant', ClaimantSchema);
