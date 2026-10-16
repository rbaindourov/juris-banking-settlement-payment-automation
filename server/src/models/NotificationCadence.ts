import mongoose, { Schema, Document } from 'mongoose';

export type CadenceStageKey =
  | 'initial_notice'
  | 'reminder_14d'
  | 'urgent_warning_7d'
  | 'final_notice_48h'
  | 'post_deadline_fallback';

export const CADENCE_STAGE_KEYS: readonly CadenceStageKey[] = [
  'initial_notice',
  'reminder_14d',
  'urgent_warning_7d',
  'final_notice_48h',
  'post_deadline_fallback'
] as const;

export type CadenceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export const CADENCE_STATUSES: readonly CadenceStatus[] = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived'
] as const;

export type StageTriggerType = 'date_fixed' | 'deadline_relative';

export const STAGE_TRIGGER_TYPES: readonly StageTriggerType[] = [
  'date_fixed',
  'deadline_relative'
] as const;

export type CadenceStageStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'paused'
  | 'cancelled';

export const CADENCE_STAGE_STATUSES: readonly CadenceStageStatus[] = [
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'paused',
  'cancelled'
] as const;

export interface ILocalizedTemplate {
  subject: string;
  bodyHtml: string;
}

export interface IStageTemplates {
  en: ILocalizedTemplate;
  es?: ILocalizedTemplate;
  zh?: ILocalizedTemplate;
  vi?: ILocalizedTemplate;
  [locale: string]: ILocalizedTemplate | undefined;
}

export interface ICadenceThrottling {
  batchSize: number;
  intervalMinutes: number;
  rateLimitPerSecond: number;
  dailyCap: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}

export interface ICadenceSuppressionRules {
  skipCompletedPayments: boolean;
  suppressBounced: boolean;
  checkGlobalSuppression: boolean;
  skipUnsubscribed?: boolean;
}

export interface ICadenceStage {
  stageKey: CadenceStageKey;
  stageName: string;
  enabled: boolean;
  triggerType: StageTriggerType;
  offsetHours: number;
  offsetDays?: number;
  fixedDate?: Date;
  templates: IStageTemplates;
  status: CadenceStageStatus;
  activeWaveId?: string;
  lastEvaluatedAt?: Date;
}

export interface INotificationCadence extends Document {
  caseId: mongoose.Types.ObjectId | string;
  lawFirmId: string;
  name: string;
  status: CadenceStatus;
  stages: ICadenceStage[];
  throttling: ICadenceThrottling;
  suppression: ICadenceSuppressionRules;
  createdAt: Date;
  updatedAt: Date;
}

const LocalizedTemplateSchema = new Schema<ILocalizedTemplate>(
  {
    subject: { type: String, default: '', trim: true },
    bodyHtml: { type: String, default: '' }
  },
  { _id: false }
);

const StageTemplatesSchema = new Schema<IStageTemplates>(
  {
    en: { type: LocalizedTemplateSchema, required: [true, 'English template is required'] },
    es: { type: LocalizedTemplateSchema, default: () => ({ subject: '', bodyHtml: '' }) },
    zh: { type: LocalizedTemplateSchema, default: () => ({ subject: '', bodyHtml: '' }) },
    vi: { type: LocalizedTemplateSchema, default: () => ({ subject: '', bodyHtml: '' }) }
  },
  { _id: false }
);

const CadenceThrottlingSchema = new Schema<ICadenceThrottling>(
  {
    batchSize: {
      type: Number,
      default: 500,
      min: [1, 'Batch size must be at least 1'],
      max: [10000, 'Batch size cannot exceed 10,000']
    },
    intervalMinutes: {
      type: Number,
      default: 15,
      min: [1, 'Interval must be at least 1 minute'],
      max: [1440, 'Interval cannot exceed 1,440 minutes']
    },
    rateLimitPerSecond: {
      type: Number,
      default: 25,
      min: [1, 'Rate limit must be at least 1 msg/sec'],
      max: [200, 'Rate limit cannot exceed 200 msg/sec']
    },
    dailyCap: {
      type: Number,
      default: 10000,
      min: [0, 'Daily cap cannot be negative']
    },
    quietHoursEnabled: {
      type: Boolean,
      default: true
    },
    quietHoursStart: {
      type: String,
      default: '22:00',
      trim: true
    },
    quietHoursEnd: {
      type: String,
      default: '07:00',
      trim: true
    },
    timezone: {
      type: String,
      default: 'UTC',
      trim: true
    }
  },
  { _id: false }
);

const CadenceSuppressionSchema = new Schema<ICadenceSuppressionRules>(
  {
    skipCompletedPayments: { type: Boolean, default: true },
    suppressBounced: { type: Boolean, default: true },
    checkGlobalSuppression: { type: Boolean, default: true },
    skipUnsubscribed: { type: Boolean, default: true }
  },
  { _id: false }
);

export function createDefaultCadenceStages(): ICadenceStage[] {
  return [
    {
      stageKey: 'initial_notice',
      stageName: 'Court-Approved Initial Settlement Notice',
      enabled: true,
      triggerType: 'date_fixed',
      offsetHours: 0,
      offsetDays: 0,
      templates: {
        en: {
          subject: 'Court-Approved Settlement Notice: Payment Selection Required',
          bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>You are an eligible claimant in a class-action settlement. Your settlement amount is <strong>{{settlement_amount}}</strong>. Please select your payment method by <strong>{{selection_deadline}}</strong> at <a href="{{payment_selection_link}}">JurisBanking Portal</a>.</p>'
        },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      },
      status: 'draft'
    },
    {
      stageKey: 'reminder_14d',
      stageName: '14-Day Deadline Reminder',
      enabled: true,
      triggerType: 'deadline_relative',
      offsetHours: -336,
      offsetDays: -14,
      templates: {
        en: {
          subject: 'Reminder: 14 Days Remaining to Select Your Settlement Payment Method',
          bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>This is a reminder that you have 14 days remaining to elect your payment method for your settlement of <strong>{{settlement_amount}}</strong>. Complete your selection by {{selection_deadline}} at <a href="{{payment_selection_link}}">JurisBanking Portal</a>.</p>'
        },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      },
      status: 'draft'
    },
    {
      stageKey: 'urgent_warning_7d',
      stageName: '7-Day Urgent Deadline Warning',
      enabled: true,
      triggerType: 'deadline_relative',
      offsetHours: -168,
      offsetDays: -7,
      templates: {
        en: {
          subject: 'Urgent: 7 Days Left to Select Your Settlement Payment Option',
          bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>Urgent notice: Only 7 days remain before the settlement payment election window closes on {{selection_deadline}}. Amount: <strong>{{settlement_amount}}</strong>. Please submit your choice immediately: <a href="{{payment_selection_link}}">Select Payment Method</a>.</p>'
        },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      },
      status: 'draft'
    },
    {
      stageKey: 'final_notice_48h',
      stageName: '48-Hour Final Notice',
      enabled: true,
      triggerType: 'deadline_relative',
      offsetHours: -48,
      offsetDays: -2,
      templates: {
        en: {
          subject: 'FINAL NOTICE: 48 Hours Remaining to Elect Settlement Payment Method',
          bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>This is your FINAL NOTICE. The deadline to elect your payment method closes in 48 hours ({{selection_deadline}}). If no action is taken, fallback payment will apply. Amount: <strong>{{settlement_amount}}</strong>. Access portal: <a href="{{payment_selection_link}}">Immediate Action Required</a>.</p>'
        },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      },
      status: 'draft'
    },
    {
      stageKey: 'post_deadline_fallback',
      stageName: 'Post-Deadline Fallback / Disbursement Confirmation Notice',
      enabled: true,
      triggerType: 'deadline_relative',
      offsetHours: 24,
      offsetDays: 1,
      templates: {
        en: {
          subject: 'Settlement Disbursement Confirmation: Fallback Payment Assigned',
          bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>The payment selection deadline has passed. As outlined in the court notice, your settlement payment of <strong>{{settlement_amount}}</strong> has been assigned to the default court-approved fallback method. Track your status: <a href="{{payment_selection_link}}">JurisBanking Portal</a>.</p>'
        },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      },
      status: 'draft'
    }
  ];
}

const CadenceStageSchema = new Schema<ICadenceStage>(
  {
    stageKey: {
      type: String,
      enum: {
        values: CADENCE_STAGE_KEYS,
        message: 'Invalid stage key: {VALUE}'
      },
      required: [true, 'Stage key is required']
    },
    stageName: {
      type: String,
      required: [true, 'Stage name is required'],
      trim: true
    },
    enabled: {
      type: Boolean,
      default: true
    },
    triggerType: {
      type: String,
      enum: {
        values: STAGE_TRIGGER_TYPES,
        message: 'Invalid trigger type: {VALUE}'
      },
      default: 'deadline_relative'
    },
    offsetHours: {
      type: Number,
      default: 0
    },
    offsetDays: {
      type: Number
    },
    fixedDate: {
      type: Date
    },
    templates: {
      type: StageTemplatesSchema,
      default: () => ({
        en: { subject: '', bodyHtml: '' },
        es: { subject: '', bodyHtml: '' },
        zh: { subject: '', bodyHtml: '' },
        vi: { subject: '', bodyHtml: '' }
      })
    },
    status: {
      type: String,
      enum: {
        values: CADENCE_STAGE_STATUSES,
        message: 'Invalid stage status: {VALUE}'
      },
      default: 'draft'
    },
    activeWaveId: {
      type: String,
      trim: true
    },
    lastEvaluatedAt: {
      type: Date
    }
  },
  { _id: false }
);

const NotificationCadenceSchema = new Schema<INotificationCadence>(
  {
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required']
    },
    lawFirmId: {
      type: String,
      required: [true, 'Law firm ID is required'],
      trim: true
    },
    name: {
      type: String,
      default: 'Default Settlement Notification Cadence',
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: CADENCE_STATUSES,
        message: 'Invalid cadence status: {VALUE}'
      },
      default: 'draft'
    },
    stages: {
      type: [CadenceStageSchema],
      default: () => createDefaultCadenceStages()
    },
    throttling: {
      type: CadenceThrottlingSchema,
      default: () => ({
        batchSize: 500,
        intervalMinutes: 15,
        rateLimitPerSecond: 25,
        dailyCap: 10000,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'UTC'
      })
    },
    suppression: {
      type: CadenceSuppressionSchema,
      default: () => ({
        skipCompletedPayments: true,
        suppressBounced: true,
        checkGlobalSuppression: true,
        skipUnsubscribed: true
      })
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
NotificationCadenceSchema.index({ caseId: 1 }, { unique: true });
NotificationCadenceSchema.index({ lawFirmId: 1, status: 1 });
NotificationCadenceSchema.index({ status: 1 });

export const NotificationCadence =
  (mongoose.models.NotificationCadence as mongoose.Model<INotificationCadence>) ||
  mongoose.model<INotificationCadence>('NotificationCadence', NotificationCadenceSchema);
