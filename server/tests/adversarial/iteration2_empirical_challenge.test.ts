import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app';
import { User } from '../../src/models/User';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { authenticateToken, requireTenantScope, requireRole } from '../../src/middleware/auth';
import { signToken, signRefreshToken } from '../../src/utils/jwt';
import { AuthenticatedRequest } from '../../src/types';
import { config } from '../../src/config/env';

describe('Milestone 1 Iteration 2 Empirical Challenge Suite', () => {
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
  // CHALLENGE 1: Multi-Tenant Isolation & Parameter Conflict Verification
  // =========================================================================
  describe('Challenge 1: Multi-Tenant Isolation Verification', () => {
    function createTenantApp(): Express {
      const tenantApp = express();
      tenantApp.use(express.json());
      tenantApp.use(cookieParser('test-cookie-secret'));

      // Tenant mutation route
      tenantApp.post(
        '/api/firms/:firmId/cases',
        authenticateToken,
        requireTenantScope,
        (req: AuthenticatedRequest, res) => {
          res.status(200).json({
            success: true,
            userFirmId: req.user?.lawFirmId,
            routeFirmId: req.params.firmId,
            bodyFirmId: req.body?.lawFirmId,
            tenantFilter: req.tenantFilter
          });
        }
      );

      // Route with :lawFirmId param
      tenantApp.post(
        '/api/law-firms/:lawFirmId/cases',
        authenticateToken,
        requireTenantScope,
        (req: AuthenticatedRequest, res) => {
          res.status(200).json({
            success: true,
            userFirmId: req.user?.lawFirmId,
            routeFirmId: req.params.lawFirmId,
            bodyFirmId: req.body?.firmId,
            tenantFilter: req.tenantFilter
          });
        }
      );

      // Route with query param checking
      tenantApp.get(
        '/api/firms/:firmId/cases',
        authenticateToken,
        requireTenantScope,
        (req: AuthenticatedRequest, res) => {
          res.status(200).json({
            success: true,
            userFirmId: req.user?.lawFirmId,
            routeFirmId: req.params.firmId,
            queryFirmId: req.query.lawFirmId,
            tenantFilter: req.tenantFilter
          });
        }
      );

      return tenantApp;
    }

    const tenantApp = createTenantApp();

    it('1.1 Strictly returns 403 Forbidden when req.params.firmId is firm-A but req.body.lawFirmId is firm-B', async () => {
      const userToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c001',
        email: 'firmA_admin@test.com',
        fullName: 'Firm A Admin',
        role: 'law_firm_admin',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .post('/api/firms/firm-A/cases')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          caseName: 'Adversarial Injection Case',
          lawFirmId: 'firm-B' // Cross-tenant target in body!
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Cross-tenant access denied.');
      expect(res.body.userFirmId).toBe('firm-A');
      expect(res.body.targetFirmId).toBe('firm-B');
    });

    it('1.2 Strictly returns 403 Forbidden when req.params.lawFirmId is firm-A but req.body.firmId is firm-B', async () => {
      const userToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c002',
        email: 'firmA_cm@test.com',
        fullName: 'Firm A Case Manager',
        role: 'case_manager',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .post('/api/law-firms/firm-A/cases')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          caseName: 'Adversarial Injection Case 2',
          firmId: 'firm-B'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Cross-tenant access denied.');
      expect(res.body.userFirmId).toBe('firm-A');
      expect(res.body.targetFirmId).toBe('firm-B');
    });

    it('1.3 Strictly returns 403 Forbidden when req.params.firmId is firm-A but req.query.lawFirmId is firm-B', async () => {
      const userToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c003',
        email: 'firmA_auditor@test.com',
        fullName: 'Firm A Auditor',
        role: 'auditor',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .get('/api/firms/firm-A/cases?lawFirmId=firm-B')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Cross-tenant access denied.');
      expect(res.body.userFirmId).toBe('firm-A');
      expect(res.body.targetFirmId).toBe('firm-B');
    });

    it('1.4 Returns 200 OK when req.params.firmId and req.body.lawFirmId match user lawFirmId', async () => {
      const userToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c004',
        email: 'firmA_legit@test.com',
        fullName: 'Firm A Legit',
        role: 'law_firm_admin',
        lawFirmId: 'firm-A'
      });

      const res = await request(tenantApp)
        .post('/api/firms/firm-A/cases')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          caseName: 'Legitimate Firm A Case',
          lawFirmId: 'firm-A'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenantFilter).toEqual({ lawFirmId: 'firm-A' });
    });

    it('1.5 Super Admin bypasses tenant restrictions and receives empty tenantFilter for global access', async () => {
      const superAdminToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c005',
        email: 'superadmin@juris-banking.com',
        fullName: 'Super Admin',
        role: 'super_admin',
        lawFirmId: null
      });

      const res = await request(tenantApp)
        .post('/api/firms/firm-A/cases')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          caseName: 'Global Case Under Firm B',
          lawFirmId: 'firm-B'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tenantFilter).toEqual({});
    });

    it('1.6 Returns 403 Forbidden if non-super_admin user has no lawFirmId assigned', async () => {
      const unassignedToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c006',
        email: 'unassigned@test.com',
        fullName: 'Unassigned User',
        role: 'case_manager',
        lawFirmId: null
      });

      const res = await request(tenantApp)
        .post('/api/firms/firm-A/cases')
        .set('Authorization', `Bearer ${unassignedToken}`)
        .send({ lawFirmId: 'firm-A' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Tenant context required');
    });
  });

  // =========================================================================
  // CHALLENGE 2: Privilege Escalation Neutralization Verification
  // =========================================================================
  describe('Challenge 2: Privilege Escalation Neutralization Verification', () => {
    it('2.1 Anonymous registration with role "super_admin" from public domain is neutralized to "case_manager"', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'anonymous_attacker@gmail.com',
          password: 'AttackerPassword123!',
          fullName: 'Anonymous Attacker',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('case_manager'); // Downgraded!
      expect(res.body.user.role).not.toBe('super_admin');

      // Verify the persisted user in DB is actually case_manager
      const dbUser = await User.findOne({ email: 'anonymous_attacker@gmail.com' });
      expect(dbUser).toBeDefined();
      expect(dbUser?.role).toBe('case_manager');
    });

    it('2.2 Anonymous registration with role "platform_admin" from public domain is neutralized to "case_manager"', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'platform_attacker@yahoo.com',
          password: 'AttackerPassword123!',
          fullName: 'Platform Attacker',
          role: 'platform_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('case_manager'); // Downgraded!

      const dbUser = await User.findOne({ email: 'platform_attacker@yahoo.com' });
      expect(dbUser?.role).toBe('case_manager');
    });

    it('2.3 Authenticated super_admin CAN provision a new super_admin', async () => {
      const superAdminToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c010',
        email: 'root@juris-banking.com',
        fullName: 'Root Admin',
        role: 'super_admin'
      });

      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: 'new_admin_delegated@partner-network.com',
          password: 'DelegatedAdminPassword123!',
          fullName: 'New Delegated Admin',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('super_admin'); // Preserved because caller is super_admin
    });

    it('2.4 Authenticated case_manager CANNOT provision a super_admin (is neutralized)', async () => {
      const caseManagerToken = signToken({
        id: '64f1a2b3c4d5e6f7a8b9c011',
        email: 'cm@firm-a.com',
        fullName: 'CM User',
        role: 'case_manager',
        lawFirmId: 'firm-A'
      });

      const res = await request(app)
        .post('/api/auth/register')
        .set('Authorization', `Bearer ${caseManagerToken}`)
        .send({
          email: 'sneaky_admin@gmail.com',
          password: 'SneakyPassword123!',
          fullName: 'Sneaky Admin Attempt',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('case_manager'); // Neutralized because caller is not super_admin
    });

    it('2.5 Authorized administrative domain (@juris-banking.com) allows bootstrap registration as super_admin', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'bootstrap_admin@juris-banking.com',
          password: 'BootstrapPassword123!',
          fullName: 'Bootstrap Admin',
          role: 'super_admin'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('super_admin');
    });
  });

  // =========================================================================
  // CHALLENGE 3: Cookie vs Bearer Header Fallback Verification
  // =========================================================================
  describe('Challenge 3: Cookie vs Bearer Header Fallback Verification', () => {
    let validUser: any;
    let validBearerToken: string;

    beforeEach(async () => {
      validUser = await User.create({
        email: 'header_carrier@firm-law.com',
        passwordHash: await User.hashPassword('HeaderPassword123!'),
        fullName: 'Header Carrier',
        role: 'case_manager',
        lawFirmId: 'firm-test'
      });

      validBearerToken = signToken({
        id: validUser._id.toString(),
        email: validUser.email,
        fullName: validUser.fullName,
        role: validUser.role,
        lawFirmId: validUser.lawFirmId
      });
    });

    it('3.1 Expired cookie with valid Bearer header authenticates cleanly (HTTP 200)', async () => {
      // Craft an expired JWT cookie
      const expiredPayload = {
        id: '64f1a2b3c4d5e6f7a8b9c999',
        email: 'old_expired@test.com',
        fullName: 'Old Expired',
        role: 'case_manager'
      };
      const expiredCookieToken = signToken(expiredPayload as any, -10); // Expired 10s ago

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${expiredCookieToken}`)
        .set('Authorization', `Bearer ${validBearerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('header_carrier@firm-law.com');
      expect(res.body.user.role).toBe('case_manager');
    });

    it('3.2 Malformed / garbage cookie with valid Bearer header authenticates cleanly (HTTP 200)', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `juris_auth_token=totally.invalid.corrupted.jwt.cookie`)
        .set('Authorization', `Bearer ${validBearerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('header_carrier@firm-law.com');
    });

    it('3.3 Expired cookie with NO Bearer header returns 401 Unauthorized', async () => {
      const expiredCookieToken = signToken(
        { id: '64f1a2b3c4d5e6f7a8b9c999', email: 'expired_only@test.com', role: 'case_manager', fullName: 'Expired Only' },
        -10
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${expiredCookieToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired authentication token.');
    });

    it('3.4 Expired cookie with EXPIRED Bearer header returns 401 Unauthorized', async () => {
      const expiredCookieToken = signToken(
        { id: '64f1a2b3c4d5e6f7a8b9c999', email: 'expired_cookie@test.com', role: 'case_manager', fullName: 'Expired Cookie' },
        -10
      );
      const expiredHeaderToken = signToken(
        { id: '64f1a2b3c4d5e6f7a8b9c998', email: 'expired_header@test.com', role: 'case_manager', fullName: 'Expired Header' },
        -10
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${expiredCookieToken}`)
        .set('Authorization', `Bearer ${expiredHeaderToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired authentication token.');
    });

    it('3.5 Valid cookie takes precedence over different valid Bearer header', async () => {
      const cookieUser = await User.create({
        email: 'cookie_winner@test.com',
        passwordHash: await User.hashPassword('CookiePassword123!'),
        fullName: 'Cookie Winner',
        role: 'law_firm_admin',
        lawFirmId: 'firm-cookie'
      });

      const validCookieToken = signToken({
        id: cookieUser._id.toString(),
        email: cookieUser.email,
        fullName: cookieUser.fullName,
        role: cookieUser.role,
        lawFirmId: cookieUser.lawFirmId
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `token=${validCookieToken}`)
        .set('Authorization', `Bearer ${validBearerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('cookie_winner@test.com');
    });
  });

  // =========================================================================
  // CHALLENGE 4: Zod String Upper Bounds & Input Safety
  // =========================================================================
  describe('Challenge 4: Zod Validation Boundary & Length Limits', () => {
    it('4.1 Rejects fullName exceeding 100 characters with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'valid_email@test.com',
          password: 'ValidPassword123!',
          fullName: 'A'.repeat(101)
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('4.2 Rejects password exceeding 128 characters with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'valid_email2@test.com',
          password: 'P'.repeat(129),
          fullName: 'Normal Name'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });

    it('4.3 Rejects email exceeding 255 characters with 400 Bad Request', async () => {
      const longEmail = 'a'.repeat(250) + '@example.com'; // > 255 chars
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: longEmail,
          password: 'ValidPassword123!',
          fullName: 'Normal Name'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Validation failed');
    });
  });

  // =========================================================================
  // CHALLENGE 5: Async Error Handling & Mongoose Translation
  // =========================================================================
  describe('Challenge 5: Async Error Handling & Mongoose Translation', () => {
    it('5.1 Non-ObjectId in JWT payload returns 400 Bad Request without hanging connection', async () => {
      const malformedIdToken = signToken({
        id: 'invalid-non-hex-object-id',
        email: 'cast_user@test.com',
        fullName: 'Cast User',
        role: 'case_manager'
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${malformedIdToken}`);

      // Centralized error middleware in app.ts converts CastError to 400 Bad Request
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid ID format: invalid-non-hex-object-id');
    });

    it('5.2 Duplicate key race collision returns 409 Conflict gracefully', async () => {
      await User.create({
        email: 'collision@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Original User',
        role: 'case_manager'
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'collision@test.com',
          password: 'Password123!',
          fullName: 'Duplicate User',
          role: 'case_manager'
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('User already exists');
    });
  });

  // =========================================================================
  // CHALLENGE 6: Token Refresh Endpoint Contract Verification
  // =========================================================================
  describe('Challenge 6: POST /api/auth/refresh Contract Verification', () => {
    it('6.1 Rotates access token and refresh token successfully', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'rotation_user@test.com',
          password: 'Password123!',
          fullName: 'Rotation User',
          role: 'case_manager'
        });

      expect(regRes.status).toBe(201);
      const oldRefreshToken = regRes.body.refreshToken;
      expect(oldRefreshToken).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.token).toBeDefined();
      expect(refreshRes.body.refreshToken).toBeDefined();
      expect(refreshRes.body.user.email).toBe('rotation_user@test.com');
    });

    it('6.2 Rejects refresh when token is missing with 401', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Refresh token required');
    });

    it('6.3 Rejects refresh when user was deleted from DB with 401', async () => {
      const user = await User.create({
        email: 'deleted_user@test.com',
        passwordHash: await User.hashPassword('Password123!'),
        fullName: 'Deleted User',
        role: 'case_manager'
      });

      const payload = {
        id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        lawFirmId: user.lawFirmId
      };
      const refreshToken = signRefreshToken(payload);

      // Delete the user from MongoDB
      await User.deleteOne({ _id: user._id });

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User no longer exists');
    });
  });
});
