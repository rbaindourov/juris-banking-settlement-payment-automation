export type PaymentRail =
  | 'ach'
  | 'digital_card'
  | 'debit_card'
  | 'physical_check'
  | 'paypal'
  | 'venmo'
  | 'zelle'
  | 'bitcoin';

export type LanguageCode = 'en' | 'es' | 'zh' | 'vi';

export interface IFaqItem {
  question: string;
  answer: string;
}

export interface ILandingPageText {
  headline: string;
  introHtml: string;
  faqAccordion: IFaqItem[];
  supportContact?: string | { email?: string; phone?: string };
}

export interface ClaimPortalData {
  token: string;
  claimantToken: string;
  selectionToken?: string;
  claimId: string;
  firstName: string;
  lastName: string;
  settlementAmount: number;
  formattedAwardAmount: string;
  status: string;
  isExpired: boolean;
  disbursementDeadline: string;
  formattedDeadline: string;
  assignedFallbackMethod: PaymentRail;
  selectedPaymentMethod?: PaymentRail | null;
  confirmationNumber?: string | null;
  selectedAt?: string | null;
}

export interface CasePortalData {
  caseId: string;
  name: string;
  caseName?: string;
  docketNumber: string;
  settlementFundTotal?: number;
  fallbackPaymentMethod: PaymentRail;
  defaultLanguage: string;
  supportedLanguages: string[];
  currentLanguage: string;
  landingPageText: ILandingPageText;
}

export interface PortalApiResponse {
  claim: ClaimPortalData;
  case: CasePortalData;
}

export interface ReceiptData {
  confirmationNumber: string;
  claimId: string;
  claimantName: string;
  caseName: string;
  docketNumber: string;
  selectedMethod: PaymentRail;
  amount: number;
  formattedAmount: string;
  timestamp: string;
  digitalSignature: string;
  ipAddress: string;
  maskedDetails: Record<string, any>;
  assignedFallbackMethod?: PaymentRail;
}

export interface SelectPaymentPayload {
  method: PaymentRail;
  details: Record<string, any>;
  certificationAffirmed: boolean;
  signature: string;
}

export interface SelectPaymentResponse {
  success: boolean;
  confirmationNumber: string;
  status: string;
  receipt: ReceiptData;
}
