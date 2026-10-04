import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import SftpClient from 'ssh2-sftp-client';
import { config } from '../config/env';

export interface SftpConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  passphrase?: string;
  remoteInboundDir: string;
  remoteReportsDir: string;
  readyTimeout?: number;
  retries?: number;
}

export interface BatchUploadResult {
  remotePath: string;
  tempRemotePath: string;
  bytesUploaded: number;
  durationMs: number;
  sha256: string;
}

export interface RemoteReportInfo {
  name: string;
  size: number;
  modifyTime: Date;
  remotePath: string;
}

export interface DownloadReportResult {
  remoteFilename: string;
  localPath: string;
  bytesDownloaded: number;
  content: string;
}

export function resolveSftpConfig(override?: Partial<SftpConnectionConfig>): SftpConnectionConfig {
  let privateKey: string | Buffer | undefined = override?.privateKey || config.SFTP_PRIVATE_KEY;
  if (!privateKey && config.SFTP_PRIVATE_KEY_PATH && fs.existsSync(config.SFTP_PRIVATE_KEY_PATH)) {
    try {
      privateKey = fs.readFileSync(config.SFTP_PRIVATE_KEY_PATH, 'utf8');
    } catch {
      // ignore
    }
  }

  return {
    host: override?.host || config.SFTP_HOST || '127.0.0.1',
    port: override?.port !== undefined ? override.port : config.SFTP_PORT || 2222,
    username: override?.username || config.SFTP_USER || 'dash_user',
    password: override?.password || config.SFTP_PASSWORD || config.SFTP_PASS || 'dash_pass',
    privateKey,
    passphrase: override?.passphrase,
    remoteInboundDir:
      override?.remoteInboundDir ||
      config.SFTP_REMOTE_INBOUND_DIR ||
      config.SFTP_REMOTE_DIR_INBOUND ||
      '/inbound/disbursements',
    remoteReportsDir:
      override?.remoteReportsDir ||
      config.SFTP_REMOTE_OUTBOUND_DIR ||
      config.SFTP_REMOTE_DIR_REPORTS ||
      '/outbound/reports',
    readyTimeout: override?.readyTimeout || 10000,
    retries: override?.retries || 1
  };
}

function buildClientConnectOptions(cfg: SftpConnectionConfig): any {
  const opts: any = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    readyTimeout: cfg.readyTimeout,
    retries: cfg.retries,
    // Accept self-signed keys in test/dev
    hostVerifier: () => true
  };

  if (cfg.password) {
    opts.password = cfg.password;
  }
  if (cfg.privateKey) {
    opts.privateKey = cfg.privateKey;
    if (cfg.passphrase) {
      opts.passphrase = cfg.passphrase;
    }
  }

  return opts;
}

/**
 * Scoped SFTP client helper ensuring client.end() is always called in a finally block.
 */
export async function withSftpClient<T>(
  action: (client: SftpClient, cfg: SftpConnectionConfig) => Promise<T>,
  overrideConfig?: Partial<SftpConnectionConfig>
): Promise<T> {
  const client = new SftpClient();
  const cfg = resolveSftpConfig(overrideConfig);
  try {
    await client.connect(buildClientConnectOptions(cfg));
    return await action(client, cfg);
  } finally {
    try {
      await client.end();
    } catch {
      // ignore teardown errors
    }
  }
}

export class SftpService {
  private client: SftpClient;
  private isConnectedState: boolean = false;
  private currentConfig: SftpConnectionConfig;

  constructor(overrideConfig?: Partial<SftpConnectionConfig>) {
    this.client = new SftpClient();
    this.currentConfig = resolveSftpConfig(overrideConfig);
  }

  public async connect(overrideConfig?: Partial<SftpConnectionConfig>): Promise<boolean> {
    if (overrideConfig) {
      this.currentConfig = resolveSftpConfig(overrideConfig);
    }
    if (this.isConnectedState) {
      return true;
    }

    await this.client.connect(buildClientConnectOptions(this.currentConfig));
    this.isConnectedState = true;
    return true;
  }

  public async disconnect(): Promise<void> {
    if (this.isConnectedState) {
      try {
        await this.client.end();
      } catch {
        // ignore
      } finally {
        this.isConnectedState = false;
      }
    }
  }

  public isConnected(): boolean {
    return this.isConnectedState;
  }

  /**
   * Uploads a batch CSV file and companion .sha256 digest atomically using temporary staging and rename.
   */
  public async uploadBatch(
    localCsvPath: string,
    localSha256Path?: string,
    options?: { remoteInboundDir?: string }
  ): Promise<BatchUploadResult> {
    const filename = path.basename(localCsvPath);
    const inboundDir = options?.remoteInboundDir || this.currentConfig.remoteInboundDir;
    const remoteDestPath = path.posix.join(inboundDir, filename);
    const tempRemotePath = path.posix.join(
      inboundDir,
      `${filename}.tmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
    );

    const startTime = Date.now();
    const csvContent = await fs.promises.readFile(localCsvPath, 'utf8');
    const sha256 = crypto.createHash('sha256').update(csvContent).digest('hex');

    // Scoped upload ensuring connection lifecycle
    const doUpload = async (sftp: SftpClient) => {
      // 1. Ensure remote inbound directory exists
      const dirExists = await sftp.exists(inboundDir);
      if (!dirExists) {
        await sftp.mkdir(inboundDir, true);
      }

      // 2. Put staged CSV file
      await sftp.put(localCsvPath, tempRemotePath);

      // 3. Atomically rename staging file to final destination
      await sftp.rename(tempRemotePath, remoteDestPath);

      // 4. Put companion .sha256 digest file if exists or provided
      let companionPath = localSha256Path;
      if (!companionPath && fs.existsSync(`${localCsvPath}.sha256`)) {
        companionPath = `${localCsvPath}.sha256`;
      }

      if (companionPath && fs.existsSync(companionPath)) {
        const shaFilename = path.basename(companionPath);
        const remoteShaDest = path.posix.join(inboundDir, shaFilename);
        const tempShaPath = path.posix.join(
          inboundDir,
          `${shaFilename}.tmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
        );
        await sftp.put(companionPath, tempShaPath);
        await sftp.rename(tempShaPath, remoteShaDest);
      } else {
        // Upload dynamic sha256 buffer
        const shaData = `${sha256}  ${filename}\n`;
        const remoteShaDest = path.posix.join(inboundDir, `${filename}.sha256`);
        const tempShaPath = path.posix.join(
          inboundDir,
          `${filename}.sha256.tmp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
        );
        await sftp.put(Buffer.from(shaData, 'utf8'), tempShaPath);
        await sftp.rename(tempShaPath, remoteShaDest);
      }

      const stats = await sftp.stat(remoteDestPath);
      return {
        remotePath: remoteDestPath,
        tempRemotePath,
        bytesUploaded: stats.size,
        durationMs: Date.now() - startTime,
        sha256
      };
    };

    if (this.isConnectedState) {
      return await doUpload(this.client);
    } else {
      return await withSftpClient(async (client) => {
        return await doUpload(client);
      }, this.currentConfig);
    }
  }

  /**
   * Lists status reports available in the remote reports directory.
   */
  public async listReports(remoteDir?: string, pattern = /^REPORT_STATUS_.*\.csv$/i): Promise<RemoteReportInfo[]> {
    const targetDir = remoteDir || this.currentConfig.remoteReportsDir;

    const doList = async (sftp: SftpClient) => {
      const exists = await sftp.exists(targetDir);
      if (!exists) {
        return [];
      }

      const list = await sftp.list(targetDir);
      return list
        .filter((item) => pattern.test(item.name))
        .map((item) => ({
          name: item.name,
          size: item.size,
          modifyTime: new Date(item.modifyTime),
          remotePath: path.posix.join(targetDir, item.name)
        }))
        .sort((a, b) => b.modifyTime.getTime() - a.modifyTime.getTime());
    };

    if (this.isConnectedState) {
      return await doList(this.client);
    } else {
      return await withSftpClient(async (client) => {
        return await doList(client);
      }, this.currentConfig);
    }
  }

  /**
   * Downloads a remote report to a local storage inbox directory.
   */
  public async downloadReport(remoteFilename: string, localDestPath?: string): Promise<DownloadReportResult> {
    const remotePath = path.posix.join(this.currentConfig.remoteReportsDir, remoteFilename);
    const destPath =
      localDestPath ||
      path.resolve(process.cwd(), config.SFTP_LOCAL_STORAGE_DIR || 'storage/sftp', 'inbox', remoteFilename);

    const doDownload = async (sftp: SftpClient) => {
      const buffer = (await sftp.get(remotePath)) as Buffer;
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.writeFile(destPath, buffer);
      return {
        remoteFilename,
        localPath: destPath,
        bytesDownloaded: buffer.length,
        content: buffer.toString('utf8')
      };
    };

    if (this.isConnectedState) {
      return await doDownload(this.client);
    } else {
      return await withSftpClient(async (client) => {
        return await doDownload(client);
      }, this.currentConfig);
    }
  }

  /**
   * Health check verification for SFTP server connectivity.
   */
  public async testConnection(): Promise<{ connected: boolean; inboundExists: boolean; reportsExists: boolean }> {
    return await withSftpClient(async (sftp, cfg) => {
      const inboundExists = Boolean(await sftp.exists(cfg.remoteInboundDir));
      const reportsExists = Boolean(await sftp.exists(cfg.remoteReportsDir));
      return {
        connected: true,
        inboundExists,
        reportsExists
      };
    }, this.currentConfig);
  }
}
