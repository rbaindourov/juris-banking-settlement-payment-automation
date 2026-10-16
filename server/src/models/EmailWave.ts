import mongoose, { Schema, Document } from 'mongoose';
import { CadenceStageKey, CADENCE_STAGE_KEYS, ICadenceThrottling } from './NotificationCadence';

export type WaveStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'paused'
  | 'rescheduled'
  | 'completed'
  | 'cancelled'
  | 'failed';

export const WAVE_STATUSES: readonly WaveStatus[] = [
  'draft',
  'scheduled',
  'in_progress',
  'paused',
  'rescheduled',
  'completed',
  'cancelled',
  'failed'
] as const;

export interface IWaveTelemetry {
  eligible: number;
  queued: number;
  dispatched: number;
  skipped_completed: number;
  suppressed_bounced: number;
  failed: number;
  opened: number;
  clicked: number;
}

export interface IWaveControlState {
  isPaused: boolean;
  pausedAt?: Date;
  resumedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  rescheduledAt?: Date;
  originalScheduledDate?: Date;
}

export interface IEmailWave extends Document {
  waveId: string;
  caseId: mongoose.Types.ObjectId | string;
  cadenceId?: mongoose.Types.ObjectId | string;
  stage: CadenceStageKey;
  stageName?: string;
  stageId?: string;
  status: WaveStatus;
  scheduledDate: Date;
  actualStartTime?: Date;
  completedDate?: Date;
  totalSubBatches: number;
  completedSubBatches: number;
  throttlingConfig?: ICadenceThrottling;
  telemetry: IWaveTelemetry;
  controlState: IWaveControlState;
  subBatches: Array<mongoose.Types.ObjectId | string>;
  createdAt: Date;
  updatedAt: Date;
}

const WaveTelemetrySchema = new Schema<IWaveTelemetry>(
  {
    eligible: { type: Number, default: 0, min: 0 },
    queued: { type: Number, default: 0, min: 0 },
    dispatched: { type: Number, default: 0, min: 0 },
    skipped_completed: { type: Number, default: 0, min: 0 },
    suppressed_bounced: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    opened: { type: Number, default: 0, min: 0 },
    clicked: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const WaveControlStateSchema = new Schema<IWaveControlState>(
  {
    isPaused: { type: Boolean, default: false },
    pausedAt: { type: Date },
    resumedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true },
    rescheduledAt: { type: Date },
    originalScheduledDate: { type: Date }
  },
  { _id: false }
);

const EmailWaveSchema = new Schema<IEmailWave>(
  {
    waveId: {
      type: String,
      required: [true, 'Wave ID is required'],
      trim: true
    },
    caseId: {
      type: Schema.Types.Mixed,
      ref: 'Case',
      required: [true, 'Case ID is required']
    },
    cadenceId: {
      type: Schema.Types.Mixed,
      ref: 'NotificationCadence',
      index: true
    },
    stage: {
      type: String,
      enum: {
        values: CADENCE_STAGE_KEYS,
        message: 'Invalid wave stage: {VALUE}'
      },
      required: [true, 'Stage is required']
    },
    stageName: {
      type: String,
      default: '',
      trim: true
    },
    stageId: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: WAVE_STATUSES,
        message: 'Invalid wave status: {VALUE}'
      },
      default: 'draft'
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Scheduled date is required']
    },
    actualStartTime: {
      type: Date
    },
    completedDate: {
      type: Date
    },
    totalSubBatches: {
      type: Number,
      default: 0,
      min: 0
    },
    completedSubBatches: {
      type: Number,
      default: 0,
      min: 0
    },
    throttlingConfig: {
      type: Schema.Types.Mixed
    },
    telemetry: {
      type: WaveTelemetrySchema,
      default: () => ({
        eligible: 0,
        queued: 0,
        dispatched: 0,
        skipped_completed: 0,
        suppressed_bounced: 0,
        failed: 0,
        opened: 0,
        clicked: 0
      })
    },
    controlState: {
      type: WaveControlStateSchema,
      default: () => ({ isPaused: false })
    },
    subBatches: [
      {
        type: Schema.Types.Mixed,
        ref: 'SubBatch'
      }
    ]
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
EmailWaveSchema.index({ waveId: 1 }, { unique: true });
EmailWaveSchema.index({ caseId: 1, status: 1 });
EmailWaveSchema.index({ caseId: 1, stage: 1 });
EmailWaveSchema.index({ scheduledDate: 1, status: 1 });
EmailWaveSchema.index({ status: 1 });

export const EmailWave =
  (mongoose.models.EmailWave as mongoose.Model<IEmailWave>) ||
  mongoose.model<IEmailWave>('EmailWave', EmailWaveSchema);
