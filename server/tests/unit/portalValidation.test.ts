import { describe, it, expect } from 'vitest';
import {
  isValidAbaRouting,
  isValidLuhn,
  isValidCardExpiration,
  isValidBitcoinAddress,
  validatePaymentRailPayload,
  encryptAes256Gcm,
  decryptAes256Gcm,
  generateConfirmationNumber,
  normalizeRailName,
  maskEmail,
  maskPhone
} from '../../src/services/portalValidation.service';

describe('Portal Payment Rails Validation & Cryptography Unit Tests', () => {
  describe('ABA Routing Mod 10 & District Validation', () => {
    it('accepts valid Federal Reserve routing transit numbers across districts', () => {
      const validRoutings = [
        '021000021', // JPMorgan Chase NY (District 02)
        '121000358', // Wells Fargo CA (District 12)
        '071000288', // Chase Bank IL (District 07)
        '111000025', // Bank of America TX (District 11)
        '011000138'  // Bank of America MA (District 01)
      ];
      for (const routing of validRoutings) {
        expect(isValidAbaRouting(routing)).toBe(true);
      }
    });

    it('rejects invalid routing transit numbers (invalid check digits, prefixes, formats)', () => {
      const invalidRoutings = [
        '021000022', // Off-by-one check digit
        '123456789', // Invalid Mod 10
        '000000000', // Invalid prefix 00
        '999999999', // Invalid prefix 99
        '02100002',  // Too short (8 digits)
        '0210000210',// Too long (10 digits)
        'abcdefghi'  // Non-numeric
      ];
      for (const routing of invalidRoutings) {
        expect(isValidAbaRouting(routing)).toBe(false);
      }
    });
  });

  describe('Luhn Mod 10 Algorithm (ISO/IEC 7812)', () => {
    it('accepts valid card PANs', () => {
      const validPans = [
        '4111111111111111', // Visa
        '4242424242424242', // Visa test
        '5555555555554444', // Mastercard
        '378282246310005'   // Amex (15 digits)
      ];
      for (const pan of validPans) {
        expect(isValidLuhn(pan)).toBe(true);
      }
    });

    it('rejects invalid card PANs (off-by-one check digit, length out of bounds)', () => {
      const invalidPans = [
        '4111111111111112', // Off by one
        '4000000000000000', // Fails Mod 10
        '1234567890123456', // Random non-Luhn
        '4111',             // Too short (<13)
        '41111111111111111111' // Too long (>19)
      ];
      for (const pan of invalidPans) {
        expect(isValidLuhn(pan)).toBe(false);
      }
    });
  });

  describe('Card Expiration Date Verification', () => {
    it('accepts future expiration dates in MM/YY format', () => {
      expect(isValidCardExpiration('12/35')).toBe(true);
      expect(isValidCardExpiration('01/2032')).toBe(true);
    });

    it('rejects past expiration dates or malformed formats', () => {
      expect(isValidCardExpiration('01/20')).toBe(false);
      expect(isValidCardExpiration('13/28')).toBe(false); // Invalid month 13
      expect(isValidCardExpiration('00/28')).toBe(false); // Invalid month 00
      expect(isValidCardExpiration('invalid')).toBe(false);
    });
  });

  describe('Bitcoin Address Cryptographic Verification', () => {
    it('accepts valid Base58Check and Bech32 mainnet Bitcoin addresses', () => {
      const validBtc = [
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Legacy P2PKH (starts with 1)
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', // SegWit P2SH (starts with 3)
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Native SegWit Bech32 (starts with bc1q)
        'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ', // Native SegWit Bech32 uppercase (BIP173 compliant)
        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0' // Taproot Bech32m (starts with bc1p)
      ];
      for (const addr of validBtc) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(true);
      }
    });

    it('rejects invalid Bitcoin addresses', () => {
      const invalidBtc = [
        '0A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Starts with 0
        'bc1invalid', // Too short
        '2MvFTpC45hV7zXWJp...', // Testnet prefix
        'bc1qAR0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Mixed-case Bech32 (rejected per BIP173)
        'BC1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Mixed-case Bech32 (rejected per BIP173)
        'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5JJ0', // Mixed-case Bech32m (rejected per BIP350)
        ''
      ];
      for (const addr of invalidBtc) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });
  });

  describe('All 9 Payment Rails Validation via validatePaymentRailPayload', () => {
    it('validates Rail 1: ACH / Direct Deposit with matching account numbers', () => {
      const validPayload = {
        routingNumber: '021000021',
        accountNumber: '9988776655',
        confirmAccountNumber: '9988776655',
        accountType: 'checking',
        bankName: 'JPMorgan Chase'
      };
      const res = validatePaymentRailPayload('ach', validPayload);
      expect(res.valid).toBe(true);
      expect(res.sanitizedDetails?.routingNumber).toBe('021000021');
      expect(res.sanitizedDetails?.accountNumberMasked).toBe('******6655');
      expect(res.sanitizedDetails?.encryptedAccountNumber).toBeDefined();

      // Mismatched accounts
      const mismatchRes = validatePaymentRailPayload('ach', {
        ...validPayload,
        confirmAccountNumber: '9988776654'
      });
      expect(mismatchRes.valid).toBe(false);
      expect(mismatchRes.error).toContain('do not match');
    });

    it('validates Rail 2: Digital Prepaid Card (EMAIL and SMS channels)', () => {
      const emailRes = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'EMAIL',
        recipientEmail: 'claimant@example.com',
        cardBrand: 'MASTERCARD'
      });
      expect(emailRes.valid).toBe(true);
      expect(emailRes.maskedDetails?.recipientEmailMasked).toBe('c***t@example.com');

      const smsRes = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'SMS',
        recipientPhone: '+12055550199',
        cardBrand: 'VISA'
      });
      expect(smsRes.valid).toBe(true);
      expect(smsRes.maskedDetails?.recipientPhoneMasked).toBe('+1 ***-***-0199');

      const badEmailRes = validatePaymentRailPayload('digital_card', {
        deliveryChannel: 'EMAIL',
        recipientEmail: 'not-an-email'
      });
      expect(badEmailRes.valid).toBe(false);
    });

    it('validates Rail 3: Push to Debit Card (Luhn check, zero CVV storage)', () => {
      const debitRes = validatePaymentRailPayload('debit_card', {
        cardholderName: 'Eleanor Vance',
        cardNumber: '4111 1111 1111 1111',
        expirationDate: '12/35',
        cvv: '123',
        billingZip: '02108'
      });
      expect(debitRes.valid).toBe(true);
      expect(debitRes.sanitizedDetails?.cardLast4).toBe('1111');
      expect(debitRes.sanitizedDetails?.cvv).toBeUndefined(); // CVV is NEVER stored
      expect(debitRes.maskedDetails?.cardLast4).toBe('**** **** **** 1111');

      // Fails on non-Luhn card number
      const badDebitRes = validatePaymentRailPayload('debit_card', {
        cardholderName: 'Eleanor Vance',
        cardNumber: '4111 1111 1111 1112',
        expirationDate: '12/35',
        cvv: '123',
        billingZip: '02108'
      });
      expect(badDebitRes.valid).toBe(false);
      expect(badDebitRes.error).toContain('Luhn');
    });

    it('validates Rail 4: Mailed Physical Check (State & ZIP codes)', () => {
      const checkRes = validatePaymentRailPayload('physical_check', {
        recipientName: 'Eleanor Vance',
        street1: '456 Hilltop Road',
        street2: 'Suite 2B',
        city: 'Boston',
        state: 'MA',
        zip: '02108'
      });
      expect(checkRes.valid).toBe(true);
      expect(checkRes.sanitizedDetails?.state).toBe('MA');

      // Fails on non-US state
      const badStateRes = validatePaymentRailPayload('physical_check', {
        recipientName: 'Eleanor Vance',
        street1: '456 Hilltop Road',
        city: 'Boston',
        state: 'ZZ',
        zip: '02108'
      });
      expect(badStateRes.valid).toBe(false);
    });

    it('validates Rail 5: PayPal (email and phone)', () => {
      const emailRes = validatePaymentRailPayload('paypal', { paypalAccount: 'eleanor@example.com' });
      expect(emailRes.valid).toBe(true);
      expect(emailRes.maskedDetails?.paypalAccountMasked).toBe('e***r@example.com');

      const phoneRes = validatePaymentRailPayload('paypal', { paypalAccount: '+12055550199' });
      expect(phoneRes.valid).toBe(true);

      const badRes = validatePaymentRailPayload('paypal', { paypalAccount: 'bad-input' });
      expect(badRes.valid).toBe(false);
    });

    it('validates Rail 6: Venmo (handle and phone)', () => {
      const handleRes = validatePaymentRailPayload('venmo', { venmoIdentifier: '@eleanor_vance' });
      expect(handleRes.valid).toBe(true);

      const phoneRes = validatePaymentRailPayload('venmo', { venmoIdentifier: '+12055550199' });
      expect(phoneRes.valid).toBe(true);

      const badRes = validatePaymentRailPayload('venmo', { venmoIdentifier: 'hi' }); // Too short
      expect(badRes.valid).toBe(false);
    });

    it('validates Rail 7: Zelle (enrolled email and phone)', () => {
      const zelleRes = validatePaymentRailPayload('zelle', { zelleRecipient: 'eleanor@example.com' });
      expect(zelleRes.valid).toBe(true);

      const badRes = validatePaymentRailPayload('zelle', { zelleRecipient: 'invalid' });
      expect(badRes.valid).toBe(false);
    });

    it('validates Rail 8: Bitcoin (valid Base58 / Bech32)', () => {
      const btcRes = validatePaymentRailPayload('bitcoin', {
        bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
      });
      expect(btcRes.valid).toBe(true);
      expect(btcRes.maskedDetails?.bitcoinAddressMasked).toContain('bc1q...5mdq');

      const badRes = validatePaymentRailPayload('bitcoin', { bitcoinAddress: 'not-btc-address' });
      expect(badRes.valid).toBe(false);
    });
  });

  describe('AES-256-GCM Sensitive Data Encryption', () => {
    it('encrypts and decrypts account numbers accurately with authentication tag', () => {
      const plaintext = '98765432109876';
      const encrypted = encryptAes256Gcm(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

      const decrypted = decryptAes256Gcm(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('throws error when ciphertext or auth tag is tampered with', () => {
      const encrypted = encryptAes256Gcm('123456789');
      const parts = encrypted.split(':');
      parts[1] = '00'.repeat(16); // Tampered authTag
      const tampered = parts.join(':');

      expect(() => decryptAes256Gcm(tampered)).toThrow();
    });
  });

  describe('Confirmation Number Generator', () => {
    it('produces confirmation numbers matching ^CONF-\\d{4}- format', () => {
      const confNum = generateConfirmationNumber('In re Hill House Settlement', new Date('2026-10-04T12:00:00Z'));
      expect(confNum).toMatch(/^CONF-2026-INRE-[A-F0-9]{4}$/);
    });
  });

  describe('Normalization and Masking Utilities', () => {
    it('normalizes rail aliases correctly', () => {
      expect(normalizeRailName('direct_deposit')).toBe('ach');
      expect(normalizeRailName('ach')).toBe('ach');
      expect(normalizeRailName('push_to_debit')).toBe('debit_card');
      expect(normalizeRailName('check')).toBe('physical_check');
      expect(normalizeRailName('btc')).toBe('bitcoin');
    });

    it('masks email and phone numbers safely', () => {
      expect(maskEmail('alice@example.com')).toBe('a***e@example.com');
      expect(maskPhone('2055550199')).toBe('+1 ***-***-0199');
    });
  });
});
