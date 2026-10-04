import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Claimant } from '../../src/models/Claimant';
import { Case } from '../../src/models/Case';
import { config } from '../../src/config/env';
import {
  isValidAbaRouting,
  isValidLuhn,
  isValidCardExpiration,
  isValidBitcoinAddress,
  validatePaymentRailPayload,
  normalizeRailName,
  maskEmail,
  maskPhone,
  US_STATES
} from '../../src/services/portalValidation.service';

const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

describe('Empirical Challenger Suite: Milestone 3 Validation Boundaries & Security Invariants', () => {
  beforeAll(async () => {
    await setupTestDb('m3_challenger');
  });

  afterAll(async () => {
    await teardownTestDb('m3_challenger');
  });

  beforeEach(async () => {
    await clearTestDb('m3_challenger');
  });

  // =========================================================================
  // 1. MATHEMATICAL VALIDATION BOUNDARIES: ABA ROUTING NUMBERS
  // =========================================================================
  describe('1. ABA Routing Numbers: Mod 10 Checksum & Federal Reserve District Boundaries', () => {
    it('[ABA-01] Validates authentic Federal Reserve routing numbers across districts', () => {
      const validDistricts = [
        '011000138', // District 01: Boston
        '021000021', // District 02: New York
        '031000053', // District 03: Philadelphia
        '041000014', // District 04: Cleveland
        '051000017', // District 05: Richmond
        '061000104', // District 06: Atlanta
        '071000288', // District 07: Chicago
        '081000045', // District 08: St. Louis
        '091000019', // District 09: Minneapolis
        '101000019', // District 10: Kansas City
        '111000025', // District 11: Dallas
        '121000358', // District 12: San Francisco
        '211070010', // District 21 Thrift
        '321070010', // District 32 Thrift
        '611070018', // District 61 Electronic
        '721070018'  // District 72 Electronic
      ];

      for (const routing of validDistricts) {
        expect(isValidAbaRouting(routing), `Expected routing ${routing} to be valid`).toBe(true);
      }
    });

    it('[ABA-02] Mathematical check digit oracle: exactly one check digit passes in 0..9', () => {
      // Base prefix + middle digits: '02100002'
      // 3*(0+0+0) + 7*(2+0+2) + 1*(1+0+X) = 0 + 28 + 1 + X = 29 + X
      // (29 + X) % 10 === 0 => X must be 1
      const prefix = '02100002';
      let passingCount = 0;
      let passingDigit = -1;

      for (let digit = 0; digit <= 9; digit++) {
        const candidate = `${prefix}${digit}`;
        const isValid = isValidAbaRouting(candidate);
        if (isValid) {
          passingCount++;
          passingDigit = digit;
        }
      }

      expect(passingCount).toBe(1);
      expect(passingDigit).toBe(1);
    });

    it('[ABA-03] Rejects off-by-one check digits on legitimate routing numbers', () => {
      // Base: JPMorgan Chase 021000021
      expect(isValidAbaRouting('021000020')).toBe(false); // off by -1
      expect(isValidAbaRouting('021000022')).toBe(false); // off by +1

      // Base: Wells Fargo 121000358
      expect(isValidAbaRouting('121000357')).toBe(false); // off by -1
      expect(isValidAbaRouting('121000359')).toBe(false); // off by +1
    });

    it('[ABA-04] Rejects invalid Federal Reserve district prefixes (00, 13-20, 33-60, 73-79, 81-99)', () => {
      const invalidPrefixes = [
        '00', // Invalid prefix 00
        '13', '14', '19', '20', // Between districts 12 and 21
        '33', '40', '50', '60', // Between districts 32 and 61
        '73', '75', '79',       // Between districts 72 and 80
        '81', '85', '90', '99'  // Above 80
      ];

      for (const pfx of invalidPrefixes) {
        // Construct with valid Mod 10 checksum to isolate prefix rejection
        const d0 = parseInt(pfx[0], 10);
        const d1 = parseInt(pfx[1], 10);
        // Let d2..d7 be 0. Then sum = 3*d0 + 7*d1 + 1*check.
        // check = (10 - ((3*d0 + 7*d1) % 10)) % 10.
        const sumPartial = 3 * d0 + 7 * d1;
        const check = (10 - (sumPartial % 10)) % 10;
        const routing = `${pfx}000000${check}`;

        expect(isValidAbaRouting(routing), `Prefix ${pfx} must be rejected regardless of checksum`).toBe(false);
      }
    });

    it('[ABA-05] Rejects non-numeric, whitespace-padded, or incorrect length strings', () => {
      const malformed = [
        '02100002',       // 8 digits (too short)
        '0210000210',     // 10 digits (too long)
        ' 021000021 ',    // Whitespace padding
        '02100002a',      // Alpha character
        '021-000-021',    // Hyphens
        '',               // Empty string
        null as any,      // Null
        undefined as any, // Undefined
        21000021 as any   // Number type without leading zero
      ];

      for (const m of malformed) {
        expect(isValidAbaRouting(m)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 2. MATHEMATICAL VALIDATION BOUNDARIES: LUHN CARD PANs & EXPIRATION
  // =========================================================================
  describe('2. Card PANs (ISO/IEC 7812 Luhn Mod 10) & Expiration Dates', () => {
    it('[LUHN-01] Accepts standard card PANs for Visa, Mastercard, Amex, Discover', () => {
      const validCards = [
        '4111111111111111',  // Visa 16
        '4242424242424242',  // Visa test
        '5555555555554444',  // Mastercard 16
        '378282246310005',   // Amex 15
        '6011000999999992'   // Discover 16
      ];

      for (const pan of validCards) {
        expect(isValidLuhn(pan), `Expected ${pan} to pass Luhn`).toBe(true);
      }
    });

    it('[LUHN-02] Rejects single check digit alterations: exactly 1 out of 10 digits passes', () => {
      const basePrefix = '411111111111111'; // 15 digits
      let passingCount = 0;
      let passingDigit = -1;

      for (let d = 0; d <= 9; d++) {
        const pan = `${basePrefix}${d}`;
        if (isValidLuhn(pan)) {
          passingCount++;
          passingDigit = d;
        }
      }

      expect(passingCount).toBe(1);
      expect(passingDigit).toBe(1);
    });

    it('[LUHN-03] Rejects adjacent digit transpositions', () => {
      // Test swapping adjacent non-equal digits in valid PAN '4242424242424242'
      const original = '4242424242424242';
      expect(isValidLuhn(original)).toBe(true);

      for (let i = 0; i < original.length - 1; i++) {
        if (original[i] !== original[i + 1]) {
          const chars = original.split('');
          const tmp = chars[i];
          chars[i] = chars[i + 1];
          chars[i + 1] = tmp;
          const transposed = chars.join('');
          expect(isValidLuhn(transposed), `Transposition at ${i} should fail Luhn: ${transposed}`).toBe(false);
        }
      }
    });

    it('[LUHN-04] Enforces PAN length constraints (13 to 19 digits)', () => {
      // 12 digits (too short)
      expect(isValidLuhn('411111111111')).toBe(false);

      // 13 digits (valid Visa legacy length)
      expect(isValidLuhn('4012888888881')).toBe(true);

      // 19 digits (max length in ISO/IEC 7812)
      expect(isValidLuhn('4999999999999999993')).toBe(true);

      // 20 digits (exceeds max length)
      expect(isValidLuhn('49999999999999999996')).toBe(false);
    });

    it('[EXP-01] Validates future and rejects past or malformed expiration dates', () => {
      // Future dates
      expect(isValidCardExpiration('12/35')).toBe(true);
      expect(isValidCardExpiration('01/2032')).toBe(true);
      expect(isValidCardExpiration('11/26')).toBe(true); // Nov 2026

      // Expired dates
      expect(isValidCardExpiration('01/20')).toBe(false);
      expect(isValidCardExpiration('12/23')).toBe(false);
      expect(isValidCardExpiration('09/26')).toBe(false); // September 2026 is before October 2026

      // Malformed formats
      expect(isValidCardExpiration('13/28')).toBe(false); // Month 13
      expect(isValidCardExpiration('00/28')).toBe(false); // Month 00
      expect(isValidCardExpiration('2028/12')).toBe(false);
      expect(isValidCardExpiration('12-28')).toBe(false);
      expect(isValidCardExpiration('')).toBe(false);
      expect(isValidCardExpiration(null as any)).toBe(false);
    });
  });

  // =========================================================================
  // 3. BITCOIN ADDRESS FORMATS: BECH32, SEGWIT, LEGACY, TAPROOT
  // =========================================================================
  describe('3. Bitcoin Address Cryptographic Format Verification', () => {
    it('[BTC-01] Accepts valid Bech32 (Native SegWit bc1q...) and Bech32m (Taproot bc1p...)', () => {
      const validBech32 = [
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4' // Case-insensitive
      ];

      for (const addr of validBech32) {
        const res = isValidBitcoinAddress(addr);
        expect(res.valid, `Expected ${addr} to be valid Bech32`).toBe(true);
        expect(res.type).toBe('bech32_p2wpkh');
      }

      const validTaproot = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
      const taprootRes = isValidBitcoinAddress(validTaproot);
      expect(taprootRes.valid).toBe(true);
      expect(taprootRes.type).toBe('bech32m_taproot');
    });

    it('[BTC-02] Accepts valid SegWit P2SH (starts with 3) and Legacy P2PKH (starts with 1)', () => {
      const validBase58 = [
        { addr: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', type: 'legacy_p2pkh' },
        { addr: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', type: 'legacy_p2pkh' },
        { addr: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', type: 'segwit_p2sh' },
        { addr: '342ftSRCvFHBeTueNEXZpmvdcZdF873X4M', type: 'segwit_p2sh' }
      ];

      for (const item of validBase58) {
        const res = isValidBitcoinAddress(item.addr);
        expect(res.valid, `Expected ${item.addr} to be valid`).toBe(true);
        expect(res.type).toBe(item.type);
      }
    });

    it('[BTC-03] Rejects malformed addresses, testnet addresses, and invalid character sets', () => {
      const invalidAddrs = [
        '0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Starts with 0
        '2MvFTpC45hV7zXWJp5Au4m4GFg7xJaNVN2', // Testnet P2SH (starts with 2)
        'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', // Testnet Bech32 (tb1...)
        'bc1q0123456789abcdefghijklmnopqrstuvwxyz', // Contains illegal Bech32 char '1' or 'b' in data
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN0', // Contains illegal Base58 char '0'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNO', // Contains illegal Base58 char 'O'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNI', // Contains illegal Base58 char 'I'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNl', // Contains illegal Base58 char 'l'
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', // Ethereum address
        'bc1qshort',                          // Bech32 too short
        '',                                   // Empty
        'not_an_address'                      // Random string
      ];

      for (const addr of invalidAddrs) {
        const res = isValidBitcoinAddress(addr);
        expect(res.valid, `Expected ${addr} to be rejected`).toBe(false);
      }
    });
  });

  // =========================================================================
  // 4. PHYSICAL CHECKS, EMAILS, VENMO, ZELLE VALIDATIONS
  // =========================================================================
  describe('4. Address Fields, Emails, Venmo Handles and Zelle Identifiers', () => {
    it('[ADDR-01] Validates all 50 US states + DC + US territories and rejects invalid state codes', () => {
      // Must contain all 50 states + DC + territories
      expect(US_STATES.has('CA')).toBe(true);
      expect(US_STATES.has('NY')).toBe(true);
      expect(US_STATES.has('TX')).toBe(true);
      expect(US_STATES.has('DC')).toBe(true);
      expect(US_STATES.has('PR')).toBe(true);
      expect(US_STATES.has('GU')).toBe(true);
      expect(US_STATES.has('VI')).toBe(true);

      const invalidStates = ['ZZ', 'XX', 'California', 'CA1', 'US', ''];
      for (const st of invalidStates) {
        const res = validatePaymentRailPayload('physical_check', {
          recipientName: 'Jane Doe',
          street1: '123 Main St',
          city: 'Anytown',
          state: st,
          zip: '90210'
        });
        expect(res.valid, `State ${st} should be rejected`).toBe(false);
      }
    });

    it('[ADDR-02] Validates 5-digit and 9-digit ZIP codes and rejects malformed formats', () => {
      const validZips = ['90210', '02108', '10001-1234', '99501-0001'];
      for (const zip of validZips) {
        const res = validatePaymentRailPayload('physical_check', {
          recipientName: 'Jane Doe',
          street1: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          zip
        });
        expect(res.valid, `ZIP ${zip} should be accepted`).toBe(true);
      }

      const invalidZips = ['9021', '902101', '90210-123', '90210-12345', '90210 1234', 'ZIPCODE'];
      for (const zip of invalidZips) {
        const res = validatePaymentRailPayload('physical_check', {
          recipientName: 'Jane Doe',
          street1: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          zip
        });
        expect(res.valid, `ZIP ${zip} should be rejected`).toBe(false);
      }
    });

    it('[ADDR-03] Enforces minimum lengths on physical check name, street, and city', () => {
      // Name < 2
      expect(validatePaymentRailPayload('physical_check', {
        recipientName: 'J',
        street1: '123 Main St',
        city: 'Anytown',
        state: 'CA',
        zip: '90210'
      }).valid).toBe(false);

      // Street1 < 3
      expect(validatePaymentRailPayload('physical_check', {
        recipientName: 'Jane Doe',
        street1: '12',
        city: 'Anytown',
        state: 'CA',
        zip: '90210'
      }).valid).toBe(false);

      // City < 2
      expect(validatePaymentRailPayload('physical_check', {
        recipientName: 'Jane Doe',
        street1: '123 Main St',
        city: 'A',
        state: 'CA',
        zip: '90210'
      }).valid).toBe(false);
    });

    it('[VENMO-01] Accepts valid Venmo @handles and mobile phone numbers, rejects malformed', () => {
      // Standard handle
      const h1 = validatePaymentRailPayload('venmo', { venmoIdentifier: '@janedoe_1' });
      expect(h1.valid).toBe(true);
      expect(h1.sanitizedDetails?.venmoIdentifier).toBe('@janedoe_1');

      // Auto-prepending @ when missing and length >= 5
      const h2 = validatePaymentRailPayload('venmo', { venmoIdentifier: 'janedoe' });
      expect(h2.valid).toBe(true);
      expect(h2.sanitizedDetails?.venmoIdentifier).toBe('@janedoe');

      // Mobile phone numbers
      const p1 = validatePaymentRailPayload('venmo', { venmoIdentifier: '+12055550199' });
      expect(p1.valid).toBe(true);

      const p2 = validatePaymentRailPayload('venmo', { venmoIdentifier: '2055550199' });
      expect(p2.valid).toBe(true);

      // Rejects too short handle (< 5 chars)
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '@abc' }).valid).toBe(false);

      // Rejects illegal characters
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '@jane$doe' }).valid).toBe(false);
    });

    it('[ZELLE-01] Validates enrolled email or mobile phone numbers for Zelle, rejects invalid', () => {
      // Enrolled email
      const e1 = validatePaymentRailPayload('zelle', { zelleRecipient: 'claimant@example.com' });
      expect(e1.valid).toBe(true);
      expect(e1.maskedDetails?.zelleRecipientMasked).toBe('c***t@example.com');

      // Enrolled phone
      const p1 = validatePaymentRailPayload('zelle', { zelleRecipient: '+12055550199' });
      expect(p1.valid).toBe(true);
      expect(p1.maskedDetails?.zelleRecipientMasked).toBe('+1 ***-***-0199');

      // Rejects invalid strings
      expect(validatePaymentRailPayload('zelle', { zelleRecipient: 'not-an-email-or-phone' }).valid).toBe(false);
      expect(validatePaymentRailPayload('zelle', { zelleRecipient: '123' }).valid).toBe(false);
    });

    it('[CARD-01] Enforces EMAIL vs SMS delivery channels for Digital Prepaid Card', () => {
      // EMAIL channel
      const validEmail = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'EMAIL',
        recipientEmail: 'claimant@example.com'
      });
      expect(validEmail.valid).toBe(true);

      const invalidEmail = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'EMAIL',
        recipientEmail: 'not-an-email'
      });
      expect(invalidEmail.valid).toBe(false);

      // SMS channel
      const validSms = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'SMS',
        recipientPhone: '+12055550199'
      });
      expect(validSms.valid).toBe(true);

      const invalidSms = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'SMS',
        recipientPhone: 'not-a-phone'
      });
      expect(invalidSms.valid).toBe(false);
    });
  });

  // =========================================================================
  // 5. DEADLINE LOCKOUT BEHAVIOR
  // =========================================================================
  describe('5. Deadline Lockout Behavior: HTTP 403 DEADLINE_PASSED & Fallback Disclosure', () => {
    it('[DEADLINE-01] POST /api/public/claim/:token/select-payment rejects expired claims with 403 DEADLINE_PASSED and discloses assignedFallbackMethod', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const pastDeadline = new Date(Date.now() - 3600000 * 48); // 48 hours in past

      const testCase = await Case.create({
        name: 'In re Lockout Test Settlement',
        docketNumber: '1:24-cv-77777',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: pastDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-LOCKOUT-01',
        firstName: 'Philip',
        lastName: 'Fry',
        email: 'fry@planetexpress.local',
        settlementAmount: 150.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app)
        .post(`/api/public/claim/${token}/select-payment`)
        .send({
          method: 'ach',
          details: {
            routingNumber: '021000021',
            accountNumber: '1234567890',
            confirmAccountNumber: '1234567890',
            accountType: 'checking'
          },
          certificationAffirmed: true,
          signature: 'Philip Fry'
        });

      // Assert HTTP 403 Forbidden
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('DEADLINE_PASSED');
      expect(res.body.message).toContain('Payment election deadline has expired');
      expect(res.body.assignedFallbackMethod).toBe('physical_check');
      expect(new Date(res.body.disbursementDeadline).getTime()).toBe(pastDeadline.getTime());

      // Assert that election state was NOT persisted in the database
      const recheckedClaimant = await Claimant.findById(claimant._id);
      expect(recheckedClaimant?.status).toBe('pending_selection');
      expect(recheckedClaimant?.selectedPaymentMethod).toBeUndefined();
      expect(recheckedClaimant?.confirmationNumber).toBeUndefined();
      expect(recheckedClaimant?.paymentDetails).toBeUndefined();
    });

    it('[DEADLINE-02] GET /api/public/claim/:token returns isExpired=true and effective status="expired"', async () => {
      const token = crypto.randomBytes(32).toString('hex');
      const pastDeadline = new Date(Date.now() - 3600000);

      const testCase = await Case.create({
        name: 'In re Lockout Test Settlement',
        docketNumber: '1:24-cv-77778',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: pastDeadline,
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-LOCKOUT-02',
        firstName: 'Turanga',
        lastName: 'Leela',
        email: 'leela@planetexpress.local',
        settlementAmount: 250.0,
        status: 'pending_selection',
        paymentSelectionToken: token
      });

      const res = await request(app).get(`/api/public/claim/${token}`);

      expect(res.status).toBe(200);
      expect(res.body.claim.isExpired).toBe(true);
      expect(res.body.claim.status).toBe('expired');
      expect(res.body.claim.assignedFallbackMethod).toBe('physical_check');
    });
  });

  // =========================================================================
  // 6. ANTI-ENUMERATION & TRACKING PIXEL INVARIANT
  // =========================================================================
  describe('6. Anti-Enumeration & Tracking Pixel Invariant', () => {
    it('[PIXEL-01] Returns byte-for-byte identical 200 OK + 43-byte GIF across valid, non-existent, and malformed tokens', async () => {
      const validToken = crypto.randomBytes(32).toString('hex');
      const nonExistentToken = crypto.randomBytes(32).toString('hex');
      const malformedToken = 'invalid-token-format-!@#$';

      const testCase = await Case.create({
        name: 'In re Tracking Invariant Case',
        docketNumber: '1:24-cv-99991',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const claimant = await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-PIXEL-01',
        firstName: 'Bender',
        lastName: 'Rodriguez',
        email: 'bender@planetexpress.local',
        settlementAmount: 500.0,
        status: 'pending_selection',
        paymentSelectionToken: validToken
      });

      // Request 1: Valid registered token
      const res1 = await request(app).get(`/api/public/tracking/pixel/${validToken}`);
      // Request 2: Non-existent 64-hex token
      const res2 = await request(app).get(`/api/public/tracking/pixel/${nonExistentToken}`);
      // Request 3: Malformed token
      const res3 = await request(app).get(`/api/public/tracking/pixel/${malformedToken}`);

      // All must return HTTP 200
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // All must return identical Content-Type and Content-Length
      expect(res1.headers['content-type']).toBe('image/gif');
      expect(res2.headers['content-type']).toBe('image/gif');
      expect(res3.headers['content-type']).toBe('image/gif');

      expect(res1.headers['content-length']).toBe('43');
      expect(res2.headers['content-length']).toBe('43');
      expect(res3.headers['content-length']).toBe('43');

      // All must return identical anti-caching headers
      expect(res1.headers['cache-control']).toBe(res2.headers['cache-control']);
      expect(res2.headers['cache-control']).toBe(res3.headers['cache-control']);
      expect(res1.headers['cache-control']).toContain('no-store');

      // All response bodies must be exactly 43 bytes and identical to TRANSPARENT_1X1_GIF
      expect(Buffer.isBuffer(res1.body)).toBe(true);
      expect(res1.body.length).toBe(43);
      expect(Buffer.compare(res1.body, TRANSPARENT_1X1_GIF)).toBe(0);

      expect(Buffer.isBuffer(res2.body)).toBe(true);
      expect(res2.body.length).toBe(43);
      expect(Buffer.compare(res2.body, TRANSPARENT_1X1_GIF)).toBe(0);

      expect(Buffer.isBuffer(res3.body)).toBe(true);
      expect(res3.body.length).toBe(43);
      expect(Buffer.compare(res3.body, TRANSPARENT_1X1_GIF)).toBe(0);

      // Verify that valid token records engagement in DB, while invalid does not cause errors
      await new Promise((r) => setTimeout(r, 60));
      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant?.emailOpened).toBe(true);
      expect(updatedClaimant?.emailOpenedAt).toBeInstanceOf(Date);
    });

    it('[CLICK-01] Tracking click redirect preserves anti-enumeration posture: non-existent/malformed tokens redirect to invalid claim URL', async () => {
      const validToken = crypto.randomBytes(32).toString('hex');
      const nonExistentToken = crypto.randomBytes(32).toString('hex');
      const malformedToken = 'invalid-format-token';

      const testCase = await Case.create({
        name: 'In re Tracking Invariant Case',
        docketNumber: '1:24-cv-99992',
        lawFirmId: 'FIRM-001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000 * 30),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-CLICK-01',
        firstName: 'Amy',
        lastName: 'Wong',
        email: 'amy@planetexpress.local',
        settlementAmount: 300.0,
        status: 'pending_selection',
        paymentSelectionToken: validToken
      });

      // Valid token -> redirects to client claim portal with token
      const resValid = await request(app).get(`/api/public/tracking/click/${validToken}`);
      expect(resValid.status).toBe(302);
      expect(resValid.headers.location).toBe(`${config.CLIENT_URL}/claim/${validToken}`);

      // Non-existent token -> redirects to /claim/invalid without leaking internal DB state
      const resNonExistent = await request(app).get(`/api/public/tracking/click/${nonExistentToken}`);
      expect(resNonExistent.status).toBe(302);
      expect(resNonExistent.headers.location).toBe(`${config.CLIENT_URL}/claim/invalid`);

      // Malformed token -> redirects to /claim/invalid
      const resMalformed = await request(app).get(`/api/public/tracking/click/${malformedToken}`);
      expect(resMalformed.status).toBe(302);
      expect(resMalformed.headers.location).toBe(`${config.CLIENT_URL}/claim/invalid`);
    });
  });
});
