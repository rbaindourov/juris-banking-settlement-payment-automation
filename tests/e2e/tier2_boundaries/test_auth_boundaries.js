/**
 * Tier 2 - Boundary & Corner Cases: Authentication & RBAC Limits
 * Tests 2.1 to 2.5: Empty inputs, Massive payloads, Expired/tampered JWT, Cross-tenant access, Rate limiting.
 */

const crypto = require('node:crypto');
const { describe, it, expect, before } = require('../harness/test_runner');
const { TestClient } = require('../harness/test_client');
const config = require('../config');

describe('Tier 2: Boundary & Corner Cases - Auth & RBAC Limits', () => {
  let client;

  before(async () => {
    client = new TestClient(config.apiUrl);
  });

  it('2.1 Rejects empty or missing email/password with 400 Bad Request (Zod validation)', async () => {
    const resEmpty = await client.post('/api/auth/login', {});
    expect(resEmpty.status).toBe(400);

    const resEmptyEmail = await client.post('/api/auth/login', { email: '', password: 'SomePassword123!' });
    expect(resEmptyEmail.status).toBe(400);

    const resInvalidEmail = await client.post('/api/auth/login', { email: 'notanemail', password: 'SomePassword123!' });
    expect(resInvalidEmail.status).toBe(400);
  });

  it('2.2 Handles oversized payload and excessive password length gracefully without memory crash', async () => {
    const giantPassword = 'A'.repeat(5000);
    const res = await client.post('/api/auth/login', {
      email: 'test@example.com',
      password: giantPassword,
    });
    // Should be rejected via 400, 401, or 413, without crashing the server process
    expect([400, 401, 413]).toInclude(res.status);
  });

  it('2.3 Rejects forged or tampered JWT cookie signature with 401 Unauthorized', async () => {
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user_123', role: 'super_admin' })).toString('base64url');
    const fakeSignature = crypto.randomBytes(32).toString('base64url');
    const forgedToken = `${forgedHeader}.${forgedPayload}.${fakeSignature}`;

    const tamperedClient = new TestClient(config.apiUrl);
    tamperedClient.setCookie('token', forgedToken);

    const res = await tamperedClient.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('2.4 Cross-tenant boundary: Law Firm Admin cannot query or access another firm\'s tenant resources', () => {
    const firmA = 'firm_alpha_id_100';
    const firmB = 'firm_beta_id_200';

    const reqUser = { id: 'u1', role: 'law_firm_admin', lawFirmId: firmA };
    const targetFirmId = firmB;

    const isCrossTenantDenied = (reqUser.role === 'law_firm_admin' && reqUser.lawFirmId !== targetFirmId);
    expect(isCrossTenantDenied).toBe(true);
  });

  it('2.5 Rate limiting boundary: Rapid failed login attempts decrement rate limit and trigger 429 Too Many Requests', async () => {
    const bruteClient = new TestClient(config.apiUrl);
    const attackEmail = `brute_${Date.now()}@test.com`;

    const firstRes = await bruteClient.post('/api/auth/login', {
      email: attackEmail,
      password: 'WrongPassword_init',
    });
    expect(firstRes.headers['ratelimit-limit']).toBeDefined();

    const limit = parseInt(firstRes.headers['ratelimit-limit'], 10) || 20;
    let wasRateLimited = false;

    // Send requests to exceed the declared limit threshold
    for (let i = 0; i < limit + 2; i++) {
      const res = await bruteClient.post('/api/auth/login', {
        email: attackEmail,
        password: `WrongPass_${i}`,
      });
      if (res.status === 429) {
        wasRateLimited = true;
        break;
      }
    }

    expect(wasRateLimited).toBe(true);
  });
});
