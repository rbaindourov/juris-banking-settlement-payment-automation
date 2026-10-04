import fs from 'node:fs';
import path from 'node:path';
import { MockSftpVfs } from './types';

export class VfsManager implements MockSftpVfs {
  public readonly baseDir: string;
  public readonly inboundDir: string;
  public readonly outboundDir: string;
  public readonly openHandles: Set<number> = new Set();

  constructor(baseDir?: string) {
    this.baseDir = baseDir
      ? path.resolve(baseDir)
      : path.resolve(process.cwd(), 'storage/mock-sftp-server', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    this.inboundDir = path.join(this.baseDir, 'inbound', 'disbursements');
    this.outboundDir = path.join(this.baseDir, 'outbound', 'reports');

    this.ensureDirs();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.inboundDir, { recursive: true });
    fs.mkdirSync(this.outboundDir, { recursive: true });
  }

  public resolvePath(requestedPath: string): string {
    if (!requestedPath || typeof requestedPath !== 'string') {
      return this.baseDir;
    }

    // Explicit path traversal check: reject any .. segments
    const parts = requestedPath.split(/[/\\]+/);
    if (parts.includes('..')) {
      const err: any = new Error('SSH_FX_PERMISSION_DENIED: Path traversal prohibited');
      err.code = 'PERMISSION_DENIED';
      err.sftpCode = 3; // SSH_FX_PERMISSION_DENIED
      throw err;
    }

    const rawNormalized = path.posix.normalize(requestedPath);
    const relative = rawNormalized.replace(/^(\/|\\)+/, '');
    const resolved = path.resolve(this.baseDir, relative);

    // Path traversal check
    if (!resolved.startsWith(this.baseDir + path.sep) && resolved !== this.baseDir) {
      const err: any = new Error('SSH_FX_PERMISSION_DENIED: Path traversal prohibited');
      err.code = 'PERMISSION_DENIED';
      err.sftpCode = 3; // SSH_FX_PERMISSION_DENIED
      throw err;
    }

    return resolved;
  }

  public seedReconciliationReport(filename: string, csvContent: string): string {
    this.ensureDirs();
    const target = path.join(this.outboundDir, filename);
    fs.writeFileSync(target, csvContent, 'utf8');
    return target;
  }

  public getReceivedBatches(): Array<{ filename: string; fullPath: string; size: number; createdAt: Date }> {
    if (!fs.existsSync(this.inboundDir)) return [];
    return fs.readdirSync(this.inboundDir)
      .filter((f) => f.endsWith('.csv') && !f.endsWith('.tmp'))
      .map((filename) => {
        const fullPath = path.join(this.inboundDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          fullPath,
          size: stat.size,
          createdAt: stat.birthtime || stat.mtime
        };
      });
  }

  public getBatchContent(filename: string): string | null {
    const target = path.join(this.inboundDir, filename);
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target, 'utf8');
  }

  public getUploadedBatch(filename: string): string | null {
    return this.getBatchContent(filename);
  }

  public clearStorage(): void {
    const cleanDir = (dir: string) => {
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              cleanDir(fullPath);
              fs.rmdirSync(fullPath);
            } else {
              fs.unlinkSync(fullPath);
            }
          } catch {
            // ignore
          }
        }
      }
    };

    cleanDir(this.inboundDir);
    cleanDir(this.outboundDir);
  }

  public closeAllOpenHandles(): void {
    for (const fd of this.openHandles) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    this.openHandles.clear();
  }
}
