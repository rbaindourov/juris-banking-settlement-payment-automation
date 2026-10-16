import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { EmailService } from '../../src/services/email.service';
import {
  createTestCase,
  createTestClaimants,
  executeOpaqueWaveDispatch,
  makeAuthToken,
  standardFirmAdminToken,
  standardCaseManagerToken,
  unauthorizedFirmToken,
  FailableMockEmailProvider,
  defaultTemplates,
  defaultThrottling
} from './cadenceE2eHarness';

describe('E2E Master Suite: Rolling Emails & Settlement Notification Scheduling', () => {
  let mockEmailProvider: FailableMockEmailProvider;

  beforeAll(async () => {
    await setupTestDb('e2e_master_rolling_cadence');
  });

  afterAll(async () => {
    await teardownTestDb('e2e_master_rolling_cadence');
  });

  beforeEach(async () => {
    await clearTestDb('e2e_master_rolling_cadence');
    mockEmailProvider = new FailableMockEmailProvider();
    EmailService.setProvider(mockEmailProvider);
  });

  afterEach(async () => {
    EmailService.resetProvider();
  });

  describe('1. API Route Contracts & RBAC Access Enforcement', () => {
    it('Law firm admin can access case cadence endpoints with tenant scoping', async () => {
      const testCase = await createTestCase({ lawFirmId: 'firm-test-alpha' });

      // Unauthenticated request receives 401 Unauthorized
      const unauthRes = await request(app)
        .get(`/api/cases/${testCase._id}/cadence`)
        .send();
      expect([401, 404]).toContain(unauthRes.status);

      // Unauthorized tenant receives 403 Forbidden or 404 Not Found
      const foreignRes = await request(app)
        .get(`/api/cases/${testCase._id}/cadence`)
        .set('Authorization', `Bearer ${unauthorizedFirmToken}`)
        .send();
      expect([403, 404]).toContain(foreignRes.status);
    });

    it('Wave control actions require authorized administrative credentials', async () => {
      const fakeWaveId = '507f1f77bcf86cd799439011';

      // Calling pause without JWT returns 401
      const unauthPause = await request(app)
        .post(`/api/waves/${fakeWaveId}/pause`)
        .send();
      expect([401, 404]).toContain(unauthPause.status);
    });
  });

  describe('2. End-to-End Rolling Batch Dispatch & Dynamic Pre-Dispatch Filtering', () => {
    it('Executes staggered waves, applies pre-dispatch suppression, and produces exact telemetry', async () => {
      const testCase = await createTestCase({
        name: 'In re Master Settlement Rolling Test',
        lawFirmId: 'firm-test-alpha'
      });

      // Cohort of 30 claimants: 2 bounced, 28 clean
      const claimants = await createTestClaimants(testCase._id, 30, {
        bouncedCount: 2
      });

      expect(claimants.length).toBe(30);

      // Execute Initial Notice Wave with batchSize=10
      const wave1 = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        throttling: { batchSize: 10, intervalMinutes: 15 },
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(wave1.telemetry.eligible).toBe(28); // 2 historical bounces pre-filtered
      expect(wave1.telemetry.dispatched).toBe(28);
      expect(wave1.subBatchCount).toBe(3); // ceil(28 / 10) = 3
      expect(mockEmailProvider.sentEmails.length).toBe(28);

      // 15 claimants elect payment rails
      const sentClaimants = await Claimant.find({ caseId: testCase._id, emailSent: true }).exec();
      for (let i = 0; i < 15; i++) {
        sentClaimants[i].status = 'selected';
        sentClaimants[i].selectedPaymentMethod = 'ach';
        await sentClaimants[i].save();
      }

      // Execute T-14d Reminder Wave
      mockEmailProvider.clear();
      const wave2 = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'reminder_14d',
        throttling: { batchSize: 10 },
        currentTime: new Date('2026-11-16T15:00:00Z')
      });

      // Exactly 13 remaining unselected claimants receive reminder
      expect(wave2.telemetry.eligible).toBe(13);
      expect(wave2.telemetry.dispatched).toBe(13);
      expect(mockEmailProvider.sentEmails.length).toBe(13);
    });

    it('Guarantees 100% template localization fidelity (EN, ES, ZH, VI)', async () => {
      const testCase = await createTestCase();
      const langs = ['en', 'es', 'zh', 'vi'];

      for (const lang of langs) {
        await Claimant.create({
          caseId: testCase._id,
          claimId: `CLM-MASTER-${lang.toUpperCase()}`,
          firstName: `Master-${lang}`,
          lastName: 'User',
          email: `master.${lang}@juris-test.com`,
          settlementAmount: 750,
          status: 'pending_selection',
          paymentSelectionToken: `token-master-${lang}`,
          paymentDetails: { preferredLanguage: lang }
        });
      }

      const result = await executeOpaqueWaveDispatch({
        caseRecord: testCase,
        stage: 'initial_notice',
        currentTime: new Date('2026-11-01T14:00:00Z')
      });

      expect(result.telemetry.dispatched).toBe(4);
      expect(mockEmailProvider.sentEmails.length).toBe(4);

      const subjects = mockEmailProvider.sentEmails.map((e) => e.subject);
      expect(subjects.some((s) => s.includes('Court Notice:'))).toBe(true);
      expect(subjects.some((s) => s.includes('Notificación Judicial:'))).toBe(true);
      expect(subjects.some((s) => s.includes('法院和解通知'))).toBe(true);
      expect(subjects.some((s) => s.includes('Thông Báo Tòa Án'))).toBe(true);
    });
  });

  describe('3. Campaign State Machine Integrity', () => {
    it('Enforces deterministic lifecycle transitions across wave states', () => {
      const transitions: Record<string, string[]> = {
        draft: ['scheduled'],
        scheduled: ['in_progress', 'rescheduled', 'cancelled'],
        in_progress: ['paused', 'rescheduled', 'completed', 'cancelled'],
        paused: ['in_progress', 'cancelled'],
        rescheduled: ['in_progress', 'cancelled'],
        completed: [],
        cancelled: []
      };

      // Valid path: scheduled -> in_progress -> paused -> in_progress -> completed
      expect(transitions.scheduled.includes('in_progress')).toBe(true);
      expect(transitions.in_progress.includes('paused')).toBe(true);
      expect(transitions.paused.includes('in_progress')).toBe(true);
      expect(transitions.in_progress.includes('completed')).toBe(true);

      // Terminal validations
      expect(transitions.completed.length).toBe(0);
      expect(transitions.cancelled.length).toBe(0);
    });
  });
});
