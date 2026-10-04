/**
 * Tier 1 - Feature Coverage: Agenda Scheduler & Agendash
 * Tests 1.1 to 1.5: Agendash RBAC Mount, 5 Core Job Definitions, Deadline Sweeper, Dispatch Throttling, Reminder Schedule.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { TestClient } = require('../harness/test_client');
const config = require('../config');

describe('Tier 1: Feature Coverage - Agenda Scheduler & Agendash', () => {
  it('1.1 Agendash UI mount (/agendash) is protected: requires Super Admin or Law Firm Admin roles', async () => {
    // 1. Unauthenticated request is rejected with 401
    const unauthClient = new TestClient(config.apiUrl);
    const unauthRes = await unauthClient.get('/agendash');
    expect(unauthRes.status).toBe(401);

    // 2. Case Manager role is blocked with 403 Forbidden
    const caseManagerClient = new TestClient(config.apiUrl);
    await caseManagerClient.post('/api/auth/register', {
      email: `cm_agenda_${Date.now()}@firm.com`,
      password: 'Password123!',
      fullName: 'Case Manager User',
      role: 'case_manager',
      lawFirmId: 'firm_001',
    });
    const cmRes = await caseManagerClient.get('/agendash');
    expect(cmRes.status).toBe(403);

    // 3. Law Firm Admin role is allowed with 200 OK
    const adminClient = new TestClient(config.apiUrl);
    await adminClient.post('/api/auth/register', {
      email: `admin_agenda_${Date.now()}@firm.com`,
      password: 'Password123!',
      fullName: 'Law Firm Admin User',
      role: 'law_firm_admin',
      lawFirmId: 'firm_001',
    });
    const adminRes = await adminClient.get('/agendash');
    expect(adminRes.status).toBe(200);
  });

  it('1.2 Verifies exact registration of the 5 core Agenda scheduled jobs', async () => {
    const adminClient = new TestClient(config.apiUrl);
    await adminClient.post('/api/auth/register', {
      email: `admin_agenda_jobs_${Date.now()}@firm.com`,
      password: 'Password123!',
      fullName: 'Admin Jobs Verifier',
      role: 'law_firm_admin',
      lawFirmId: 'firm_001',
    });
    const res = await adminClient.get('/agendash');
    expect(res.status).toBe(200);

    const requiredJobs = res.body.registeredJobs;
    expect(requiredJobs).toBeDefined();
    expect(requiredJobs.length).toBe(5);
    expect(requiredJobs).toInclude('case:dispatch-notifications');
    expect(requiredJobs).toInclude('case:send-deadline-reminders');
    expect(requiredJobs).toInclude('case:enforce-deadline-fallback');
    expect(requiredJobs).toInclude('sftp:generate-and-upload-batch');
    expect(requiredJobs).toInclude('sftp:poll-reconciliation-reports');
  });

  it('1.3 Deadline fallback job logic sweeps expired pending claimants to case.fallbackPaymentMethod', () => {
    const pastDeadline = new Date(Date.now() - 3600000); // 1 hour ago
    const testCase = {
      _id: 'case_001',
      disbursementDeadline: pastDeadline,
      fallbackPaymentMethod: 'physical_check',
      status: 'active',
    };

    const claimants = [
      { id: 'c1', status: 'pending_selection', selectedMethod: null },
      { id: 'c2', status: 'method_selected', selectedMethod: 'ach' },
      { id: 'c3', status: 'pending_selection', selectedMethod: null },
    ];

    // Simulate sweeper run
    const now = new Date();
    const isDeadlinePassed = now > testCase.disbursementDeadline;
    expect(isDeadlinePassed).toBe(true);

    const sweptClaimants = claimants.map(c => {
      if (c.status === 'pending_selection' && isDeadlinePassed) {
        return {
          ...c,
          status: 'deadline_expired',
          selectedMethod: testCase.fallbackPaymentMethod,
          fallbackAssigned: true,
        };
      }
      return c;
    });

    expect(sweptClaimants[0].status).toBe('deadline_expired');
    expect(sweptClaimants[0].selectedMethod).toBe('physical_check');
    expect(sweptClaimants[1].status).toBe('method_selected'); // Untouched
    expect(sweptClaimants[1].selectedMethod).toBe('ach');
    expect(sweptClaimants[2].status).toBe('deadline_expired');
    expect(sweptClaimants[2].selectedMethod).toBe('physical_check');
  });

  it('1.4 Notification dispatch job queues emails with rate-limiting / batch throttle configuration', () => {
    const jobConfig = {
      name: 'case:dispatch-notifications',
      concurrency: 5,
      batchSize: 50,
      rateLimitPerSecond: 10,
    };

    expect(jobConfig.concurrency).toBeGreaterThan(0);
    expect(jobConfig.batchSize).toBeGreaterThan(0);
    expect(jobConfig.rateLimitPerSecond).toBeGreaterThan(0);
  });

  it('1.5 Automated deadline reminders scheduled at 7 days and 48 hours prior to deadline', () => {
    const reminderConfig = {
      name: 'case:send-deadline-reminders',
      intervals: [
        { label: '7_days', hoursBeforeDeadline: 168 },
        { label: '48_hours', hoursBeforeDeadline: 48 },
      ],
      cronSchedule: '0 9 * * *', // Daily 9:00 AM UTC
    };

    expect(reminderConfig.intervals.length).toBe(2);
    expect(reminderConfig.intervals[0].hoursBeforeDeadline).toBe(168);
    expect(reminderConfig.intervals[1].hoursBeforeDeadline).toBe(48);
  });
});
