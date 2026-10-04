import mongoose, { Schema, Document, Model } from 'mongoose';

export type FallbackPaymentMethod =
  | 'physical_check'
  | 'direct_deposit'
  | 'digital_card'
  | 'debit_card'
  | 'ach'
  | 'paypal'
  | 'venmo'
  | 'zelle'
  | 'bitcoin';

export const FALLBACK_PAYMENT_METHODS: readonly FallbackPaymentMethod[] = [
  'physical_check',
  'direct_deposit',
  'digital_card',
  'debit_card',
  'ach',
  'paypal',
  'venmo',
  'zelle',
  'bitcoin'
] as const;

export type CaseStatus = 'draft' | 'active' | 'deadline_passed' | 'disbursed' | 'closed';

export const CASE_STATUSES: readonly CaseStatus[] = [
  'draft',
  'active',
  'deadline_passed',
  'disbursed',
  'closed'
] as const;

export interface IFaqItem {
  question: string;
  answer: string;
}

export interface IEmailTemplate {
  subject: string;
  bodyHtml: string;
}

export interface ILandingPageText {
  headline: string;
  introHtml: string;
  faqAccordion: IFaqItem[];
  supportContact: any;
}

export interface ICase extends Document {
  caseId?: string;
  name: string;
  docketNumber: string;
  lawFirmId: string;
  settlementFundTotal: number;
  disbursementDeadline: Date;
  fallbackPaymentMethod: FallbackPaymentMethod;
  status: CaseStatus;
  emailTemplate: IEmailTemplate;
  landingPageText: ILandingPageText;
  defaultLanguage: string;
  supportedLanguages: string[];
  localizedLandingPageText?: Record<string, ILandingPageText> | Map<string, ILandingPageText>;
  createdAt: Date;
  updatedAt: Date;
}

const FaqItemSchema = new Schema<IFaqItem>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    subject: { type: String, default: '', trim: true },
    bodyHtml: { type: String, default: '' }
  },
  { _id: false }
);

const LandingPageTextSchema = new Schema<ILandingPageText>(
  {
    headline: { type: String, default: '', trim: true },
    introHtml: { type: String, default: '' },
    faqAccordion: { type: [FaqItemSchema], default: [] },
    supportContact: { type: Schema.Types.Mixed, default: '' }
  },
  { _id: false }
);

const CaseSchema = new Schema<ICase>(
  {
    caseId: {
      type: String,
      sparse: true,
      index: true,
      trim: true
    },
    name: {
      type: String,
      required: [true, 'Case name is required'],
      trim: true
    },
    docketNumber: {
      type: String,
      required: [true, 'Docket number is required'],
      trim: true
    },
    lawFirmId: {
      type: String,
      required: [true, 'Law firm ID is required'],
      trim: true,
      index: true
    },
    settlementFundTotal: {
      type: Number,
      required: [true, 'Settlement fund total is required'],
      min: [0, 'Settlement fund total cannot be negative']
    },
    disbursementDeadline: {
      type: Date,
      required: [true, 'Disbursement deadline is required']
    },
    fallbackPaymentMethod: {
      type: String,
      enum: {
        values: FALLBACK_PAYMENT_METHODS,
        message: 'Invalid fallback payment method: {VALUE}'
      },
      default: 'physical_check'
    },
    status: {
      type: String,
      enum: {
        values: CASE_STATUSES,
        message: 'Invalid case status: {VALUE}'
      },
      default: 'draft',
      index: true
    },
    emailTemplate: {
      type: EmailTemplateSchema,
      default: () => ({ subject: '', bodyHtml: '' })
    },
    landingPageText: {
      type: LandingPageTextSchema,
      default: () => ({
        headline: '',
        introHtml: '',
        faqAccordion: [],
        supportContact: ''
      })
    },
    defaultLanguage: {
      type: String,
      default: 'en',
      trim: true
    },
    supportedLanguages: {
      type: [String],
      default: ['en']
    },
    localizedLandingPageText: {
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
        if (!ret.caseId) {
          ret.caseId = ret.id;
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Pre-save hook to populate caseId if not explicitly provided
CaseSchema.pre('save', function (next) {
  if (!this.caseId) {
    this.caseId = this._id ? this._id.toString() : undefined;
  }
  next();
});

export const Case = (mongoose.models.Case as mongoose.Model<ICase>) || mongoose.model<ICase>('Case', CaseSchema);
