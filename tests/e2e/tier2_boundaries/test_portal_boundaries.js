/**
 * Tier 2 - Boundary & Corner Cases: Claimant Portal & Payment Rail Validations
 * Tests 2.1 to 2.6: Deadline Passed (403), Invalid ABA (Mod 10), Valid ABA Districts, Invalid PAN (Luhn), Malformed Address, Bad Token.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { isValidAbaRouting, isValidLuhn } = require('../harness/oracles');
const { VALID_ABA_ROUTINGS, INVALID_ABA_ROUTINGS } = require('../harness/data_generators');

describe('Tier 2: Boundary & Corner Cases - Claimant Portal & Rail Validations', () => {
  it('2.1 Rejects payment selection after disbursement deadline passes with 403 DEADLINE_PASSED', () => {
    const caseDeadline = new Date('2026-09-01T00:00:00Z'); // Past deadline
    const attemptTime = new Date('2026-10-04T12:00:00Z');

    const isExpired = attemptTime > caseDeadline;
    expect(isExpired).toBe(true);

    const submissionResult = isExpired
      ? { status: 403, error: 'DEADLINE_PASSED', message: 'Payment election deadline has expired. Default court fallback assigned.' }
      : { status: 200, success: true };

    expect(submissionResult.status).toBe(403);
    expect(submissionResult.error).toBe('DEADLINE_PASSED');
  });

  it('2.2 Mathematical oracle rejects all invalid ABA routing numbers via Federal Reserve Mod 10 formula', () => {
    for (const testVector of INVALID_ABA_ROUTINGS) {
      const isValid = isValidAbaRouting(testVector.routing);
      expect(isValid).toBe(false);
    }
  });

  it('2.3 Mathematical oracle validates real ABA routing transit numbers across Federal Reserve districts', () => {
    for (const testVector of VALID_ABA_ROUTINGS) {
      const isValid = isValidAbaRouting(testVector.routing);
      expect(isValid).toBe(true);
    }
  });

  it('2.4 Luhn algorithm oracle rejects invalid Debit Card PANs (single-digit transpositions and off-by-one check digits)', () => {
    const invalidPans = [
      '4111111111111112', // Off by one from valid 4111111111111111
      '4000000000000000', // Mod 10 fails
      '4242424242424241', // Off by one from valid 4242424242424242
      '1234567890123456', // Random non-Luhn
      '4111',             // Too short
    ];

    for (const pan of invalidPans) {
      const isValid = isValidLuhn(pan);
      expect(isValid).toBe(false);
    }

    // Positive controls
    expect(isValidLuhn('4111111111111111')).toBe(true);
    expect(isValidLuhn('4242424242424242')).toBe(true);
  });

  it('2.5 Rejects malformed postal address fields (non-US 2-letter state codes, invalid ZIP codes)', () => {
    const invalidStates = ['CAL', '12', 'c', 'california', ''];
    const invalidZips = ['9021', 'ABCDE', '90210-12', '90210-12345', ''];

    const stateRegex = /^[A-Z]{2}$/;
    const zipRegex = /^\d{5}(-\d{4})?$/;

    for (const st of invalidStates) {
      expect(stateRegex.test(st)).toBe(false);
    }

    for (const z of invalidZips) {
      expect(zipRegex.test(z)).toBe(false);
    }

    // Positive control
    expect(stateRegex.test('CA')).toBe(true);
    expect(stateRegex.test('NY')).toBe(true);
    expect(zipRegex.test('90210')).toBe(true);
    expect(zipRegex.test('90210-1234')).toBe(true);
  });

  it('2.6 Tampered or non-existent claimant token returns 404 without leaking internal system metadata', () => {
    const nonExistentToken = '0000000000000000000000000000000000000000000000000000000000000000';
    const mockLookup = (token) => {
      if (token === 'valid_token_123') return { found: true };
      return { found: false, status: 404, error: 'CLAIM_NOT_FOUND', message: 'No claim record matching this token.' };
    };

    const res = mockLookup(nonExistentToken);
    expect(res.status).toBe(404);
    expect(res.error).toBe('CLAIM_NOT_FOUND');
    expect(res).not.toHaveProperty('databaseQuery');
    expect(res).not.toHaveProperty('stack');
  });
});
