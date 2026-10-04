import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VfsManager } from './vfs';

export const SFTP_STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
} as const;

export const SFTP_OPEN_MODE = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREAT: 0x00000008,
  TRUNC: 0x00000010,
  EXCL: 0x00000020
} as const;

interface HandleInfo {
  isDir: boolean;
  fd?: number;
  dirPath?: string;
  entries?: string[];
  sent?: boolean;
}

export function setupSftpHandler(sftpStream: any, vfs: VfsManager): void {
  const handles = new Map<string, HandleInfo>();

  const createHandle = (info: HandleInfo): Buffer => {
    const id = crypto.randomBytes(8).toString('hex');
    handles.set(id, info);
    return Buffer.from(id, 'utf8');
  };

  const getHandle = (buf: Buffer): { id: string; info: HandleInfo } | null => {
    const id = buf.toString('utf8');
    const info = handles.get(id);
    if (!info) return null;
    return { id, info };
  };

  const toAttrs = (stats: fs.Stats) => ({
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  });

  sftpStream.on('REALPATH', (reqid: number, requestedPath: string) => {
    try {
      if (requestedPath && requestedPath !== '.' && requestedPath !== '/') {
        vfs.resolvePath(requestedPath);
      }
      let clean = requestedPath ? path.posix.normalize(requestedPath) : '/';
      if (!clean.startsWith('/')) clean = '/' + clean;
      sftpStream.name(reqid, [
        {
          filename: clean,
          longname: clean,
          attrs: {}
        }
      ]);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('STAT', (reqid: number, filePath: string) => {
    try {
      const resolved = vfs.resolvePath(filePath);
      if (!fs.existsSync(resolved)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
      const stats = fs.statSync(resolved);
      sftpStream.attrs(reqid, toAttrs(stats));
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
    }
  });

  sftpStream.on('LSTAT', (reqid: number, filePath: string) => {
    try {
      const resolved = vfs.resolvePath(filePath);
      if (!fs.existsSync(resolved)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
      const stats = fs.lstatSync(resolved);
      sftpStream.attrs(reqid, toAttrs(stats));
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
    }
  });

  sftpStream.on('OPENDIR', (reqid: number, dirPath: string) => {
    try {
      const resolved = vfs.resolvePath(dirPath);
      if (!fs.existsSync(resolved)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
      const entries = fs.readdirSync(resolved);
      const handle = createHandle({
        isDir: true,
        dirPath: resolved,
        entries,
        sent: false
      });
      sftpStream.handle(reqid, handle);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('READDIR', (reqid: number, handleBuffer: Buffer) => {
    try {
      const handle = getHandle(handleBuffer);
      if (!handle || !handle.info.isDir) {
        return sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
      if (handle.info.sent) {
        return sftpStream.status(reqid, SFTP_STATUS.EOF);
      }

      handle.info.sent = true;
      const entries = (handle.info.entries || []).map((name) => {
        const full = path.join(handle.info.dirPath!, name);
        let attrs: any = {};
        try {
          attrs = toAttrs(fs.statSync(full));
        } catch {
          // ignore
        }
        return {
          filename: name,
          longname: name,
          attrs
        };
      });

      sftpStream.name(reqid, entries);
    } catch {
      sftpStream.status(reqid, SFTP_STATUS.FAILURE);
    }
  });

  sftpStream.on('OPEN', (reqid: number, filename: string, flags: number) => {
    try {
      const resolved = vfs.resolvePath(filename);
      // Ensure parent directory exists when creating/writing
      if (flags & (SFTP_OPEN_MODE.WRITE | SFTP_OPEN_MODE.CREAT)) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
      }

      let flagStr = 'r';
      if ((flags & SFTP_OPEN_MODE.READ) && (flags & SFTP_OPEN_MODE.WRITE)) {
        flagStr = flags & SFTP_OPEN_MODE.CREAT ? 'w+' : 'r+';
      } else if (flags & SFTP_OPEN_MODE.WRITE) {
        if (flags & SFTP_OPEN_MODE.APPEND) {
          flagStr = 'a';
        } else if (flags & (SFTP_OPEN_MODE.CREAT | SFTP_OPEN_MODE.TRUNC)) {
          flagStr = 'w';
        } else {
          flagStr = 'r+';
        }
      } else if (flags & SFTP_OPEN_MODE.READ) {
        flagStr = 'r';
      }

      const fd = fs.openSync(resolved, flagStr);
      vfs.openHandles.add(fd);
      const handle = createHandle({ isDir: false, fd });
      sftpStream.handle(reqid, handle);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else if (err.code === 'ENOENT') {
        sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('READ', (reqid: number, handleBuffer: Buffer, offset: number, length: number) => {
    try {
      const handle = getHandle(handleBuffer);
      if (!handle || handle.info.isDir || handle.info.fd === undefined) {
        return sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
      const stat = fs.fstatSync(handle.info.fd);
      if (offset >= stat.size) {
        return sftpStream.status(reqid, SFTP_STATUS.EOF);
      }

      const bytesToRead = Math.min(length, stat.size - offset);
      const buf = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(handle.info.fd, buf, 0, bytesToRead, offset);
      if (bytesRead === 0) {
        return sftpStream.status(reqid, SFTP_STATUS.EOF);
      }
      sftpStream.data(reqid, buf.subarray(0, bytesRead));
    } catch {
      sftpStream.status(reqid, SFTP_STATUS.FAILURE);
    }
  });

  sftpStream.on('WRITE', (reqid: number, handleBuffer: Buffer, offset: number, data: Buffer) => {
    try {
      const handle = getHandle(handleBuffer);
      if (!handle || handle.info.isDir || handle.info.fd === undefined) {
        return sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
      fs.writeSync(handle.info.fd, data, 0, data.length, offset);
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch {
      sftpStream.status(reqid, SFTP_STATUS.FAILURE);
    }
  });

  sftpStream.on('RENAME', (reqid: number, oldPath: string, newPath: string) => {
    try {
      const resolvedOld = vfs.resolvePath(oldPath);
      const resolvedNew = vfs.resolvePath(newPath);

      if (!fs.existsSync(resolvedOld)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }

      fs.mkdirSync(path.dirname(resolvedNew), { recursive: true });
      fs.renameSync(resolvedOld, resolvedNew);
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('REMOVE', (reqid: number, filePath: string) => {
    try {
      const resolved = vfs.resolvePath(filePath);
      if (!fs.existsSync(resolved)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
      fs.unlinkSync(resolved);
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('MKDIR', (reqid: number, dirPath: string) => {
    try {
      const resolved = vfs.resolvePath(dirPath);
      fs.mkdirSync(resolved, { recursive: true });
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('RMDIR', (reqid: number, dirPath: string) => {
    try {
      const resolved = vfs.resolvePath(dirPath);
      if (!fs.existsSync(resolved)) {
        return sftpStream.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
      }
      fs.rmdirSync(resolved);
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch (err: any) {
      if (err.code === 'PERMISSION_DENIED') {
        sftpStream.status(reqid, SFTP_STATUS.PERMISSION_DENIED);
      } else {
        sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
    }
  });

  sftpStream.on('SETSTAT', (reqid: number) => {
    sftpStream.status(reqid, SFTP_STATUS.OK);
  });

  sftpStream.on('FSETSTAT', (reqid: number) => {
    sftpStream.status(reqid, SFTP_STATUS.OK);
  });

  sftpStream.on('FSTAT', (reqid: number, handleBuffer: Buffer) => {
    try {
      const handle = getHandle(handleBuffer);
      if (!handle || handle.info.isDir || handle.info.fd === undefined) {
        return sftpStream.status(reqid, SFTP_STATUS.FAILURE);
      }
      const stats = fs.fstatSync(handle.info.fd);
      sftpStream.attrs(reqid, toAttrs(stats));
    } catch {
      sftpStream.status(reqid, SFTP_STATUS.FAILURE);
    }
  });

  sftpStream.on('CLOSE', (reqid: number, handleBuffer: Buffer) => {
    try {
      const handle = getHandle(handleBuffer);
      if (handle) {
        if (!handle.info.isDir && handle.info.fd !== undefined) {
          try {
            fs.closeSync(handle.info.fd);
            vfs.openHandles.delete(handle.info.fd);
          } catch {
            // ignore
          }
        }
        handles.delete(handle.id);
      }
      sftpStream.status(reqid, SFTP_STATUS.OK);
    } catch {
      sftpStream.status(reqid, SFTP_STATUS.FAILURE);
    }
  });
}
