import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import {
  escapeCsvField,
  maskPaymentDetails,
  buildAuditLedgerRow,
  CsvExportService,
  CSV_HEADERS
} from '../../src/services/csvExport.service';
import { Case } from '../../src/models/Case';
import { Claimant, IClaimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';

describe('Unit: CsvExportService RFC 4180 Escaping & Audit Export', () => {
  beforeEach(async () => {
    await setupTestDb('csvexport_unit');
    await clearTestDb('csvexport_unit');
  });

  afterEach(async () => {
    await teardownTestDb('csvexport_unit');
  });

  describe('1. RFC 4180 CSV Escaping', () => {
    it('returns empty string for null and undefined', () => {
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });

    it('returns simple strings and numbers unchanged', () => {
      expect(escapeCsvField('John Doe')).toBe('John Doe');
      expect(escapeCsvField(1234.56)).toBe('1234.56');
      expect(escapeCsvField('CLM-001')).toBe('CLM-001');
    });

    it('escapes fields containing commas', () => {
      expect(escapeCsvField('Doe, Jane')).toBe('"Doe, Jane"');
      expect(escapeCsvField('Austin, TX 78701')).toBe('"Austin, TX 78701"');
    });

    it('escapes fields containing double quotes by doubling them', () => {
      expect(escapeCsvField('John "Jack" Doe')).toBe('"John ""Jack"" Doe"');
    });

    it('escapes fields containing newlines and semicolons', () => {
      expect(escapeCsvField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
      expect(escapeCsvField('Line 1\r\nLine 2')).toBe('"Line 1\r\nLine 2"');
      expect(escapeCsvField('Field;Subfield')).toBe('"Field;Subfield"');
    });
  });

  describe('2. PII / PCI Payment Details Masking', () => {
    it('returns N/A when details or method is missing', () => {
      expect(maskPaymentDetails(undefined, undefined)).toBe('N/A');
      expect(maskPaymentDetails('ach', undefined)).toBe('N/A');
      expect(maskPaymentDetails(undefined, { routing: '123' })).toBe('N/A');
    });

    it('masks ACH routing and account numbers preserving last 4 digits', () => {
      const masked = maskPaymentDetails('ach', {
        routingNumber: '123456789',
        accountNumber: '9876543210'
      });
      expect(masked).toBe('Routing: 123456789, Account: ****3210');

      const maskedAlt = maskPaymentDetails('direct_deposit', {
        routing: '021000021',
        account: '1234'
      });
      expect(maskedAlt).toBe('Routing: 021000021, Account: ****');
    });

    it('masks debit card numbers preserving last 4 digits and masking exp date', () => {
      const masked = maskPaymentDetails('debit_card', {
        cardNumber: '4111111111114321',
        exp: '12/28'
      });
      expect(masked).toBe('Card: **** **** **** 4321, Exp: **/**');

      const maskedPush = maskPaymentDetails('push_to_debit', {
        pan: '5500000000009876'
      });
      expect(maskedPush).toBe('Card: **** **** **** 9876, Exp: **/**');
    });

    it('masks physical check address to formatted string', () => {
      const masked = maskPaymentDetails('physical_check', {
        street: '123 Main St',
        city: 'Denver',
        state: 'CO',
        zip: '80202'
      });
      expect(masked).toBe('Mailed to: 123 Main St, Denver, CO 80202');
    });

    it('masks digital cards to email address', () => {
      const masked = maskPaymentDetails('digital_card', {
        preferredDeliveryEmail: 'claimant@example.com'
      });
      expect(masked).toBe('Digital Card: claimant@example.com');
    });

    it('formats PayPal, Venmo, Zelle correctly', () => {
      expect(maskPaymentDetails('paypal', { email: 'claimant@paypal.com' })).toBe('PayPal: claimant@paypal.com');
      expect(maskPaymentDetails('venmo', { venmoHandle: '@claimant-user' })).toBe('Venmo: @claimant-user');
      expect(maskPaymentDetails('zelle', { phone: '555-555-1234' })).toBe('Zelle: 555-555-1234');
    });

    it('masks Bitcoin addresses to prefix and suffix', () => {
      const masked = maskPaymentDetails('bitcoin', {
        bitcoinAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      });
      expect(masked).toBe('BTC: 1A1zP1...DivfNa');
    });
  });

  describe('3. buildAuditLedgerRow 22-Column Mapping', () => {
    it('creates exactly 22 columns with proper formatting and exception correlation', () => {
      expect(CSV_HEADERS.length).toBe(22);

      const dummyClaimant = {
        claimId: 'CLM-001',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '555-123-4567',
        address: {
          street: '100 Congress Ave',
          city: 'Austin',
          state: 'TX',
          zip: '78701'
        },
        settlementAmount: 1250.5,
        status: 'disbursed',
        selectedPaymentMethod: 'ach',
        paymentDetails: {
          routingNumber: '111000025',
          accountNumber: '9998887776'
        },
        selectedAt: new Date('2026-03-01T12:00:00Z'),
        signedAt: new Date('2026-03-01T12:01:00Z'),
        digitalSignature: 'Jane Doe',
        signatureIp: '192.168.1.100',
        confirmationNumber: 'CONF-12345',
        batchId: 'BATCH-001',
        dashReferenceId: 'DASH-REF-999',
        disbursedAt: new Date('2026-03-02T15:30:00Z')
      } as unknown as IClaimant;

      const exceptionMap = new Map<string, any>();
      exceptionMap.set('CLM-001', {
        resolutionStatus: 'open',
        returnCode: 'R01',
        returnReason: 'Insufficient Funds'
      });

      const row = buildAuditLedgerRow(dummyClaimant, exceptionMap);
      expect(row.length).toBe(22);

      expect(row[0]).toBe('CLM-001'); // Claim ID
      expect(row[1]).toBe('Doe, Jane'); // Claimant Name
      expect(row[2]).toBe('Jane'); // First Name
      expect(row[3]).toBe('Doe'); // Last Name
      expect(row[4]).toBe('jane@example.com'); // Email
      expect(row[5]).toBe('555-123-4567'); // Phone
      expect(row[6]).toBe('100 Congress Ave, Austin, TX 78701'); // Address
      expect(row[7]).toBe('1250.50'); // Settlement Amount formatted
      expect(row[8]).toBe('disbursed'); // Status
      expect(row[9]).toBe('ach'); // Payment Method
      expect(row[10]).toBe(new Date('2026-03-01T12:00:00Z').toISOString()); // Selected Timestamp
      expect(row[11]).toBe('Routing: 111000025, Account: ****7776'); // Masked Details
      expect(row[12]).toBe('Jane Doe'); // Digital Signature
      expect(row[13]).toBe('192.168.1.100'); // Signature IP
      expect(row[14]).toBe(new Date('2026-03-01T12:01:00Z').toISOString()); // Signature Timestamp
      expect(row[15]).toBe('CONF-12345'); // Confirmation Number
      expect(row[16]).toBe('BATCH-001'); // Batch ID
      expect(row[17]).toBe('DASH-REF-999'); // Dash Ref ID
      expect(row[18]).toBe(new Date('2026-03-02T15:30:00Z').toISOString()); // Disbursed Timestamp
      expect(row[19]).toBe('open'); // Exception Status
      expect(row[20]).toBe('R01'); // Exception Code
      expect(row[21]).toBe('Insufficient Funds'); // Exception Notes
    });
  });

  describe('4. CsvExportService.streamAuditLedgerCsv Streaming', () => {
    it('streams RFC 4180 CSV response with UTF-8 BOM and headers', async () => {
      const testCase = await Case.create({
        name: 'CSV Export Case',
        docketNumber: '1:24-cv-999',
        lawFirmId: 'firm_001',
        settlementFundTotal: 5000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-001',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        settlementAmount: 2500,
        status: 'disbursed',
        selectedPaymentMethod: 'ach',
        paymentDetails: { routingNumber: '123456789', accountNumber: '987654321' }
      });

      await ReconciliationException.create({
        caseId: testCase._id,
        claimId: 'CLM-001',
        amount: 2500,
        exceptionType: 'ach_return',
        returnCode: 'R02',
        returnReason: 'Account Closed',
        resolutionStatus: 'open'
      });

      const writtenChunks: string[] = [];
      const headersSet: Record<string, string> = {};

      const mockRes: any = {
        setHeader: vi.fn((key: string, val: string) => {
          headersSet[key] = val;
        }),
        write: vi.fn((chunk: string) => {
          writtenChunks.push(chunk);
          return true;
        }),
        end: vi.fn()
      };

      await CsvExportService.streamAuditLedgerCsv(testCase, [testCase._id], mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(headersSet['Content-Disposition']).toContain('attachment; filename="case_1_24-cv-999_audit_ledger_');
      expect(mockRes.end).toHaveBeenCalled();

      // Check BOM
      expect(writtenChunks[0]).toBe('\uFEFF');

      // Check Header Row
      expect(writtenChunks[1]).toContain('Claim ID,Claimant Name,First Name,Last Name,Email');

      // Check Data Row
      const dataRow = writtenChunks[2];
      expect(dataRow).toContain('CLM-001');
      expect(dataRow).toContain('Smith, Alice');
      expect(dataRow).toContain('alice@example.com');
      expect(dataRow).toContain('Routing: 123456789, Account: ****4321');
      expect(dataRow).toContain('R02');
      expect(dataRow).toContain('Account Closed');
    });
  });
});
