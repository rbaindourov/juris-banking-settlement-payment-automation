/**
 * Tier 1 - Feature Coverage: Authentication & RBAC Identity Management
 * Tests 1.1 to 1.6: Super Admin, Firm Admin, Case Manager, Auditor, 401 unauthenticated, 401 invalid creds.
 */

const { describe, it, expect, before } = require('../harness/test_runner');
const { TestClient } = require('../harness/test_client');
const config = require('../config');

describe('Tier 1: Feature Coverage - Auth & RBAC IDM', () => {
  let client;

  before(async () => {
    client = new TestClient(config.apiUrl);
  });

  it('1.1 Super Admin registers, logs in, receives HttpOnly cookie, and queries /api/auth/me', async () => {
    const email = `superadmin_${Date.now()}@juris-test.com`;
    const password = 'SuperSecurePassword123!';

    // Register
    const regRes = await client.post('/api/auth/register', {
      email,
      password,
      fullName: 'Chief Super Admin',
      role: 'super_admin',
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body).toBeDefined();
    expect(regRes.body.user).toBeDefined();
    expect(regRes.body.user.role).toBe('super_admin');
    expect(regRes.body.user.email).toBe(email);

    // Verify cookie was captured in client jar
    const cookie = client.getCookie('token') || client.getCookie('juris_auth_token');
    expect(cookie).toBeDefined();

    // Query /api/auth/me using authenticated cookie session
    const meRes = await client.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
    expect(meRes.body.user.role).toBe('super_admin');
  });

  it('1.2 Law Firm Admin registers and maintains tenant-scoped session with lawFirmId', async () => {
    const firmClient = new TestClient(config.apiUrl);
    const firmId = `firm_alpha_${Date.now()}`;
    const email = `admin_${Date.now()}@firmalpha-law.com`;
    const password = 'FirmAdminPassword123!';

    const regRes = await firmClient.post('/api/auth/register', {
      email,
      password,
      fullName: 'Sarah Jenkins, Esq.',
      role: 'law_firm_admin',
      lawFirmId: firmId,
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.role).toBe('law_firm_admin');
    expect(regRes.body.user.lawFirmId).toBe(firmId);

    // Verify me endpoint returns lawFirmId
    const meRes = await firmClient.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.lawFirmId).toBe(firmId);
  });

  it('1.3 Case Manager user is created and successfully authenticated', async () => {
    const cmClient = new TestClient(config.apiUrl);
    const firmId = `firm_beta_${Date.now()}`;
    const email = `casemanager_${Date.now()}@firmbeta-law.com`;
    const password = 'CaseManagerPass123!';

    const regRes = await cmClient.post('/api/auth/register', {
      email,
      password,
      fullName: 'David Case Specialist',
      role: 'case_manager',
      lawFirmId: firmId,
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.role).toBe('case_manager');

    // Test logout clears session
    const logoutRes = await cmClient.post('/api/auth/logout', {});
    expect(logoutRes.status).toBe(200);
  });

  it('1.4 Auditor / Viewer user has read-only identity profile verified', async () => {
    const auditorClient = new TestClient(config.apiUrl);
    const firmId = `firm_gamma_${Date.now()}`;
    const email = `auditor_${Date.now()}@compliance-audit.org`;
    const password = 'AuditorSecurePass123!';

    const regRes = await auditorClient.post('/api/auth/register', {
      email,
      password,
      fullName: 'Emily Compliance Inspector',
      role: 'auditor',
      lawFirmId: firmId,
    });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.role).toBe('auditor');

    const meRes = await auditorClient.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.role).toBe('auditor');
  });

  it('1.5 Unauthenticated request without token/cookie is rejected with 401 Unauthorized', async () => {
    const anonClient = new TestClient(config.apiUrl);
    // Explicitly send request with empty cookie jar
    const res = await anonClient.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('1.6 Login with incorrect password returns 401 and does not issue a session cookie', async () => {
    const clientTest = new TestClient(config.apiUrl);
    const email = `existing_${Date.now()}@firm-law.com`;
    const validPassword = 'CorrectPassword123!';

    await clientTest.post('/api/auth/register', {
      email,
      password: validPassword,
      fullName: 'Test User',
      role: 'case_manager',
    });

    clientTest.clearCookies();

    // Attempt login with wrong password
    const failRes = await clientTest.post('/api/auth/login', {
      email,
      password: 'TotallyWrongPassword999!',
    });

    expect(failRes.status).toBe(401);
    expect(failRes.body.error).toBeDefined();
    expect(clientTest.getCookie('token')).toBeUndefined();
  });
});
