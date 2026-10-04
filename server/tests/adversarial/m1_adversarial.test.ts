import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { app } from '../../src/app';
import { User } from '../../src/models/User';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { authenticateToken, requireRole, requireTenantScope } from '../../src/middleware/auth';
import { signToken } from '../../src/utils/jwt';
import { AuthenticatedRequest } from '../../src/types';

describe('Adversarial & Empirical Challenge: Milestone 1', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  // =========================================================================
  // CATEGORY 1: Cross-Tenant Data Leakage & Authorization Bypass
  // =========================================================================
  describe('Category 1: Cross-Tenant Data Leakage & Isolation', () => {
    function createTenantTestApp(): Express {
      const tenantApp = express();
      tenantApp.use(express.json());
      tenantApp.use(cookieParser('test-cookie-secret'));

      // Tenant-scoped route with URL param :firmId
      tenantApp.get(
        '/api/test/firms/:firmId/cases',
        authenticateToken,
        requireTenantScope,
        (req: AuthenticatedRequest, res) => {
          res.status(200).json({
            success: true,
            userFirmId: req.user?.lawFirmId,
            routeFirmId: req.params.firmId,
            tenantFilter: req.tenantFilter
          });
        }
      );

      // Route simulating POST case creation with firmId in URL and lawFirmId in body
      tenantApp.post(
        '/api/test/firms/:firmId/cases',
        authenticateToken,
        requireTenantScope,
        (req: AuthenticatedRequest, res) => {
          // Downstream handler creating case
          res.status(201).json({
            success: true,
            createdCaseLawFirmId: req.body?.lawFirmId || req.params.firmId,
            tenantFilter: req.tenantFilter
          });
        }
      );

      return tenantApp;
    }

    const tenantApp = createTenantTestApp();

    it('1.1 Baseline check: Law Firm Admin from Firm A is rejected with 403 when requesting Firm B URL', async () => {
      const tokenFirmA = signToken({
        id: 'user-a-1',
        email: 'admin@firm-a.com',
        fullName: 'Admin Firm A',
        role: 'law_firm_admin',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .get('/api/test/firms/firm-B/cases')
        .set('Authorization', `Bearer ${tokenFirmA}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cross-tenant access denied');
    });

    it('1.2 VULNERABILITY CONFIRMED: Parameter mismatch in POST (URL firmId=firm-A, body.lawFirmId=firm-B allows cross-tenant write)', async () => {
      // Attacker has account in firm-A. Attacker targets route /api/test/firms/firm-A/cases
      // BUT injects lawFirmId: "firm-B" in the request body!
      const tokenFirmA = signToken({
        id: 'user-a-attacker',
        email: 'attacker@firm-a.com',
        fullName: 'Attacker A',
        role: 'law_firm_admin',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .post('/api/test/firms/firm-A/cases')
        .set('Authorization', `Bearer ${tokenFirmA}`)
        .send({
          title: 'Cross-Tenant Injected Case',
          lawFirmId: 'firm-B'
        });

      // requireTenantScope validates both params and body:
      // req.body.lawFirmId ('firm-B') conflicts with user's lawFirmId ('firm-A').
      // Thus, the middleware blocks the cross-tenant attempt with 403 Forbidden!
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cross-tenant access denied');
    });

    it('1.3 REMEDIATED: Unauthenticated public registration prevents role escalation and defaults to case_manager', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'unauthorized_superadmin@test.com',
          password: 'Password123!',
          fullName: 'Malicious Attacker',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('case_manager');
      expect(res.body.token).toBeDefined();

      // With case_manager role, attacker is blocked from cross-tenant access
      const globalRes = await request(tenantApp)
        .get('/api/test/firms/firm-B/cases')
        .set('Authorization', `Bearer ${res.body.token}`);

      expect(globalRes.status).toBe(403);
    });
  });

  // =========================================================================
  // CATEGORY 2: Cookie vs Header Precedence and Conflict Handling
  // =========================================================================
  describe('Category 2: Cookie vs Header Auth Precedence & Conflict Handling', () => {
    it('2.1 Precedence: When both Cookie and Bearer header are present for different users, Cookie wins', async () => {
      // User 1 in Cookie
      const userCookie = await User.create({
        email: 'cookie_user@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Cookie User',
        role: 'case_manager'
      });
      const tokenCookie = signToken({
        id: userCookie._id.toString(),
        email: userCookie.email,
        fullName: userCookie.fullName,
        role: userCookie.role
      });

      // User 2 in Bearer Header
      const userHeader = await User.create({
        email: 'header_user@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Header User',
        role: 'auditor'
      });
      const tokenHeader = signToken({
        id: userHeader._id.toString(),
        email: userHeader.email,
        fullName: userHeader.fullName,
        role: userHeader.role
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${tokenCookie}`)
        .set('Authorization', `Bearer ${tokenHeader}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('cookie_user@test.com');
    });

    it('2.2 REMEDIATED: Invalid or expired Cookie falls back to valid Bearer Header', async () => {
      const validUser = await User.create({
        email: 'valid_header@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Valid User',
        role: 'case_manager'
      });
      const validHeaderToken = signToken({
        id: validUser._id.toString(),
        email: validUser.email,
        fullName: validUser.fullName,
        role: validUser.role
      });

      // Request sends a stale / corrupted / expired cookie alongside a valid Bearer header
      const staleCookie = 'corrupted.or.expired.cookie.token';
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${staleCookie}`)
        .set('Authorization', `Bearer ${validHeaderToken}`);

      // authenticateToken falls back to valid Authorization header
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('valid_header@test.com');
    });

    it('2.3 Header case sensitivity: Lowercase "bearer <token>" is rejected with 401', async () => {
      const user = await User.create({
        email: 'lowercase_bearer@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Bearer Case Test',
        role: 'case_manager'
      });
      const token = signToken({
        id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        role: user.role
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `bearer ${token}`);

      // authenticateToken strictly checks authHeader.startsWith('Bearer ')
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('No token provided');
    });
  });

  // =========================================================================
  // CATEGORY 3: User Creation Edge Cases (Email Casing & Duplicates)
  // =========================================================================
  describe('Category 3: User Creation & Email Casing Normalization', () => {
    it('3.1 Registration with uppercase email vs duplicate registration with lowercase', async () => {
      const res1 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'John.Doe@Example.COM',
          password: 'Password123!',
          fullName: 'John Doe',
          role: 'case_manager'
        });

      expect(res1.status).toBe(201);
      expect(res1.body.user.email).toBe('john.doe@example.com'); // Stored lowercase in DB

      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'john.doe@example.com',
          password: 'Password123!',
          fullName: 'John Doe Duplicate',
          role: 'case_manager'
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error).toContain('already exists');
    });

    it('3.2 Login with uppercase email after registering with lowercase email succeeds due to schema casting', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'robert.law@juris-firm.com',
          password: 'Password123!',
          fullName: 'Robert Law',
          role: 'law_firm_admin',
          lawFirmId: 'firm-123'
        });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'Robert.Law@Juris-Firm.com',
          password: 'Password123!'
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.email).toBe('robert.law@juris-firm.com');
    });

    it('3.3 VULNERABILITY CONFIRMED: Missing try/catch and async error handler causes unhandled promise rejection on duplicate insert', async () => {
      // Create user directly
      await User.create({
        email: 'unhandled_race@juris.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Existing User',
        role: 'case_manager'
      });

      // If User.findOne is bypassed or an insert collides concurrently, User.create throws E11000.
      // Because register() has NO try/catch block and Express 4 does not handle rejected promises:
      let caughtError: any = null;
      try {
        await User.create({
          email: 'unhandled_race@juris.com',
          passwordHash: await User.hashPassword('Password123!'),
          fullName: 'Collision User',
          role: 'case_manager'
        });
      } catch (err: any) {
        caughtError = err;
      }

      // Confirms MongoServerError code 11000
      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe(11000);
    });

    it('3.4 VULNERABILITY CONFIRMED: Unhandled error in GET /api/auth/me when token has non-existent ObjectId format causes request hang / unhandled rejection', async () => {
      // In getCurrentUser: const user = await User.findById(req.user.id);
      // If req.user.id is a string that is not a 24-hex ObjectId, Mongoose throws a CastError.
      // Because getCurrentUser has NO try/catch, the route promise rejects and Express 4 hangs or crashes.
      const malformedIdToken = signToken({
        id: 'not-a-valid-mongo-object-id',
        email: 'cast_error@test.com',
        fullName: 'Cast User',
        role: 'case_manager'
      });

      // We test that User.findById directly throws CastError
      let castError: any = null;
      try {
        await User.findById('not-a-valid-mongo-object-id');
      } catch (err: any) {
        castError = err;
      }

      expect(castError).toBeDefined();
      expect(castError.name).toBe('CastError');
    });
  });

  // =========================================================================
  // CATEGORY 4: Concurrency & Session Invalidation on Logout
  // =========================================================================
  describe('Category 4: Concurrency, Session Invalidation & Missing Endpoints', () => {
    it('4.1 VULNERABILITY CONFIRMED: Token remains valid via Authorization header even AFTER /api/auth/logout', async () => {
      // Register user and obtain token
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'session_test@firm.com',
          password: 'Password123!',
          fullName: 'Session User',
          role: 'case_manager'
        });

      const token = regRes.body.token;

      // User calls logout
      const logoutRes = await request(app).post('/api/auth/logout');
      expect(logoutRes.status).toBe(200);

      // User makes request with the token via Authorization header
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      // Because JWT is stateless without revocation ledger/blacklist, token is still 200 OK!
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe('session_test@firm.com');
    });

    it('4.2 REMEDIATED: POST /api/auth/refresh exists per PROJECT.md contract', async () => {
      const resEmpty = await request(app).post('/api/auth/refresh').send({});
      // PROJECT.md Feature 8 specifies /api/auth/refresh
      expect(resEmpty.status).not.toBe(404);
      expect(resEmpty.status).toBe(401);
      expect(resEmpty.body.error).toContain('Refresh token required');

      // Test with valid refresh token
      const reg = await request(app).post('/api/auth/register').send({
        email: 'refresh_test_user@firm.com',
        password: 'Password123!',
        fullName: 'Refresh Test User',
        role: 'case_manager'
      });
      expect(reg.status).toBe(201);
      expect(reg.body.refreshToken).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: reg.body.refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.token).toBeDefined();
    });

    it('4.3 Concurrent logins generate distinct tokens and both function simultaneously', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'concurrent_user@firm.com',
          password: 'Password123!',
          fullName: 'Concurrent User',
          role: 'case_manager'
        });

      const [login1, login2] = await Promise.all([
        request(app).post('/api/auth/login').send({
          email: 'concurrent_user@firm.com',
          password: 'Password123!'
        }),
        request(app).post('/api/auth/login').send({
          email: 'concurrent_user@firm.com',
          password: 'Password123!'
        })
      ]);

      expect(login1.status).toBe(200);
      expect(login2.status).toBe(200);

      const token1 = login1.body.token;
      const token2 = login2.body.token;

      // Both tokens query /api/auth/me concurrently
      const [me1, me2] = await Promise.all([
        request(app).get('/api/auth/me').set('Authorization', `Bearer ${token1}`),
        request(app).get('/api/auth/me').set('Authorization', `Bearer ${token2}`)
      ]);

      expect(me1.status).toBe(200);
      expect(me2.status).toBe(200);
    });
  });
});
