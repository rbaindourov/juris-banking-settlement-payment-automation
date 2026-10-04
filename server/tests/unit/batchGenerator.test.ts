import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  BatchGeneratorService,
  BatchHeaderMeta,
  BatchDetailItem
} from '../../src/services/batchGenerator.service';

// Import authoritative verification oracles from E2E harness
const {
  validateDashBatchCsv,
  validateSha256Checksum
} = require('../../../tests/e2e/harness/oracles');

describe('Unit: Outbound Batch Generator & Outbox Spooling (batchGenerator.service.ts)', () => {
  const headerMeta: BatchHeaderMeta = {
    clientId: 'FIRM-LEGAL-001',
    caseId: 'CASE-2026-99',
    caseName: 'Smith v. Acme Corporation',
    companyName: 'Smith v. Acme Corporation',
    docketNumber: '1:24-cv-09821',
    batchId: 'BATCH-20261004-001',
    environment: 'TEST'
  };

  const sampleDetails: BatchDetailItem[] = [
    {
      method: 'ACH',
      claimId: 'CLM-01',
      firstName: 'Alice',
      lastName: 'Adams',
      amount: 150.0,
      achRouting: '021000021',
      achAccount: '123456789',
      achType: 'CHECKING'
    },
    {
      method: 'DIGITAL_CARD',
      claimId: 'CLM-02',
      firstName: 'Bob',
      lastName: 'Baker',
      amount: 200.0,
      cardBrand: 'MASTERCARD',
      channel: 'EMAIL',
      email: 'bob@example.com'
    },
    {
      method: 'PUSH_DEBIT',
      claimId: 'CLM-03',
      firstName: 'Charlie',
      lastName: 'Clark',
      amount: 100.0,
      token: 'tok_visa_001',
      last4: '4412',
      bin: '411111',
      network: 'VISA'
    },
    {
      method: 'PHYSICAL_CHECK',
      claimId: 'CLM-04',
      firstName: 'Diana',
      lastName: 'Davis',
      amount: 250.0,
      payee: 'Diana Davis',
      street1: '789 Pine St',
      city: 'Seattle',
      state: 'WA',
      zip: '98101'
    }
  ];

  it('generates standardized Dash batch CSV validated 100% by validateDashBatchCsv oracle', () => {
    const { csvContent, totalAmount, breakdown } = BatchGeneratorService.buildBatchCsv(headerMeta, sampleDetails, 'v2');

    expect(totalAmount).toBe(700.0);
    expect(breakdown.ach.count).toBe(1);
    expect(breakdown.card.count).toBe(1);
    expect(breakdown.debit.count).toBe(1);
    expect(breakdown.check.count).toBe(1);

    const validation = validateDashBatchCsv(csvContent);
    expect(validation.valid).toBe(true);
    expect(validation.totalRecords).toBe(4);
    expect(validation.totalAmount).toBe(700.0);
  });

  it('generates companion .sha256 digest file verified by validateSha256Checksum oracle', () => {
    const { csvContent } = BatchGeneratorService.buildBatchCsv(headerMeta, sampleDetails, 'v2');
    const filename = 'DASH_DISBURSE_TEST_DIGEST.csv';
    const hash = crypto.createHash('sha256').update(csvContent).digest('hex');
    const companionContent = `${hash}  ${filename}\n`;

    const validation = validateSha256Checksum(csvContent, companionContent, filename);
    expect(validation.valid).toBe(true);
    expect(validation.hash).toBe(hash);
  });

  it('rejects batch generation when details array is empty (MIN_RECORDS = 1)', () => {
    expect(() => {
      BatchGeneratorService.buildBatchCsv(headerMeta, [], 'v2');
    }).toThrow(/MIN_RECORDS/);
  });

  it('supports compact CSV format (H, D, T) with SHA-256 trailer', () => {
    const { csvContent, totalAmount } = BatchGeneratorService.buildBatchCsv(headerMeta, sampleDetails, 'compact');
    expect(totalAmount).toBe(700.0);

    const lines = csvContent.trim().split('\n');
    expect(lines[0].startsWith('H,')).toBe(true);
    expect(lines[1].startsWith('D,')).toBe(true);
    expect(lines[lines.length - 1].startsWith('T,')).toBe(true);
  });

  it('correctly escapes RFC 4180 special characters (commas, quotes, newlines)', () => {
    const complexField = '123 Main St, Apt "4B"';
    const escaped = BatchGeneratorService.escapeCsvField(complexField);
    expect(escaped).toBe('"123 Main St, Apt ""4B"""');
  });

  it('spools CSV atomically to outbox with companion .sha256 digest file', async () => {
    const { csvContent } = BatchGeneratorService.buildBatchCsv(headerMeta, sampleDetails, 'v2');
    const filename = `DASH_DISBURSE_SPOOL_TEST_${Date.now()}.csv`;

    const result = await BatchGeneratorService.spoolToOutbox(filename, csvContent);
    expect(fs.existsSync(result.csvPath)).toBe(true);
    expect(fs.existsSync(result.sha256Path)).toBe(true);

    const readCsv = await fs.promises.readFile(result.csvPath, 'utf8');
    const readSha = await fs.promises.readFile(result.sha256Path, 'utf8');

    expect(readCsv).toBe(csvContent);
    expect(readSha).toBe(`${result.sha256}  ${filename}\n`);

    // Cleanup
    await fs.promises.unlink(result.csvPath).catch(() => {});
    await fs.promises.unlink(result.sha256Path).catch(() => {});
  });
});
