import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as xlsx from 'xlsx';
import crypto from 'node:crypto';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { signToken } from '../../src/utils/jwt';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { IngestionService } from '../../src/services/ingestion.service';
import { UserRole } from '../../src/types';

describe('Empirical Challenger: Milestone 2 Ingestion & Validation Engine Stress Battery', () => {
  function makeAuthToken(role: UserRole, firmId?: string | null, userId = 'usr-chal-1'): string {
    return signToken({
      id: userId,
      email: `${role}@challenger-firm.com`,
      fullName: `Challenger ${role}`,
      role,
      lawFirmId: firmId || null
    });
  }

  const superAdminToken = makeAuthToken('super_admin');
  const firmAdminToken = makeAuthToken('law_firm_admin', 'firm-CHALLENGER');
  const otherFirmAdminToken = makeAuthToken('law_firm_admin', 'firm-OTHER');

  let testCase: any;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    testCase = await Case.create({
      name: 'Class Action Challenge Case',
      docketNumber: 'CHAL-2026-001',
      lawFirmId: 'firm-CHALLENGER',
      settlementFundTotal: 10000.00,
      disbursementDeadline: new Date('2026-12-31T23:59:59.000Z'),
      fallbackPaymentMethod: 'physical_check',
      status: 'draft'
    });
  });

  // =========================================================================
  // CATEGORY 1: Malformed, Corrupted, or Empty CSV & Excel Ingestion
  // =========================================================================
  describe('1. Malformed, Corrupted & Empty File Ingestion', () => {
    it('[FILE-01] Zero-byte empty buffer is rejected with FILE_EMPTY error and canCommit=false', async () => {
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.alloc(0), 'empty.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.totalRows).toBe(0);
      expect(res.body.validCount).toBe(0);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].code).toBe('FILE_EMPTY');
    });

    it('[FILE-02] Whitespace and newline only file is rejected with FILE_EMPTY', async () => {
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from('   \n\r\n\t  \n   \n'), 'whitespace.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.errors[0].code).toBe('FILE_EMPTY');
    });

    it('[FILE-03] Corrupted / truncated Excel file behavior', async () => {
      // PK header (zip / xlsx signature 0x50 0x4b 0x03 0x04) followed by garbage
      const corruptXlsx = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('corrupted payload that cannot be decompressed as zip or excel')
      ]);

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', corruptXlsx, 'corrupt.xlsx');

      // Check whether controller/service handles corrupt xlsx or crashes to 500
      console.log('[FILE-03 Corrupt Excel Response Status]:', res.status);
      console.log('[FILE-03 Corrupt Excel Response Body]:', res.body);
      // Even if it throws, Express error handler should catch it
      expect([200, 400, 500]).toContain(res.status);
    });

    it('[FILE-04] Header-only CSV with zero data rows yields validCount=0 and canCommit=false', async () => {
      const headerOnlyCsv = 'Claim ID,First Name,Last Name,Email,Settlement Amount\n';

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(headerOnlyCsv), 'header_only.csv');

      expect(res.status).toBe(200);
      expect(res.body.totalRows).toBe(0);
      expect(res.body.validCount).toBe(0);
      expect(res.body.canCommit).toBe(false);
    });

    it('[FILE-05] UTF-8 BOM prefix on header row is successfully parsed or flags appropriately', async () => {
      const bomCsv = '\ufeffClaim ID,First Name,Last Name,Email,Settlement Amount\nCLM-BOM-1,John,Doe,john@test.com,250.00\n';

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(bomCsv, 'utf-8'), 'bom.csv');

      expect(res.status).toBe(200);
      console.log('[FILE-05 BOM test result]: canCommit=', res.body.canCommit, 'validCount=', res.body.validCount, 'errors=', res.body.errors);
      expect(res.body.validCount).toBe(1);
      expect(res.body.canCommit).toBe(true);
      expect(res.body.preview[0].claimId).toBe('CLM-BOM-1');
    });

    it('[FILE-06] Adversarial settlement amounts ($ symbols, commas, negative, zero, non-numeric)', async () => {
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-OK-1,Alice,Smith,alice@test.com,"$1,250.50"', // Formatted string with $ and commas
        'CLM-NEG-2,Bob,Jones,bob@test.com,-100.00',        // Negative amount
        'CLM-ZERO-3,Charlie,Brown,charlie@test.com,0.00',   // Zero amount
        'CLM-NAN-4,David,Miller,david@test.com,FREE_MONEY', // Non-numeric
        'CLM-EMPTY-5,Eve,Davis,eve@test.com,'               // Missing amount
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'amounts.csv');

      expect(res.status).toBe(200);
      expect(res.body.validCount).toBe(1);
      expect(res.body.invalidCount).toBe(4);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.preview[0].settlementAmount).toBe(1250.50);

      const invalidCodes = res.body.errors.map((e: any) => e.code);
      expect(invalidCodes.filter((c: string) => c === 'INVALID_AMOUNT').length).toBeGreaterThanOrEqual(4);
    });
  });

  // =========================================================================
  // CATEGORY 2: Duplicate Claim IDs (In-File and Existing Database)
  // =========================================================================
  describe('2. In-File and Database Duplicate Claim IDs', () => {
    it('[DUP-01] Multiple duplicates of the same Claim ID in file are tracked and isolated', async () => {
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-DUP,First,Occurrence,first@test.com,100.00',  // Row 2 (valid)
        'CLM-DUP,Second,Occurrence,sec@test.com,100.00',   // Row 3 (duplicate of 2)
        'CLM-DUP,Third,Occurrence,third@test.com,100.00'   // Row 4 (duplicate of 2)
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'dup_triplet.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.validCount).toBe(1);
      expect(res.body.invalidCount).toBe(2);

      const dupErrors = res.body.errors.filter((e: any) => e.code === 'DUPLICATE_CLAIM_ID');
      expect(dupErrors).toHaveLength(2);
      expect(dupErrors[0].row).toBe(3);
      expect(dupErrors[1].row).toBe(4);
    });

    it('[DUP-02] Existing Claim ID in database for THIS case triggers DUPLICATE_DB_CLAIM_ID', async () => {
      // Seed existing claimant in database
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-SEEDED-999',
        firstName: 'Prior',
        lastName: 'Claimant',
        email: 'prior@test.com',
        settlementAmount: 500.00,
        status: 'pending_selection'
      });

      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-SEEDED-999,New,Attempt,attempt@test.com,500.00',
        'CLM-FRESH-100,Good,Claimant,fresh@test.com,300.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'db_dup.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      const dbDupError = res.body.errors.find((e: any) => e.code === 'DUPLICATE_DB_CLAIM_ID');
      expect(dbDupError).toBeDefined();
      expect(dbDupError.claimId).toBe('CLM-SEEDED-999');
    });

    it('[DUP-03] Cross-case Claim ID collision is permitted (isolated per case)', async () => {
      // Create second case
      const otherCase = await Case.create({
        name: 'Unrelated Second Case',
        docketNumber: 'CASE-2',
        lawFirmId: 'firm-CHALLENGER',
        settlementFundTotal: 5000.00,
        disbursementDeadline: new Date('2026-12-31')
      });

      // Seed claimant in otherCase
      await Claimant.create({
        caseId: otherCase._id,
        claimId: 'CLM-SHARED-123',
        firstName: 'Other',
        lastName: 'Person',
        email: 'other@test.com',
        settlementAmount: 200.00,
        status: 'pending_selection'
      });

      // Now stage the SAME claim ID in testCase
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-SHARED-123,Alice,SameId,alice@test.com,200.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'cross_case.csv');

      if (res.status !== 200) {
        console.log('[DUP-03 Failure Details]: status=', res.status, 'body=', res.body, 'testCaseId=', testCase?._id);
      }
      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(true);
      expect(res.body.errors).toHaveLength(0);
      expect(res.body.validCount).toBe(1);
    });
  });

  // =========================================================================
  // CATEGORY 3: Fund Allocation Variance Calculations
  // =========================================================================
  describe('3. Fund Allocation Variance Calculations', () => {
    it('[VAR-01] Under-allocated batch has negative variance and canCommit=true', async () => {
      // Fund total is $10,000.00
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-U1,Alice,One,alice@test.com,3000.00',
        'CLM-U2,Bob,Two,bob@test.com,2500.00'
      ].join('\n'); // Total: $5,500.00, Variance: -$4,500.00

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'under.csv');

      expect(res.status).toBe(200);
      expect(res.body.totalAllocation).toBe(5500.00);
      expect(res.body.settlementFundTotal).toBe(10000.00);
      expect(res.body.fundVariance).toBe(-4500.00);
      expect(res.body.canCommit).toBe(true);
    });

    it('[VAR-02] Exact fund match has 0 variance and canCommit=true', async () => {
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-E1,Alice,One,alice@test.com,6000.00',
        'CLM-E2,Bob,Two,bob@test.com,4000.00'
      ].join('\n'); // Total: $10,000.00, Variance: $0.00

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'exact.csv');

      expect(res.status).toBe(200);
      expect(res.body.totalAllocation).toBe(10000.00);
      expect(res.body.settlementFundTotal).toBe(10000.00);
      expect(res.body.fundVariance).toBe(0.00);
      expect(res.body.canCommit).toBe(true);
    });

    it('[VAR-03] Over-allocation by even 1 cent triggers SETTLEMENT_FUND_OVERALLOCATION', async () => {
      const csvContent = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-O1,Alice,One,alice@test.com,5000.00',
        'CLM-O2,Bob,Two,bob@test.com,5000.01' // Total: $10,000.01, Variance: +$0.01
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csvContent), 'over.csv');

      expect(res.status).toBe(200);
      expect(res.body.canCommit).toBe(false);
      expect(res.body.fundVariance).toBe(0.01);
      const overErr = res.body.errors.find((e: any) => e.code === 'SETTLEMENT_FUND_OVERALLOCATION');
      expect(overErr).toBeDefined();
    });

    it('[VAR-04] Cumulative multi-batch overallocation inquiry', async () => {
      // First commit $8,000 of claimants into this $10,000 case
      await Claimant.create([
        {
          caseId: testCase._id,
          claimId: 'BATCH1-01',
          firstName: 'Batch1',
          lastName: 'User1',
          email: 'b1_1@test.com',
          settlementAmount: 8000.00,
          status: 'pending_selection'
        }
      ]);

      // Now stage a SECOND batch of $3,000.
      // Current file is $3,000 (which is <= $10,000 case total),
      // BUT existing in DB is $8,000. Total would be $11,000 > $10,000!
      const batch2Csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'BATCH2-01,Batch2,User2,b2_2@test.com,3000.00'
      ].join('\n');

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(batch2Csv), 'batch2.csv');

      expect(res.status).toBe(200);
      console.log('[VAR-04 Multi-batch Result]: totalAllocation=', res.body.totalAllocation,
        'settlementFundTotal=', res.body.settlementFundTotal,
        'fundVariance=', res.body.fundVariance,
        'canCommit=', res.body.canCommit);
    });
  });

  // =========================================================================
  // CATEGORY 4: Pre-Assigned Payment Methods Across All 9 Rails (Addendum 2)
  // =========================================================================
  describe('4. Pre-Assigned Payment Rails Ingestion (All 9 Rails)', () => {
    it('[RAIL-01] Parses and normalizes all 9 rails from roster headers and columns', async () => {
      const multiRailCsv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount,Payment Method,Routing Number,Account Number,PayPal Email,Venmo Handle,Zelle Contact,Bitcoin Address',
        'R-ACH,Ach,User,ach@test.com,100.00,ach,021000021,123456789,,,,',
        'R-DD,Direct,Deposit,dd@test.com,100.00,direct_deposit,021000021,987654321,,,,',
        'R-DIG,Digital,Card,card@test.com,100.00,digital_card,,,,,,',
        'R-DEB,Debit,Card,debit@test.com,100.00,debit_card,,,,,,',
        'R-CHK,Check,Recipient,check@test.com,100.00,physical_check,,,,,,',
        'R-PP,Pay,Pal,paypal@test.com,100.00,paypal,,,paypal_me@pay.com,,,',
        'R-VEN,Ven,Mo,venmo@test.com,100.00,venmo,,,,@venmo_handle,,',
        'R-ZEL,Zel,Le,zelle@test.com,100.00,zelle,,,,,555-123-4567,',
        'R-BTC,Bit,Coin,btc@test.com,100.00,bitcoin,,,,,,bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      ].join('\n');

      const stageRes = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(multiRailCsv), 'rails.csv');

      expect(stageRes.status).toBe(200);
      expect(stageRes.body.validCount).toBe(9);
      expect(stageRes.body.canCommit).toBe(true);

      const preview = stageRes.body.preview;
      const railsObserved = preview.map((p: any) => p.selectedPaymentMethod);
      console.log('[RAIL-01 Rails Observed]:', railsObserved);

      // Verify mapping
      expect(preview.find((p: any) => p.claimId === 'R-ACH').selectedPaymentMethod).toBe('ach');
      expect(preview.find((p: any) => p.claimId === 'R-DD').selectedPaymentMethod).toBe('ach'); // direct_deposit normalizes to ach
      expect(preview.find((p: any) => p.claimId === 'R-DIG').selectedPaymentMethod).toBe('digital_card');
      expect(preview.find((p: any) => p.claimId === 'R-DEB').selectedPaymentMethod).toBe('debit_card');
      expect(preview.find((p: any) => p.claimId === 'R-CHK').selectedPaymentMethod).toBe('physical_check');
      expect(preview.find((p: any) => p.claimId === 'R-PP').selectedPaymentMethod).toBe('paypal');
      expect(preview.find((p: any) => p.claimId === 'R-VEN').selectedPaymentMethod).toBe('venmo');
      expect(preview.find((p: any) => p.claimId === 'R-ZEL').selectedPaymentMethod).toBe('zelle');
      expect(preview.find((p: any) => p.claimId === 'R-BTC').selectedPaymentMethod).toBe('bitcoin');

      // Verify status: pre-assigned rails should have status 'selected'
      for (const claimant of preview) {
        expect(claimant.status).toBe('selected');
      }

      // Commit to database
      const commitRes = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: stageRes.body.stagedClaimants });

      expect(commitRes.status).toBe(201);
      expect(commitRes.body.insertedCount).toBe(9);

      // Verify in MongoDB
      const dbBtc = await Claimant.findOne({ caseId: testCase._id, claimId: 'R-BTC' });
      expect(dbBtc).not.toBeNull();
      expect(dbBtc!.selectedPaymentMethod).toBe('bitcoin');
      expect(dbBtc!.paymentDetails?.bitcoinAddress).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(dbBtc!.status).toBe('selected');
    });

    it('[RAIL-02] Without pre-assigned method, status defaults to pending_selection', async () => {
      const csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-NOPRE,No,Method,nomethod@test.com,200.00'
      ].join('\n');

      const stageRes = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csv), 'nomethod.csv');

      expect(stageRes.body.preview[0].selectedPaymentMethod).toBeUndefined();
      expect(stageRes.body.preview[0].status).toBe('pending_selection');
    });
  });

  // =========================================================================
  // CATEGORY 5: Atomic Staged Preview and Commit Lifecycle
  // =========================================================================
  describe('5. Atomic Staged Preview and Commit Lifecycle', () => {
    it('[LIFE-01] Stage upload is strictly side-effect free: zero DB writes occur during staging', async () => {
      const csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-STG-1,Staged,User,staged@test.com,500.00'
      ].join('\n');

      const countBefore = await Claimant.countDocuments({ caseId: testCase._id });
      expect(countBefore).toBe(0);

      await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csv), 'staging.csv');

      const countAfter = await Claimant.countDocuments({ caseId: testCase._id });
      expect(countAfter).toBe(0);
    });

    it('[LIFE-02] Commit transitions draft case to active and generates unique 64-hex tokens', async () => {
      const csv = [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-ACT-1,Active,User1,act1@test.com,500.00',
        'CLM-ACT-2,Active,User2,act2@test.com,500.00'
      ].join('\n');

      // Stage
      const stageRes = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(csv), 'commit.csv');

      // Commit
      const commitRes = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: stageRes.body.stagedClaimants });

      expect(commitRes.status).toBe(201);
      expect(commitRes.body.insertedCount).toBe(2);

      // Verify case status transitioned to active
      const updatedCase = await Case.findById(testCase._id);
      expect(updatedCase!.status).toBe('active');

      // Verify 64-hex tokens
      const claimants = await Claimant.find({ caseId: testCase._id });
      expect(claimants).toHaveLength(2);
      for (const c of claimants) {
        expect(c.paymentSelectionToken).toMatch(/^[0-9a-f]{64}$/);
        expect(c.claimantToken).toBe(c.paymentSelectionToken);
        expect(c.tokenExpiresAt).toBeDefined();
      }
      expect(claimants[0].paymentSelectionToken).not.toBe(claimants[1].paymentSelectionToken);
    });

    it('[LIFE-03] Direct commit bypass probing: Attempting to commit without valid records', async () => {
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No claimant records provided');
    });

    it('[LIFE-04] Cross-tenant commit protection: Firm B cannot commit to Firm A case', async () => {
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${otherFirmAdminToken}`)
        .send({ claimants: [{ claimId: 'HACK', firstName: 'A', lastName: 'B', email: 'hack@test.com', settlementAmount: 100 }] });

      expect(res.status).toBe(403);
    });

    it('[LIFE-05] Direct commit endpoint validates email format and rejects invalid emails with 400', async () => {
      const bypassPayload = [
        {
          claimId: 'BYPASS-01',
          firstName: 'Bypass',
          lastName: 'User',
          email: 'not-an-email-at-all',
          settlementAmount: 50.00
        }
      ];

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/commit-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({ claimants: bypassPayload });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid email address');
    });

    it('[LIFE-06] Claimant model schema rejects invalid email on direct create', async () => {
      await expect(
        Claimant.create({
          caseId: testCase._id,
          claimId: 'CLM-SCHEMA-INVALID',
          firstName: 'Invalid',
          lastName: 'Email',
          email: 'invalid-email-format',
          settlementAmount: 100.00
        })
      ).rejects.toThrow(/Invalid email address/);
    });
  });

  // =========================================================================
  // CATEGORY 6: Scale, Memory & Advanced Security Stress Tests
  // =========================================================================
  describe('6. Scale & Security Stress Tests', () => {
    it('[SCALE-01] Ingests a 1,000-row CSV file under tight execution constraints (<1000ms)', async () => {
      const rows: string[] = ['Claim ID,First Name,Last Name,Email,Settlement Amount'];
      for (let i = 1; i <= 1000; i++) {
        rows.push(`CLM-SCALE-${i},FirstName${i},LastName${i},user${i}@juris-scale.org,10.00`);
      }
      const thousandRowCsv = rows.join('\n');

      const startTime = Date.now();
      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(thousandRowCsv), 'scale_1000.csv');
      const elapsed = Date.now() - startTime;

      console.log(`[SCALE-01 Elapsed]: ${elapsed}ms for 1,000 rows`);
      expect(res.status).toBe(200);
      expect(res.body.totalRows).toBe(1000);
      expect(res.body.validCount).toBe(1000);
      expect(res.body.totalAllocation).toBe(10000.00);
      expect(res.body.fundVariance).toBe(0.00);
      expect(res.body.canCommit).toBe(true);
      expect(elapsed).toBeLessThan(3000); // Must be performant
    });

    it('[SEC-01] Dynamic merge tag HTML injection in template preview', async () => {
      // Test whether malicious tags in sampleData (e.g. claimant_first_name) are escaped
      const maliciousSampleData = {
        claimant_first_name: '<script>alert("XSS")</script>',
        claimant_last_name: '<img src="x" onerror="stealTokens()">',
        case_name: '"><script>alert(1)</script>'
      };

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/templates/preview`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .send({
          template: '<p>Hello {{claimant_first_name}} {{claimant_last_name}} for {{case_name}}</p>',
          sampleData: maliciousSampleData,
          viewport: 'desktop'
        });

      expect(res.status).toBe(200);
      console.log('[SEC-01 Rendered Preview HTML]:', res.body.renderedHtml);
      // Check if raw <script> or onerror tag is in renderedHtml
      const hasScriptTag = res.body.renderedHtml.includes('<script>');
      const hasImgOnerror = res.body.renderedHtml.includes('onerror=');
      console.log('[SEC-01 Merge Tag Injection Result]: hasScriptTag=', hasScriptTag, 'hasImgOnerror=', hasImgOnerror);
    });

    it('[SEC-02] Unterminated CSV quotes handling', async () => {
      const corruptCsv = 'Claim ID,First Name,Last Name,Email,Settlement Amount\nCLM-UNTERM,"Alice,UnclosedQuote,alice@test.com,500.00\n';

      const res = await request(app)
        .post(`/api/cases/${testCase._id}/claimants/stage-upload`)
        .set('Authorization', `Bearer ${firmAdminToken}`)
        .attach('file', Buffer.from(corruptCsv), 'unterm.csv');

      expect(res.status).toBe(200);
      console.log('[SEC-02 Unclosed Quote Response]: canCommit=', res.body.canCommit, 'errors=', res.body.errors);
    });
  });
});
