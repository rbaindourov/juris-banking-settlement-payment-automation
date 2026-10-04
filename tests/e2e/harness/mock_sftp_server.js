/**
 * Juris Banking - Mock Dash SFTP Server & Protocol Harness
 * Self-contained sandboxed VFS providing atomic upload, checksum validation, and report seeding.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class MockSftpServer {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.resolve(__dirname, '../../fixtures/mock-sftp-vfs');
    this.inboundDir = path.join(this.baseDir, 'inbound', 'disbursements');
    this.outboundDir = path.join(this.baseDir, 'outbound', 'reports');
    this.port = options.port || 2222;
    this.username = options.username || 'juris_test_user';
    this.password = options.password || 'juris_test_password';
    this.isRunning = false;
  }

  async start() {
    fs.mkdirSync(this.inboundDir, { recursive: true });
    fs.mkdirSync(this.outboundDir, { recursive: true });
    this.isRunning = true;
    return {
      host: 'localhost',
      port: this.port,
      inboundDir: this.inboundDir,
      outboundDir: this.outboundDir,
    };
  }

  async stop() {
    this.isRunning = false;
  }

  clearStorage() {
    if (fs.existsSync(this.inboundDir)) {
      for (const f of fs.readdirSync(this.inboundDir)) {
        try { fs.unlinkSync(path.join(this.inboundDir, f)); } catch (_) {}
      }
    }
    if (fs.existsSync(this.outboundDir)) {
      for (const f of fs.readdirSync(this.outboundDir)) {
        try { fs.unlinkSync(path.join(this.outboundDir, f)); } catch (_) {}
      }
    }
  }

  seedReconciliationReport(filename, csvContent) {
    fs.mkdirSync(this.outboundDir, { recursive: true });
    const target = path.join(this.outboundDir, filename);
    fs.writeFileSync(target, csvContent, 'utf8');
    return target;
  }

  getReceivedBatches() {
    if (!fs.existsSync(this.inboundDir)) return [];
    return fs.readdirSync(this.inboundDir)
      .filter(f => f.endsWith('.csv') && !f.endsWith('.tmp'))
      .map(filename => {
      const fullPath = path.join(this.inboundDir, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        fullPath,
        size: stat.size,
        createdAt: stat.birthtime,
      };
    });
  }

  getBatchContent(filename) {
    const target = path.join(this.inboundDir, filename);
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target, 'utf8');
  }

  getCompanionSha256(filename) {
    const shaFile = `${filename}.sha256`;
    return this.getBatchContent(shaFile);
  }

  /**
   * Virtual SFTP Client Adapter matching ssh2-sftp-client API
   */
  createClientAdapter() {
    const self = this;
    return {
      async connect(config) {
        if (!config) throw new Error('ERR_SFTP_AUTH_FAILED: Missing config');
        if (config.username && config.username !== self.username) {
          throw new Error('ERR_SFTP_AUTH_FAILED: Invalid username');
        }
        if (config.password && config.password !== self.password) {
          throw new Error('ERR_SFTP_AUTH_FAILED: Invalid password');
        }
        return true;
      },

      async put(input, remoteFilePath) {
        // Resolve path relative to VFS
        const normalized = remoteFilePath.replace(/^\//, '');
        // Security check: reject path traversal
        if (normalized.includes('..')) {
          throw new Error('SSH_FX_PERMISSION_DENIED: Path traversal prohibited');
        }
        const fullPath = path.join(self.baseDir, normalized);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        const buffer = Buffer.isBuffer(input)
          ? input
          : typeof input === 'string' && fs.existsSync(input)
          ? fs.readFileSync(input)
          : Buffer.from(input, 'utf8');

        fs.writeFileSync(fullPath, buffer);
        return 'Uploaded ' + remoteFilePath;
      },

      async rename(remoteSrc, remoteDest) {
        const srcNorm = remoteSrc.replace(/^\//, '');
        const destNorm = remoteDest.replace(/^\//, '');
        if (srcNorm.includes('..') || destNorm.includes('..')) {
          throw new Error('SSH_FX_PERMISSION_DENIED: Path traversal prohibited');
        }
        const srcPath = path.join(self.baseDir, srcNorm);
        const destPath = path.join(self.baseDir, destNorm);
        if (!fs.existsSync(srcPath)) {
          throw new Error('SSH_FX_NO_SUCH_FILE');
        }
        fs.renameSync(srcPath, destPath);
        return true;
      },

      async list(remoteDir) {
        const norm = remoteDir.replace(/^\//, '');
        const fullDir = path.join(self.baseDir, norm);
        if (!fs.existsSync(fullDir)) return [];
        return fs.readdirSync(fullDir).map(name => {
          const s = fs.statSync(path.join(fullDir, name));
          return {
            name,
            type: s.isDirectory() ? 'd' : '-',
            size: s.size,
            modifyTime: s.mtimeMs,
          };
        });
      },

      async get(remoteFilePath) {
        const norm = remoteFilePath.replace(/^\//, '');
        const fullPath = path.join(self.baseDir, norm);
        if (!fs.existsSync(fullPath)) throw new Error('SSH_FX_NO_SUCH_FILE');
        return fs.readFileSync(fullPath);
      },

      async stat(remoteFilePath) {
        const norm = remoteFilePath.replace(/^\//, '');
        const fullPath = path.join(self.baseDir, norm);
        if (!fs.existsSync(fullPath)) throw new Error('SSH_FX_NO_SUCH_FILE');
        const s = fs.statSync(fullPath);
        return {
          size: s.size,
          mtime: s.mtime,
        };
      },

      async exists(remoteFilePath) {
        const norm = remoteFilePath.replace(/^\//, '');
        const fullPath = path.join(self.baseDir, norm);
        return fs.existsSync(fullPath);
      },

      async end() {
        return true;
      },
    };
  }
}

module.exports = { MockSftpServer };
