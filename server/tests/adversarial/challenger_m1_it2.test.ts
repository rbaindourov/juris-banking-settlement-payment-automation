import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { User } from '../../src/models/User';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { config } from '../../src/config/env';
import { signToken, signRefreshToken } from '../../src/utils/jwt';

describe('Empirical Challenger: Milestone 1 Iteration 2 Hardening', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ASYNC ERROR RESILIENCE & DATABASE ERROR TRANSLATION
  // =========================================================================
  describe('1. Async Error Resilience & Database Error Translation', () => {
    it('[ERR-01] GET /api/auth/me handles Mongoose CastError cleanly without crashing or hanging', async () => {
      // Craft a token signed with valid secret but carrying an invalid MongoDB ObjectId string
      const tokenWithBadId = jwt.sign(
        {
          id: 'invalid-non-hex-object-id',
          email: 'casterror@juris.local',
          fullName: 'Cast User',
          role: 'case_manager'
        },
        config.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenWithBadId}`);

      // Mongoose throws CastError on User.findById("invalid-non-hex-object-id").
      // Centralized error handler intercepts err.name === 'CastError' and responds with 400.
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid ID format');
      expect(res.body.error).toContain('invalid-non-hex-object-id');
    });

    it('[ERR-02] POST /api/auth/refresh handles CastError when payload contains malformed ObjectId', async () => {
      const badIdRefreshToken = jwt.sign(
        {
          id: 'malformed-refresh-user-id',
          email: 'refresh_cast@juris.local',
          tokenType: 'refresh'
        },
        config.JWT_SECRET
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: badIdRefreshToken });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid ID format');
    });

    it('[ERR-03] Forced database error on POST /api/auth/login returns 500 cleanly without hanging', async () => {
      // Spy on User.findOne to simulate an unexpected database crash/network drop
      const findOneSpy = vi.spyOn(User, 'findOne').mockRejectedValueOnce(
        new Error('MongoNetworkTimeout: connection timed out')
      );

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'db_failure@juris.local',
          password: 'Password123!'
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('MongoNetworkTimeout');
      expect(findOneSpy).toHaveBeenCalled();
    });

    it('[ERR-04] Forced database error on POST /api/auth/register returns 500 cleanly without hanging', async () => {
      const createSpy = vi.spyOn(User, 'create').mockRejectedValueOnce(
        new Error('DiskFull: database storage exhausted')
      );

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'storage_exhausted@juris.local',
          password: 'Password123!',
          fullName: 'Storage User'
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('DiskFull');
      expect(createSpy).toHaveBeenCalled();
    });

    it('[ERR-05] Concurrent duplicate key collision (MongoServerError 11000) returns 409 Conflict', async () => {
      // Simulate MongoDB driver duplicate key error (code 11000) on create
      const mongoDuplicateError: any = new Error('E11000 duplicate key error collection: users index: email_1 dup key');
      mongoDuplicateError.code = 11000;

      const createSpy = vi.spyOn(User, 'create').mockRejectedValueOnce(mongoDuplicateError);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'race_condition@juris.local',
          password: 'Password123!',
          fullName: 'Race User'
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('User already exists with this email address');
      expect(createSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. BRUTE-FORCE RATE LIMITING RESILIENCE (/api/auth/login)
  // =========================================================================
  describe('2. Brute-Force Rate Limiting Resilience', () => {
    it('[RATE-01] 5 failed login attempts trigger HTTP 429 Too Many Requests on the 6th attempt', async () => {
      // Register authentic target account
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'brute_target@juris.local',
          password: 'CorrectPassword123!',
          fullName: 'Target Account'
        });

      // Fire 5 invalid credential attempts
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'brute_target@juris.local',
            password: `WrongGuess_${attempt}`
          });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid email or password');
      }

      // 6th attempt MUST be blocked by authRateLimiter with HTTP 429
      const blockedRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'brute_target@juris.local',
          password: 'WrongGuess_Final'
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain('Too many authentication attempts');
      expect(blockedRes.headers['ratelimit-limit']).toBe('5');
      expect(blockedRes.headers['ratelimit-remaining']).toBe('0');
    });

    it('[RATE-02] Successful login is skipped and does NOT consume the failed attempt quota', async () => {
      const email = `legit_user_${Date.now()}@juris.local`;
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'CorrectPassword123!',
          fullName: 'Legit Account'
        });
      expect(regRes.status).toBe(201);

      // Execute 6 consecutive successful logins
      for (let i = 1; i <= 6; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({
            email,
            password: 'CorrectPassword123!'
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    it('[RATE-03] Validation schema failures (400 Bad Request) do not consume rate limit quota', async () => {
      // Send 5 requests with invalid email schema
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'not-an-email',
            password: 'SomePassword123!'
          });
        expect(res.status).toBe(400);
      }

      // Register user and verify login succeeds
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'valid_schema@juris.local',
          password: 'Password123!',
          fullName: 'Valid Schema'
        });

      const validRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid_schema@juris.local',
          password: 'Password123!'
        });

      expect(validRes.status).toBe(200);
    });

    it('[RATE-04] Rate limit is partitioned by account: attacking Account A does not block Account B', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'account_b@juris.local',
          password: 'Password123!',
          fullName: 'Account B'
        });

      // Exhaust 5 attempts for Account A
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'account_a@juris.local', password: 'wrong' });
      }

      // Account A is blocked
      const resA = await request(app)
        .post('/api/auth/login')
        .send({ email: 'account_a@juris.local', password: 'wrong' });
      expect(resA.status).toBe(429);

      // Account B from the same client IP can still authenticate successfully
      const resB = await request(app)
        .post('/api/auth/login')
        .send({ email: 'account_b@juris.local', password: 'Password123!' });
      expect(resB.status).toBe(200);
    });
  });

  // =========================================================================
  // 3. TOKEN REFRESH LIFECYCLE (POST /api/auth/refresh)
  // =========================================================================
  describe('3. Token Refresh Lifecycle', () => {
    let testUser: any;
    let initialToken: string;
    let initialRefreshToken: string;

    beforeEach(async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'refresh_user@juris.local',
          password: 'Password123!',
          fullName: 'Refresh Test User',
          role: 'law_firm_admin',
          lawFirmId: 'firm-999'
        });

      testUser = reg.body.user;
      initialToken = reg.body.token;
      initialRefreshToken = reg.body.refreshToken;
    });

    it('[REFRESH-01] POST /api/auth/refresh rotates tokens and issues valid access and refresh credentials', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.user.email).toBe('refresh_user@juris.local');

      const rotatedAccessToken = res.body.token;
      const rotatedRefreshToken = res.body.refreshToken;

      // Verify cookies are set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.startsWith('token='))).toBe(true);
      expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true);

      // Verify the new access token functions on protected routes
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${rotatedAccessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.id).toBe(testUser.id);

      // Verify the new refresh token can execute a subsequent rotation
      const secondRefreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rotatedRefreshToken });
      expect(secondRefreshRes.status).toBe(200);
      expect(secondRefreshRes.body.token).toBeDefined();
    });

    it('[REFRESH-02] Rejects expired refresh tokens with HTTP 401', async () => {
      const expiredRefreshToken = jwt.sign(
        {
          id: testUser.id,
          email: testUser.email,
          role: testUser.role,
          tokenType: 'refresh'
        },
        config.JWT_SECRET,
        { expiresIn: '-10s' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: expiredRefreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('[REFRESH-03] Rejects forged refresh token signed with unauthorized secret', async () => {
      const forgedRefreshToken = jwt.sign(
        {
          id: testUser.id,
          email: testUser.email,
          role: testUser.role,
          tokenType: 'refresh'
        },
        'unauthorized_attacker_secret_key_9999!',
        { algorithm: 'HS256' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: forgedRefreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('[REFRESH-04] Rejects tampered refresh token payload', async () => {
      const parts = initialRefreshToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      payload.role = 'super_admin'; // Tamper role
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tamperedToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('[REFRESH-05] Rejects request when no refresh token is provided', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Refresh token required');
    });

    it('[REFRESH-06] Rejects refresh request if user was deleted from database', async () => {
      // Delete user
      await User.findByIdAndDelete(testUser.id);

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('User no longer exists');
    });

    it('[REFRESH-07] Refresh token provided via HttpOnly cookie succeeds', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refreshToken=${initialRefreshToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
    });
  });

  // =========================================================================
  // 4. ADVERSARIAL EDGE CASE PROBING & FAILURE MODES
  // =========================================================================
  describe('4. Adversarial Edge Case Probing', () => {
    it('[PROBE-01] Stale expired access token cookie alongside valid body refreshToken', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'stale_cookie_user@juris.local',
          password: 'Password123!',
          fullName: 'Stale Cookie User'
        });

      const validRefreshToken = reg.body.refreshToken;
      const expiredAccessToken = jwt.sign(
        { id: reg.body.user.id, email: reg.body.user.email },
        config.JWT_SECRET,
        { expiresIn: '-1h' }
      );

      // Browser has expired access cookie 'token', but client sends fresh refreshToken in JSON body
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `token=${expiredAccessToken}`)
        .send({ refreshToken: validRefreshToken });

      // Document whether the server accepts the valid body token or gets blocked by expired cookie
      console.log('[PROBE-01 Result] Status:', res.status, 'Body:', res.body);
    });

    it('[PROBE-02] Direct access token usage on /api/auth/refresh', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'access_as_refresh@juris.local',
          password: 'Password123!',
          fullName: 'Access User'
        });

      const accessToken = reg.body.token;

      // Attacker attempts to pass access token as refreshToken
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: accessToken });

      console.log('[PROBE-02 Result] Status:', res.status, 'Body:', res.body);
    });

    it('[PROBE-03] Direct refresh token usage on protected route /api/auth/me', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'refresh_as_access@juris.local',
          password: 'Password123!',
          fullName: 'Refresh User'
        });

      const refreshToken = reg.body.refreshToken;

      // Attacker passes 7-day refresh token directly to access-token protected route
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);

      console.log('[PROBE-03 Result] Status:', res.status, 'Body:', res.body);
    });

    it('[PROBE-04] Email case-variation in brute-force rate limiter key', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'case_probe@juris.local',
          password: 'CorrectPassword123!',
          fullName: 'Case Probe User'
        });

      // Attempt 5 logins with lower-case email
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'case_probe@juris.local', password: 'wrong' });
      }

      // Check if lower-case is blocked
      const lowerRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'case_probe@juris.local', password: 'wrong' });
      expect(lowerRes.status).toBe(429);

      // Now check if varying the casing (e.g. Case_Probe@juris.local) bypasses the limiter
      const mixedCaseRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'Case_Probe@juris.local', password: 'wrong' });

      console.log('[PROBE-04 Result] Mixed-case rate limit status:', mixedCaseRes.status);
    });
  });
});
