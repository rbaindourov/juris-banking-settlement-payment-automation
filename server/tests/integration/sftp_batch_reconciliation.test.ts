import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { DisbursementBatch } from '../../src/models/DisbursementBatch';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';
import { SftpService } from '../../src/services/sftp.service';
import { ReconciliationService } from '../../src/services/reconciliation.service';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';

describe('Integration: Outbound SFTP Batch Generation & Inbound Status Reconciliation Cycle', () => {
  let mockServer: MockSftpInstance;
  let sftpService: SftpService;

  beforeAll(async () => {
    await setupTestDb('sftp_batch_rec');
    mockServer = await startMockSftp({
      port: 0,
      username: 'batch_rec_user',
      password: 'batch_rec_pass'
    });
    sftpService = new SftpService({
      host: mockServer.host,
      port: mockServer.port,
      username: 'batch_rec_user',
      password: 'batch_rec_pass'
    });
  });

  afterAll(async () => {
    if (sftpService) {
      await sftpService.disconnect();
    }
    if (mockServer) {
      await stopMockSftp(mockServer);
    }
    await teardownTestDb('sftp_batch_rec');
  });

  beforeEach(async () => {
    await clearTestDb('sftp_batch_rec');
    mockServer.vfs.clearStorage();
  });

  it('compiles batch, uploads via SFTP, reconciles report, and updates claimant statuses to terminal states', async () => {
    // 1. Seed Case
    const testCase = await Case.create({
      caseId: 'CASE-REC-TEST-001',
      name: 'In re Financial Disbursals Class Action',
      docketNumber: '1:24-cv-09821',
      lawFirmId: 'FIRM-001',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check'
    });

    // 2. Seed Claimants (2 selected, 1 deadline_expired, 1 pending_selection)
    const c1 = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-REC-01',
      firstName: 'Alice',
      lastName: 'Adams',
      email: 'alice@example.com',
      settlementAmount: 300.0,
      status: 'selected',
      selectedPaymentMethod: 'ach',
      paymentDetails: {
        routingNumber: '021000021',
        accountNumber: '123456789',
        accountType: 'CHECKING'
      }
    });

    const c2 = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-REC-02',
      firstName: 'Bob',
      lastName: 'Baker',
      email: 'bob@example.com',
      settlementAmount: 200.0,
      status: 'selected',
      selectedPaymentMethod: 'digital_card',
      paymentDetails: {
        cardBrand: 'MASTERCARD',
        recipientEmail: 'bob@example.com'
      }
    });

    const c3 = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-REC-03',
      firstName: 'Charlie',
      lastName: 'Clark',
      email: 'charlie@example.com',
      settlementAmount: 150.0,
      status: 'deadline_expired',
      address: {
        street: '456 Elm St',
        city: 'Denver',
        state: 'CO',
        zip: '80201'
      }
    });

    // Claimant not eligible for batch (still pending selection)
    await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-REC-04',
      firstName: 'David',
      lastName: 'Davis',
      email: 'david@example.com',
      settlementAmount: 50.0,
      status: 'pending_selection'
    });

    // 3. Compile and Spool Outbound Batch
    const batchResult = await BatchGeneratorService.compileAndSpoolCaseBatch(testCase._id.toString());
    expect(batchResult.totalRecords).toBe(3);
    expect(batchResult.totalAmount).toBe(650.0);

    // Verify claimants transitioned to queued_for_sftp
    const updatedC1 = await Claimant.findById(c1._id);
    const updatedC2 = await Claimant.findById(c2._id);
    const updatedC3 = await Claimant.findById(c3._id);

    expect(updatedC1?.status).toBe('queued_for_sftp');
    expect(updatedC1?.batchId).toBe(batchResult.batchId);
    expect(updatedC2?.status).toBe('queued_for_sftp');
    expect(updatedC3?.status).toBe('queued_for_sftp');

    // Verify DisbursementBatch record
    const batchDoc = await DisbursementBatch.findOne({ batchId: batchResult.batchId });
    expect(batchDoc).not.toBeNull();
    expect(batchDoc?.status).toBe('spooled');
    expect(batchDoc?.totalRecords).toBe(3);

    // 4. Upload Batch to Mock SFTP
    const uploadRes = await sftpService.uploadBatch(batchResult.csvPath, batchResult.sha256Path);
    expect(uploadRes.bytesUploaded).toBeGreaterThan(0);

    // 5. Seed Inbound Status Report on Mock SFTP
    // Row 1: CLM-REC-01 settled -> PAID
    // Row 2: CLM-REC-02 rejected -> REJECTED (CARD_BLOCKED)
    // Row 3: CLM-REC-03 returned -> RETURNED (R02)
    // Row 4: Unmatched claim ID -> CLM-UNKNOWN-999
    const reportFilename = `REPORT_STATUS_${Date.now()}.csv`;
    const reportCsv = [
      'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
      `REP-01,${batchResult.batchId},CLM-REC-01,REF-01,ACH,300.00,USD,PAID,DASH-ACH-889901,2026-10-05,2026-10-05T12:00:00Z,,,`,
      `REP-01,${batchResult.batchId},CLM-REC-02,REF-02,DIGITAL_CARD,200.00,USD,REJECTED,,2026-10-05,2026-10-05T12:00:00Z,CARD_BLOCKED,"Card blocked by issuer",`,
      `REP-01,${batchResult.batchId},CLM-REC-03,REF-03,PHYSICAL_CHECK,150.00,USD,RETURNED,,2026-10-05,2026-10-05T12:00:00Z,UNDELIVERABLE_ADDR,"Undeliverable as addressed",`,
      `REP-01,${batchResult.batchId},CLM-UNKNOWN-999,REF-99,ACH,50.00,USD,PAID,DASH-999,2026-10-05,2026-10-05T12:00:00Z,,,`
    ].join('\n');

    mockServer.seedReconciliationReport(reportFilename, reportCsv);

    // 6. Download and Reconcile
    const tempInboxPath = path.resolve(process.cwd(), 'storage/sftp/inbox', reportFilename);
    const downloadedReport = await sftpService.downloadReport(reportFilename, tempInboxPath);

    const recResult = await ReconciliationService.reconcileCaseStatusReport({
      caseId: testCase._id.toString(),
      csvContent: downloadedReport.content,
      reportFilename,
      batchId: batchResult.batchId
    });

    expect(recResult.totalProcessed).toBe(4);
    expect(recResult.disbursedCount).toBe(1);
    expect(recResult.rejectedCount).toBe(1);
    expect(recResult.returnedCount).toBe(1);
    expect(recResult.unmatchedCount).toBe(1);
    expect(recResult.exceptionsLogged).toBe(3);

    // 7. Verify Terminal Claimant States in DB
    const finalC1 = await Claimant.findById(c1._id);
    const finalC2 = await Claimant.findById(c2._id);
    const finalC3 = await Claimant.findById(c3._id);

    expect(finalC1?.status).toBe('disbursed');
    expect(finalC1?.dashReferenceId).toBe('DASH-ACH-889901');
    expect(finalC1?.disbursedAt).toBeDefined();

    expect(finalC2?.status).toBe('rejected');
    expect(finalC2?.failureCode).toBe('CARD_BLOCKED');

    expect(finalC3?.status).toBe('returned');
    expect(finalC3?.failureCode).toBe('UNDELIVERABLE_ADDR');

    // 8. Verify Reconciliation Exceptions in DB
    const exceptions = await ReconciliationException.find({ caseId: testCase._id });
    expect(exceptions.length).toBe(3);

    const rejectedEx = exceptions.find((e) => e.claimId === 'CLM-REC-02');
    expect(rejectedEx?.status).toBe('REJECTED');
    expect(rejectedEx?.exceptionType).toBe('card_decline');
    expect(rejectedEx?.returnCode).toBe('CARD_BLOCKED');

    const returnedEx = exceptions.find((e) => e.claimId === 'CLM-REC-03');
    expect(returnedEx?.status).toBe('RETURNED');
    expect(returnedEx?.exceptionType).toBe('check_returned');

    const unmatchedEx = exceptions.find((e) => e.claimId === 'CLM-UNKNOWN-999');
    expect(unmatchedEx?.exceptionType).toBe('unmatched_claim');
    expect(unmatchedEx?.claimantId).toBeNull();
  });
});
