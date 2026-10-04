import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../../src/utils/jwt';
import { AuthTokenPayload } from '../../src/types';

describe('JWT Utilities (jsonwebtoken)', () => {
  const samplePayload: AuthTokenPayload = {
    id: '64f1a2b3c4d5e6f7a8b9c0d1',
    email: 'lawyer@firm.com',
    fullName: 'Jane Doe, Esq.',
    role: 'law_firm_admin',
    lawFirmId: 'firm-778899'
  };

  it('signs and verifies a valid JWT payload correctly', () => {
    const token = signToken(samplePayload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const decoded = verifyToken(token);
    expect(decoded.id).toBe(samplePayload.id);
    expect(decoded.email).toBe(samplePayload.email);
    expect(decoded.fullName).toBe(samplePayload.fullName);
    expect(decoded.role).toBe(samplePayload.role);
    expect(decoded.lawFirmId).toBe(samplePayload.lawFirmId);
  });

  it('throws an error when verifying an invalid or tampered token', () => {
    const validToken = signToken(samplePayload);
    const tamperedToken = validToken.slice(0, -5) + 'abcde';

    expect(() => verifyToken(tamperedToken)).toThrow();
  });

  it('throws when verifying a completely malformed token string', () => {
    expect(() => verifyToken('not.a.valid.jwt.string')).toThrow();
    expect(() => verifyToken('')).toThrow();
  });

  it('correctly handles custom short expiration time', async () => {
    const shortLivedToken = signToken(samplePayload, '1s');
    expect(verifyToken(shortLivedToken)).toBeDefined();

    // Wait 1.1s for 1s token to expire (JWT timestamps are second-resolution)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(() => verifyToken(shortLivedToken)).toThrow(/jwt expired/);
  });
});
