import { describe, it, expect, afterEach } from 'vitest';
import SftpClient from 'ssh2-sftp-client';
import { startMockSftp, stopMockSftp, MockSftpInstance } from '../../../fixtures/mock-sftp';

describe('Unit: In-Process Mock SFTP Server Daemon (fixtures/mock-sftp)', () => {
  let mockServer: MockSftpInstance | null = null;

  afterEach(async () => {
    if (mockServer) {
      await stopMockSftp(mockServer);
      mockServer = null;
    }
  });

  it('starts successfully on ephemeral port (port: 0) and reports bound port', async () => {
    mockServer = await startMockSftp({ port: 0 });
    expect(mockServer.port).toBeGreaterThan(0);
    expect(mockServer.host).toBe('127.0.0.1');
    expect(mockServer.username).toBe('dash_user');
  });

  it('authenticates valid credentials and allows SFTP directory operations', async () => {
    mockServer = await startMockSftp({
      port: 0,
      username: 'test_user',
      password: 'test_password'
    });

    const client = new SftpClient();
    try {
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'test_user',
        password: 'test_password',
        hostVerifier: () => true
      });

      const list = await client.list('/inbound/disbursements');
      expect(Array.isArray(list)).toBe(true);
    } finally {
      await client.end().catch(() => {});
    }
  });

  it('rejects invalid authentication credentials', async () => {
    mockServer = await startMockSftp({
      port: 0,
      username: 'valid_user',
      password: 'valid_password'
    });

    const client = new SftpClient();
    let failed = false;
    try {
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'valid_user',
        password: 'WRONG_PASSWORD',
        hostVerifier: () => true,
        readyTimeout: 1000,
        retries: 0
      });
    } catch {
      failed = true;
    } finally {
      await client.end().catch(() => {});
    }

    expect(failed).toBe(true);
  });

  it('sandboxes filesystem and rejects path traversal attempts with PERMISSION_DENIED', async () => {
    mockServer = await startMockSftp({
      port: 0,
      username: 'user_trav',
      password: 'pwd_trav'
    });

    const client = new SftpClient();
    try {
      await client.connect({
        host: mockServer.host,
        port: mockServer.port,
        username: 'user_trav',
        password: 'pwd_trav',
        hostVerifier: () => true
      });

      let threw = false;
      try {
        await client.put(Buffer.from('evil'), '/inbound/../../../etc/passwd');
      } catch (err: any) {
        threw = true;
        expect(err.message).toMatch(/Permission denied|prohibited/i);
      }
      expect(threw).toBe(true);
    } finally {
      await client.end().catch(() => {});
    }
  });

  it('tracks all active sockets and terminates cleanly on stopMockSftp without handle leaks', async () => {
    mockServer = await startMockSftp({ port: 0 });

    const client = new SftpClient();
    await client.connect({
      host: mockServer.host,
      port: mockServer.port,
      username: 'dash_user',
      password: 'dash_pass',
      hostVerifier: () => true
    });

    expect(mockServer.activeSockets.size).toBeGreaterThan(0);

    // Stop mock server while client is connected
    await stopMockSftp(mockServer);
    expect(mockServer.activeSockets.size).toBe(0);
    mockServer = null;
  });
});
