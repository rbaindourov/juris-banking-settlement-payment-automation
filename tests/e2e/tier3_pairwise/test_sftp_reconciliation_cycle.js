/**
 * Tier 3 - Cross-Feature Combinations: Pairwise Scenario 3
 * Feature Interaction: Outbound SFTP Batch Upload + Inbound Reconciliation Report Polling & Processing.
 */

const { describe, it, expect, before, after } = require('../harness/test_runner');
const { MockSftpServer } = require('../harness/mock_sftp_server');
const { buildDashBatchCsv, buildReconciliationReportCsv } = require('../harness/data_generators');
const { validateDashBatchCsv, validateReconciliationReport } = require('../harness/oracles');

describe('Tier 3: Pairwise - Outbound SFTP Batch & Reconciliation Cycle', () => {
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

  it('Transmits outbound batch via SFTP, seeds inbound reconciliation report, and updates claimant statuses to terminal states', async () => {
    const sftpClient = mockServer.createClientAdapter();
    const caseMeta = {
      caseId: 'CASE-E2E-REC-001',
      clientId: 'FIRM-001',
      docketNumber: '1:24-cv-09821',
      batchId: 'BATCH-REC-CYCLE-01',
    };

    // 1. Generate and Upload Outbound Batch
    const claimants = [
      { claimId: 'CLM-REC-01', method: 'ACH', firstName: 'John', lastName: 'Doe', amount: 300.00, achRouting: '021000021', achAccount: '112233' },
      { claimId: 'CLM-REC-02', method: 'PHYSICAL_CHECK', firstName: 'Mary', lastName: 'Roe', amount: 200.00, street1: '123 Main St', city: 'Denver', state: 'CO', zip: '80201' },
      { claimId: 'CLM-REC-03', method: 'ACH', firstName: 'Frank', lastName: 'Boe', amount: 150.00, achRouting: '021000089', achAccount: '445566' },
    ];

    const outboundCsv = buildDashBatchCsv(caseMeta, claimants);
    expect(validateDashBatchCsv(outboundCsv).valid).toBe(true);

    const batchFilename = `DASH_DISBURSE_${caseMeta.caseId}_20261004120000.csv`;
    await sftpClient.put(outboundCsv, `/inbound/disbursements/${batchFilename}`);

    // Verify batch landed in mock SFTP
    const receivedBatches = mockServer.getReceivedBatches();
    expect(receivedBatches.length).toBe(1);
    expect(receivedBatches[0].filename).toBe(batchFilename);

    // 2. Mock SFTP generates inbound status reconciliation report
    // Row 1: CLM-REC-01 settled -> PAID
    // Row 2: CLM-REC-02 check settled -> PAID
    // Row 3: CLM-REC-03 ACH account closed -> RETURNED (R02)
    const reportFilename = 'REPORT_STATUS_20261005120000.csv';
    const reportRecords = [
      { claimId: 'CLM-REC-01', method: 'ACH', amount: 300.00, status: 'PAID', dashRefId: 'DASH-ACH-889901' },
      { claimId: 'CLM-REC-02', method: 'PHYSICAL_CHECK', amount: 200.00, status: 'PAID', dashRefId: 'DASH-CHK-889902' },
      { claimId: 'CLM-REC-03', method: 'ACH', amount: 150.00, status: 'RETURNED', errorCode: 'R02', errorMessage: 'Account Closed' },
    ];

    const reportCsv = buildReconciliationReportCsv('REP-20261005-01', caseMeta.batchId, reportRecords);
    mockServer.seedReconciliationReport(reportFilename, reportCsv);

    // 3. Client Poller discovers and downloads report
    const remoteReports = await sftpClient.list('/outbound/reports');
    expect(remoteReports.length).toBe(1);
    expect(remoteReports[0].name).toBe(reportFilename);

    const downloadedReportBuffer = await sftpClient.get(`/outbound/reports/${reportFilename}`);
    const downloadedReportContent = downloadedReportBuffer.toString('utf8');
    const parsedReport = validateReconciliationReport(downloadedReportContent);

    expect(parsedReport.valid).toBe(true);
    expect(parsedReport.total).toBe(3);

    // 4. State Machine Transitions Verification
    const dbClaimants = new Map([
      ['CLM-REC-01', { claimId: 'CLM-REC-01', status: 'dispatched', dashRefId: null }],
      ['CLM-REC-02', { claimId: 'CLM-REC-02', status: 'dispatched', dashRefId: null }],
      ['CLM-REC-03', { claimId: 'CLM-REC-03', status: 'dispatched', dashRefId: null }],
    ]);

    for (const r of parsedReport.records) {
      const record = dbClaimants.get(r.claimId);
      if (r.status === 'PAID') {
        record.status = 'disbursed';
        record.dashRefId = r.dashRefId;
      } else if (r.status === 'RETURNED' || r.status === 'REJECTED') {
        record.status = 'payment_failed';
        record.errorCode = r.errorCode;
      }
    }

    expect(dbClaimants.get('CLM-REC-01').status).toBe('disbursed');
    expect(dbClaimants.get('CLM-REC-01').dashRefId).toBe('DASH-ACH-889901');
    expect(dbClaimants.get('CLM-REC-02').status).toBe('disbursed');
    expect(dbClaimants.get('CLM-REC-03').status).toBe('payment_failed');
    expect(dbClaimants.get('CLM-REC-03').errorCode).toBe('R02');
  });
});
