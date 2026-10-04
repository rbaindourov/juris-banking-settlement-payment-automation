/**
 * Juris Banking - Authoritative Verification Oracles
 * Mathematically derived, specification-compliant reference checkers.
 */

const crypto = require('node:crypto');

/**
 * Validates 9-digit ABA Routing Transit Number using Federal Reserve Mod 10 Checksum:
 * [3*(d1+d4+d7) + 7*(d2+d5+d8) + 1*(d3+d6+d9)] % 10 === 0
 * and checks valid Federal Reserve routing prefix ranges.
 */
function isValidAbaRouting(routing) {
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
function isValidLuhn(pan) {
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
 * Parses RFC 4180 CSV line into fields, handling quotes and commas.
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Validates Dash Solutions Outbound Batch CSV layout and control totals.
 */
function validateDashBatchCsv(csvContent) {
  const lines = csvContent.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { valid: false, error: 'Batch must contain at least a Header and Trailer record' };
  }

  const headerLine = lines[0];
  const trailerLine = lines[lines.length - 1];
  const detailLines = lines.slice(1, lines.length - 1);

  // Validate Header
  const headerFields = parseCsvLine(headerLine);
  if (headerFields[0] !== 'HEADER') {
    return { valid: false, error: `First line must be HEADER record, got "${headerFields[0]}"` };
  }
  if (headerFields[1] !== 'DASH_SFTP_V2.0') {
    return { valid: false, error: `Header spec version must be DASH_SFTP_V2.0, got "${headerFields[1]}"` };
  }
  if (headerFields[7] !== 'PRODUCTION' && headerFields[7] !== 'TEST') {
    return { valid: false, error: `Header environment must be PRODUCTION or TEST, got "${headerFields[7]}"` };
  }
  if (headerFields[8] !== 'USD') {
    return { valid: false, error: `Header currency must be USD, got "${headerFields[8]}"` };
  }

  const declaredHeaderCount = parseInt(headerFields[9], 10);
  const declaredHeaderSum = parseFloat(headerFields[10]);

  if (detailLines.length < 1) {
    return { valid: false, error: 'MIN_RECORDS: Outbound batch must contain at least 1 detail record' };
  }

  // Validate Details
  let totalDetailAmount = 0;
  let countAch = 0;
  let amountAch = 0;
  let countCard = 0;
  let amountCard = 0;
  let countDebit = 0;
  let amountDebit = 0;
  let countCheck = 0;
  let amountCheck = 0;
  let routingSum = 0;

  const validMethods = ['ACH', 'DIGITAL_CARD', 'PUSH_DEBIT', 'PHYSICAL_CHECK'];
  const detailRecords = [];

  for (let i = 0; i < detailLines.length; i++) {
    const fields = parseCsvLine(detailLines[i]);
    if (fields[0] !== 'DETAIL') {
      return { valid: false, error: `Line ${i + 2} must be DETAIL record, got "${fields[0]}"` };
    }
    const method = fields[1];
    if (!validMethods.includes(method)) {
      return { valid: false, error: `Line ${i + 2} invalid payment method "${method}"` };
    }
    const amount = parseFloat(fields[6]);
    if (isNaN(amount) || amount <= 0) {
      return { valid: false, error: `Line ${i + 2} invalid amount "${fields[6]}"` };
    }

    totalDetailAmount += amount;

    if (method === 'ACH') {
      countAch++;
      amountAch += amount;
      const routing = fields[9];
      if (!isValidAbaRouting(routing)) {
        return { valid: false, error: `Line ${i + 2} invalid ABA routing number "${routing}"` };
      }
      routingSum = (routingSum + parseInt(routing, 10)) % 10000000000;
    } else if (method === 'DIGITAL_CARD') {
      countCard++;
      amountCard += amount;
      const brand = fields[9];
      if (brand !== 'MASTERCARD' && brand !== 'VISA') {
        return { valid: false, error: `Line ${i + 2} invalid card brand "${brand}"` };
      }
    } else if (method === 'PUSH_DEBIT') {
      countDebit++;
      amountDebit += amount;
    } else if (method === 'PHYSICAL_CHECK') {
      countCheck++;
      amountCheck += amount;
      const state = fields[13];
      if (!/^[A-Z]{2}$/.test(state)) {
        return { valid: false, error: `Line ${i + 2} invalid US state code "${state}"` };
      }
    }

    detailRecords.push({
      line: i + 2,
      method,
      claimId: fields[2],
      claimantId: fields[3],
      amount,
      reference: fields[8],
    });
  }

  // Validate Trailer
  const trailerFields = parseCsvLine(trailerLine);
  if (trailerFields[0] !== 'TRAILER') {
    return { valid: false, error: `Last line must be TRAILER record, got "${trailerFields[0]}"` };
  }

  const totalRecords = parseInt(trailerFields[1], 10);
  const totalAmount = parseFloat(trailerFields[2]);
  const tCountAch = parseInt(trailerFields[3], 10);
  const tAmountAch = parseFloat(trailerFields[4]);
  const tCountCard = parseInt(trailerFields[5], 10);
  const tAmountCard = parseFloat(trailerFields[6]);
  const tCountDebit = parseInt(trailerFields[7], 10);
  const tAmountDebit = parseFloat(trailerFields[8]);
  const tCountCheck = parseInt(trailerFields[9], 10);
  const tAmountCheck = parseFloat(trailerFields[10]);

  // Invariant Control Checks
  if (totalRecords !== detailLines.length) {
    return { valid: false, error: `Trailer record count ${totalRecords} does not match details count ${detailLines.length}` };
  }
  if (declaredHeaderCount !== totalRecords) {
    return { valid: false, error: `Header declared count ${declaredHeaderCount} does not match trailer total ${totalRecords}` };
  }
  if (Math.abs(totalAmount - totalDetailAmount) > 0.01) {
    return { valid: false, error: `Trailer total amount ${totalAmount} does not match sum of details ${totalDetailAmount.toFixed(2)}` };
  }
  if (Math.abs(declaredHeaderSum - totalAmount) > 0.01) {
    return { valid: false, error: `Header declared sum ${declaredHeaderSum} does not match trailer sum ${totalAmount}` };
  }
  if (tCountAch !== countAch || Math.abs(tAmountAch - amountAch) > 0.01) {
    return { valid: false, error: `ACH control totals mismatch: trailer has (${tCountAch}, $${tAmountAch}), calculated (${countAch}, $${amountAch.toFixed(2)})` };
  }
  if (tCountCard !== countCard || Math.abs(tAmountCard - amountCard) > 0.01) {
    return { valid: false, error: `Card control totals mismatch: trailer has (${tCountCard}, $${tAmountCard}), calculated (${countCard}, $${amountCard.toFixed(2)})` };
  }
  if (tCountDebit !== countDebit || Math.abs(tAmountDebit - amountDebit) > 0.01) {
    return { valid: false, error: `Debit control totals mismatch: trailer has (${tCountDebit}, $${tAmountDebit}), calculated (${countDebit}, $${amountDebit.toFixed(2)})` };
  }
  if (tCountCheck !== countCheck || Math.abs(tAmountCheck - amountCheck) > 0.01) {
    return { valid: false, error: `Check control totals mismatch: trailer has (${tCountCheck}, $${tAmountCheck}), calculated (${countCheck}, $${amountCheck.toFixed(2)})` };
  }

  return {
    valid: true,
    totalRecords,
    totalAmount,
    breakdown: {
      ach: { count: countAch, amount: amountAch },
      card: { count: countCard, amount: amountCard },
      debit: { count: countDebit, amount: amountDebit },
      check: { count: countCheck, amount: amountCheck },
    },
    detailRecords,
  };
}

/**
 * Verifies SHA-256 companion file checksum.
 */
function validateSha256Checksum(content, companionShaContent, expectedFilename) {
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');
  const cleaned = companionShaContent.trim();
  const parts = cleaned.split(/\s+/);
  const declaredHash = parts[0];
  const declaredFile = parts[1];

  if (declaredHash.toLowerCase() !== actualHash.toLowerCase()) {
    return {
      valid: false,
      error: `SHA-256 mismatch: expected ${actualHash}, declared ${declaredHash}`,
    };
  }

  if (expectedFilename && declaredFile && !declaredFile.endsWith(expectedFilename)) {
    return {
      valid: false,
      error: `Companion file declared filename "${declaredFile}" does not match "${expectedFilename}"`,
    };
  }

  return { valid: true, hash: actualHash };
}

/**
 * Validates Dash Inbound Reconciliation Report format.
 */
function validateReconciliationReport(csvContent) {
  const lines = csvContent.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { valid: false, error: 'Reconciliation report must contain header and at least 1 record' };
  }

  const expectedHeaders = [
    'REPORT_ID', 'BATCH_ID', 'CLAIM_ID', 'PAYMENT_REFERENCE',
    'PAYMENT_METHOD', 'AMOUNT', 'CURRENCY', 'STATUS',
    'DASH_REFERENCE_ID', 'SETTLEMENT_DATE', 'PROCESSED_TIMESTAMP',
    'ERROR_CODE', 'ERROR_MESSAGE', 'FAILURE_REASON'
  ];

  const headerFields = parseCsvLine(lines[0]);
  for (let i = 0; i < expectedHeaders.length; i++) {
    if (headerFields[i] !== expectedHeaders[i]) {
      return { valid: false, error: `Reconciliation header mismatch at col ${i}: expected "${expectedHeaders[i]}", got "${headerFields[i]}"` };
    }
  }

  const validStatuses = ['PAID', 'REJECTED', 'RETURNED'];
  const validNachaReturns = ['R01', 'R02', 'R03', 'R04', 'R13', 'R16', 'R20'];
  const validRejections = ['CARD_BLOCKED', 'CARD_EXPIRED', 'INVALID_BIN', 'UNDELIVERABLE_ADDR', 'STALE_DATED_CHECK'];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const status = fields[7];
    if (!validStatuses.includes(status)) {
      return { valid: false, error: `Row ${i} invalid status "${status}"` };
    }

    const claimId = fields[2];
    const amount = parseFloat(fields[5]);
    const errorCode = fields[11];

    if (status === 'RETURNED' && errorCode && !validNachaReturns.includes(errorCode)) {
      // Flag if unknown return code
    }

    results.push({
      reportId: fields[0],
      batchId: fields[1],
      claimId,
      status,
      dashRefId: fields[8],
      errorCode,
      errorMessage: fields[12],
    });
  }

  return { valid: true, total: results.length, records: results };
}

/**
 * Strips XSS attack vectors from HTML while preserving valid formatting and dynamic merge tags.
 */
function sanitizeHtmlOracle(dirtyHtml) {
  if (typeof dirtyHtml !== 'string') return '';
  let clean = dirtyHtml;

  // Strip script tags
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Strip style tags with javascript
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Strip iframe, object, embed
  clean = clean.replace(/<(iframe|object|embed|applet)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
  // Strip on* event handlers
  clean = clean.replace(/\son[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
  // Strip javascript: pseudo-protocols
  clean = clean.replace(/href\s*=\s*['"]?javascript:[^'">\s]*['"]?/gi, 'href="#"');
  // Strip data: pseudo-protocols for scripts
  clean = clean.replace(/src\s*=\s*['"]?data:(?!image\/)[^'">\s]*['"]?/gi, 'src=""');

  return clean;
}

/**
 * Replaces dynamic merge tags with context values.
 */
function resolveMergeTagsOracle(template, context) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, tag) => {
    if (tag in context && context[tag] !== undefined && context[tag] !== null) {
      return String(context[tag]);
    }
    return match; // Keep unresolved tags intact
  });
}

module.exports = {
  isValidAbaRouting,
  isValidLuhn,
  validateDashBatchCsv,
  validateSha256Checksum,
  validateReconciliationReport,
  sanitizeHtmlOracle,
  resolveMergeTagsOracle,
  parseCsvLine,
};
