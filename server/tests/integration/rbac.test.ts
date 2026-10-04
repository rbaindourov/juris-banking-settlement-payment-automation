import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { authenticateToken, requireRole, requireTenantScope } from '../../src/middleware/auth';
import { signToken } from '../../src/utils/jwt';
import { UserRole, AuthenticatedRequest } from '../../src/types';

function createRbacTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser('test-cookie-secret'));

  // Super Admin only route
  app.get(
    '/api/test/super-admin-only',
    authenticateToken,
    requireRole(['super_admin']),
    (_req, res) => {
      res.status(200).json({ allowed: true, role: 'super_admin' });
    }
  );

  // Platform or Super Admin route (e.g. Agendash or system maintenance)
  app.get(
    '/api/test/platform-admin',
    authenticateToken,
    requireRole(['super_admin', 'platform_admin']),
    (_req, res) => {
      res.status(200).json({ allowed: true });
    }
  );

  // Law Firm Admin and above route (case creation, template editing)
  app.get(
    '/api/test/firm-admin',
    authenticateToken,
    requireRole(['super_admin', 'platform_admin', 'law_firm_admin']),
    (_req, res) => {
      res.status(200).json({ allowed: true });
    }
  );

  // Case Manager and above route (reviewing claimant records, exceptions)
  app.get(
    '/api/test/case-manager',
    authenticateToken,
    requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager']),
    (_req, res) => {
      res.status(200).json({ allowed: true });
    }
  );

  // Auditor read-only route
  app.get(
    '/api/test/auditor-view',
    authenticateToken,
    requireRole(['super_admin', 'platform_admin', 'law_firm_admin', 'case_manager', 'auditor']),
    (_req, res) => {
      res.status(200).json({ allowed: true });
    }
  );

  // Tenant-scoped route
  app.get(
    '/api/test/firms/:firmId/data',
    authenticateToken,
    requireTenantScope,
    (req: AuthenticatedRequest, res) => {
      res.status(200).json({
        allowed: true,
        tenantFilter: req.tenantFilter,
        targetFirmId: req.params.firmId
      });
    }
  );

  return app;
}

describe('RBAC & Tenant Scoping Middleware (/src/middleware/auth.ts)', () => {
  const testApp = createRbacTestApp();

  function makeToken(role: UserRole, firmId?: string | null): string {
    return signToken({
      id: `usr-${role}-123`,
      email: `${role}@juris.local`,
      fullName: `Test ${role}`,
      role,
      lawFirmId: firmId || null
    });
  }

  const superAdminToken = makeToken('super_admin');
  const platformAdminToken = makeToken('platform_admin');
  const lawFirmAdminFirmAToken = makeToken('law_firm_admin', 'firm-A');
  const caseManagerFirmAToken = makeToken('case_manager', 'firm-A');
  const auditorFirmAToken = makeToken('auditor', 'firm-A');
  const userNoFirmToken = makeToken('law_firm_admin', null);

  describe('requireRole() Access Hierarchy Enforcement', () => {
    it('Super Admin can access super_admin routes, and all subordinate routes', async () => {
      const res1 = await request(testApp)
        .get('/api/test/super-admin-only')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(testApp)
        .get('/api/test/platform-admin')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res2.status).toBe(200);

      const res3 = await request(testApp)
        .get('/api/test/firm-admin')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res3.status).toBe(200);

      const res4 = await request(testApp)
        .get('/api/test/case-manager')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res4.status).toBe(200);

      const res5 = await request(testApp)
        .get('/api/test/auditor-view')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res5.status).toBe(200);
    });

    it('Platform Admin cannot access super_admin only routes, but can access platform and firm admin routes', async () => {
      const resDenied = await request(testApp)
        .get('/api/test/super-admin-only')
        .set('Authorization', `Bearer ${platformAdminToken}`);
      expect(resDenied.status).toBe(403);
      expect(resDenied.body.error).toContain('Forbidden');

      const resAllowed = await request(testApp)
        .get('/api/test/platform-admin')
        .set('Authorization', `Bearer ${platformAdminToken}`);
      expect(resAllowed.status).toBe(200);
    });

    it('Law Firm Admin cannot access super_admin or platform_admin routes (403)', async () => {
      const res1 = await request(testApp)
        .get('/api/test/super-admin-only')
        .set('Authorization', `Bearer ${lawFirmAdminFirmAToken}`);
      expect(res1.status).toBe(403);

      const res2 = await request(testApp)
        .get('/api/test/platform-admin')
        .set('Authorization', `Bearer ${lawFirmAdminFirmAToken}`);
      expect(res2.status).toBe(403);

      const res3 = await request(testApp)
        .get('/api/test/firm-admin')
        .set('Authorization', `Bearer ${lawFirmAdminFirmAToken}`);
      expect(res3.status).toBe(200);
    });

    it('Case Manager cannot access firm_admin routes (403), but can access case_manager routes (200)', async () => {
      const resForbidden = await request(testApp)
        .get('/api/test/firm-admin')
        .set('Authorization', `Bearer ${caseManagerFirmAToken}`);
      expect(resForbidden.status).toBe(403);

      const resAllowed = await request(testApp)
        .get('/api/test/case-manager')
        .set('Authorization', `Bearer ${caseManagerFirmAToken}`);
      expect(resAllowed.status).toBe(200);
    });

    it('Auditor can only access auditor-view routes and is forbidden on mutating manager/admin routes (403)', async () => {
      const resForbidden = await request(testApp)
        .get('/api/test/case-manager')
        .set('Authorization', `Bearer ${auditorFirmAToken}`);
      expect(resForbidden.status).toBe(403);

      const resAllowed = await request(testApp)
        .get('/api/test/auditor-view')
        .set('Authorization', `Bearer ${auditorFirmAToken}`);
      expect(resAllowed.status).toBe(200);
    });

    it('Unauthenticated requests are rejected with 401 Unauthorized', async () => {
      const res = await request(testApp).get('/api/test/case-manager');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Authentication required');
    });
  });

  describe('requireTenantScope Multi-Tenant Isolation Enforcement', () => {
    it('Super Admin has global access to any law firm tenant', async () => {
      const resFirmA = await request(testApp)
        .get('/api/test/firms/firm-A/data')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resFirmA.status).toBe(200);

      const resFirmB = await request(testApp)
        .get('/api/test/firms/firm-B/data')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resFirmB.status).toBe(200);
    });

    it('Law Firm Admin of firm-A can access firm-A data', async () => {
      const res = await request(testApp)
        .get('/api/test/firms/firm-A/data')
        .set('Authorization', `Bearer ${lawFirmAdminFirmAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.targetFirmId).toBe('firm-A');
    });

    it('Law Firm Admin of firm-A is blocked with 403 when attempting to access firm-B data', async () => {
      const res = await request(testApp)
        .get('/api/test/firms/firm-B/data')
        .set('Authorization', `Bearer ${lawFirmAdminFirmAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cross-tenant access denied');
    });

    it('Case Manager of firm-A is blocked when attempting to access firm-B data', async () => {
      const res = await request(testApp)
        .get('/api/test/firms/firm-B/data')
        .set('Authorization', `Bearer ${caseManagerFirmAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Cross-tenant access denied');
    });

    it('Tenant user without lawFirmId is blocked with 403 Forbidden', async () => {
      const res = await request(testApp)
        .get('/api/test/firms/firm-A/data')
        .set('Authorization', `Bearer ${userNoFirmToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Tenant context required');
    });
  });
});
