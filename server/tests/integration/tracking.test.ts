import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { Case } from '../../src/models/Case';
import { config } from '../../src/config/env';

describe('Engagement Tracking Routes Integration Tests (/api/public/tracking)', () => {
  beforeAll(async () => {
    await setupTestDb('tracking_integration');
  });

  afterAll(async () => {
    await teardownTestDb('tracking_integration');
  });

  beforeEach(async () => {
    await clearTestDb('tracking_integration');
  });

  describe('GET /api/public/tracking/pixel/:token', () => {
    it('serves 43-byte transparent 1x1 GIF with anti-caching headers for valid token', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Tracking Settlement',
        docketNumber: '1:24-cv-00101',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-TRK-01',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        settlementAmount: 150.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/tracking/pixel/${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/gif');
      expect(res.headers['content-length']).toBe('43');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBe(43);

      // Verify DB engagement status update
      // Allow async update to complete
      await new Promise((r) => setTimeout(r, 50));
      const updated = await Claimant.findById(claimant._id);
      expect(updated?.emailOpened).toBe(true);
      expect(updated?.emailOpenedAt).toBeInstanceOf(Date);
    });

    it('returns uniform 1x1 GIF for non-existent or invalid tokens without leaking errors', async () => {
      const nonExistentToken = '0000000000000000000000000000000000000000000000000000000000000000';
      const res1 = await request(app).get(`/api/public/tracking/pixel/${nonExistentToken}`);
      expect(res1.status).toBe(200);
      expect(res1.headers['content-type']).toBe('image/gif');
      expect(res1.body.length).toBe(43);

      const invalidFormatToken = 'not-a-hex-token';
      const res2 = await request(app).get(`/api/public/tracking/pixel/${invalidFormatToken}`);
      expect(res2.status).toBe(200);
      expect(res2.headers['content-type']).toBe('image/gif');
      expect(res2.body.length).toBe(43);
    });

    it('is idempotent and preserves initial emailOpenedAt timestamp on multiple pixel fetches', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Tracking Settlement',
        docketNumber: '1:24-cv-00101',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const initialDate = new Date(Date.now() - 60000); // 1 min ago
      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-TRK-02',
        firstName: 'John',
        lastName: 'Smith',
        email: 'john.smith@example.com',
        settlementAmount: 200.0,
        status: 'pending_selection',
        paymentSelectionToken: token,
        emailOpened: true,
        emailOpenedAt: initialDate
      });

      await request(app).get(`/api/public/tracking/pixel/${token}`);
      await new Promise((r) => setTimeout(r, 50));

      const rechecked = await Claimant.findById(claimant._id);
      expect(rechecked?.emailOpenedAt?.getTime()).toBe(initialDate.getTime());
    });
  });

  describe('GET /api/public/tracking/click/:token', () => {
    it('redirects to client claim portal with 302 and marks linkClicked and emailOpened', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const testCase = await Case.create({
        name: 'In re Tracking Settlement',
        docketNumber: '1:24-cv-00101',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-TRK-03',
        firstName: 'Alice',
        lastName: 'Walker',
        email: 'alice.walker@example.com',
        settlementAmount: 300.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/tracking/click/${token}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${config.CLIENT_URL}/claim/${token}`);

      const updated = await Claimant.findById(claimant._id);
      expect(updated?.linkClicked).toBe(true);
      expect(updated?.linkClickedAt).toBeInstanceOf(Date);
      expect(updated?.emailOpened).toBe(true);
      expect(updated?.emailOpenedAt).toBeInstanceOf(Date);
    });

    it('redirects invalid or unknown token to invalid claim destination with 302', async () => {
      const unknownToken = '0000000000000000000000000000000000000000000000000000000000000000';
      const res = await request(app).get(`/api/public/tracking/click/${unknownToken}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${config.CLIENT_URL}/claim/invalid`);

      const malformedToken = 'invalid-token-short';
      const resMalformed = await request(app).get(`/api/public/tracking/click/${malformedToken}`);
      expect(resMalformed.status).toBe(302);
      expect(resMalformed.headers.location).toBe(`${config.CLIENT_URL}/claim/invalid`);
    });
  });
});
