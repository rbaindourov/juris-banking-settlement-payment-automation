import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import SftpClient from 'ssh2-sftp-client';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { signToken } from '../../src/utils/jwt';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';
import { VfsManager } from '../../../fixtures/mock-sftp/vfs';
import {
  parseReconciliationReport,
  ReconciliationService
} from '../../src/services/reconciliation.service';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';

const { validateDashBatchCsv } = require('../../../tests/e2e/harness/oracles');

describe('Empirical Challenger: Milestone 4 SFTP Boundaries, Security Invariants, and Reconciliation Edge Cases', () => {
  let mockServer: MockSftpInstance;
  let adminToken: string;
  let testCase: any;

  beforeAll(async () => {
    await setupTestDb('m4_challenger');

    mockServer = await startMockSftp({
      port: 0,
      username: 'challenger_user',
      password: 'challenger_pass'
    });

    adminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm1.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-001'
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await stopMockSftp(mockServer);
    }
    await teardownTestDb('m4_challenger');
  });

  beforeEach(async () => {
    await clearTestDb('m4_challenger');
    testCase = await Case.create({
      caseId: 'CASE-CHALLENGE-M4',
      name: 'Class Action Settlement Alpha',
      docketNumber: '3:24-cv-01122',
      lawFirmId: 'FIRM-001',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check'
    });
  });

  // =========================================================================
  // Dimension 1: SFTP Path Traversal Resistance & Sandboxed VFS
  // =========================================================================
  describe('Dimension 1: SFTP Path Traversal Resistance & Sandboxed VFS', () => {
    it('[SFTP-TRAV-01] Strictly blocks write (PUT) operations attempting to escape inbound directory or baseDir via path traversal', async () => {
      const client = new SftpClient();
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'challenger_user',
        password: 'challenger_pass',
        hostVerifier: () => true
      });

      const traversalPayloads = [
        '../../../../etc/passwd',
        '/inbound/disbursements/../../../../etc/passwd',
        '/inbound/disbursements/../../../etc/shadow',
        '..\\..\\..\\windows\\system32\\cmd.exe',
        '../outside.csv',
        '/inbound/../outbound/../../escape_test.txt',
        './../../../../etc/passwd'
      ];

      try {
        for (const targetPath of traversalPayloads) {
          let blocked = false;
          let errorMessage = '';
          try {
            await client.put(Buffer.from('EXPLOIT_PAYLOAD'), targetPath);
          } catch (err: any) {
            blocked = true;
            errorMessage = err.message || '';
          }
          expect(blocked).toBe(true);
          expect(errorMessage).toMatch(/Permission denied|prohibited/i);
        }
      } finally {
        await client.end().catch(() => {});
      }
    });

    it('[SFTP-TRAV-02] Host filesystem isolation: SFTP client cannot read or overwrite host system files (/etc/passwd)', async () => {
      const client = new SftpClient();
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'challenger_user',
        password: 'challenger_pass',
        hostVerifier: () => true
      });

      try {
        // 1. Path traversal GET targeting host /etc/passwd must be blocked
        let travGetBlocked = false;
        try {
          await client.get('../../../../etc/passwd');
        } catch (err: any) {
          travGetBlocked = true;
          expect(err.message).toMatch(/Permission denied|prohibited/i);
        }
        expect(travGetBlocked).toBe(true);

        // 2. Direct GET on /etc/passwd must NOT leak host /etc/passwd content
        const realHostPasswd = fs.readFileSync('/etc/passwd', 'utf8');
        expect(realHostPasswd).toContain('root:');

        let directContent: Buffer | string | null = null;
        try {
          directContent = await client.get('/etc/passwd');
        } catch {
          directContent = null;
        }

        // Either it was not found, or if created inside sandbox, it must NEVER match real host passwd
        if (directContent) {
          expect(directContent.toString()).not.toBe(realHostPasswd);
        } else {
          expect(directContent).toBeNull();
        }

        // 3. STAT / LIST operations with traversal must be blocked
        let statBlocked = false;
        try {
          await client.stat('../../../../etc/passwd');
        } catch {
          statBlocked = true;
        }
        expect(statBlocked).toBe(true);

        let listBlocked = false;
        try {
          await client.list('../../../../');
        } catch {
          listBlocked = true;
        }
        expect(listBlocked).toBe(true);
      } finally {
        await client.end().catch(() => {});
      }
    });

    it('[SFTP-TRAV-03] Direct VFS manager resolvePath throws PERMISSION_DENIED on dot-dot segments and path escapes', () => {
      const vfs = new VfsManager();

      const invalidPaths = [
        '../etc/passwd',
        'foo/../../bar',
        '/a/b/../../../etc/shadow',
        '..\\windows\\win.ini',
        '/inbound/disbursements/../../../../etc/passwd',
        './../../../../etc/passwd'
      ];

      for (const p of invalidPaths) {
        expect(() => vfs.resolvePath(p)).toThrow(/PERMISSION_DENIED|Path traversal prohibited/);
      }

      // Valid subpaths within baseDir must resolve correctly and stay inside baseDir
      const validPath = vfs.resolvePath('/inbound/disbursements/batch_01.csv');
      expect(validPath.startsWith(vfs.baseDir)).toBe(true);
      expect(validPath).toContain('batch_01.csv');

      const validOutbound = vfs.resolvePath('/outbound/reports/report_01.csv');
      expect(validOutbound.startsWith(vfs.baseDir)).toBe(true);
      expect(validOutbound).toContain('report_01.csv');
    });
  });

  // =========================================================================
  // Dimension 2: Trailer Control Total Tampering & Financial Integrity
  // =========================================================================
  describe('Dimension 2: Trailer Control Total Tampering & Financial Integrity', () => {
    it('[TRAILER-01] Rejects trailer if total amount differs by even $0.01 (+1 cent or -1 cent)', () => {
      // Base valid batch with $100.00 ACH
      const createBatch = (trailerAmount: string) => [
        'HEADER,DASH_SFTP_V2.0,FIRM-001,CASE-01,3:24-cv-01122,B1,2026-10-04T12:00:00Z,TEST,USD,1,100.00',
        'DETAIL,ACH,CLM-01,CLM-01,"John","Doe",100.00,USD,REF-01,021000021,123456,CHECKING,PPD,SETTLEMENT,,,,,,',
        `TRAILER,1,${trailerAmount},1,100.00,0,0.00,0,0.00,0,0.00,021000021`
      ].join('\n');

      // +0.01 discrepancy
      const plusOneCent = validateDashBatchCsv(createBatch('100.01'));
      expect(plusOneCent.valid).toBe(false);
      expect(plusOneCent.error).toMatch(/Trailer total amount 100.01 does not match sum of details 100.00/);

      // -0.01 discrepancy
      const minusOneCent = validateDashBatchCsv(createBatch('99.99'));
      expect(minusOneCent.valid).toBe(false);
      expect(minusOneCent.error).toMatch(/Trailer total amount 99.99 does not match sum of details 100.00/);

      // Gross discrepancy
      const grossTampering = validateDashBatchCsv(createBatch('50000.00'));
      expect(grossTampering.valid).toBe(false);
      expect(grossTampering.error).toMatch(/Trailer total amount 50000 does not match sum of details 100.00/);
    });

    it('[TRAILER-02] Rejects trailer if total record count differs from detail lines count', () => {
      const forgedCount = [
        'HEADER,DASH_SFTP_V2.0,FIRM-001,CASE-01,3:24-cv-01122,B1,2026-10-04T12:00:00Z,TEST,USD,1,100.00',
        'DETAIL,ACH,CLM-01,CLM-01,"John","Doe",100.00,USD,REF-01,021000021,123456,CHECKING,PPD,SETTLEMENT,,,,,,',
        'TRAILER,5,100.00,1,100.00,0,0.00,0,0.00,0,0.00,021000021' // 5 declared vs 1 actual
      ].join('\n');

      const validation = validateDashBatchCsv(forgedCount);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/Trailer record count 5 does not match details count 1/);
    });

    it('[TRAILER-03] Rejects trailer if rail breakdown count or amount is tampered', () => {
      // 1 ACH ($100), 1 Card ($50) -> total 2 records, $150.00
      const createRailBatch = (tCountAch: number, tAmountAch: string, tCountCard: number, tAmountCard: string) => [
        'HEADER,DASH_SFTP_V2.0,FIRM-001,CASE-01,3:24-cv-01122,B1,2026-10-04T12:00:00Z,TEST,USD,2,150.00',
        'DETAIL,ACH,CLM-01,CLM-01,"John","Doe",100.00,USD,REF-01,021000021,123456,CHECKING,PPD,SETTLEMENT,,,,,,',
        'DETAIL,DIGITAL_CARD,CLM-02,CLM-02,"Jane","Smith",50.00,USD,REF-02,MASTERCARD,EMAIL,jane@example.com,,Jane Smith,24,,,,,',
        `TRAILER,2,150.00,${tCountAch},${tAmountAch},${tCountCard},${tAmountCard},0,0.00,0,0.00,021000021`
      ].join('\n');

      // Tampered ACH count (0 instead of 1)
      const tamperedAchCount = validateDashBatchCsv(createRailBatch(0, '100.00', 1, '50.00'));
      expect(tamperedAchCount.valid).toBe(false);
      expect(tamperedAchCount.error).toMatch(/ACH control totals mismatch/);

      // Tampered ACH amount ($90.00 instead of $100.00)
      const tamperedAchAmount = validateDashBatchCsv(createRailBatch(1, '90.00', 1, '50.00'));
      expect(tamperedAchAmount.valid).toBe(false);
      expect(tamperedAchAmount.error).toMatch(/ACH control totals mismatch/);

      // Tampered Card amount ($60.00 instead of $50.00)
      const tamperedCardAmount = validateDashBatchCsv(createRailBatch(1, '100.00', 1, '60.00'));
      expect(tamperedCardAmount.valid).toBe(false);
      expect(tamperedCardAmount.error).toMatch(/Card control totals mismatch/);
    });

    it('[TRAILER-04] Rejects batch when header declared count or sum does not match trailer', () => {
      const headerMismatch = [
        'HEADER,DASH_SFTP_V2.0,FIRM-001,CASE-01,3:24-cv-01122,B1,2026-10-04T12:00:00Z,TEST,USD,2,200.00', // Header says 2 and 200.00
        'DETAIL,ACH,CLM-01,CLM-01,"John","Doe",100.00,USD,REF-01,021000021,123456,CHECKING,PPD,SETTLEMENT,,,,,,',
        'TRAILER,1,100.00,1,100.00,0,0.00,0,0.00,0,0.00,021000021' // Trailer says 1 and 100.00
      ].join('\n');

      const validation = validateDashBatchCsv(headerMismatch);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/Header declared count 2 does not match trailer total 1/);
    });
  });

  // =========================================================================
  // Dimension 3: Corrupted or Truncated Status Report CSVs
  // =========================================================================
  describe('Dimension 3: Corrupted or Truncated Status Report CSVs', () => {
    it('[CSV-ROBUST-01] Gracefully handles empty, whitespace-only, and header-only content without unhandled exceptions', () => {
      const emptyResult = parseReconciliationReport('');
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.records.length).toBe(0);
      expect(emptyResult.errors.length).toBeGreaterThan(0);

      const whitespaceResult = parseReconciliationReport('   \n\n\t\r\n  ');
      expect(whitespaceResult.valid).toBe(false);
      expect(whitespaceResult.records.length).toBe(0);

      const headerOnly = 'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON';
      const headerOnlyResult = parseReconciliationReport(headerOnly);
      expect(headerOnlyResult.valid).toBe(false);
      expect(headerOnlyResult.errors[0]).toMatch(/must contain header and at least 1 record/);
    });

    it('[CSV-ROBUST-02] Gracefully handles empty lines interspersed throughout the file without breaking valid records', () => {
      const interspersedCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        '',
        'REP-1,B-1,CLM-01,REF-01,ACH,100.00,USD,PAID,DASH-01,2026-10-04,2026-10-04T12:00:00Z,,,',
        '   ',
        '',
        'REP-1,B-1,CLM-02,REF-02,ACH,200.00,USD,PAID,DASH-02,2026-10-04,2026-10-04T12:00:00Z,,,',
        ''
      ].join('\n');

      const result = parseReconciliationReport(interspersedCsv);
      expect(result.valid).toBe(true);
      expect(result.totalRecords).toBe(2);
      expect(result.paidCount).toBe(2);
      expect(result.records[0].claimId).toBe('CLM-01');
      expect(result.records[1].claimId).toBe('CLM-02');
    });

    it('[CSV-ROBUST-03] Handles invalid status values, malformed timestamps, and non-numeric amounts without throwing', () => {
      const malformedDataCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        // Row 2: Invalid status 'IN_FLIGHT' -> should record error for this row, but not crash
        'REP-1,B-1,CLM-INV-STATUS,REF-1,ACH,100.00,USD,IN_FLIGHT,DASH-1,2026-10-04,2026-10-04,,,',
        // Row 3: Malformed timestamp and non-numeric amount 'NaN_AMOUNT' -> should handle safely
        'REP-1,B-1,CLM-MALFORMED,REF-2,ACH,NOT_A_NUMBER,USD,PAID,DASH-2,INVALID_DATE,NOT_A_TIMESTAMP,,,',
        // Row 4: Valid record
        'REP-1,B-1,CLM-VALID,REF-3,ACH,300.00,USD,PAID,DASH-3,2026-10-04,2026-10-04T12:00:00Z,,,'
      ].join('\n');

      const result = parseReconciliationReport(malformedDataCsv);
      expect(result.valid).toBe(false); // flagged errors for invalid status row
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toMatch(/Invalid status "IN_FLIGHT"/);
      expect(result.records.length).toBe(2); // CLM-MALFORMED and CLM-VALID parsed
      expect(result.records[0].claimId).toBe('CLM-MALFORMED');
      expect(result.records[0].amount).toBeUndefined(); // NaN converted to undefined safely
      expect(result.records[1].claimId).toBe('CLM-VALID');
      expect(result.records[1].amount).toBe(300.00);
    });

    it('[CSV-ROBUST-04] Gracefully handles unclosed quotes and binary garbage without throwing or hanging', () => {
      const unclosedQuoteCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        'REP-1,B-1,CLM-01,REF-01,ACH,100.00,USD,PAID,DASH-01,2026-10-04,2026-10-04T12:00:00Z,,"Unclosed description text,,'
      ].join('\n');

      const result = parseReconciliationReport(unclosedQuoteCsv);
      expect(result.totalRecords).toBe(1);
      expect(result.records[0].claimId).toBe('CLM-01');

      const binaryGarbage = '\x00\xFF\xFE\x00\x01\x02\x03\x04\x05\x06';
      const garbageResult = parseReconciliationReport(binaryGarbage);
      expect(garbageResult.valid).toBe(false);
      expect(garbageResult.records.length).toBe(0);
    });
  });

  // =========================================================================
  // Dimension 4: Unmatched Claim IDs & Resilience
  // =========================================================================
  describe('Dimension 4: Unmatched Claim IDs & Resilience', () => {
    it('[UNMATCHED-01] Logs unmatched_claim exception without halting processing for subsequent valid claimants', async () => {
      // Create 3 valid claimants in test case
      const c1 = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-VALID-1',
        firstName: 'Alice',
        lastName: 'Anderson',
        email: 'alice@example.com',
        settlementAmount: 100.00,
        status: 'queued_for_sftp',
        selectedPaymentMethod: 'ach'
      });

      const c2 = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-VALID-2',
        firstName: 'Bob',
        lastName: 'Baker',
        email: 'bob@example.com',
        settlementAmount: 200.00,
        status: 'queued_for_sftp',
        selectedPaymentMethod: 'ach'
      });

      const c3 = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-VALID-3',
        firstName: 'Charlie',
        lastName: 'Clark',
        email: 'charlie@example.com',
        settlementAmount: 300.00,
        status: 'queued_for_sftp',
        selectedPaymentMethod: 'ach'
      });

      // Construct reconciliation report with interleaved unmatched claims
      const interleavedReport = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        // Row 1: Valid CLM-VALID-1 (PAID)
        'REP-1,B-1,CLM-VALID-1,REF-1,ACH,100.00,USD,PAID,DASH-REF-01,2026-10-04,2026-10-04T12:00:00Z,,,',
        // Row 2: Unknown CLM-GHOST-999 (PAID)
        'REP-1,B-1,CLM-GHOST-999,REF-GHOST,ACH,500.00,USD,PAID,DASH-REF-GHOST,2026-10-04,2026-10-04T12:00:00Z,,,',
        // Row 3: Valid CLM-VALID-2 (RETURNED with R01)
        'REP-1,B-1,CLM-VALID-2,REF-2,ACH,200.00,USD,RETURNED,,2026-10-04,2026-10-04T12:00:00Z,R01,Insufficient Funds,Insufficient Funds',
        // Row 4: Unknown CLM-GHOST-888 (REJECTED with CARD_BLOCKED)
        'REP-1,B-1,CLM-GHOST-888,REF-GHOST2,CARD,50.00,USD,REJECTED,,2026-10-04,2026-10-04T12:00:00Z,CARD_BLOCKED,Card Blocked,Card Blocked',
        // Row 5: Valid CLM-VALID-3 (PAID)
        'REP-1,B-1,CLM-VALID-3,REF-3,ACH,300.00,USD,PAID,DASH-REF-03,2026-10-04,2026-10-04T12:00:00Z,,,'
      ].join('\n');

      const result = await ReconciliationService.reconcileCaseStatusReport({
        caseId: testCase._id.toString(),
        csvContent: interleavedReport,
        reportFilename: 'test_interleaved.csv',
        batchId: 'B-1'
      });

      expect(result.totalProcessed).toBe(5);
      expect(result.disbursedCount).toBe(2); // CLM-VALID-1 and CLM-VALID-3
      expect(result.returnedCount).toBe(1);  // CLM-VALID-2
      expect(result.rejectedCount).toBe(0);
      expect(result.unmatchedCount).toBe(2); // CLM-GHOST-999 and CLM-GHOST-888
      expect(result.exceptionsLogged).toBe(3); // 1 returned + 2 unmatched

      // Verify claimant states in MongoDB
      const updatedC1 = await Claimant.findById(c1._id);
      expect(updatedC1?.status).toBe('disbursed');
      expect(updatedC1?.dashReferenceId).toBe('DASH-REF-01');

      const updatedC2 = await Claimant.findById(c2._id);
      expect(updatedC2?.status).toBe('returned');
      expect(updatedC2?.failureCode).toBe('R01');

      const updatedC3 = await Claimant.findById(c3._id);
      expect(updatedC3?.status).toBe('disbursed');
      expect(updatedC3?.dashReferenceId).toBe('DASH-REF-03');

      // Verify unmatched exceptions in database
      const ghostExceptions = await ReconciliationException.find({
        caseId: testCase._id,
        exceptionType: 'unmatched_claim'
      });

      expect(ghostExceptions.length).toBe(2);
      const ghostIds = ghostExceptions.map((e) => e.claimId).sort();
      expect(ghostIds).toEqual(['CLM-GHOST-888', 'CLM-GHOST-999']);
      expect(ghostExceptions[0].claimantId).toBeNull();
      expect(ghostExceptions[0].status).toBe('UNMATCHED');
      expect(ghostExceptions[0].resolved).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 5: Administrative Resolution Edge Cases
  // =========================================================================
  describe('Dimension 5: Administrative Resolution Edge Cases', () => {
    it('[ADMIN-RES-01] Rejects switch_to_check without updatedAddress with 400 Bad Request', async () => {
      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-EX-01',
        firstName: 'Diana',
        lastName: 'Prince',
        email: 'diana@example.com',
        settlementAmount: 150.00,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        failureCode: 'R02'
      });

      const ex = await ReconciliationException.create({
        caseId: testCase._id,
        claimantId: claimant._id,
        claimId: 'CLM-EX-01',
        paymentRail: 'ach',
        amount: 150.00,
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        resolved: false,
        resolutionStatus: 'open'
      });

      // 1. Missing updatedAddress entirely
      const resMissing = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'switch_to_check', reason: 'Missing address test' });

      expect(resMissing.status).toBe(400);

      // 2. Incomplete address: missing street1
      const resIncomplete = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'switch_to_check',
          updatedAddress: {
            city: 'Gotham',
            state: 'NY',
            zip: '10001'
          }
        });

      expect(resIncomplete.status).toBe(400);

      // 3. Invalid state code: non-2-letter 'NEWYORK'
      const resInvalidState = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'switch_to_check',
          updatedAddress: {
            street1: '100 Wayne Manor',
            city: 'Gotham',
            state: 'NEWYORK',
            zip: '10001'
          }
        });

      expect(resInvalidState.status).toBe(400);
    });

    it('[ADMIN-RES-02] Rejects switch_to_check, resend_email, or requeue_sftp on unmatched claims', async () => {
      const ghostEx = await ReconciliationException.create({
        caseId: testCase._id,
        claimantId: null,
        claimId: 'CLM-GHOST-RESOLVE',
        amount: 250.00,
        status: 'UNMATCHED',
        exceptionType: 'unmatched_claim',
        returnCode: 'UNMATCHED_CLAIM_ID',
        resolved: false,
        resolutionStatus: 'open'
      });

      // switch_to_check on ghost claim -> 400
      const resSwitch = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ghostEx._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'switch_to_check',
          updatedAddress: {
            street1: '123 Fake St',
            city: 'Nowhere',
            state: 'CA',
            zip: '90001'
          }
        });

      expect(resSwitch.status).toBe(400);
      expect(resSwitch.body.error).toMatch(/Cannot switch method for unmatched claim/);

      // resend_email on ghost claim -> 400
      const resEmail = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ghostEx._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'resend_email' });

      expect(resEmail.status).toBe(400);
      expect(resEmail.body.error).toMatch(/Cannot resend email for unmatched claim/);

      // requeue_sftp on ghost claim -> 400
      const resRequeue = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ghostEx._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'requeue_sftp' });

      expect(resRequeue.status).toBe(400);
      expect(resRequeue.body.error).toMatch(/Cannot requeue unmatched claim/);

      // mark_resolved on ghost claim -> succeeds (200)
      const resMark = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ghostEx._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'mark_resolved', reason: 'Audit dismissed unmatched orphan record' });

      expect(resMark.status).toBe(200);
      expect(resMark.body.exception.resolved).toBe(true);
      expect(resMark.body.exception.resolutionStatus).toBe('resolved');
    });

    it('[ADMIN-RES-03] Valid switch_to_check resolution updates both exception and claimant states accurately', async () => {
      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-VALID-SWITCH',
        firstName: 'Elena',
        lastName: 'Rostova',
        email: 'elena@example.com',
        settlementAmount: 850.00,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        failureCode: 'R03',
        rejectionReason: 'No Account/Unable to Locate Account'
      });

      const ex = await ReconciliationException.create({
        caseId: testCase._id,
        claimantId: claimant._id,
        claimId: 'CLM-VALID-SWITCH',
        paymentRail: 'ach',
        amount: 850.00,
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R03',
        returnReason: 'No Account/Unable to Locate Account',
        resolved: false,
        resolutionStatus: 'open'
      });

      const payload = {
        action: 'switch_to_check',
        updatedAddress: {
          street1: '742 Evergreen Terrace',
          street2: 'Suite 400',
          city: 'Springfield',
          state: 'OR',
          zip: '97477'
        },
        reason: 'Claimant requested check disbursement following ACH return'
      };

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);

      // 1. Check Exception Doc
      const updatedEx = await ReconciliationException.findById(ex._id);
      expect(updatedEx?.resolved).toBe(true);
      expect(updatedEx?.resolutionStatus).toBe('resolved_switched_to_check');
      expect(updatedEx?.resolutionAction).toBe('switch_to_check');
      expect(updatedEx?.resolutionNotes).toBe(payload.reason);
      expect(updatedEx?.resolvedAt).toBeDefined();
      expect(updatedEx?.resolutionPayload?.updatedAddress?.street1).toBe('742 Evergreen Terrace');

      // 2. Check Claimant Doc
      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant?.status).toBe('selected');
      expect(updatedClaimant?.selectedPaymentMethod).toBe('physical_check');
      expect(updatedClaimant?.address?.street).toBe('742 Evergreen Terrace, Suite 400');
      expect(updatedClaimant?.address?.city).toBe('Springfield');
      expect(updatedClaimant?.address?.state).toBe('OR');
      expect(updatedClaimant?.address?.zip).toBe('97477');
      expect(updatedClaimant?.requeuedAt).toBeDefined();
      expect(updatedClaimant?.failureCode).toBeUndefined();
      expect(updatedClaimant?.rejectionReason).toBeUndefined();
    });
  });
});
