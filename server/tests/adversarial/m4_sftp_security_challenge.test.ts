import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import SftpClient from 'ssh2-sftp-client';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';
import { parseReconciliationReport } from '../../src/services/reconciliation.service';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';

const {
  validateDashBatchCsv,
  validateReconciliationReport
} = require('../../../tests/e2e/harness/oracles');

describe('Adversarial: Milestone 4 SFTP & Batch Security Challenge Battery', () => {
  let mockServer: MockSftpInstance;

  beforeAll(async () => {
    mockServer = await startMockSftp({
      port: 0,
      username: 'adv_user',
      password: 'adv_password'
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await stopMockSftp(mockServer);
    }
  });

  describe('1. VFS Path Traversal & Injection Invariants', () => {
    it('[SEC-01] Rejects multi-level path traversal attempts across protocol commands', async () => {
      const client = new SftpClient();
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'adv_user',
        password: 'adv_password',
        hostVerifier: () => true
      });

      try {
        const attackVectors = [
          '../../../../etc/passwd',
          '/inbound/../../../etc/shadow',
          '..\\..\\..\\windows\\system32',
          '/outbound/reports/../../../../root/.ssh/id_rsa'
        ];

        for (const vector of attackVectors) {
          let blocked = false;
          try {
            await client.put(Buffer.from('malicious'), vector);
          } catch (err: any) {
            blocked = true;
          }
          expect(blocked).toBe(true);
        }
      } finally {
        await client.end().catch(() => {});
      }
    });
  });

  describe('2. Financial Control Totals & Trailer Tampering Guards', () => {
    it('[FIN-01] Rejects batch if trailer control count differs by even 1 record', () => {
      const forgedBatch = [
        'HEADER,DASH_SFTP_V2.0,FIRM-01,CASE-01,1:24-cv-01,B1,2026-10-04T12:00:00Z,TEST,USD,1,100.00',
        'DETAIL,ACH,CLM-01,CLM-01,"Alice","Adams",100.00,USD,REF-01,021000021,1234,CHECKING,PPD,SETTLEMENT,,,,,,',
        'TRAILER,2,100.00,1,100.00,0,0.00,0,0.00,0,0.00,021000021' // Forged count: 2 instead of 1
      ].join('\n');

      const validation = validateDashBatchCsv(forgedBatch);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/Trailer record count 2 does not match details count 1/);
    });

    it('[FIN-02] Rejects batch if trailer dollar amount differs by 1 cent', () => {
      const forgedAmount = [
        'HEADER,DASH_SFTP_V2.0,FIRM-01,CASE-01,1:24-cv-01,B1,2026-10-04T12:00:00Z,TEST,USD,1,100.00',
        'DETAIL,ACH,CLM-01,CLM-01,"Alice","Adams",100.00,USD,REF-01,021000021,1234,CHECKING,PPD,SETTLEMENT,,,,,,',
        'TRAILER,1,100.01,1,100.00,0,0.00,0,0.00,0,0.00,021000021' // Off by 1 cent: 100.01 vs 100.00
      ].join('\n');

      const validation = validateDashBatchCsv(forgedAmount);
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/Trailer total amount 100.01 does not match sum of details 100.00/);
    });
  });

  describe('3. Inbound Report Robustness & Malformed Payload Handling', () => {
    it('[REP-01] Handles 1,000-row status report under tight execution constraints (<100ms)', () => {
      const rows = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON'
      ];

      for (let i = 1; i <= 1000; i++) {
        rows.push(
          `REP-BATCH,B-01,CLM-${i},REF-${i},ACH,150.00,USD,PAID,DASH-${i},2026-10-05,2026-10-05T12:00:00Z,,,`
        );
      }

      const csvContent = rows.join('\n');
      const start = Date.now();
      const parseResult = parseReconciliationReport(csvContent);
      const elapsed = Date.now() - start;

      expect(parseResult.valid).toBe(true);
      expect(parseResult.totalRecords).toBe(1000);
      expect(parseResult.paidCount).toBe(1000);
      expect(elapsed).toBeLessThan(100);
    });

    it('[REP-02] Recovers gracefully without throwing unhandled exceptions on garbage bytes', () => {
      const garbage = 'GARBAGE_BINARY_\x00\xFF\xFE\x00\x00_NOT_A_CSV';
      const result = parseReconciliationReport(garbage);
      expect(result.valid).toBe(false);
      expect(result.records.length).toBe(0);
    });
  });
});
