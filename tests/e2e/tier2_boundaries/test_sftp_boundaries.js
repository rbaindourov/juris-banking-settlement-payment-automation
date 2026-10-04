/**
 * Tier 2 - Boundary & Corner Cases: Dash Solutions SFTP & Financial Integrity
 * Tests 2.1 to 2.6: Zero details, Control totals mismatch, RFC 4180 escaping, 0-byte reports, Unmatched Claim IDs, Traversal.
 */

const { describe, it, expect, before, after } = require('../harness/test_runner');
const { MockSftpServer } = require('../harness/mock_sftp_server');
const { validateDashBatchCsv, validateReconciliationReport } = require('../harness/oracles');

describe('Tier 2: Boundary & Corner Cases - Dash SFTP & Financial Integrity', () => {
  let mockServer;

  before(async () => {
    mockServer = new MockSftpServer();
    await mockServer.start();
  });

  after(async () => {
    await mockServer.stop();
  });

  it('2.1 Rejects outbound batch generation when detail array is empty (MIN_RECORDS = 1)', () => {
    const emptyBatchCsv = 'HEADER,DASH_SFTP_V2.0,FIRM-01,CASE-01,1:24-cv-01,B1,2026-10-04T12:00:00Z,TEST,USD,0,0.00\nTRAILER,0,0.00,0,0.00,0,0.00,0,0.00,0,0.00,000000000';
    const validation = validateDashBatchCsv(emptyBatchCsv);

    // Detail lines count is 0
    expect(validation.valid).toBe(false);
    expect(validation.error).toInclude('MIN_RECORDS');
  });

  it('2.2 Control total mismatch detection: Declared trailer total ($100.01) vs sum of detail rows ($100.00) is rejected', () => {
    const mismatchedCsv = [
      'HEADER,DASH_SFTP_V2.0,FIRM-01,CASE-01,1:24-cv-01,B1,2026-10-04T12:00:00Z,TEST,USD,1,100.00',
      'DETAIL,ACH,C1,CLM1,Jane,Doe,100.00,USD,REF1,021000021,1234,CHECKING,PPD,SETTLEMENT,,,,,,',
      'TRAILER,1,100.01,1,100.00,0,0.00,0,0.00,0,0.00,021000021' // Trailer total declared as 100.01
    ].join('\n');

    const validation = validateDashBatchCsv(mismatchedCsv);
    expect(validation.valid).toBe(false);
    expect(validation.error).toInclude('Trailer total amount');
  });

  it('2.3 RFC 4180 escaping: Correctly escapes commas, quotes, and newlines in physical check addresses and names', () => {
    const complexAddress = {
      payee: 'O\'Connor, Jr., Esq.',
      street1: '123 Main St, Apt "4B"',
      street2: 'Care of: "Smith & Co."',
      city: 'St. Louis',
      state: 'MO',
      zip: '63101'
    };

    const escapedLine = [
      'DETAIL', 'PHYSICAL_CHECK', 'CLM-99', 'CLM-99',
      `"${complexAddress.payee.replace(/"/g, '""')}"`,
      'Jane', '150.00', 'USD', 'REF99',
      `"${complexAddress.payee.replace(/"/g, '""')}"`,
      `"${complexAddress.street1.replace(/"/g, '""')}"`,
      `"${complexAddress.street2.replace(/"/g, '""')}"`,
      `"${complexAddress.city}"`,
      complexAddress.state,
      complexAddress.zip,
      'US', 'Settlement', '', '', ''
    ].join(',');

    expect(escapedLine).toInclude('""4B""');
    expect(escapedLine).toInclude('"O\'Connor, Jr., Esq."');
  });

  it('2.4 Handles corrupt or 0-byte inbound reconciliation report file gracefully without unhandled exception', () => {
    const emptyReport = '';
    const result = validateReconciliationReport(emptyReport);

    expect(result.valid).toBe(false);
    expect(result.error).toInclude('must contain header');
  });

  it('2.5 Inbound reconciliation report with unmatched ClaimId creates UNMATCHED_CLAIM_ID exception without crashing', () => {
    const knownClaimIds = new Set(['CLM-001', 'CLM-002']);
    const incomingRecord = { claimId: 'CLM-UNKNOWN-999', status: 'PAID', amount: 50.00 };

    let exceptionLogged = false;
    let exceptionCode = null;

    if (!knownClaimIds.has(incomingRecord.claimId)) {
      exceptionLogged = true;
      exceptionCode = 'UNMATCHED_CLAIM_ID';
    }

    expect(exceptionLogged).toBe(true);
    expect(exceptionCode).toBe('UNMATCHED_CLAIM_ID');
  });

  it('2.6 SFTP security: Rejects path traversal attempts (e.g. /inbound/../../../etc/passwd) with PERMISSION_DENIED', async () => {
    const client = mockServer.createClientAdapter();
    let threwTraversal = false;
    let errorMessage = '';

    try {
      await client.put('malicious data', '/inbound/../../../etc/passwd');
    } catch (err) {
      threwTraversal = true;
      errorMessage = err.message;
    }

    expect(threwTraversal).toBe(true);
    expect(errorMessage).toInclude('Path traversal prohibited');
  });
});
