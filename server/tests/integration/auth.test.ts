import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';

describe('Auth Integration APIs (/api/auth)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  describe('GET /api/health', () => {
    it('returns 200 OK and health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /api/auth/register', () => {
    it('successfully registers a user, returns sanitized user object, and sets HttpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'admin@juris-banking.com',
          password: 'SecurePassword123!',
          fullName: 'Alexander Hamilton',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('admin@juris-banking.com');
      expect(res.body.user.fullName).toBe('Alexander Hamilton');
      expect(res.body.user.role).toBe('super_admin');
      expect(res.body.user.id).toBeDefined();
      expect(res.body.user.passwordHash).toBeUndefined(); // Security invariant: never leak hash
      expect(res.body.token).toBeDefined();

      // Verify HttpOnly cookie header
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const tokenCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      const payload = {
        email: 'duplicate@juris-banking.com',
        password: 'Password123!',
        fullName: 'First Register'
      };

      await request(app).post('/api/auth/register').send(payload);

      const res = await request(app).post('/api/auth/register').send(payload);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
    });

    it('rejects invalid payload with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'short',
          fullName: ''
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'casemanager@firm.com',
          password: 'PasswordCaseManager123',
          fullName: 'Case Manager User',
          role: 'case_manager',
          lawFirmId: 'firm-abc-123'
        });
    });

    it('successfully logs in with valid credentials and sets HttpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'casemanager@firm.com',
          password: 'PasswordCaseManager123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('casemanager@firm.com');
      expect(res.body.user.role).toBe('case_manager');
      expect(res.body.user.lawFirmId).toBe('firm-abc-123');
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.token).toBeDefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const tokenCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');
    });

    it('rejects login with incorrect password with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'casemanager@firm.com',
          password: 'WrongPassword999'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects login with nonexistent email with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@firm.com',
          password: 'PasswordCaseManager123'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken: string;
    let authCookie: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'auditor@auditfirm.com',
          password: 'AuditorPassword2026',
          fullName: 'Compliance Auditor',
          role: 'auditor'
        });

      authToken = res.body.token;
      const cookies = res.headers['set-cookie'] as unknown as string[];
      authCookie = cookies.find((c: string) => c.startsWith('token=')) || '';
    });

    it('returns user profile when authenticated via HttpOnly cookie', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('auditor@auditfirm.com');
      expect(res.body.user.role).toBe('auditor');
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('returns user profile when authenticated via Bearer token header', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('auditor@auditfirm.com');
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });

    it('rejects request with corrupted or forged token with 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer forged.token.signature');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired authentication token');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the auth cookie on logout', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Logged out successfully');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      const tokenCookie = cookies.find((c: string) => c.startsWith('token='));
      expect(tokenCookie).toBeDefined();
      // Verifies cookie is cleared (empty value or expires in past)
      expect(
        tokenCookie?.includes('token=;') ||
        tokenCookie?.includes('Expires=Thu, 01 Jan 1970') ||
        tokenCookie?.includes('Max-Age=0')
      ).toBe(true);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns 401 when no refresh token is provided', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Refresh token required');
    });

    it('successfully refreshes token using request body refreshToken', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'refreshtest@juris-banking.com',
          password: 'SecurePassword123!',
          fullName: 'Refresh Test User',
          role: 'case_manager'
        });

      const refreshToken = reg.body.refreshToken;
      expect(refreshToken).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.token).toBeDefined();
      expect(refreshRes.body.user).toBeDefined();
      expect(refreshRes.body.user.email).toBe('refreshtest@juris-banking.com');
    });

    it('successfully refreshes token using HttpOnly cookie', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'cookierefresh@juris-banking.com',
          password: 'SecurePassword123!',
          fullName: 'Cookie Refresh User',
          role: 'case_manager'
        });

      const cookies = reg.headers['set-cookie'] as unknown as string[];
      const refreshCookie = cookies.find((c: string) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie || '');

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.token).toBeDefined();
    });

    it('rejects invalid refresh token with 401', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.forged.refresh.token' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid or expired refresh token');
    });
  });
});
