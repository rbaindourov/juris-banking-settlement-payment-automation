import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { DisbursementBatch } from '../../src/models/DisbursementBatch';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { User } from '../../src/models/User';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';
import { ReconciliationService } from '../../src/services/reconciliation.service';
import { IngestionService } from '../../src/services/ingestion.service';
import {
  CsvExportService,
  buildAuditLedgerRow,
  escapeCsvField,
  maskPaymentDetails,
  CSV_HEADERS
} from '../../src/services/csvExport.service';
import { signToken, AUTH_COOKIE_NAME } from '../../src/utils/jwt';
import { executeDeadlineFallback } from '../../src/jobs/definitions/enforceDeadlineFallback.job';
import { Writable } from 'node:stream';

describe('Adversarial & Empirical Challenge: M6 Tier 5 Coverage Hardening & Concurrency Audit', () => {
  const SUITE_NAME = 'm6_tier5_coverage_hardening_1';

  let adminUser: any;
  let adminToken: string;
  let firmCase: any;

  beforeEach(async () => {
    await setupTestDb(SUITE_NAME);
    await clearTestDb(SUITE_NAME);

    // Create Admin User & Auth Token
    adminUser = await User.create({
      email: 'admin_m6_t5@example.com',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
      role: 'super_admin',
      fullName: 'Admin Challenger',
      lawFirmId: 'FIRM-M6-T5'
    });

    adminToken = signToken({
      userId: adminUser._id.toString(),
      email: adminUser.email,
      role: adminUser.role,
      lawFirmId: adminUser.lawFirmId
    });

    // Create Default Case
    firmCase = await Case.create({
      name: 'Adversarial Tier 5 Settlement',
      docketNumber: '1:24-cv-M6T5-001',
      lawFirmId: 'FIRM-M6-T5',
      settlementFundTotal: 50000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 14), // 14 days in future
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });
  });

  afterEach(async () => {
    await clearTestDb(SUITE_NAME);
  });

  afterAll(async () => {
    await teardownTestDb(SUITE_NAME);
  });

  // =========================================================================
  // BATTERY 1: Concurrency & Race Conditions
  // =========================================================================
  describe('Battery 1: Concurrency & Race Conditions', () => {
    it('[CONCUR-01] Concurrent conflicting payment selections on the same claimant token', async () => {
      const claimantToken = 'a'.repeat(64);
      const claimant = await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-CONCUR-01',
        firstName: 'Alice',
        lastName: 'Concurrent',
        email: 'alice.concur@example.com',
        settlementAmount: 250.0,
        status: 'pending_selection',
        paymentSelectionToken: claimantToken
      });

      const achPayload = {
        method: 'direct_deposit',
        details: {
          routingNumber: '021000021', // Chase Fed Mod 10 valid
          accountNumber: '1234567890',
          accountType: 'checking'
        },
        certificationAffirmed: true,
        signature: 'Alice Concurrent'
      };

      const debitPayload = {
        method: 'push_to_debit',
        details: {
          cardholderName: 'Alice Concurrent',
          cardNumber: '4111111111111111', // Visa Luhn valid
          expirationDate: '12/28',
          cvv: '123',
          billingZip: '90001'
        },
        certificationAffirmed: true,
        signature: 'Alice Concurrent'
      };

      // Fire both requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app).post(`/api/public/claim/${claimantToken}/select-payment`).send(achPayload),
        request(app).post(`/api/public/claim/${claimantToken}/select-payment`).send(debitPayload)
      ]);

      const statuses = [res1.status, res2.status];
      // At least one request succeeds with 200
      expect(statuses).toContain(200);

      // Verify that the document in DB was not corrupted and holds valid state
      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded).toBeDefined();
      expect(reloaded?.status).toBe('selected');
      expect(['ach', 'debit_card', 'direct_deposit', 'push_to_debit']).toContain(reloaded?.selectedPaymentMethod);
      expect(reloaded?.confirmationNumber).toBeDefined();
      expect(reloaded?.confirmationNumber?.length).toBeGreaterThan(5);
    });

    it('[CONCUR-02] Concurrent rapid identical double-submit on the same claimant token', async () => {
      const claimantToken = 'b'.repeat(64);
      const claimant = await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-CONCUR-02',
        firstName: 'Bob',
        lastName: 'DoubleSubmit',
        email: 'bob.double@example.com',
        settlementAmount: 175.5,
        status: 'pending_selection',
        paymentSelectionToken: claimantToken
      });

      const payload = {
        method: 'digital_card',
        details: {
          deliveryChannel: 'EMAIL',
          recipientEmail: 'bob.double@example.com'
        },
        certificationAffirmed: true,
        signature: 'Bob DoubleSubmit'
      };

      const [res1, res2] = await Promise.all([
        request(app).post(`/api/public/claim/${claimantToken}/select-payment`).send(payload),
        request(app).post(`/api/public/claim/${claimantToken}/select-payment`).send(payload)
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);

      const totalClaimants = await Claimant.countDocuments({ claimId: 'CLM-CONCUR-02' });
      expect(totalClaimants).toBe(1);

      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded?.status).toBe('selected');
      expect(reloaded?.selectedPaymentMethod).toBe('digital_card');
    });

    it('[CONCUR-03] Concurrent batch spooling race condition and temporary file collision are prevented', async () => {
      // Create 3 eligible claimants in selected status
      await Claimant.insertMany([
        {
          caseId: firmCase._id,
          claimId: 'CLM-SPOOL-01',
          firstName: 'User1',
          lastName: 'Spool',
          email: 'u1@example.com',
          settlementAmount: 100.0,
          status: 'selected',
          selectedPaymentMethod: 'direct_deposit',
          paymentDetails: { routingNumber: '021000021', accountNumber: '111111', accountType: 'checking' }
        },
        {
          caseId: firmCase._id,
          claimId: 'CLM-SPOOL-02',
          firstName: 'User2',
          lastName: 'Spool',
          email: 'u2@example.com',
          settlementAmount: 200.0,
          status: 'selected',
          selectedPaymentMethod: 'physical_check',
          paymentDetails: { street: '100 Main St', city: 'Dallas', state: 'TX', zip: '75001' }
        },
        {
          caseId: firmCase._id,
          claimId: 'CLM-SPOOL-03',
          firstName: 'User3',
          lastName: 'Spool',
          email: 'u3@example.com',
          settlementAmount: 300.0,
          status: 'selected',
          selectedPaymentMethod: 'digital_card',
          paymentDetails: { deliveryChannel: 'EMAIL', recipientEmail: 'u3@example.com' }
        }
      ]);

      // Fire two batch compilations concurrently
      const results = await Promise.allSettled([
        BatchGeneratorService.compileAndSpoolCaseBatch(firmCase._id.toString()),
        BatchGeneratorService.compileAndSpoolCaseBatch(firmCase._id.toString())
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Hardened behavior:
      // Exactly 1 batch is spooled containing the claimants; the concurrent call finds 0 remaining claimants and fails with MIN_RECORDS.
      // Or if split, zero claimants are double-drawn across batches.
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const b1 = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      expect(b1.filename).toMatch(/DASH_DISBURSE_.*_[0-9a-f]{6}\.csv/);
      expect(b1.batchId).toBeDefined();

      if (rejected.length > 0) {
        const err = (rejected[0] as PromiseRejectedResult).reason;
        expect(err.message).toMatch(/MIN_RECORDS/i);
      } else if (fulfilled.length === 2) {
        const b2 = (fulfilled[1] as PromiseFulfilledResult<any>).value;
        const overlap = b1.claimantIds.filter((id: string) => b2.claimantIds.includes(id));
        expect(overlap).toHaveLength(0);
      }

      // Check DB integrity: all 3 claimants are queued_for_sftp
      const allQueued = await Claimant.countDocuments({
        caseId: firmCase._id,
        status: 'queued_for_sftp'
      });
      expect(allQueued).toBe(3);
    });

    it('[CONCUR-04] Payment selection attempted concurrently with batch spooling', async () => {
      const claimantToken = 'c'.repeat(64);
      const claimant = await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-CONCUR-04',
        firstName: 'Charlie',
        lastName: 'Interleaved',
        email: 'charlie@example.com',
        settlementAmount: 500.0,
        status: 'selected',
        selectedPaymentMethod: 'physical_check',
        paymentSelectionToken: claimantToken
      });

      // Claimant tries to change payment method to ACH at the exact moment batch compiles
      const [spoolRes, portalRes] = await Promise.all([
        BatchGeneratorService.compileAndSpoolCaseBatch(firmCase._id.toString()),
        request(app).post(`/api/public/claim/${claimantToken}/select-payment`).send({
          method: 'direct_deposit',
          details: { routingNumber: '021000021', accountNumber: '9988776655', accountType: 'checking' },
          certificationAffirmed: true,
          signature: 'Charlie Interleaved'
        })
      ]);

      expect(spoolRes.batchId).toBeDefined();
      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded).toBeDefined();
      expect(['selected', 'queued_for_sftp']).toContain(reloaded?.status);
    });
  });

  // =========================================================================
  // BATTERY 2: Boundary Inputs & Malformed Data
  // =========================================================================
  describe('Battery 2: Boundary Inputs & Malformed Data', () => {
    it('[BOUND-01] Malformed UTF-8, null bytes, and non-ASCII Unicode in roster ingestion', async () => {
      const csvContent = [
        'claim_id,first_name,last_name,email,settlement_amount,street,city,state,zip',
        'CLM-U1,Renée,Noël,renee@example.com,150.00,123 Rue de la Paix,Paris,TX,75460',
        'CLM-U2,太郎,田中,tanaka@example.com,200.00,Chiyoda-ku,Tokyo,CA,90210',
        'CLM-U3,أحمد,محمود,ahmed@example.com,250.00,Nile St,Cairo,IL,60601',
        'CLM-U4,John 😃,Doe 🎉,emoji@example.com,300.00,456 Fun Lane,Orlando,FL,32801'
      ].join('\n');

      const stageResult = await IngestionService.stageUpload(firmCase, csvContent, 'roster_unicode.csv');
      expect(stageResult.totalRows).toBe(4);
      expect(stageResult.validCount).toBe(4);
      expect(stageResult.canCommit).toBe(true);
      expect(stageResult.totalAllocation).toBe(900.0);

      const p1 = stageResult.preview.find((p) => p.claimId === 'CLM-U1');
      expect(p1?.firstName).toBe('Renée');
      expect(p1?.lastName).toBe('Noël');

      const p2 = stageResult.preview.find((p) => p.claimId === 'CLM-U2');
      expect(p2?.firstName).toBe('太郎');

      const p4 = stageResult.preview.find((p) => p.claimId === 'CLM-U4');
      expect(p4?.firstName).toContain('😃');
    });

    it('[BOUND-02] Zero and negative amount rejection across CSV ingestion', async () => {
      const csvContent = [
        'claim_id,first_name,last_name,email,settlement_amount',
        'CLM-ZERO-1,Zero,One,zero1@example.com,0.00',
        'CLM-ZERO-2,Zero,Two,zero2@example.com,$0',
        'CLM-NEG-1,Neg,One,neg1@example.com,-50.00',
        'CLM-NEG-2,Neg,Two,neg2@example.com,-$0.01',
        'CLM-NAN-1,Bad,Val,badval@example.com,N/A',
        'CLM-VALID,Good,Claimant,good@example.com,100.00'
      ].join('\n');

      const stageResult = await IngestionService.stageUpload(firmCase, csvContent, 'amounts.csv');
      expect(stageResult.canCommit).toBe(false);
      expect(stageResult.invalidCount).toBe(5);
      expect(stageResult.validCount).toBe(1);

      const errorCodes = stageResult.errors.map((e) => e.code);
      expect(errorCodes.filter((c) => c === 'INVALID_AMOUNT').length).toBe(5);
    });

    it('[BOUND-03] Settlement fund total zero boundary rejects overallocation', async () => {
      const zeroFundCase = await Case.create({
        name: 'Zero Fund Case',
        docketNumber: '1:24-cv-ZERO-FUND',
        lawFirmId: 'FIRM-M6-T5',
        settlementFundTotal: 0,
        disbursementDeadline: new Date(Date.now() + 86400000 * 14),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const csvContent = [
        'claim_id,first_name,last_name,email,settlement_amount',
        'CLM-BIG-1,Big,Claim,big@example.com,1000000.00'
      ].join('\n');

      const stageResult = await IngestionService.stageUpload(zeroFundCase, csvContent, 'huge.csv');

      expect(stageResult.canCommit).toBe(false);
      expect(stageResult.errors.some((e) => e.code === 'SETTLEMENT_FUND_OVERALLOCATION')).toBe(true);
      expect(stageResult.totalAllocation).toBe(1000000.0);
    });

    it('[BOUND-04] Extreme floating point values and precision boundary', async () => {
      const csvContent = [
        'claim_id,first_name,last_name,email,settlement_amount',
        'CLM-PREC-1,Prec,One,p1@example.com,10.001',
        'CLM-PREC-2,Prec,Two,p2@example.com,10.009'
      ].join('\n');

      const stageResult = await IngestionService.stageUpload(firmCase, csvContent, 'prec.csv');
      expect(stageResult.canCommit).toBe(true);
      const p1 = stageResult.preview.find((p) => p.claimId === 'CLM-PREC-1');
      const p2 = stageResult.preview.find((p) => p.claimId === 'CLM-PREC-2');
      expect(p1?.settlementAmount).toBe(10.0);
      expect(p2?.settlementAmount).toBe(10.01);
      expect(stageResult.totalAllocation).toBe(20.01);
    });

    it('[BOUND-05] Special regex injection characters in GET /api/cases query are safely handled', async () => {
      const resParen = await request(app)
        .get('/api/cases?search=(')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminToken}`]);

      expect(resParen.status).toBe(200);
      expect(resParen.body.cases).toBeDefined();

      const resBracket = await request(app)
        .get('/api/cases?search=[')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminToken}`]);

      expect(resBracket.status).toBe(200);
      expect(resBracket.body.cases).toBeDefined();

      const resStar = await request(app)
        .get('/api/cases?search=*')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminToken}`]);

      expect(resStar.status).toBe(200);
      expect(resStar.body.cases).toBeDefined();
    });

    it('[BOUND-06] Special regex injection characters in GET /api/cases/:id/claimants query are safely handled', async () => {
      const res = await request(app)
        .get(`/api/cases/${firmCase._id}/claimants?search=(unclosed`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.claimants).toBeDefined();
    });

    it('[BOUND-07] Special regex injection characters in GET /api/cases/:id/exceptions query are safely handled', async () => {
      const res = await request(app)
        .get(`/api/cases/${firmCase._id}/exceptions?search=(`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.exceptions).toBeDefined();
    });
  });

  // =========================================================================
  // BATTERY 3: State Machine Transition Integrity
  // =========================================================================
  describe('Battery 3: State Machine Transition Integrity', () => {
    it('[STATE-01] Payment selection rejected after batch generation (queued_for_sftp) preserves state machine', async () => {
      const claimantToken = 'd'.repeat(64);
      const claimant = await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-STATE-01',
        firstName: 'David',
        lastName: 'Queued',
        email: 'david.q@example.com',
        settlementAmount: 350.0,
        status: 'queued_for_sftp',
        batchId: 'BATCH-ALREADY-SPOOLED-01',
        selectedPaymentMethod: 'physical_check',
        paymentSelectionToken: claimantToken
      });

      const res = await request(app)
        .post(`/api/public/claim/${claimantToken}/select-payment`)
        .send({
          method: 'direct_deposit',
          details: { routingNumber: '021000021', accountNumber: '7788990011', accountType: 'checking' },
          certificationAffirmed: true,
          signature: 'David Queued'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Payment method cannot be changed once disbursement batch processing has begun');

      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded?.status).toBe('queued_for_sftp');
      expect(reloaded?.selectedPaymentMethod).toBe('physical_check');
    });

    it('[STATE-02] Payment selection strictly rejected when status is disbursed', async () => {
      const claimantToken = 'e'.repeat(64);
      await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-STATE-02',
        firstName: 'Eve',
        lastName: 'Disbursed',
        email: 'eve.d@example.com',
        settlementAmount: 400.0,
        status: 'disbursed',
        disbursedAt: new Date(),
        selectedPaymentMethod: 'direct_deposit',
        paymentSelectionToken: claimantToken
      });

      const res = await request(app)
        .post(`/api/public/claim/${claimantToken}/select-payment`)
        .send({
          method: 'physical_check',
          details: { street: '123 New St', city: 'Miami', state: 'FL', zip: '33101' },
          certificationAffirmed: true,
          signature: 'Eve Disbursed'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ALREADY_DISBURSED');
    });

    it('[STATE-03] Payment selection strictly rejected with 403 when case deadline has expired', async () => {
      const expiredCase = await Case.create({
        name: 'Past Deadline Case',
        docketNumber: '1:24-cv-EXPIRED-01',
        lawFirmId: 'FIRM-M6-T5',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() - 86400000 * 2), // 2 days ago
        fallbackPaymentMethod: 'physical_check',
        status: 'deadline_passed'
      });

      const claimantToken = 'f'.repeat(64);
      await Claimant.create({
        caseId: expiredCase._id,
        claimId: 'CLM-STATE-03',
        firstName: 'Frank',
        lastName: 'Expired',
        email: 'frank.e@example.com',
        settlementAmount: 150.0,
        status: 'pending_selection',
        paymentSelectionToken: claimantToken
      });

      const res = await request(app)
        .post(`/api/public/claim/${claimantToken}/select-payment`)
        .send({
          method: 'direct_deposit',
          details: { routingNumber: '021000021', accountNumber: '123123123', accountType: 'checking' },
          certificationAffirmed: true,
          signature: 'Frank Expired'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('DEADLINE_PASSED');
      expect(res.body.assignedFallbackMethod).toBe('physical_check');
    });

    it('[STATE-04] Idempotent double-disbursement with duplicate reconciliation reports', async () => {
      const claimant = await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-RECON-PAID',
        firstName: 'Grace',
        lastName: 'Paid',
        email: 'grace@example.com',
        settlementAmount: 500.0,
        status: 'queued_for_sftp',
        batchId: 'BATCH-RECON-01'
      });

      const reportCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        'REP-001,BATCH-RECON-01,CLM-RECON-PAID,REF-001,ach,500.00,USD,PAID,DASH-PAID-999,2026-10-04,2026-10-04,,,'
      ].join('\n');

      // First run
      const res1 = await ReconciliationService.reconcileCaseStatusReport({
        caseId: firmCase._id.toString(),
        csvContent: reportCsv,
        reportFilename: 'status_report_01.csv'
      });
      expect(res1.disbursedCount).toBe(1);

      const afterFirst = await Claimant.findById(claimant._id);
      expect(afterFirst?.status).toBe('disbursed');
      expect(afterFirst?.dashReferenceId).toBe('DASH-PAID-999');

      // Second identical run (idempotency check)
      const res2 = await ReconciliationService.reconcileCaseStatusReport({
        caseId: firmCase._id.toString(),
        csvContent: reportCsv,
        reportFilename: 'status_report_01.csv'
      });
      expect(res2.disbursedCount).toBe(1);

      const afterSecond = await Claimant.findById(claimant._id);
      expect(afterSecond?.status).toBe('disbursed');
      expect(afterSecond?.dashReferenceId).toBe('DASH-PAID-999');
    });

    it('[STATE-05] Duplicate exception documents prevented on repeated reconciliation runs', async () => {
      await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-RECON-REJ',
        firstName: 'Helen',
        lastName: 'Reject',
        email: 'helen@example.com',
        settlementAmount: 300.0,
        status: 'queued_for_sftp',
        batchId: 'BATCH-RECON-02'
      });

      const reportCsv = [
        'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON',
        'REP-002,BATCH-RECON-02,CLM-RECON-REJ,REF-002,ach,300.00,USD,REJECTED,DASH-REJ-111,2026-10-04,2026-10-04,R02,Account Closed,Account Closed'
      ].join('\n');

      // Ingest report once
      await ReconciliationService.reconcileCaseStatusReport({
        caseId: firmCase._id.toString(),
        csvContent: reportCsv,
        reportFilename: 'status_report_rej.csv'
      });

      const excCount1 = await ReconciliationException.countDocuments({ claimId: 'CLM-RECON-REJ' });
      expect(excCount1).toBe(1);

      // Ingest report a second time
      await ReconciliationService.reconcileCaseStatusReport({
        caseId: firmCase._id.toString(),
        csvContent: reportCsv,
        reportFilename: 'status_report_rej.csv'
      });

      // Deduplication check: second run should not create duplicate rows
      const excCount2 = await ReconciliationException.countDocuments({ claimId: 'CLM-RECON-REJ' });
      expect(excCount2).toBe(1);
    });

    it('[STATE-06] Deadline fallback sweeper job is idempotent on repeated invocations', async () => {
      const expiredCase = await Case.create({
        name: 'Sweeper Idempotent Case',
        docketNumber: '1:24-cv-SWEEP-01',
        lawFirmId: 'FIRM-M6-T5',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() - 86400000 * 5),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      await Claimant.create({
        caseId: expiredCase._id,
        claimId: 'CLM-SWEEP-01',
        firstName: 'Ian',
        lastName: 'Swept',
        email: 'ian@example.com',
        settlementAmount: 200.0,
        status: 'pending_selection'
      });

      // First sweep
      const run1 = await executeDeadlineFallback({ caseId: expiredCase._id.toString() });
      expect(run1.modifiedCount).toBe(1);
      expect(run1.casesUpdated).toBe(1);

      const afterRun1 = await Claimant.findOne({ claimId: 'CLM-SWEEP-01' });
      expect(afterRun1?.status).toBe('deadline_expired');
      expect(afterRun1?.selectedPaymentMethod).toBe('physical_check');

      // Second sweep (must be idempotent)
      const run2 = await executeDeadlineFallback({ caseId: expiredCase._id.toString() });
      expect(run2.modifiedCount).toBe(0);
      expect(run2.casesUpdated).toBe(0);
    });
  });

  // =========================================================================
  // BATTERY 4: Streaming CSV Export Edge Cases
  // =========================================================================
  describe('Battery 4: Streaming CSV Export Edge Cases', () => {
    it('[CSV-01] Formula injection attack prefixes (=+@-) are neutralized in CSV export', async () => {
      const equalsFormula = '=cmd|\' /C calc\'!A0';
      const atFormula = '@SUM(1,2)';
      const plusFormula = '+1234567';
      const minusFormula = '-2+5';

      const escapedEq = escapeCsvField(equalsFormula);
      const escapedAt = escapeCsvField(atFormula);
      const escapedPlus = escapeCsvField(plusFormula);
      const escapedMinus = escapeCsvField(minusFormula);

      // Verified security remediation:
      // Formula triggers have an apostrophe prepended, neutralizing execution in Excel/Calc
      expect(escapedEq.startsWith("'")).toBe(true);
      expect(escapedAt.startsWith("\"'")).toBe(true);
      expect(escapedPlus.startsWith("'")).toBe(true);
      expect(escapedMinus.startsWith("'")).toBe(true);
    });

    it('[CSV-02] RFC 4180 complex field escaping and exact 22 column layout', async () => {
      const claimant = new Claimant({
        caseId: firmCase._id,
        claimId: 'CLM-RFC-01',
        firstName: 'Jane "Janie"',
        lastName: 'Doe, MD',
        email: 'janie@example.com',
        phone: '555-0199',
        address: {
          street: '123 Main St; Suite 400',
          city: 'Los Angeles, CA',
          state: 'CA',
          zip: '90001'
        },
        settlementAmount: 1250.5,
        status: 'selected',
        selectedPaymentMethod: 'direct_deposit',
        paymentDetails: {
          routingNumber: '021000021',
          accountNumber: '9876543210'
        },
        digitalSignature: 'Jane Doe',
        signatureIp: '192.168.1.100',
        signedAt: new Date('2026-10-01T12:00:00Z'),
        selectedAt: new Date('2026-10-01T12:00:00Z'),
        confirmationNumber: 'CONF-RFC-01'
      });

      const exceptionMap = new Map();
      const row = buildAuditLedgerRow(claimant, exceptionMap);

      expect(row.length).toBe(CSV_HEADERS.length); // Must match 22 columns
      expect(row.length).toBe(22);

      // Verify masking
      const maskedIndex = CSV_HEADERS.indexOf('Masked Payment Details');
      expect(row[maskedIndex]).toBe('Routing: 021000021, Account: ****3210');

      // Verify escaping of quotes, commas, semicolons
      const escapedRow = row.map(escapeCsvField);
      const nameIndex = CSV_HEADERS.indexOf('Claimant Name');
      expect(escapedRow[nameIndex]).toBe('"Doe, MD, Jane ""Janie"""');

      const addressIndex = CSV_HEADERS.indexOf('Mailing Address');
      expect(escapedRow[addressIndex]).toContain('Suite 400');
    });

    it('[CSV-03] Early stream abort simulation in CsvExportService.streamAuditLedgerCsv', async () => {
      await Claimant.create({
        caseId: firmCase._id,
        claimId: 'CLM-ABORT-01',
        firstName: 'Stream',
        lastName: 'User',
        email: 'stream@example.com',
        settlementAmount: 100.0,
        status: 'pending_selection'
      });

      const chunks: string[] = [];
      let isAborted = false;

      const mockRes: any = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk.toString());
          if (chunks.length >= 1) {
            isAborted = true;
            this.destroy();
            return callback(new Error('ERR_STREAM_DESTROYED'));
          }
          callback();
        }
      });

      mockRes.on('error', () => {}); // Attach listener to prevent unhandled EventEmitter error
      mockRes.setHeader = () => {};

      try {
        await CsvExportService.streamAuditLedgerCsv(firmCase, [firmCase._id], mockRes);
      } catch (err: any) {
        expect(err).toBeDefined();
      }

      expect(isAborted).toBe(true);
      expect(chunks[0]).toContain('\uFEFF'); // UTF-8 BOM was emitted
    });

    it('[CSV-04] Masked payment details verification across diverse payment rails', () => {
      expect(maskPaymentDetails('ach', { routingNumber: '021000021', accountNumber: '123456789' })).toBe(
        'Routing: 021000021, Account: ****6789'
      );
      expect(maskPaymentDetails('push_to_debit', { cardNumber: '4111222233334444' })).toBe(
        'Card: **** **** **** 4444, Exp: **/**'
      );
      expect(maskPaymentDetails('digital_card', { email: 'user@card.com' })).toBe(
        'Digital Card: user@card.com'
      );
      expect(
        maskPaymentDetails('physical_check', { street: '123 Elm St', city: 'Dallas', state: 'TX', zip: '75001' })
      ).toBe('Mailed to: 123 Elm St, Dallas, TX 75001');
      expect(maskPaymentDetails('bitcoin', { bitcoinAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' })).toBe(
        'BTC: 1A1zP1...DivfNa'
      );
      expect(maskPaymentDetails('paypal', { paypalAccount: 'pay@example.com' })).toBe(
        'PayPal: pay@example.com'
      );
      expect(maskPaymentDetails('venmo', { venmoHandle: '@myvenmo' })).toBe('Venmo: @myvenmo');
      expect(maskPaymentDetails('zelle', { zelleContact: '555-1234' })).toBe('Zelle: 555-1234');
      expect(maskPaymentDetails('unknown', {})).toBe('N/A');
    });
  });
});
