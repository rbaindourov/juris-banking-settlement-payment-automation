import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { CORE_AGENDA_JOBS, AGENDA_JOBS } from '../../src/types';

describe('Integration: Agendash Mount & Content Negotiation', () => {
  let superAdminToken: string;
  let platformAdminToken: string;
  let lawFirmAdminToken: string;
  let auditorToken: string;

  beforeAll(async () => {
    await setupTestDb('agendash_mount');

    superAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'superadmin@platform.com',
      role: 'super_admin'
    });

    platformAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'platform@platform.com',
      role: 'platform_admin'
    });

    lawFirmAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'firmadmin@lawfirm.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-001'
    });

    auditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@lawfirm.com',
      role: 'auditor',
      lawFirmId: 'FIRM-001'
    });
  });

  afterAll(async () => {
    await teardownTestDb('agendash_mount');
  });

  describe('1. RBAC Authentication & Authorization', () => {
    it('rejects unauthenticated requests to /agendash with 401', async () => {
      const res = await request(app)
        .get('/agendash')
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
    });

    it('rejects unauthorized roles (auditor) with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${auditorToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(403);
    });
  });

  describe('2. Dual-Mode Content Negotiation (JSON vs HTML)', () => {
    it('returns 200 with registeredJobs and allJobs when Accept is application/json for super_admin', async () => {
      const res = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.registeredJobs).toBeDefined();
      expect(res.body.registeredJobs).toEqual([...CORE_AGENDA_JOBS]);
      expect(res.body.registeredJobs).toHaveLength(5);

      expect(res.body.allJobs).toBeDefined();
      expect(res.body.allJobs).toEqual([...AGENDA_JOBS]);
      expect(res.body.allJobs).toHaveLength(6);
      expect(res.body.allJobs).toContain('email:scan-gmail-bounces');
    });

    it('returns 200 with registeredJobs when trailing slash is present', async () => {
      const res = await request(app)
        .get('/agendash/')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.registeredJobs).toEqual([...CORE_AGENDA_JOBS]);
      expect(res.body.allJobs).toEqual([...AGENDA_JOBS]);
    });

    it('allows law_firm_admin access with valid token', async () => {
      const res = await request(app)
        .get('/agendash')
        .set('Authorization', `Bearer ${lawFirmAdminToken}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.registeredJobs).toHaveLength(5);
      expect(res.body.allJobs).toHaveLength(6);
    });
  });
});
