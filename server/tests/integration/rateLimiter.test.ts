import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { createCustomRateLimiter } from '../../src/middleware/rateLimiter';
import { setupTestDb, teardownTestDb } from '../helpers/db';

describe('Rate Limiting Middleware (/src/middleware/rateLimiter.ts)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });
  function createRateLimitedApp(): Express {
    const app = express();
    app.use(express.json());

    // Strict 3-requests-per-minute limiter for testing
    const testLimiter = createCustomRateLimiter(3, 60 * 1000, 'Test rate limit exceeded.');

    app.get('/api/test/limited', testLimiter, (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    return app;
  }

  it('allows requests within limit and returns 429 Too Many Requests when threshold is exceeded', async () => {
    const app = createRateLimitedApp();

    // First 3 requests should pass
    const res1 = await request(app).get('/api/test/limited');
    expect(res1.status).toBe(200);

    const res2 = await request(app).get('/api/test/limited');
    expect(res2.status).toBe(200);

    const res3 = await request(app).get('/api/test/limited');
    expect(res3.status).toBe(200);

    // 4th request should be throttled
    const res4 = await request(app).get('/api/test/limited');
    expect(res4.status).toBe(429);
    expect(res4.body.error).toBe('Test rate limit exceeded.');
  });

  it('authRateLimiter on /api/auth/login enforces max 5 failed attempts before 429 throttling', async () => {
    const { app: mainApp } = await import('../../src/app');
    const attackEmail = `ratelimit_target_${Date.now()}@test.com`;

    // 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(mainApp)
        .post('/api/auth/login')
        .send({ email: attackEmail, password: `WrongPass_${i}` });
      expect(res.status).toBe(401);
    }

    // 6th attempt should be throttled with 429 Too Many Requests
    const res6 = await request(mainApp)
      .post('/api/auth/login')
      .send({ email: attackEmail, password: 'WrongPass_6' });
    expect(res6.status).toBe(429);
    expect(res6.body.error).toContain('Too many authentication attempts');
  });
});
