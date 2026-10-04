/**
 * Juris Banking - Opaque-box HTTP Test Client
 * Handles HTTP requests, cookie jars, multipart uploads, and API helpers.
 */

const http = require('node:http');
const https = require('node:https');
const url = require('node:url');

class TestClient {
  constructor(baseUrl = 'http://localhost:5000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.cookies = new Map();
    this.defaultHeaders = {
      'Accept': 'application/json',
    };
  }

  setCookie(name, value) {
    this.cookies.set(name, value);
  }

  getCookie(name) {
    return this.cookies.get(name);
  }

  clearCookies() {
    this.cookies.clear();
  }

  _parseSetCookie(cookieHeader) {
    if (!cookieHeader) return;
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
    for (const c of cookies) {
      const parts = c.split(';')[0].split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        this.cookies.set(name, value);
      }
    }
  }

  _getCookieHeader() {
    const pairs = [];
    for (const [name, value] of this.cookies.entries()) {
      pairs.push(`${name}=${value}`);
    }
    return pairs.join('; ');
  }

  async request(method, path, options = {}) {
    const targetUrl = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = { ...this.defaultHeaders, ...(options.headers || {}) };

    const cookieHeader = this._getCookieHeader();
    if (cookieHeader && !headers['Cookie'] && !headers['cookie']) {
      headers['Cookie'] = cookieHeader;
    }

    let bodyData = null;
    if (options.body) {
      if (typeof options.body === 'object' && !(options.body instanceof Buffer)) {
        bodyData = JSON.stringify(options.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        bodyData = options.body;
      }
      headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    return new Promise((resolve, reject) => {
      const req = transport.request(
        targetUrl,
        {
          method: method.toUpperCase(),
          headers,
          timeout: options.timeout || 15000,
        },
        (res) => {
          this._parseSetCookie(res.headers['set-cookie']);

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            let parsedJson = null;
            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
              try {
                parsedJson = JSON.parse(rawBody);
              } catch (_) {
                parsedJson = null;
              }
            }

            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: parsedJson !== null ? parsedJson : rawBody,
              rawBody,
              cookies: new Map(this.cookies),
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Request to ${targetUrl.toString()} timed out`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  async get(path, options = {}) {
    return this.request('GET', path, options);
  }

  async post(path, body = {}, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  async put(path, body = {}, options = {}) {
    return this.request('PUT', path, { ...options, body });
  }

  async delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  /**
   * Multipart/form-data upload using raw HTTP stream
   */
  async postMultipart(path, fields = {}, files = [], options = {}) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const chunks = [];

    for (const [key, val] of Object.entries(fields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
        )
      );
    }

    for (const f of files) {
      const filename = f.filename || 'upload.csv';
      const fieldName = f.fieldName || 'file';
      const mime = f.mimeType || 'text/csv';
      const fileBuffer = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');

      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
        )
      );
      chunks.push(fileBuffer);
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const fullBody = Buffer.concat(chunks);

    return this.request('POST', path, {
      ...options,
      body: fullBody,
      headers: {
        ...(options.headers || {}),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    });
  }

  async isServerReachable() {
    try {
      const res = await this.get('/api/auth/me', { timeout: 2000 });
      return res.status !== 0;
    } catch (_) {
      return false;
    }
  }

  // Domain API helpers
  async login(email, password) {
    return this.post('/api/auth/login', { email, password });
  }

  async logout() {
    return this.post('/api/auth/logout', {});
  }

  async getMe() {
    return this.get('/api/auth/me');
  }

  async createCase(caseData) {
    return this.post('/api/cases', caseData);
  }

  async getCase(caseId) {
    return this.get(`/api/cases/${caseId}`);
  }

  async postFile(path, content, filename = 'upload.csv', fieldName = 'file', mimeType = 'text/csv') {
    return this.postMultipart(
      path,
      {},
      [{ fieldName, filename, content, mimeType }]
    );
  }

  async stageUpload(caseId, fileContent, filename = 'claimants.csv') {
    return this.postMultipart(
      `/api/cases/${caseId}/claimants/stage-upload`,
      {},
      [{ fieldName: 'file', filename, content: fileContent, mimeType: 'text/csv' }]
    );
  }

  async commitUpload(caseId, payload = {}) {
    return this.post(`/api/cases/${caseId}/claimants/commit-upload`, payload);
  }

  async getPortalClaim(token) {
    return this.get(`/api/public/claim/${token}`);
  }

  async selectPayment(token, payload) {
    return this.post(`/api/public/claim/${token}/select-payment`, payload);
  }

  async getReceipt(token) {
    return this.get(`/api/public/claim/${token}/receipt`);
  }

  async getAgendash() {
    return this.get('/agendash');
  }

  async getAnalyticsFunnel(caseId) {
    return this.get(`/api/cases/${caseId}/analytics/funnel`);
  }

  async getAnalyticsMethods(caseId) {
    return this.get(`/api/cases/${caseId}/analytics/methods`);
  }

  async getExceptions(caseId, query = '') {
    const q = query ? `?${query}` : '';
    return this.get(`/api/cases/${caseId}/exceptions${q}`);
  }

  async resolveException(caseId, exceptionId, payload) {
    return this.post(`/api/cases/${caseId}/exceptions/${exceptionId}/resolve`, payload);
  }
}

module.exports = { TestClient };
