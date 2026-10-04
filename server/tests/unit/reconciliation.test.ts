import { describe, it, expect } from 'vitest';
import {
  parseReconciliationReport,
  determineExceptionType,
  parseCsvLine
} from '../../src/services/reconciliation.service';

const {
  validateReconciliationReport
} = require('../../../tests/e2e/harness/oracles');

describe('Unit: Inbound Status Report Parser & Exception Categorization (reconciliation.service.ts)', () => {
  it('parses valid 14-column status report accurately', () => {
    const csvContent = [
      'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
      'REP-01,B-01,CLM-01,REF-01,ACH,150.00,USD,PAID,DASH-111,2026-10-05,2026-10-05T12:00:00Z,,,',
      'REP-01,B-01,CLM-02,REF-02,DIGITAL_CARD,200.00,USD,PAID,DASH-222,2026-10-05,2026-10-05T12:00:00Z,,,',
      'REP-01,B-01,CLM-03,REF-03,PUSH_DEBIT,100.00,USD,REJECTED,,2026-10-05,2026-10-05T12:00:00Z,CARD_BLOCKED,"Card blocked by issuer",',
      'REP-01,B-01,CLM-04,REF-04,ACH,250.00,USD,RETURNED,,2026-10-05,2026-10-05T12:00:00Z,R02,"Customer closed account","RDFI return R02"'
    ].join('\n');

    const result = parseReconciliationReport(csvContent);
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(4);
    expect(result.paidCount).toBe(2);
    expect(result.rejectedCount).toBe(1);
    expect(result.returnedCount).toBe(1);

    const oracleValidation = validateReconciliationReport(csvContent);
    expect(oracleValidation.valid).toBe(true);
    expect(oracleValidation.total).toBe(4);
  });

  it('parses valid 7-column compact status report accurately', () => {
    const compactCsv = [
      'RECORD_TYPE,CLAIM_ID,DASH_REFERENCE_ID,STATUS,SETTLEMENT_DATE,FAILURE_CODE,FAILURE_REASON',
      'DETAIL,CLM-01,DASH-111,PAID,2026-10-05,,',
      'DETAIL,CLM-02,,RETURNED,2026-10-05,R01,Insufficient Funds',
      'DETAIL,CLM-03,,REJECTED,2026-10-05,CARD_EXPIRED,Card Expired'
    ].join('\n');

    const result = parseReconciliationReport(compactCsv);
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(3);
    expect(result.paidCount).toBe(1);
    expect(result.returnedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.records[1].errorCode).toBe('R01');
  });

  it('rejects 0-byte or empty report file gracefully without crashing', () => {
    const result = parseReconciliationReport('');
    expect(result.valid).toBe(false);
    expect(result.totalRecords).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('correctly categorizes exception types using taxonomy rules', () => {
    expect(determineExceptionType('ACH', 'R01')).toBe('ach_return');
    expect(determineExceptionType('ACH', 'R02')).toBe('ach_return');
    expect(determineExceptionType('ACH', 'R20')).toBe('ach_return');
    expect(determineExceptionType('PUSH_DEBIT', 'CARD_BLOCKED')).toBe('card_decline');
    expect(determineExceptionType('DIGITAL_CARD', 'INVALID_PAN')).toBe('card_decline');
    expect(determineExceptionType('PHYSICAL_CHECK', 'UNDELIVERABLE_ADDR')).toBe('check_returned');
    expect(determineExceptionType('PHYSICAL_CHECK', 'STALE_DATED_CHECK')).toBe('check_returned');
    expect(determineExceptionType('ACH', 'INVALID_ROUTING')).toBe('invalid_routing');
    expect(determineExceptionType('ACH', 'UNMATCHED_CLAIM_ID')).toBe('unmatched_claim');
  });

  it('parses RFC 4180 complex lines with quotes and commas safely', () => {
    const line = 'REP-01,"B,01",CLM-01,"Ref, 123",ACH,100.00,USD,RETURNED,"","2026-10-05","2026-10-05T12:00:00Z","R02","Account closed, per court order ""sealed""","Reason text"';
    const fields = parseCsvLine(line);
    expect(fields.length).toBe(14);
    expect(fields[1]).toBe('B,01');
    expect(fields[12]).toBe('Account closed, per court order "sealed"');
  });
});
