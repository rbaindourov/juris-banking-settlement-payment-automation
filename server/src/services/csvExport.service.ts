import { Response } from 'express';
import { Claimant, IClaimant } from '../models/Claimant';
import { ReconciliationException } from '../models/ReconciliationException';
import { ICase } from '../models/Case';

export const CSV_HEADERS = [
  'Claim ID',
  'Claimant Name',
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Mailing Address',
  'Settlement Amount',
  'Status',
  'Payment Method',
  'Payment Selection Timestamp',
  'Masked Payment Details',
  'Digital Signature',
  'Signature IP',
  'Signature Timestamp',
  'Confirmation Number',
  'Batch ID',
  'Dash Reference ID',
  'Disbursement Timestamp',
  'Exception Status',
  'Exception Code',
  'Exception Notes'
] as const;

/**
 * RFC 4180 compliant CSV field escaping.
 * Fields containing double-quotes, commas, semicolons, or newlines are wrapped in double quotes.
 */
export function escapeCsvField(val: any): string {
  if (val === undefined || val === null) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r') ||
    str.includes(';')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Sanitizes and masks sensitive PII/PCI payment details for legal audit export.
 */
export function maskPaymentDetails(method?: string, details?: any): string {
  if (!details || !method) return 'N/A';

  switch (method.toLowerCase()) {
    case 'ach':
    case 'direct_deposit': {
      const routing = details.routingNumber || details.routing || '';
      const acct = String(details.accountNumber || details.account || '');
      const maskedAcct = acct.length > 4 ? `****${acct.slice(-4)}` : '****';
      return `Routing: ${routing}, Account: ${maskedAcct}`;
    }
    case 'debit_card':
    case 'push_to_debit': {
      const pan = String(details.cardNumber || details.pan || '');
      const last4 = pan.length >= 4 ? pan.slice(-4) : '****';
      return `Card: **** **** **** ${last4}, Exp: **/**`;
    }
    case 'digital_card': {
      return `Digital Card: ${details.email || details.preferredDeliveryEmail || 'Email delivery'}`;
    }
    case 'physical_check':
    case 'court_fallback':
    case 'fallback_check': {
      const street = details.street || details.address?.street || '';
      const city = details.city || details.address?.city || '';
      const state = details.state || details.address?.state || '';
      const zip = details.zip || details.address?.zip || '';
      return `Mailed to: ${street}, ${city}, ${state} ${zip}`.trim();
    }
    case 'paypal':
      return `PayPal: ${details.paypalAccount || details.email || ''}`;
    case 'venmo':
      return `Venmo: ${details.venmoHandle || ''}`;
    case 'zelle':
      return `Zelle: ${details.zelleContact || details.phone || details.email || ''}`;
    case 'bitcoin': {
      const addr = String(details.bitcoinAddress || '');
      if (addr.length > 12) {
        return `BTC: ${addr.slice(0, 6)}...${addr.slice(-6)}`;
      }
      return `BTC: ${addr}`;
    }
    default:
      return 'N/A';
  }
}

/**
 * Builds a 22-column array of audit ledger values for a single claimant record.
 */
export function buildAuditLedgerRow(
  claimant: IClaimant,
  exceptionMap: Map<string, any>
): string[] {
  const exception = exceptionMap.get(claimant.claimId);

  const fullName = `${claimant.lastName || ''}, ${claimant.firstName || ''}`.trim();
  const address = claimant.address
    ? `${claimant.address.street || ''}, ${claimant.address.city || ''}, ${claimant.address.state || ''} ${claimant.address.zip || ''}`.trim()
    : '';

  const selectedDateStr = claimant.selectedAt
    ? new Date(claimant.selectedAt).toISOString()
    : claimant.signedAt
      ? new Date(claimant.signedAt).toISOString()
      : '';

  const disbursedDateStr = claimant.disbursedAt
    ? new Date(claimant.disbursedAt).toISOString()
    : claimant.settlementDate
      ? new Date(claimant.settlementDate).toISOString()
      : '';

  const signedDateStr = claimant.signedAt ? new Date(claimant.signedAt).toISOString() : '';

  return [
    claimant.claimId,
    fullName,
    claimant.firstName || '',
    claimant.lastName || '',
    claimant.email || '',
    claimant.phone || '',
    address,
    (claimant.settlementAmount || 0).toFixed(2),
    claimant.status || 'pending_selection',
    claimant.selectedPaymentMethod || 'NONE',
    selectedDateStr,
    maskPaymentDetails(claimant.selectedPaymentMethod, claimant.paymentDetails),
    claimant.digitalSignature || '',
    claimant.signatureIp || '',
    signedDateStr,
    claimant.confirmationNumber || '',
    claimant.batchId || '',
    claimant.dashReferenceId || '',
    disbursedDateStr,
    exception ? exception.resolutionStatus || 'open' : 'NONE',
    exception ? exception.returnCode || exception.errorCode || 'NONE' : 'NONE',
    exception ? exception.resolutionNotes || exception.returnReason || 'NONE' : 'NONE'
  ];
}

export class CsvExportService {
  /**
   * Streams the RFC 4180 compliant audit ledger CSV response using a Mongoose cursor.
   */
  public static async streamAuditLedgerCsv(
    caseDoc: ICase,
    caseLookupIds: any[],
    res: Response
  ): Promise<void> {
    const cleanDocket = (caseDoc.docketNumber || 'case').replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestampStr = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '_');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="case_${cleanDocket}_audit_ledger_${timestampStr}.csv"`
    );
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // Write UTF-8 Byte Order Mark for Excel compatibility
    res.write('\uFEFF');

    // Write Header Row
    res.write(CSV_HEADERS.map(escapeCsvField).join(',') + '\r\n');

    // Pre-load exceptions map for fast in-memory lookup during cursor streaming
    const exceptions = await ReconciliationException.find({
      caseId: { $in: caseLookupIds }
    }).lean();

    const exceptionMap = new Map<string, any>();
    for (const ex of exceptions) {
      if (ex.claimId) {
        exceptionMap.set(ex.claimId, ex);
      }
    }

    // Stream claimants via cursor
    const cursor = Claimant.find({ caseId: { $in: caseLookupIds } })
      .sort({ claimId: 1 })
      .cursor();

    for await (const claimant of cursor) {
      const rowValues = buildAuditLedgerRow(claimant as IClaimant, exceptionMap);
      const csvLine = rowValues.map(escapeCsvField).join(',') + '\r\n';
      res.write(csvLine);
    }

    res.end();
  }
}
