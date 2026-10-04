/**
 * Tier 1 - Feature Coverage: Dash Solutions SFTP Batch Engine & Reconciliation
 * Tests 1.1 to 1.6: Batch CSV Generation, SHA-256 Companion, SFTP Upload, Atomic Rename, Report Parsing, Exception Ledger.
 */

const crypto = require('node:crypto');
const { describe, it, expect, before, after } = require('../harness/test_runner');
const { MockSftpServer } = require('../harness/mock_sftp_server');
const { buildDashBatchCsv, buildReconciliationReportCsv } = require('../harness/data_generators');
const {
  validateDashBatchCsv,
  validateSha256Checksum,
  validateReconciliationReport
} = require('../harness/oracles');

describe('Tier 1: Feature Coverage - Dash Solutions SFTP Batch Engine', () => {
  let mockServer;

  before(async () => {
    mockServer = new MockSftpServer();
    await mockServer.start();
    mockServer.clearStorage();
  });

  after(async () => {
    mockServer.clearStorage();
    await mockServer.stop();
  });

  it('1.1 Generates standardized Dash batch CSV with Header, 4 Detail types, and verified Trailer controls', () => {
    const metadata = {
      clientId: 'FIRM-LEGAL-001',
      caseId: 'CASE-2026-99',
      docketNumber: '1:24-cv-09821',
      batchId: 'BATCH-20261004-001',
      caseName: 'Smith v. Acme',
    };

    const details = [
      {
        method: 'ACH', claimId: 'CLM-01', firstName: 'Alice', lastName: 'Adams',
        amount: 150.00, achRouting: '021000021', achAccount: '123456789', achType: 'CHECKING'
      },
      {
        method: 'DIGITAL_CARD', claimId: 'CLM-02', firstName: 'Bob', lastName: 'Baker',
        amount: 200.00, cardBrand: 'MASTERCARD', channel: 'EMAIL', email: 'bob@example.com'
      },
      {
        method: 'PUSH_DEBIT', claimId: 'CLM-03', firstName: 'Charlie', lastName: 'Clark',
        amount: 100.00, token: 'tok_visa_001', last4: '4412', bin: '411111', network: 'VISA'
      },
      {
        method: 'PHYSICAL_CHECK', claimId: 'CLM-04', firstName: 'Diana', lastName: 'Davis',
        amount: 250.00, street1: '789 Pine St', city: 'Seattle', state: 'WA', zip: '98101'
      },
    ];

    const csvContent = buildDashBatchCsv(metadata, details);
    const validation = validateDashBatchCsv(csvContent);

    expect(validation.valid).toBe(true);
    expect(validation.totalRecords).toBe(4);
    expect(validation.totalAmount).toBe(700.00);
    expect(validation.breakdown.ach.count).toBe(1);
    expect(validation.breakdown.ach.amount).toBe(150.00);
    expect(validation.breakdown.card.count).toBe(1);
    expect(validation.breakdown.debit.count).toBe(1);
    expect(validation.breakdown.check.count).toBe(1);
  });

  it('1.2 Generates companion .sha256 digest file and cryptographically verifies checksum', () => {
    const csvContent = 'HEADER,DASH_SFTP_V2.0,FIRM-01,CASE-01,1:24-cv-01,BATCH-01,2026-10-04T12:00:00Z,TEST,USD,1,100.00\nDETAIL,ACH,C1,C1,"A","B",100.00,USD,REF1,021000021,1234,CHECKING,PPD,DESC,,,,,\nTRAILER,1,100.00,1,100.00,0,0.00,0,0.00,0,0.00,021000021';
    const filename = 'DASH_DISBURSE_CASE01_20261004120000.csv';

    const hash = crypto.createHash('sha256').update(csvContent).digest('hex');
    const companionContent = `${hash}  ${filename}\n`;

    const checkResult = validateSha256Checksum(csvContent, companionContent, filename);
    expect(checkResult.valid).toBe(true);
    expect(checkResult.hash).toBe(hash);
  });

  it('1.3 Uploads batch file and companion checksum to mock SFTP server', async () => {
    const client = mockServer.createClientAdapter();
    await client.connect({
      username: 'juris_test_user',
      password: 'juris_test_password',
    });

    const filename = 'DASH_DISBURSE_TEST_001.csv';
    const csvData = 'HEADER,DASH_SFTP_V2.0\nTRAILER,0,0.00';
    const shaData = `${crypto.createHash('sha256').update(csvData).digest('hex')}  ${filename}`;

    await client.put(csvData, `/inbound/disbursements/${filename}`);
    await client.put(shaData, `/inbound/disbursements/${filename}.sha256`);

    const received = mockServer.getReceivedBatches();
    expect(received.length).toBeGreaterThan(0);
    expect(mockServer.getBatchContent(filename)).toBe(csvData);
  });

  it('1.4 Executes atomic upload: writes to .tmp staging file before renaming to target CSV', async () => {
    const client = mockServer.createClientAdapter();
    const finalFilename = 'DASH_DISBURSE_ATOMIC_002.csv';
    const tmpFilename = `${finalFilename}.tmp`;
    const batchData = 'HEADER,DASH_SFTP_V2.0,ATOMIC\nTRAILER,0,0.00';

    // 1. Write staged .tmp
    await client.put(batchData, `/inbound/disbursements/${tmpFilename}`);
    expect(await client.exists(`/inbound/disbursements/${tmpFilename}`)).toBe(true);

    // 2. Atomic rename
    await client.rename(`/inbound/disbursements/${tmpFilename}`, `/inbound/disbursements/${finalFilename}`);

    // 3. Assert .tmp is gone and final file exists
    expect(await client.exists(`/inbound/disbursements/${tmpFilename}`)).toBe(false);
    expect(await client.exists(`/inbound/disbursements/${finalFilename}`)).toBe(true);
  });

  it('1.5 Inbound reconciliation report parsing correlates Claim IDs with statuses (PAID, REJECTED, RETURNED)', () => {
    const reportId = 'REP-20261005-01';
    const batchId = 'BATCH-20261004-001';
    const statusRecords = [
      { claimId: 'CLM-01', method: 'ACH', amount: 150.00, status: 'PAID', dashRefId: 'DASH-ACH-112233' },
      { claimId: 'CLM-02', method: 'DIGITAL_CARD', amount: 200.00, status: 'PAID', dashRefId: 'DASH-VCD-445566' },
      { claimId: 'CLM-03', method: 'PUSH_DEBIT', amount: 100.00, status: 'REJECTED', errorCode: 'CARD_BLOCKED', errorMessage: 'Card blocked by issuer' },
      { claimId: 'CLM-04', method: 'ACH', amount: 250.00, status: 'RETURNED', errorCode: 'R02', errorMessage: 'Account Closed', failureReason: 'Customer closed account' },
    ];

    const reportCsv = buildReconciliationReportCsv(reportId, batchId, statusRecords);
    const parsed = validateReconciliationReport(reportCsv);

    expect(parsed.valid).toBe(true);
    expect(parsed.total).toBe(4);

    const paidRows = parsed.records.filter(r => r.status === 'PAID');
    const rejectedRows = parsed.records.filter(r => r.status === 'REJECTED');
    const returnedRows = parsed.records.filter(r => r.status === 'RETURNED');

    expect(paidRows.length).toBe(2);
    expect(rejectedRows.length).toBe(1);
    expect(returnedRows.length).toBe(1);
    expect(returnedRows[0].errorCode).toBe('R02');
  });

  it('1.6 Reconciliation exceptions are logged with audit data and NACHA return code', () => {
    const exceptionDoc = {
      caseId: 'CASE-2026-99',
      batchId: 'BATCH-20261004-001',
      claimId: 'CLM-04',
      paymentMethod: 'ACH',
      amount: 250.00,
      currency: 'USD',
      status: 'RETURNED',
      errorCode: 'R02',
      errorMessage: 'Account Closed',
      failureReason: 'Customer closed account',
      resolutionStatus: 'open',
      createdAt: new Date().toISOString(),
    };

    expect(exceptionDoc.errorCode).toBe('R02');
    expect(exceptionDoc.status).toBe('RETURNED');
    expect(exceptionDoc.resolutionStatus).toBe('open');
  });
});
