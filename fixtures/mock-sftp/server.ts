import net from 'node:net';
import { Server as SshServer } from 'ssh2';
import { MockSftpOptions, MockSftpInstance } from './types';
import { VfsManager } from './vfs';
import { setupSftpHandler } from './sftpHandler';
import { getOrCreateHostKey } from './keys';

export class MockSftpServer {
  private instance: MockSftpInstance | null = null;
  private options: MockSftpOptions;

  constructor(options: MockSftpOptions = {}) {
    this.options = options;
  }

  public async start(): Promise<MockSftpInstance> {
    if (this.instance) {
      return this.instance;
    }
    this.instance = await startMockSftp(this.options);
    return this.instance;
  }

  public async stop(): Promise<void> {
    if (this.instance) {
      await stopMockSftp(this.instance);
      this.instance = null;
    }
  }

  public clearStorage(): void {
    if (this.instance) {
      this.instance.vfs.clearStorage();
    }
  }

  public seedReconciliationReport(filename: string, content: string): string {
    if (!this.instance) {
      throw new Error('MockSftpServer is not running');
    }
    return this.instance.vfs.seedReconciliationReport(filename, content);
  }

  public getReceivedBatches() {
    if (!this.instance) return [];
    return this.instance.vfs.getReceivedBatches();
  }

  public getBatchContent(filename: string): string | null {
    if (!this.instance) return null;
    return this.instance.vfs.getBatchContent(filename);
  }

  public getInstance(): MockSftpInstance | null {
    return this.instance;
  }
}

export async function startMockSftp(options: MockSftpOptions = {}): Promise<MockSftpInstance> {
  const host = options.host || '127.0.0.1';
  // Use port 0 by default for test safety (or specified port)
  const port = options.port !== undefined ? options.port : 0;
  const username = options.username || 'dash_user';
  const password = options.password || 'dash_pass';
  const hostPrivateKey = options.hostPrivateKey || getOrCreateHostKey();

  const vfs = new VfsManager(options.baseDir);
  const activeSockets = new Set<net.Socket>();

  const server = new SshServer(
    {
      hostKeys: [hostPrivateKey]
    },
    (client: any) => {
      client.on('authentication', (ctx: any) => {
        if (ctx.method === 'password') {
          if (ctx.username === username && ctx.password === password) {
            ctx.accept();
          } else {
            ctx.reject(['password', 'publickey']);
          }
        } else if (ctx.method === 'publickey') {
          // Accept public key auth for test purposes
          if (ctx.username === username) {
            ctx.accept();
          } else {
            ctx.reject(['password', 'publickey']);
          }
        } else if (ctx.method === 'none') {
          ctx.reject(['password', 'publickey']);
        } else {
          ctx.reject(['password', 'publickey']);
        }
      });

      client.on('ready', () => {
        client.on('session', (accept: any) => {
          const session = accept();
          session.on('sftp', (acceptSftp: any) => {
            const sftpStream = acceptSftp();
            setupSftpHandler(sftpStream, vfs);
          });
        });
      });

      client.on('error', () => {
        // Suppress expected client disconnect errors
      });
    }
  );

  // Track all connected TCP sockets for zero-leak teardown
  server.on('connection', (socket: net.Socket) => {
    activeSockets.add(socket);
    socket.once('close', () => {
      activeSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => {
      resolve();
    });
    server.once('error', (err) => {
      reject(err);
    });
  });

  const boundAddress = server.address() as net.AddressInfo;
  const boundPort = boundAddress ? boundAddress.port : port;

  const instance: MockSftpInstance = {
    server,
    port: boundPort,
    host,
    username,
    password,
    baseDir: vfs.baseDir,
    inboundDir: vfs.inboundDir,
    outboundDir: vfs.outboundDir,
    activeSockets,
    vfs,
    seedReconciliationReport: (filename: string, content: string) => vfs.seedReconciliationReport(filename, content),
    getReceivedBatches: () => vfs.getReceivedBatches(),
    getBatchContent: (filename: string) => vfs.getBatchContent(filename),
    getUploadedBatch: (filename: string) => vfs.getUploadedBatch(filename),
    clearStorage: () => vfs.clearStorage(),
    stop: async () => {
      await stopMockSftp(instance);
    }
  };

  return instance;
}

export async function stopMockSftp(instance: MockSftpInstance): Promise<void> {
  // 1. Immediately destroy all active client sockets
  for (const socket of instance.activeSockets) {
    try {
      socket.end();
      socket.destroy();
    } catch {
      // ignore
    }
  }
  instance.activeSockets.clear();

  // 2. Close any lingering file descriptors
  instance.vfs.closeAllOpenHandles();

  // 3. Close the server listener with safety timeout
  await new Promise<void>((resolve) => {
    try {
      const timer = setTimeout(() => resolve(), 500);
      instance.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      resolve();
    }
  });
}
