import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SftpService } from '../../src/services/sftp.service';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';

describe('Integration: SFTP Client & Mock Server Socket Lifecycle', () => {
  let mockServer: MockSftpInstance;
  let sftpService: SftpService;
  const tempDir = path.resolve(process.cwd(), 'storage/test-sftp-lifecycle', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  beforeAll(async () => {
    await fs.promises.mkdir(tempDir, { recursive: true });
    // Bind to ephemeral port
    mockServer = await startMockSftp({
      port: 0,
      username: 'lifecycle_user',
      password: 'lifecycle_pass'
    });

    sftpService = new SftpService({
      host: mockServer.host,
      port: mockServer.port,
      username: 'lifecycle_user',
      password: 'lifecycle_pass'
    });
  });

  afterAll(async () => {
    if (sftpService) {
      await sftpService.disconnect();
    }
    if (mockServer) {
      await stopMockSftp(mockServer);
    }
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('performs end-to-end atomic upload and verifies temporary file disappears', async () => {
    const filename = `DASH_DISBURSE_LIFECYCLE_${Date.now()}.csv`;
    const localCsv = path.join(tempDir, filename);
    const content = 'HEADER,DASH_SFTP_V2.0\nDETAIL,ACH,CLM-01\nTRAILER,1,100.00';
    await fs.promises.writeFile(localCsv, content, 'utf8');

    const result = await sftpService.uploadBatch(localCsv);
    expect(result.bytesUploaded).toBe(content.length);

    // Verify file exists on remote
    const batches = mockServer.vfs.getReceivedBatches();
    expect(batches.some((b) => b.filename === filename)).toBe(true);

    // Verify .tmp does not exist
    const filesInInbound = fs.readdirSync(mockServer.inboundDir);
    const tmpFiles = filesInInbound.filter((f) => f.includes('.tmp'));
    expect(tmpFiles.length).toBe(0);
  });

  it('downloads report from remote server and verifies byte-for-byte fidelity', async () => {
    const reportFilename = `REPORT_STATUS_INTEGRATION_${Date.now()}.csv`;
    const reportData = 'REPORT_ID,BATCH_ID,CLAIM_ID,STATUS\nREP-101,B-101,CLM-101,PAID';
    mockServer.seedReconciliationReport(reportFilename, reportData);

    const destPath = path.join(tempDir, 'LOCAL_' + reportFilename);
    const downloadRes = await sftpService.downloadReport(reportFilename, destPath);

    expect(downloadRes.content).toBe(reportData);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(reportData);
  });
});
