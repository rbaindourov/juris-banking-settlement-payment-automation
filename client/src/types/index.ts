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

export type CaseStatus = 'draft' | 'active' | 'deadline_passed' | 'disbursed' | 'closed';

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

export interface Case {
  id: string;
  _id?: string;
  caseId?: string;
  name: string;
  docketNumber: string;
  lawFirmId: string;
  settlementFundTotal: number;
  disbursementDeadline: string;
  fallbackPaymentMethod: FallbackPaymentMethod;
  status: CaseStatus;
  emailTemplate: IEmailTemplate;
  landingPageText: ILandingPageText;
  defaultLanguage?: string;
  supportedLanguages?: string[];
  localizedLandingPageText?: Record<string, ILandingPageText>;
  createdAt: string;
  updatedAt: string;
}

export interface Claimant {
  id: string;
  _id?: string;
  caseId: string;
  claimId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  settlementAmount: number;
  status: 'pending_selection' | 'selected' | 'queued_for_sftp' | 'disbursed' | 'rejected' | 'returned';
  paymentSelectionToken?: string;
  claimantToken?: string;
  tokenExpiresAt?: string;
  selectedPaymentMethod?: string;
  paymentDetails?: any;
}

export interface IngestionError {
  row: number;
  claimId?: string;
  field?: string;
  code: string;
  message: string;
}

export interface StageUploadResult {
  caseId: string;
  caseName: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  totalAllocation: number;
  settlementFundTotal: number;
  fundVariance: number;
  canCommit: boolean;
  errors: IngestionError[];
  preview: Claimant[];
  stagedClaimants?: Claimant[];
}

export interface TemplatePreviewResponse {
  caseId: string;
  sanitizedHtml: string;
  renderedHtml: string;
  previewHtml: string;
  viewport: 'desktop' | 'mobile';
  language?: string;
}

// ---------------------------------------------------------------------------
// Milestone 5: Analytics, Payment Rails, & Exception Ledger Interfaces
// ---------------------------------------------------------------------------

export type PaymentRailType =
  | 'ach'
  | 'direct_deposit'
  | 'digital_card'
  | 'debit_card'
  | 'physical_check'
  | 'paypal'
  | 'venmo'
  | 'zelle'
  | 'bitcoin'
  | 'fallback'
  | 'court_fallback';

export interface FinancialSummaryMetrics {
  caseId: string;
  caseName?: string;
  docketNumber?: string;
  settlementFundTotal: number;
  settlementFundTotalFormatted?: string;
  totalAllocated: number;
  totalAllocatedFormatted?: string;
  totalClaimed: number;
  totalClaimedFormatted?: string;
  totalDisbursed: number;
  totalDisbursedFormatted?: string;
  totalOutstanding: number;
  totalOutstandingFormatted?: string;
  fundVariance: number;
  fundVarianceFormatted?: string;
  remainingUnclaimedFund?: number;
  remainingUnclaimedFundFormatted?: string;
  reconciliationDiscrepanciesCount: number;
  openExceptionsCount: number;
  totalExceptionsCount: number;
  totalClaimants: number;
  claimedClaimants: number;
  disbursedClaimants: number;
  disbursementProgressPercent?: number;
}

export interface FunnelCounts {
  uploaded: number;
  dispatched: number;
  delivered: number;
  visited: number;
  selected: number;
  disbursed: number;
}

export interface FunnelRates {
  deliveryRate: number;
  clickRate: number;
  conversionRate: number;
  disbursementRate: number;
  overallConversionRate: number;
  overallDisbursementRate: number;
}

export interface FunnelDropOff {
  dispatchToDelivery: number;
  deliveryToVisit: number;
  visitToSelect: number;
  selectToDisburse: number;
}

export interface FunnelStageItem {
  stage: 'uploaded' | 'dispatched' | 'delivered' | 'visited' | 'selected' | 'disbursed';
  label: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

export interface FunnelAnalyticsData {
  caseId: string;
  caseName?: string;
  docketNumber?: string;
  uploaded: number;
  dispatched: number;
  delivered: number;
  visited: number;
  selected: number;
  disbursed: number;
  deliveryRate: number;
  clickRate: number;
  conversionRate: number;
  disbursementRate: number;
  overallConversionRate: number;
  overallDisbursementRate: number;
  stages: FunnelCounts;
  rates: FunnelRates;
  dropOff: FunnelDropOff;
  funnel: FunnelStageItem[];
}

export interface PaymentRailMetricItem {
  method: string;
  name: string;
  count: number;
  percentage: number;
  totalAmount: number;
  totalAmountCents?: number;
  totalAmountFormatted?: string;
  color: string;
}

export interface PaymentRailMetricsData {
  caseId: string;
  totalSelected: number;
  totalAmount: number;
  totalAmountFormatted?: string;
  methods: PaymentRailMetricItem[];
}

export type ExceptionCategory =
  | 'ach_return'
  | 'card_decline'
  | 'check_returned'
  | 'invalid_routing'
  | 'bounced_email'
  | 'unmatched_claim'
  | 'other';

export type ResolutionStatusType =
  | 'open'
  | 'resolved'
  | 'resolved_switched_to_check'
  | 'resolved_requeued'
  | 'resolved_resent_email'
  | 'fallback_assigned';

export interface ExceptionItem {
  id: string;
  _id?: string;
  caseId: string;
  claimId: string;
  claimantId?: any;
  claimantName?: string;
  claimantEmail?: string;
  amount: number;
  currency: string;
  status: string;
  exceptionType: ExceptionCategory;
  returnCode: string;
  returnReason?: string;
  errorCode?: string;
  errorMessage?: string;
  paymentRail?: string;
  dashReferenceId?: string;
  resolved: boolean;
  resolutionStatus: ResolutionStatusType;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionAction?: string;
  resolutionNotes?: string;
  createdAt: string;
}

export interface ExceptionsResponse {
  exceptions: ExceptionItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ResolveExceptionPayload {
  action: 'switch_to_check' | 'resend_email' | 'requeue_sftp' | 'mark_resolved';
  reason?: string;
  updatedAddress?: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
  };
}
