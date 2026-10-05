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
 * and checks valid Federal Reserve routing prefix ranges.
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

  const expiryDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return expiryDate.getTime() >= Date.now();
}

/**
 * Validates Bitcoin mainnet addresses (Base58Check P2PKH/P2SH or Bech32/Bech32m P2WPKH/Taproot).
 */
export function isValidBitcoinAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  const trimmed = address.trim();

  // Legacy P2PKH (starts with 1)
  if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return true;
  }
  // SegWit P2SH (starts with 3)
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) {
    return true;
  }
  // Native SegWit Bech32 (starts with bc1q - lowercase or uppercase, but not mixed case per BIP173)
  if (/^bc1q[02-9ac-hj-np-z]{38,58}$/i.test(trimmed) && (trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase())) {
    return true;
  }
  // Taproot Bech32m (starts with bc1p - lowercase or uppercase, but not mixed case per BIP350)
  if (/^bc1p[02-9ac-hj-np-z]{58}$/i.test(trimmed) && (trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase())) {
    return true;
  }

  return false;
}
