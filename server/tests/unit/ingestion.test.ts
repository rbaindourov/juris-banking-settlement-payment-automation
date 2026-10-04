import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx';
import { IngestionService } from '../../src/services/ingestion.service';

describe('Claimant Ingestion & Validation Engine', () => {
  const mockCase = {
    _id: 'case_unit_test_01',
    caseId: 'CASE-UNIT-01',
    name: 'Sample Class Action',
    settlementFundTotal: 10000.00,
    disbursementDeadline: new Date('2026-12-31T23:59:59Z')
  } as any;

  describe('CSV Parsing & Normalization', () => {
    it('parses a valid CSV roster with canonical headers and verified values', async () => {
      const csv = [
        'Claim ID,First Name,Last Name,Email,Phone,Settlement Amount,Street,City,State,Zip',
        'CLM-001,John,Doe,john@example.com,555-0101,150.00,123 Main St,Springfield,IL,62701',
        'CLM-002,Jane,Smith,jane@example.com,555-0102,250.00,456 Oak St,Chicago,IL,60601'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, csv);

      expect(result.validCount).toBe(2);
      expect(result.invalidCount).toBe(0);
      expect(result.totalAllocation).toBe(400.00);
      expect(result.canCommit).toBe(true);
      expect(result.preview.length).toBe(2);
      expect(result.preview[0].claimId).toBe('CLM-001');
      expect(result.preview[0].email).toBe('john@example.com');
      expect(result.preview[0].settlementAmount).toBe(150.00);
    });

    it('normalizes header aliases (member_id, email_address, payment, telephone, postal_code)', async () => {
      const aliasedCsv = [
        'member_id,First Name,Last Name,email_address,telephone,payment,Address,City,State,Postal Code',
        'MEM-101,Alice,Brown,alice@corp.com,+12055550100,500.00,100 Market St,San Francisco,CA,94105',
        'MEM-102,Bob,Green,bob@corp.com,+12055550101,750.00,200 Pine St,San Francisco,CA,94104'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, aliasedCsv);

      expect(result.validCount).toBe(2);
      expect(result.totalAllocation).toBe(1250.00);
      expect(result.preview[0].claimId).toBe('MEM-101');
      expect(result.preview[0].email).toBe('alice@corp.com');
      expect(result.preview[0].phone).toBe('+12055550100');
      expect(result.preview[0].address?.zip).toBe('94105');
    });

    it('handles single "Full Name" column by splitting into first and last name', async () => {
      const csv = [
        'Claim ID,Name,Email,Settlement Amount',
        'CLM-FN-1,Margaret Hamilton,margaret@nasa.gov,1500.00'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, csv);

      expect(result.validCount).toBe(1);
      expect(result.preview[0].firstName).toBe('Margaret');
      expect(result.preview[0].lastName).toBe('Hamilton');
    });
  });

  describe('Excel (.xlsx) Roster Parsing', () => {
    it('parses spreadsheet buffers and maps fields identically to CSV', async () => {
      const data = [
        ['Claim ID', 'First Name', 'Last Name', 'Email', 'Settlement Amount', 'City', 'State'],
        ['XLS-001', 'Grace', 'Hopper', 'grace@navy.mil', 3000.00, 'Arlington', 'VA'],
        ['XLS-002', 'Alan', 'Turing', 'alan@bletchley.uk', 2000.00, 'London', 'UK']
      ];

      const ws = xlsx.utils.aoa_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Roster');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const result = await IngestionService.stageUpload(mockCase, buffer, 'roster.xlsx');

      expect(result.validCount).toBe(2);
      expect(result.totalAllocation).toBe(5000.00);
      expect(result.preview[0].claimId).toBe('XLS-001');
      expect(result.preview[1].claimId).toBe('XLS-002');
    });
  });

  describe('Ingestion Validation & Error Reporting', () => {
    it('rejects zero-byte empty file with FILE_EMPTY error', async () => {
      const result = await IngestionService.stageUpload(mockCase, Buffer.alloc(0));

      expect(result.canCommit).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].code).toBe('FILE_EMPTY');
      expect(result.errors[0].message).toContain('FILE_EMPTY');
    });

    it('rejects files missing mandatory headers with MISSING_MANDATORY_HEADER error', async () => {
      const corruptCsv = [
        'Claim ID,First Name,Last Name,Phone',
        'CLM-01,John,Doe,555-1234'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, corruptCsv);

      expect(result.canCommit).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_MANDATORY_HEADER')).toBe(true);
      expect(result.errors[0].message).toContain('email');
      expect(result.errors[0].message).toContain('settlement amount');
    });

    it('detects duplicate Claim IDs within the uploaded file with row tracking', async () => {
      const dupCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-001,John,Doe,john@example.com,100.00',
        'CLM-002,Jane,Smith,jane@example.com,200.00',
        'CLM-001,Duplicate,Person,dup@example.com,100.00'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, dupCsv);

      expect(result.validCount).toBe(2);
      expect(result.invalidCount).toBe(1);
      const dupError = result.errors.find(e => e.code === 'DUPLICATE_CLAIM_ID');
      expect(dupError).toBeDefined();
      expect(dupError?.claimId).toBe('CLM-001');
      expect(dupError?.row).toBe(4);
      expect(dupError?.message).toContain('already defined on row 2');
    });

    it('flags invalid email addresses with row numbers', async () => {
      const badEmailCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-01,John,Doe,notanemail,100.00',
        'CLM-02,Jane,Smith,@missinguser.com,100.00',
        'CLM-03,Bob,White,bob@valid.com,100.00'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, badEmailCsv);

      expect(result.validCount).toBe(1);
      expect(result.invalidCount).toBe(2);
      const emailErrors = result.errors.filter(e => e.code === 'INVALID_EMAIL_FORMAT');
      expect(emailErrors.length).toBe(2);
      expect(emailErrors[0].row).toBe(2);
      expect(emailErrors[1].row).toBe(3);
    });

    it('rejects negative, zero, and non-numeric amounts', async () => {
      const badAmountsCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-01,John,Doe,john@example.com,-50.00',
        'CLM-02,Jane,Smith,jane@example.com,0.00',
        'CLM-03,Bob,White,bob@example.com,INVALID_NUM',
        'CLM-04,Valid,User,valid@example.com,100.00'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, badAmountsCsv);

      expect(result.validCount).toBe(1);
      expect(result.invalidCount).toBe(3);
      const amountErrors = result.errors.filter(e => e.code === 'INVALID_AMOUNT');
      expect(amountErrors.length).toBe(3);
    });

    it('detects settlement fund over-allocation and blocks commit', async () => {
      const tightCase = {
        ...mockCase,
        settlementFundTotal: 1000.00
      };

      const overAllocatedCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-01,John,Doe,john@example.com,600.00',
        'CLM-02,Jane,Smith,jane@example.com,500.00' // Total: 1100 > 1000
      ].join('\n');

      const result = await IngestionService.stageUpload(tightCase, overAllocatedCsv);

      expect(result.totalAllocation).toBe(1100.00);
      expect(result.fundVariance).toBe(100.00);
      expect(result.canCommit).toBe(false);
      const varianceError = result.errors.find(e => e.code === 'SETTLEMENT_FUND_OVERALLOCATION');
      expect(varianceError).toBeDefined();
      expect(varianceError?.message).toContain('exceeds case settlement fund');
    });
  });

  describe('Cryptographic Magic Link Token Generation', () => {
    it('generates 64-character hexadecimal crypto tokens with guaranteed uniqueness', () => {
      const tokens = new Set<string>();
      const count = 500;

      for (let i = 0; i < count; i++) {
        const token = IngestionService.generateToken();
        expect(token).toHaveLength(64);
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        tokens.add(token);
      }

      expect(tokens.size).toBe(count);
    });
  });

  describe('Addendum 2: Payment Rails Expansion (Paypal, Venmo, Zelle, Bitcoin)', () => {
    it('parses and normalizes pre-assigned payment rails and handles details correctly', async () => {
      const csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount,Payment Method,Paypal Email,Venmo Handle,Zelle Phone,Bitcoin Address',
        'CLM-PAY-1,Satoshi,Nakamoto,sat@crypto.org,500.00,bitcoin,,,,1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        'CLM-PAY-2,Peter,Thiel,peter@paypal.com,400.00,paypal,peter@paypal.com,,,',
        'CLM-PAY-3,Vittorio,Venmo,vic@venmo.me,300.00,venmo,,@vic-venmo,,',
        'CLM-PAY-4,Zelda,Zelle,zelda@zelle.org,200.00,zelle,,,205-555-0199,'
      ].join('\n');

      const result = await IngestionService.stageUpload(mockCase, csv);

      expect(result.validCount).toBe(4);
      expect(result.canCommit).toBe(true);

      expect(result.preview[0].selectedPaymentMethod).toBe('bitcoin');
      expect(result.preview[0].paymentDetails?.bitcoinAddress).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      expect(result.preview[0].status).toBe('selected');

      expect(result.preview[1].selectedPaymentMethod).toBe('paypal');
      expect(result.preview[1].paymentDetails?.paypalEmail).toBe('peter@paypal.com');

      expect(result.preview[2].selectedPaymentMethod).toBe('venmo');
      expect(result.preview[2].paymentDetails?.venmoHandle).toBe('@vic-venmo');

      expect(result.preview[3].selectedPaymentMethod).toBe('zelle');
      expect(result.preview[3].paymentDetails?.zelleContact).toBe('205-555-0199');
    });
  });
});
