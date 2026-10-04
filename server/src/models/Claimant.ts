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
