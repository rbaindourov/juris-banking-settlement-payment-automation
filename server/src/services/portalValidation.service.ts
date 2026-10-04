import crypto from 'node:crypto';
import { config } from '../config/env';
import { PaymentRail } from '../models/Claimant';

export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP'
]);

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
export const US_PHONE_REGEX = /^\+?1?[2-9]\d{2}[2-9]\d{6}$/;
export const ZIP_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Validates 9-digit ABA Routing Transit Number using Federal Reserve Mod 10 Checksum:
 * [3*(d1+d4+d7) + 7*(d2+d5+d8) + 1*(d3+d6+d9)] % 10 === 0
 * and verifies Federal Reserve routing prefix ranges.
 */
export function isValidAbaRouting(routing: string): boolean {
  if (typeof routing !== 'string' || !/^\d{9}$/.test(routing)) {
    return false;
  }

  const prefix = parseInt(routing.substring(0, 2), 10);
  const isValidPrefix =
    (prefix >= 1 && prefix <= 12) ||
    (prefix >= 21 && prefix <= 32) ||
    (prefix >= 61 && prefix <= 72) ||
    prefix === 80;

  if (!isValidPrefix) {
    return false;
  }

  const d = routing.split('').map(Number);
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    1 * (d[2] + d[5] + d[8]);

  return checksum % 10 === 0;
}

/**
 * Validates card Primary Account Number (PAN) using Luhn Mod 10 Algorithm (ISO/IEC 7812).
 */
export function isValidLuhn(pan: string): boolean {
  if (typeof pan !== 'string') return false;
  const cleaned = pan.replace(/\D/g, '');
  if (cleaned.length < 13 || cleaned.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned.charAt(i), 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Validates future card expiration (MM/YY or MM/YYYY).
 */
export function isValidCardExpiration(exp: string): boolean {
  if (typeof exp !== 'string') return false;
  const match = exp.trim().match(/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/);
  if (!match) return false;

  const month = parseInt(match[1], 10);
  const yearStr = match[2];
  const year = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);

  // Month in JS is 0-indexed, Date(year, month, 0) gives last day of month
  const expiryDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return expiryDate.getTime() >= Date.now();
}

/**
 * Validates Bitcoin mainnet addresses (Base58Check P2PKH/P2SH or Bech32/Bech32m P2WPKH/Taproot).
 */
export function isValidBitcoinAddress(address: string): { valid: boolean; type?: string } {
  if (typeof address !== 'string') return { valid: false };
  const trimmed = address.trim();

  // Legacy P2PKH (starts with 1)
  if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return { valid: true, type: 'legacy_p2pkh' };
  }
  // SegWit P2SH (starts with 3)
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return { valid: true, type: 'segwit_p2sh' };
  }
  // Native SegWit Bech32 (starts with bc1q)
  if (/^bc1q[02-9ac-hj-np-z]{38,58}$/i.test(trimmed)) {
    return { valid: true, type: 'bech32_p2wpkh' };
  }
  // Taproot Bech32m (starts with bc1p)
  if (/^bc1p[02-9ac-hj-np-z]{58}$/i.test(trimmed)) {
    return { valid: true, type: 'bech32m_taproot' };
  }

  return { valid: false };
}

/**
 * Normalizes payment rail name string into canonical PaymentRail enum.
 */
export function normalizeRailName(method: string): PaymentRail {
  const m = (method || '').toLowerCase().trim();
  if (m === 'direct_deposit' || m === 'ach') return 'ach';
  if (m === 'push_to_debit' || m === 'debit_card') return 'debit_card';
  if (m === 'prepaid' || m === 'digital_card') return 'digital_card';
  if (m === 'check' || m === 'physical_check') return 'physical_check';
  if (m === 'paypal') return 'paypal';
  if (m === 'venmo') return 'venmo';
  if (m === 'zelle') return 'zelle';
  if (m === 'bitcoin' || m === 'btc') return 'bitcoin';
  throw new Error(`Unsupported payment rail: ${method}`);
}

/**
 * Encrypts sensitive string using AES-256-GCM.
 */
export function encryptAes256Gcm(plaintext: string, secretKey = config.ENCRYPTION_KEY || config.JWT_SECRET): string {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(secretKey).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM payload.
 */
export function decryptAes256Gcm(payload: string, secretKey = config.ENCRYPTION_KEY || config.JWT_SECRET): string {
  const [ivHex, authTagHex, encryptedHex] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.createHash('sha256').update(secretKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Masks sensitive email address (e.g. e***e@example.com).
 */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  if (user.length <= 2) return `${user.charAt(0)}***@${domain}`;
  return `${user.charAt(0)}***${user.charAt(user.length - 1)}@${domain}`;
}

/**
 * Masks phone number (e.g. +1 ***-***-0199).
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const last4 = digits.slice(-4);
  return `+1 ***-***-${last4}`;
}

/**
 * Generates unique confirmation number: CONF-${YYYY}-${CODE}-${RANDOM}
 */
export function generateConfirmationNumber(caseNameOrDocket?: string, date = new Date()): string {
  const year = date.getUTCFullYear();
  let code = 'JUR';
  if (caseNameOrDocket) {
    const cleaned = caseNameOrDocket.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleaned.length >= 4) {
      code = cleaned.substring(0, 4);
    }
  }
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CONF-${year}-${code}-${randomSuffix}`;
}

export interface RailValidationResult {
  valid: boolean;
  error?: string;
  sanitizedDetails?: Record<string, any>;
  maskedDetails?: Record<string, any>;
}

/**
 * Comprehensive mathematical and structural validator for all 9 payment rails.
 */
export function validatePaymentRailPayload(
  rawMethod: string,
  details: Record<string, any>,
  claimantName?: string
): RailValidationResult {
  let rail: PaymentRail;
  try {
    rail = normalizeRailName(rawMethod);
  } catch (err: any) {
    return { valid: false, error: err.message };
  }

  if (!details || typeof details !== 'object') {
    return { valid: false, error: 'Payment details object is required.' };
  }

  switch (rail) {
    case 'ach':
    case 'direct_deposit': {
      const routing = String(details.routingNumber || '').trim();
      const account = String(details.accountNumber || '').trim();
      const confirmAccount = String(details.confirmAccountNumber || '').trim();
      const accountType = String(details.accountType || '').toLowerCase().trim();

      if (!isValidAbaRouting(routing)) {
        return { valid: false, error: 'Invalid ABA routing transit number.' };
      }
      if (!/^\d{4,17}$/.test(account)) {
        return { valid: false, error: 'Account number must be between 4 and 17 numeric digits.' };
      }
      if (confirmAccount && account !== confirmAccount) {
        return { valid: false, error: 'Account numbers do not match.' };
      }
      if (accountType !== 'checking' && accountType !== 'savings') {
        return { valid: false, error: 'Account type must be either checking or savings.' };
      }

      const encryptedAccountNumber = encryptAes256Gcm(account);
      const accountNumberMasked = `******${account.slice(-4)}`;

      return {
        valid: true,
        sanitizedDetails: {
          routingNumber: routing,
          encryptedAccountNumber,
          accountNumberMasked,
          accountType,
          bankName: details.bankName ? String(details.bankName).trim() : undefined
        },
        maskedDetails: {
          routingNumber: routing,
          accountNumberMasked,
          accountType,
          bankName: details.bankName ? String(details.bankName).trim() : undefined
        }
      };
    }

    case 'digital_card': {
      const deliveryChannel = String(details.deliveryChannel || 'EMAIL').toUpperCase().trim();
      if (deliveryChannel !== 'EMAIL' && deliveryChannel !== 'SMS') {
        return { valid: false, error: 'Delivery channel must be EMAIL or SMS.' };
      }

      const email = details.recipientEmail ? String(details.recipientEmail).trim().toLowerCase() : '';
      const phone = details.recipientPhone ? String(details.recipientPhone).trim() : '';

      if (deliveryChannel === 'EMAIL') {
        if (!email || !EMAIL_REGEX.test(email)) {
          return { valid: false, error: 'Valid recipient email address is required for digital card delivery.' };
        }
      } else {
        if (!phone || (!E164_PHONE_REGEX.test(phone) && !US_PHONE_REGEX.test(phone))) {
          return { valid: false, error: 'Valid recipient mobile phone number is required for digital card delivery.' };
        }
      }

      const cardBrand = String(details.cardBrand || 'MASTERCARD').toUpperCase().trim();
      const cardholderName = String(details.cardholderName || claimantName || '').trim();

      return {
        valid: true,
        sanitizedDetails: {
          deliveryChannel,
          recipientEmail: email || undefined,
          recipientPhone: phone || undefined,
          cardBrand,
          cardholderName
        },
        maskedDetails: {
          deliveryChannel,
          recipientEmailMasked: email ? maskEmail(email) : undefined,
          recipientPhoneMasked: phone ? maskPhone(phone) : undefined,
          cardBrand,
          cardholderName
        }
      };
    }

    case 'debit_card': {
      const cardholderName = String(details.cardholderName || claimantName || '').trim();
      const cardNumber = String(details.cardNumber || '').replace(/\D/g, '');
      const expirationDate = String(details.expirationDate || '').trim();
      const cvv = String(details.cvv || '').trim();
      const billingZip = String(details.billingZip || '').trim();

      if (cardholderName.length < 2) {
        return { valid: false, error: 'Cardholder name must be at least 2 characters.' };
      }
      if (!isValidLuhn(cardNumber)) {
        return { valid: false, error: 'Invalid card number (fails Luhn check digit).' };
      }
      if (!isValidCardExpiration(expirationDate)) {
        return { valid: false, error: 'Card expiration date is invalid or in the past (MM/YY).' };
      }
      if (!/^\d{3,4}$/.test(cvv)) {
        return { valid: false, error: 'CVV must be 3 or 4 digits.' };
      }
      if (!ZIP_REGEX.test(billingZip)) {
        return { valid: false, error: 'Invalid billing ZIP code.' };
      }

      const cardLast4 = cardNumber.slice(-4);
      let cardBrand = 'DEBIT';
      if (cardNumber.startsWith('4')) cardBrand = 'VISA';
      else if (/^5[1-5]/.test(cardNumber) || /^2[2-7]/.test(cardNumber)) cardBrand = 'MASTERCARD';
      else if (/^3[47]/.test(cardNumber)) cardBrand = 'AMEX';
      else if (/^6011/.test(cardNumber)) cardBrand = 'DISCOVER';

      const tokenRef = `tok_debit_${crypto.randomBytes(8).toString('hex')}`;

      // CRITICAL: NEVER PERSIST CVV OR FULL PAN
      return {
        valid: true,
        sanitizedDetails: {
          cardholderName,
          cardLast4,
          cardBrand,
          expirationDate,
          billingZip,
          tokenRef
        },
        maskedDetails: {
          cardholderName,
          cardLast4: `**** **** **** ${cardLast4}`,
          cardBrand,
          billingZip
        }
      };
    }

    case 'physical_check': {
      const recipientName = String(details.recipientName || claimantName || '').trim();
      const street1 = String(details.street1 || '').trim();
      const street2 = details.street2 ? String(details.street2).trim() : '';
      const city = String(details.city || '').trim();
      const state = String(details.state || '').toUpperCase().trim();
      const zip = String(details.zip || '').trim();

      if (recipientName.length < 2) {
        return { valid: false, error: 'Recipient name is required.' };
      }
      if (street1.length < 3) {
        return { valid: false, error: 'Street address line 1 must be at least 3 characters.' };
      }
      if (city.length < 2) {
        return { valid: false, error: 'City is required.' };
      }
      if (!US_STATES.has(state)) {
        return { valid: false, error: 'State must be a valid 2-letter US postal state/territory abbreviation.' };
      }
      if (!ZIP_REGEX.test(zip)) {
        return { valid: false, error: 'ZIP code must be a valid 5-digit or 9-digit US ZIP.' };
      }

      return {
        valid: true,
        sanitizedDetails: {
          recipientName,
          street1,
          street2: street2 || undefined,
          city,
          state,
          zip,
          country: 'US'
        },
        maskedDetails: {
          recipientName,
          street1,
          street2: street2 || undefined,
          city,
          state,
          zip,
          country: 'US'
        }
      };
    }

    case 'paypal': {
      const account = String(details.paypalAccount || details.recipient || '').trim();
      const isEmail = EMAIL_REGEX.test(account);
      const isPhone = E164_PHONE_REGEX.test(account) || US_PHONE_REGEX.test(account);

      if (!isEmail && !isPhone) {
        return { valid: false, error: 'PayPal account must be a valid email address or phone number.' };
      }

      return {
        valid: true,
        sanitizedDetails: {
          paypalAccount: account
        },
        maskedDetails: {
          paypalAccountMasked: isEmail ? maskEmail(account) : maskPhone(account)
        }
      };
    }

    case 'venmo': {
      let identifier = String(details.venmoIdentifier || details.handle || details.phone || '').trim();
      if (!identifier.startsWith('@') && !/^\+?\d+$/.test(identifier) && identifier.length >= 5) {
        identifier = `@${identifier}`;
      }

      const isHandle = /^@[a-zA-Z0-9_-]{5,30}$/.test(identifier);
      const isPhone = E164_PHONE_REGEX.test(identifier) || US_PHONE_REGEX.test(identifier);

      if (!isHandle && !isPhone) {
        return { valid: false, error: 'Venmo identifier must be a valid handle (@username, 5-30 chars) or mobile phone.' };
      }

      return {
        valid: true,
        sanitizedDetails: {
          venmoIdentifier: identifier
        },
        maskedDetails: {
          venmoIdentifierMasked: isHandle
            ? `@${identifier.charAt(1)}***${identifier.charAt(identifier.length - 1)}`
            : maskPhone(identifier)
        }
      };
    }

    case 'zelle': {
      const recipient = String(details.zelleRecipient || details.recipient || '').trim();
      const isEmail = EMAIL_REGEX.test(recipient);
      const isPhone = E164_PHONE_REGEX.test(recipient) || US_PHONE_REGEX.test(recipient);

      if (!isEmail && !isPhone) {
        return { valid: false, error: 'Zelle recipient must be a valid enrolled email or mobile phone.' };
      }

      return {
        valid: true,
        sanitizedDetails: {
          zelleRecipient: recipient
        },
        maskedDetails: {
          zelleRecipientMasked: isEmail ? maskEmail(recipient) : maskPhone(recipient)
        }
      };
    }

    case 'bitcoin': {
      const address = String(details.bitcoinAddress || details.address || '').trim();
      const check = isValidBitcoinAddress(address);

      if (!check.valid) {
        return { valid: false, error: 'Invalid Bitcoin address (must be valid Base58 or Bech32 mainnet address).' };
      }

      const maskedAddress =
        address.length > 8 ? `${address.substring(0, 4)}...${address.substring(address.length - 4)}` : address;

      return {
        valid: true,
        sanitizedDetails: {
          bitcoinAddress: address,
          addressType: check.type
        },
        maskedDetails: {
          bitcoinAddressMasked: maskedAddress,
          addressType: check.type
        }
      };
    }

    default:
      return { valid: false, error: `Unsupported payment rail: ${rail}` };
  }
}
