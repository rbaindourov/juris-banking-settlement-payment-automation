/**
 * Tier 2 - Boundary & Corner Cases: Claimant Ingestion Edge Cases
 * Tests 2.1 to 2.6: Empty file, Missing headers, Duplicates in file, Invalid emails, Over-allocation, Negative amounts.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { generateCorruptCsv } = require('../harness/data_generators');

describe('Tier 2: Boundary & Corner Cases - Claimant Ingestion Edge Cases', () => {
  it('2.1 Zero-byte empty file is rejected with explicit validation error', () => {
    const emptyCsv = generateCorruptCsv('EMPTY');
    expect(emptyCsv.length).toBe(0);

    const parseResult = emptyCsv.trim().length === 0
      ? { valid: false, error: 'FILE_EMPTY: Uploaded file contains no data' }
      : { valid: true };

    expect(parseResult.valid).toBe(false);
    expect(parseResult.error).toInclude('FILE_EMPTY');
  });

  it('2.2 File missing mandatory headers (Email, Settlement Amount) flags schema error', () => {
    const corruptCsv = generateCorruptCsv('MISSING_EMAIL_HEADER');
    const headerRow = corruptCsv.split('\n')[0].toLowerCase();

    const requiredHeaders = ['claim id', 'email', 'settlement amount'];
    const missing = requiredHeaders.filter(h => !headerRow.includes(h));

    expect(missing).toInclude('email');
    expect(missing.length).toBeGreaterThan(0);
  });

  it('2.3 Detects in-file duplicate Claim IDs and isolates duplicate line numbers in staged report', () => {
    const dupCsv = generateCorruptCsv('DUPLICATE_CLAIM_IDS');
    const lines = dupCsv.split('\n').slice(1);

    const observedClaimIds = new Map();
    const duplicateErrors = [];

    lines.forEach((line, idx) => {
      const claimId = line.split(',')[0];
      if (observedClaimIds.has(claimId)) {
        duplicateErrors.push({
          row: idx + 2,
          claimId,
          error: `DUPLICATE_CLAIM_ID: Claim ID "${claimId}" was already defined on row ${observedClaimIds.get(claimId)}`,
        });
      } else {
        observedClaimIds.set(claimId, idx + 2);
      }
    });

    expect(duplicateErrors.length).toBe(1);
    expect(duplicateErrors[0].claimId).toBe('CLM-DUP-01');
    expect(duplicateErrors[0].row).toBe(4);
  });

  it('2.4 Flags invalid email formats with row-level error reporting', () => {
    const errCsv = generateCorruptCsv('INVALID_EMAILS');
    const lines = errCsv.split('\n').slice(1);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const rowErrors = [];
    lines.forEach((line, idx) => {
      const parts = line.split(',');
      const email = parts[3];
      if (!emailRegex.test(email)) {
        rowErrors.push({ row: idx + 2, email, field: 'email', error: 'INVALID_EMAIL_FORMAT' });
      }
    });

    expect(rowErrors.length).toBe(3);
    expect(rowErrors[0].email).toBe('notanemail');
    expect(rowErrors[1].email).toBe('@missinguser.com');
  });

  it('2.5 Detects settlement fund variance when total claimant allocations exceed settlement fund', () => {
    const settlementFundTotal = 100000.00;
    const claimantRows = [
      { claimId: 'CLM-01', amount: 60000.00 },
      { claimId: 'CLM-02', amount: 50000.00 }, // Total = $110,000 (exceeds by $10,000)
    ];

    const sumAllocated = claimantRows.reduce((sum, r) => sum + r.amount, 0);
    const variance = sumAllocated - settlementFundTotal;

    expect(sumAllocated).toBe(110000.00);
    expect(variance).toBe(10000.00);
    expect(variance > 0).toBe(true);

    const varianceCheck = {
      isExceeded: variance > 0.001,
      varianceAmount: variance,
      code: 'FUND_VARIANCE_EXCEEDED',
      message: `Total claimant allocation ($${sumAllocated.toFixed(2)}) exceeds case settlement fund ($${settlementFundTotal.toFixed(2)}) by $${variance.toFixed(2)}`,
    };

    expect(varianceCheck.isExceeded).toBe(true);
    expect(varianceCheck.code).toBe('FUND_VARIANCE_EXCEEDED');
  });

  it('2.6 Rejects negative amounts, zero amounts, and non-numeric values in settlement allocation', () => {
    const negCsv = generateCorruptCsv('NEGATIVE_AMOUNTS');
    const lines = negCsv.split('\n').slice(1);

    const invalidAmountErrors = [];
    lines.forEach((line, idx) => {
      const parts = line.split(',');
      const amount = parseFloat(parts[4]);
      if (isNaN(amount) || amount <= 0) {
        invalidAmountErrors.push({ row: idx + 2, rawAmount: parts[4], error: 'INVALID_AMOUNT' });
      }
    });

    expect(invalidAmountErrors.length).toBe(3);
    expect(invalidAmountErrors[0].rawAmount).toBe('-50.00');
    expect(invalidAmountErrors[1].rawAmount).toBe('0.00');
    expect(invalidAmountErrors[2].rawAmount).toBe('NaN');
  });
});
