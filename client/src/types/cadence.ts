import { Case } from './index';

export type CadenceStageKey =
  | 'initial_notice'
  | 'reminder_14d'
  | 'urgent_warning_7d'
  | 'final_notice_48h'
  | 'post_deadline_fallback';

export type CadenceStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type WaveStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'paused'
  | 'rescheduled'
  | 'completed'
  | 'cancelled'
  | 'failed';

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
  dailyCap?: number;
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
  triggerType: 'date_fixed' | 'deadline_relative';
  offsetHours: number;
  offsetDays?: number;
  fixedDate?: string | Date;
  templates: IStageTemplates;
  status?: string;
  activeWaveId?: string;
  lastEvaluatedAt?: string | Date;
}

export interface INotificationCadence {
  id?: string;
  _id?: string;
  caseId: string;
  lawFirmId: string;
  name: string;
  status: CadenceStatus;
  stages: ICadenceStage[];
  throttling: ICadenceThrottling;
  suppression: ICadenceSuppressionRules;
  createdAt?: string;
  updatedAt?: string;
}

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
  pausedAt?: string | Date;
  resumedAt?: string | Date;
  cancelledAt?: string | Date;
  cancelReason?: string;
  rescheduledAt?: string | Date;
  originalScheduledDate?: string | Date;
}

export interface SubBatchSummary {
  id?: string;
  _id?: string;
  subBatchId: string;
  waveId: string;
  chunkIndex: number;
  totalChunks: number;
  recipientCount: number;
  dispatchedCount: number;
  skippedCompletedCount: number;
  suppressedBouncedCount: number;
  failedCount: number;
  status: 'pending' | 'in_progress' | 'completed' | 'paused' | 'failed' | 'cancelled';
  scheduledAt: string | Date;
  startedAt?: string | Date;
  completedAt?: string | Date;
}

export interface IEmailWave {
  id?: string;
  _id?: string;
  waveId: string;
  caseId: string;
  cadenceId?: string;
  stage: CadenceStageKey;
  stageName?: string;
  stageId?: string;
  status: WaveStatus;
  scheduledDate: string | Date;
  actualStartTime?: string | Date;
  completedDate?: string | Date;
  totalSubBatches: number;
  completedSubBatches: number;
  throttlingConfig?: ICadenceThrottling;
  telemetry: IWaveTelemetry;
  controlState: IWaveControlState;
  subBatches?: SubBatchSummary[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StagePreview {
  stageKey: string;
  stageName: string;
  triggerType: string;
  offsetHours: number;
  triggerDate: string | Date | null;
  estimatedRecipients: number;
  batchSize: number;
  subBatchCount: number;
  estimatedBatches?: number;
  intervalMinutes: number;
  estimatedDurationMinutes: number;
  estimatedCompletionDate: string | Date | null;
}

export interface ScheduleProjection {
  caseId: string;
  caseName: string;
  disbursementDeadline: string | Date | null;
  throttling: ICadenceThrottling;
  stages: StagePreview[];
  projectedWaves?: StagePreview[];
  totalEligibleClaimants?: number;
  estimatedTotalRecipients: number;
  estimatedTotalSubBatches: number;
  estimatedCompletionDate: string | Date | null;
}

export interface SchedulePreviewRequest {
  throttling?: Partial<ICadenceThrottling>;
  stages?: Partial<ICadenceStage>[];
}

export interface SchedulePreviewResponse {
  success: boolean;
  data: ScheduleProjection;
}

export interface WaveActionResponse {
  success: boolean;
  data: IEmailWave;
  message?: string;
}

export interface IEligibilityBreakdown {
  totalEnrolled: number;
  eligiblePending: number;
  skippedCompleted: number;
  suppressedBounced: number;
  excludedFailed: number;
}

// Props Interfaces for Components
export interface RollingCadenceTimelineBuilderProps {
  stages: ICadenceStage[];
  onChange: (updatedStages: ICadenceStage[]) => void;
  deadlineDate?: string | Date;
  caseName?: string;
  caseId?: string;
  readOnly?: boolean;
  supportedLanguages?: string[];
}

export interface BatchThrottlingConfigCardProps {
  throttling: ICadenceThrottling;
  onChange: (updated: Partial<ICadenceThrottling>) => void;
  totalEligibleRecipients: number;
  deadlineDate?: string | Date | null;
  readOnly?: boolean;
  onSave?: () => Promise<void>;
  isSaving?: boolean;
}

export interface RecipientEligibilityPreviewCardProps {
  caseId: string;
  breakdown?: IEligibilityBreakdown;
  suppressionRules?: ICadenceSuppressionRules;
  stageName?: string;
  isLoading?: boolean;
  onRefresh?: () => Promise<void>;
}

export interface LiveWaveTelemetryConsoleProps {
  waves: IEmailWave[];
  caseId?: string;
  deadlineDate?: string | Date | null;
  onPause: (waveId: string, reason?: string) => Promise<void>;
  onResume: (waveId: string, options?: any) => Promise<void>;
  onReschedule: (waveId: string, newDate: Date, reason?: string) => Promise<void>;
  onCancel: (waveId: string, reason: string) => Promise<void>;
  isRefreshing?: boolean;
  onRefresh?: () => Promise<void>;
}

export interface RescheduleWaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  wave: IEmailWave | null;
  deadlineDate?: string | Date | null;
  onConfirmReschedule: (waveId: string, newDate: Date, reason?: string) => Promise<void>;
  isSubmitting?: boolean;
}

export interface CadenceCampaignManagerProps {
  caseId: string;
  settlementCase: Case;
  onRefreshCase?: () => void;
  initialSubTab?: 'designer' | 'telemetry';
}
