import net from 'node:net';
import { Server as SshServer } from 'ssh2';

export interface MockSftpOptions {
  port?: number;
  host?: string;
  username?: string;
  password?: string;
  baseDir?: string;
  hostPrivateKey?: string | Buffer;
}

export interface MockSftpVfs {
  baseDir: string;
  inboundDir: string;
  outboundDir: string;
  resolvePath: (requestedPath: string) => string;
  seedReconciliationReport: (filename: string, csvContent: string) => string;
  getReceivedBatches: () => Array<{ filename: string; fullPath: string; size: number; createdAt: Date }>;
  getBatchContent: (filename: string) => string | null;
  getUploadedBatch: (filename: string) => string | null;
  clearStorage: () => void;
  closeAllOpenHandles: () => void;
}

export interface MockSftpInstance {
  server: SshServer;
  port: number;
  host: string;
  username: string;
  password: string;
  baseDir: string;
  inboundDir: string;
  outboundDir: string;
  activeSockets: Set<net.Socket>;
  vfs: MockSftpVfs;
  seedReconciliationReport: (filename: string, csvContent: string) => string;
  getReceivedBatches: () => Array<{ filename: string; fullPath: string; size: number; createdAt: Date }>;
  getBatchContent: (filename: string) => string | null;
  getUploadedBatch: (filename: string) => string | null;
  clearStorage: () => void;
  stop: () => Promise<void>;
}
