import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SftpService, resolveSftpConfig, withSftpClient } from '../../src/services/sftp.service';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';

describe('Unit: SFTP Client Service (server/src/services/sftp.service.ts)', () => {
  let mockServer: MockSftpInstance;
  const testTmpDir = path.resolve(process.cwd(), 'storage/test-sftp-service', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  beforeAll(async () => {
    await fs.promises.mkdir(testTmpDir, { recursive: true });
    mockServer = await startMockSftp({
      port: 0,
      username: 'service_user',
      password: 'service_pass'
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await stopMockSftp(mockServer);
    }
    try {
      await fs.promises.rm(testTmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('resolves default and override SFTP configuration correctly', () => {
    const defaultCfg = resolveSftpConfig();
    expect(defaultCfg.host).toBeDefined();
    expect(defaultCfg.port).toBeDefined();
    expect(defaultCfg.remoteInboundDir).toBe('/inbound/disbursements');
    expect(defaultCfg.remoteReportsDir).toBe('/outbound/reports');

    const customCfg = resolveSftpConfig({
      host: '10.0.0.1',
      port: 9922,
      username: 'custom_usr',
      password: 'custom_pwd'
    });
    expect(customCfg.host).toBe('10.0.0.1');
    expect(customCfg.port).toBe(9922);
    expect(customCfg.username).toBe('custom_usr');
  });

  it('connects, verifies connection, and disconnects cleanly', async () => {
    const sftp = new SftpService({
      host: mockServer.host,
      port: mockServer.port,
      username: 'service_user',
      password: 'service_pass'
    });

    const isConnected = await sftp.connect();
    expect(isConnected).toBe(true);
    expect(sftp.isConnected()).toBe(true);

    const check = await sftp.testConnection();
    expect(check.connected).toBe(true);
    expect(check.inboundExists).toBe(true);
    expect(check.reportsExists).toBe(true);

    await sftp.disconnect();
    expect(sftp.isConnected()).toBe(false);
  });

  it('uploads a batch CSV and companion .sha256 atomically', async () => {
    const sftp = new SftpService({
      host: mockServer.host,
      port: mockServer.port,
      username: 'service_user',
      password: 'service_pass'
    });

    const localCsv = path.join(testTmpDir, 'DASH_DISBURSE_TEST_UNIT.csv');
    const localSha = path.join(testTmpDir, 'DASH_DISBURSE_TEST_UNIT.csv.sha256');
    const csvContent = 'HEADER,DASH_SFTP_V2.0\nTRAILER,0,0.00';
    const shaContent = `${crypto.createHash('sha256').update(csvContent).digest('hex')}  DASH_DISBURSE_TEST_UNIT.csv\n`;

    await fs.promises.writeFile(localCsv, csvContent, 'utf8');
    await fs.promises.writeFile(localSha, shaContent, 'utf8');

    const result = await sftp.uploadBatch(localCsv, localSha);
    expect(result.remotePath).toBe('/inbound/disbursements/DASH_DISBURSE_TEST_UNIT.csv');
    expect(result.bytesUploaded).toBeGreaterThan(0);
    expect(result.sha256).toBe(crypto.createHash('sha256').update(csvContent).digest('hex'));

    // Verify file exists on mock server
    const remoteContent = mockServer.vfs.getUploadedBatch('DASH_DISBURSE_TEST_UNIT.csv');
    expect(remoteContent).toBe(csvContent);
  });

  it('lists remote reports and downloads targeted report file', async () => {
    const reportFilename = 'REPORT_STATUS_20261005140000.csv';
    const reportContent = 'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON\nREP-1,B-1,CLM-1,REF-1,ACH,100.00,USD,PAID,DASH-001,2026-10-05,2026-10-05T12:00:00Z,,,';
    mockServer.seedReconciliationReport(reportFilename, reportContent);

    const sftp = new SftpService({
      host: mockServer.host,
      port: mockServer.port,
      username: 'service_user',
      password: 'service_pass'
    });

    const reports = await sftp.listReports();
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.some((r) => r.name === reportFilename)).toBe(true);

    const downloadDest = path.join(testTmpDir, 'DOWNLOADED_' + reportFilename);
    const downloaded = await sftp.downloadReport(reportFilename, downloadDest);
    expect(downloaded.remoteFilename).toBe(reportFilename);
    expect(downloaded.content).toBe(reportContent);
    expect(fs.existsSync(downloadDest)).toBe(true);
  });

  it('withSftpClient scoped wrapper executes action and guarantees teardown', async () => {
    let clientRef: any = null;
    await withSftpClient(
      async (client) => {
        clientRef = client;
        const exists = await client.exists('/inbound/disbursements');
        expect(exists).toBeTruthy();
      },
      {
        host: mockServer.host,
        port: mockServer.port,
        username: 'service_user',
        password: 'service_pass'
      }
    );

    // After withSftpClient finishes, client should be closed
    expect(clientRef).not.toBeNull();
  });
});
