import mongoose from 'mongoose';
import { Case } from '../models/Case';
import { Claimant } from '../models/Claimant';
import { DisbursementBatch } from '../models/DisbursementBatch';
import { ReconciliationException, ExceptionType } from '../models/ReconciliationException';

export interface ParsedReportRecord {
  reportId?: string;
  batchId?: string;
  claimId: string;
  paymentReference?: string;
  paymentMethod?: string;
  amount?: number;
  currency?: string;
  status: 'PAID' | 'REJECTED' | 'RETURNED';
  dashReferenceId?: string;
  settlementDate?: Date;
  processedTimestamp?: Date;
  errorCode?: string;
  errorMessage?: string;
  failureReason?: string;
  rawRow: string;
  lineNumber: number;
}

export interface ReconciliationParseResult {
  valid: boolean;
  totalRecords: number;
  paidCount: number;
  rejectedCount: number;
  returnedCount: number;
  records: ParsedReportRecord[];
  errors: string[];
}

export interface ReconcileCaseOptions {
  caseId: string;
  csvContent: string;
  reportFilename?: string;
  batchId?: string;
  actorId?: string;
}

export interface ReconcileCaseResult {
  reportFilename: string;
  totalProcessed: number;
  disbursedCount: number;
  rejectedCount: number;
  returnedCount: number;
  exceptionsLogged: number;
  unmatchedCount: number;
}

/**
 * RFC 4180 CSV line parser handling quotes, commas, and escaped quotes.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Determines appropriate ExceptionType based on method and return/error code.
 */
export function determineExceptionType(method?: string, code?: string): ExceptionType {
  const upperCode = (code || '').toUpperCase();
  const upperMethod = (method || '').toUpperCase();

  if (/^R\d{2}$/.test(upperCode) || upperCode.startsWith('ACH_')) {
    return 'ach_return';
  }
  if (
    upperCode.includes('CARD') ||
    upperCode.includes('PAN') ||
    upperCode.includes('BIN') ||
    upperMethod.includes('CARD') ||
    upperMethod.includes('DEBIT')
  ) {
    return 'card_decline';
  }
  if (
    upperCode.includes('CHECK') ||
    upperCode.includes('ADDR') ||
    upperCode.includes('MAIL') ||
    upperMethod.includes('CHECK')
  ) {
    return 'check_returned';
  }
  if (upperCode.includes('ROUTING')) {
    return 'invalid_routing';
  }
  if (upperCode.includes('UNMATCHED')) {
    return 'unmatched_claim';
  }
  return 'other';
}

/**
 * Parses inbound status report CSV (supports both 14-column standard and 7-column compact layouts).
 */
export function parseReconciliationReport(csvContent: string): ReconciliationParseResult {
  if (!csvContent || !csvContent.trim()) {
    return {
      valid: false,
      totalRecords: 0,
      paidCount: 0,
      rejectedCount: 0,
      returnedCount: 0,
      records: [],
      errors: ['Reconciliation report must contain header and at least 1 record (received empty content)']
    };
  }

  const lines = csvContent
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      valid: false,
      totalRecords: 0,
      paidCount: 0,
      rejectedCount: 0,
      returnedCount: 0,
      records: [],
      errors: ['Reconciliation report must contain header and at least 1 record']
    };
  }

  const headerLine = lines[0];
  const headerFields = parseCsvLine(headerLine).map((h) => h.trim().toUpperCase());

  const is14Col = headerFields.includes('REPORT_ID') && headerFields.includes('STATUS');
  const is7Col = (headerFields.includes('RECORD_TYPE') || headerFields.includes('TYPE')) && headerFields.includes('STATUS');

  if (!is14Col && !is7Col) {
    return {
      valid: false,
      totalRecords: 0,
      paidCount: 0,
      rejectedCount: 0,
      returnedCount: 0,
      records: [],
      errors: [`Unrecognized reconciliation CSV header format: ${headerLine}`]
    };
  }

  const records: ParsedReportRecord[] = [];
  const errors: string[] = [];
  let paidCount = 0;
  let rejectedCount = 0;
  let returnedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const fields = parseCsvLine(rawLine);

    if (is14Col) {
      // 14-column layout:
      // REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,
      // DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON
      const reportId = fields[0]?.trim();
      const batchId = fields[1]?.trim();
      const claimId = fields[2]?.trim();
      const paymentReference = fields[3]?.trim();
      const paymentMethod = fields[4]?.trim();
      const amount = parseFloat(fields[5]);
      const currency = fields[6]?.trim() || 'USD';
      let rawStatus = (fields[7]?.trim() || '').toUpperCase();
      if (rawStatus === 'SUCCESS') rawStatus = 'PAID';

      if (!['PAID', 'REJECTED', 'RETURNED'].includes(rawStatus)) {
        errors.push(`Row ${i + 1}: Invalid status "${rawStatus}" for claim "${claimId}"`);
        continue;
      }

      const dashReferenceId = fields[8]?.trim();
      const settlementDate = fields[9] ? new Date(fields[9].trim()) : undefined;
      const processedTimestamp = fields[10] ? new Date(fields[10].trim()) : undefined;
      const errorCode = fields[11]?.trim();
      const errorMessage = fields[12]?.trim();
      const failureReason = fields[13]?.trim();

      const normRecord: ParsedReportRecord = {
        reportId,
        batchId,
        claimId,
        paymentReference,
        paymentMethod,
        amount: isNaN(amount) ? undefined : amount,
        currency,
        status: rawStatus as 'PAID' | 'REJECTED' | 'RETURNED',
        dashReferenceId,
        settlementDate,
        processedTimestamp,
        errorCode,
        errorMessage,
        failureReason,
        rawRow: rawLine,
        lineNumber: i + 1
      };

      records.push(normRecord);
      if (rawStatus === 'PAID') paidCount++;
      else if (rawStatus === 'REJECTED') rejectedCount++;
      else if (rawStatus === 'RETURNED') returnedCount++;
    } else {
      // 7-column layout:
      // RECORD_TYPE,CLAIM_ID,DASH_REFERENCE_ID,STATUS,SETTLEMENT_DATE,FAILURE_CODE,FAILURE_REASON
      const claimId = fields[1]?.trim();
      const dashReferenceId = fields[2]?.trim();
      let rawStatus = (fields[3]?.trim() || '').toUpperCase();
      if (rawStatus === 'SUCCESS') rawStatus = 'PAID';

      if (!['PAID', 'REJECTED', 'RETURNED'].includes(rawStatus)) {
        errors.push(`Row ${i + 1}: Invalid status "${rawStatus}" for claim "${claimId}"`);
        continue;
      }

      const settlementDate = fields[4] ? new Date(fields[4].trim()) : undefined;
      const errorCode = fields[5]?.trim();
      const failureReason = fields[6]?.trim();

      const normRecord: ParsedReportRecord = {
        claimId,
        status: rawStatus as 'PAID' | 'REJECTED' | 'RETURNED',
        dashReferenceId,
        settlementDate,
        errorCode,
        errorMessage: failureReason,
        failureReason,
        rawRow: rawLine,
        lineNumber: i + 1
      };

      records.push(normRecord);
      if (rawStatus === 'PAID') paidCount++;
      else if (rawStatus === 'REJECTED') rejectedCount++;
      else if (rawStatus === 'RETURNED') returnedCount++;
    }
  }

  return {
    valid: errors.length === 0,
    totalRecords: records.length,
    paidCount,
    rejectedCount,
    returnedCount,
    records,
    errors
  };
}

export class ReconciliationService {
  /**
   * Reconciles an inbound status report against claimants for a specified case.
   */
  public static async reconcileCaseStatusReport(options: ReconcileCaseOptions): Promise<ReconcileCaseResult> {
    const { caseId: caseIdentifier, csvContent, reportFilename = 'reconciliation_report.csv', batchId, actorId } = options;

    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      throw new Error(`Case not found for identifier: ${caseIdentifier}`);
    }

    const parseResult = parseReconciliationReport(csvContent);
    if (!parseResult.valid && parseResult.records.length === 0) {
      throw new Error(`Invalid reconciliation report: ${parseResult.errors.join('; ')}`);
    }

    const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseIdentifier].filter(Boolean);

    let disbursedCount = 0;
    let rejectedCount = 0;
    let returnedCount = 0;
    let exceptionsLogged = 0;
    let unmatchedCount = 0;

    for (const record of parseResult.records) {
      // Look up claimant in this case
      const claimant = await Claimant.findOne({
        caseId: { $in: caseLookupIds },
        claimId: record.claimId
      });

      if (!claimant) {
        // Unmatched claim ID edge case
        unmatchedCount++;
        exceptionsLogged++;
        const existingUnmatched = await ReconciliationException.findOne({
          caseId: caseDoc._id,
          claimId: record.claimId,
          exceptionType: 'unmatched_claim',
          resolved: false
        });

        if (!existingUnmatched) {
          await ReconciliationException.create({
            caseId: caseDoc._id,
            claimantId: null,
            claimId: record.claimId,
            batchId: record.batchId || batchId,
            reportId: record.reportId,
            dashReferenceId: record.dashReferenceId,
            paymentRail: record.paymentMethod || 'ach',
            amount: record.amount || 0,
            currency: record.currency || 'USD',
            status: 'UNMATCHED',
            exceptionType: 'unmatched_claim',
            returnCode: record.errorCode || 'UNMATCHED_CLAIM_ID',
            returnReason: record.errorMessage || record.failureReason || 'Claim ID not found in target case',
            rawReportRow: record.rawRow,
            resolved: false,
            resolutionStatus: 'open'
          });
        }
        continue;
      }

      if (record.status === 'PAID') {
        disbursedCount++;
        claimant.status = 'disbursed';
        claimant.disbursedAt = new Date();
        if (record.dashReferenceId) {
          claimant.dashReferenceId = record.dashReferenceId;
        }
        if (record.settlementDate) {
          claimant.settlementDate = record.settlementDate;
        }
        claimant.receiptDetails = {
          ...claimant.receiptDetails,
          dashReferenceId: record.dashReferenceId,
          settledAmount: record.amount !== undefined ? record.amount : claimant.settlementAmount,
          settlementDate: record.settlementDate || new Date()
        };
        await claimant.save();
      } else if (record.status === 'REJECTED') {
        rejectedCount++;
        exceptionsLogged++;
        claimant.status = 'rejected';
        claimant.rejectionReason =
          record.errorMessage || record.failureReason || 'Transaction rejected by payment gateway';
        claimant.failureCode = record.errorCode || 'GATEWAY_REJECT';
        await claimant.save();

        const exceptionType = determineExceptionType(record.paymentMethod || claimant.selectedPaymentMethod, record.errorCode);
        const existingReject = await ReconciliationException.findOne({
          caseId: caseDoc._id,
          claimId: claimant.claimId,
          exceptionType,
          resolved: false
        });

        if (!existingReject) {
          await ReconciliationException.create({
            caseId: caseDoc._id,
            claimantId: claimant._id,
            claimId: claimant.claimId,
            batchId: record.batchId || batchId || claimant.batchId,
            reportId: record.reportId,
            dashReferenceId: record.dashReferenceId,
            paymentRail: record.paymentMethod || claimant.selectedPaymentMethod || 'ach',
            amount: record.amount !== undefined ? record.amount : claimant.settlementAmount,
            currency: record.currency || 'USD',
            status: 'REJECTED',
            exceptionType,
            returnCode: record.errorCode || 'REJECTED',
            returnReason: claimant.rejectionReason,
            rawReportRow: record.rawRow,
            resolved: false,
            resolutionStatus: 'open'
          });
        }
      } else if (record.status === 'RETURNED') {
        returnedCount++;
        exceptionsLogged++;
        claimant.status = 'returned';
        claimant.rejectionReason =
          record.errorMessage || record.failureReason || 'Transaction returned by receiving depository institution';
        claimant.failureCode = record.errorCode || 'RETURNED';
        await claimant.save();

        const exceptionType = determineExceptionType(record.paymentMethod || claimant.selectedPaymentMethod, record.errorCode);
        const existingReturn = await ReconciliationException.findOne({
          caseId: caseDoc._id,
          claimId: claimant.claimId,
          exceptionType,
          resolved: false
        });

        if (!existingReturn) {
          await ReconciliationException.create({
            caseId: caseDoc._id,
            claimantId: claimant._id,
            claimId: claimant.claimId,
            batchId: record.batchId || batchId || claimant.batchId,
            reportId: record.reportId,
            dashReferenceId: record.dashReferenceId,
            paymentRail: record.paymentMethod || claimant.selectedPaymentMethod || 'ach',
            amount: record.amount !== undefined ? record.amount : claimant.settlementAmount,
            currency: record.currency || 'USD',
            status: 'RETURNED',
            exceptionType,
            returnCode: record.errorCode || 'RETURNED',
            returnReason: claimant.rejectionReason,
            rawReportRow: record.rawRow,
            resolved: false,
            resolutionStatus: 'open'
          });
        }
      }
    }

    // Update batch if batchId provided
    if (batchId) {
      await DisbursementBatch.updateOne(
        { batchId, caseId: caseDoc._id },
        { $set: { status: 'reconciled', reconciledAt: new Date() } }
      );
    }

    return {
      reportFilename,
      totalProcessed: parseResult.records.length,
      disbursedCount,
      rejectedCount,
      returnedCount,
      exceptionsLogged,
      unmatchedCount
    };
  }
}
