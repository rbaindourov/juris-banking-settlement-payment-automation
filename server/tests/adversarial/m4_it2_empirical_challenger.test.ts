import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';
import { signToken } from '../../src/utils/jwt';

describe('Empirical Challenger: M4-IT2 Multi-Tenant Scoping, State Machine Round-Trip, and Identifier Parsing', () => {
  let caseFirmA: any;
  let caseFirmB: any;
  let caseNoFirm: any;

  // Tokens for various roles and tenants
  let firmAAdminToken: string;
  let firmAAuditorToken: string;
  let firmACaseManagerToken: string;

  let firmBAdminToken: string;
  let firmBAuditorToken: string;

  let noFirmAuditorToken: string;
  let noFirmManagerToken: string;

  let superAdminToken: string;
  let platformAdminToken: string;

  beforeAll(async () => {
    await setupTestDb('m4_it2_challenger');

    firmAAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-a.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-A'
    });

    firmAAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-a.com',
      role: 'auditor',
      lawFirmId: 'FIRM-A'
    });

    firmACaseManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'manager@firm-a.com',
      role: 'case_manager',
      lawFirmId: 'FIRM-A'
    });

    firmBAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-b.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-B'
    });

    firmBAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-b.com',
      role: 'auditor',
      lawFirmId: 'FIRM-B'
    });

    noFirmAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@nofirm.com',
      role: 'auditor'
    });

    noFirmManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'manager@nofirm.com',
      role: 'case_manager'
    });

    superAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'superadmin@platform.internal',
      role: 'super_admin'
    });

    platformAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'platformadmin@platform.internal',
      role: 'platform_admin'
    });
  });

  afterAll(async () => {
    await teardownTestDb('m4_it2_challenger');
  });

  beforeEach(async () => {
    await clearTestDb('m4_it2_challenger');

    const runId = new mongoose.Types.ObjectId().toString().substring(18);

    caseFirmA = await Case.create({
      caseId: `CASE-FIRM-A-${runId}`,
      name: 'Class Action Firm A Settlement',
      docketNumber: '1:24-cv-00101',
      lawFirmId: 'FIRM-A',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check'
    });

    caseFirmB = await Case.create({
      caseId: `CASE-FIRM-B-${runId}`,
      name: 'Class Action Firm B Settlement',
      docketNumber: '2:24-cv-00202',
      lawFirmId: 'FIRM-B',
      settlementFundTotal: 200000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check'
    });

    const orphanDoc = {
      caseId: `CASE-ORPHAN-${runId}`,
      name: 'Unassigned Case Settlement',
      docketNumber: '3:24-cv-00303',
      settlementFundTotal: 50000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    };
    const insertRes = await Case.collection.insertOne(orphanDoc as any);
    caseNoFirm = await Case.findById(insertRes.insertedId);
  });

  // =========================================================================
  // Dimension 1: Multi-Tenant Boundary Security & Cross-Case Authorization
  // =========================================================================
  describe('Dimension 1: Multi-Tenant Boundary Security', () => {
    it('[TENANT-01] Auditor of Firm A cannot query exceptions for Case of Firm B (403 Forbidden)', async () => {
      // Seed exception in Firm B's case
      await ReconciliationException.create({
        caseId: caseFirmB._id,
        claimId: 'CLM-FIRM-B-01',
        paymentRail: 'ach',
        amount: 250.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Firm A auditor attempts to query Firm B's case
      const res = await request(app)
        .get(`/api/cases/${caseFirmB._id}/exceptions`)
        .set('Authorization', `Bearer ${firmAAuditorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden|Cross-tenant resource access forbidden/i);
    });

    it('[TENANT-02] User token with missing lawFirmId cannot query exceptions (403 Forbidden)', async () => {
      // Missing lawFirmId for auditor
      const resAuditor = await request(app)
        .get(`/api/cases/${caseFirmA._id}/exceptions`)
        .set('Authorization', `Bearer ${noFirmAuditorToken}`);

      expect(resAuditor.status).toBe(403);
      expect(resAuditor.body.error).toMatch(/Forbidden|Cross-tenant resource access forbidden/i);

      // Missing lawFirmId for case manager
      const resManager = await request(app)
        .get(`/api/cases/${caseFirmA._id}/exceptions`)
        .set('Authorization', `Bearer ${noFirmManagerToken}`);

      expect(resManager.status).toBe(403);
      expect(resManager.body.error).toMatch(/Forbidden|Cross-tenant resource access forbidden/i);
    });

    it('[TENANT-03] super_admin and platform_admin can query exceptions across all cases', async () => {
      // Seed exceptions in Firm A and Firm B
      await ReconciliationException.create([
        {
          caseId: caseFirmA._id,
          claimId: 'CLM-FA-01',
          paymentRail: 'ach',
          amount: 150.0,
          currency: 'USD',
          status: 'RETURNED',
          exceptionType: 'ach_return',
          returnCode: 'R01',
          resolved: false,
          resolutionStatus: 'open'
        },
        {
          caseId: caseFirmB._id,
          claimId: 'CLM-FB-01',
          paymentRail: 'digital_card',
          amount: 220.0,
          currency: 'USD',
          status: 'REJECTED',
          exceptionType: 'card_decline',
          returnCode: 'CARD_BLOCKED',
          resolved: false,
          resolutionStatus: 'open'
        }
      ]);

      // super_admin querying Firm A case
      const resSuperA = await request(app)
        .get(`/api/cases/${caseFirmA._id}/exceptions`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resSuperA.status).toBe(200);
      expect(resSuperA.body.exceptions).toHaveLength(1);
      expect(resSuperA.body.exceptions[0].claimId).toBe('CLM-FA-01');

      // super_admin querying Firm B case
      const resSuperB = await request(app)
        .get(`/api/cases/${caseFirmB._id}/exceptions`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resSuperB.status).toBe(200);
      expect(resSuperB.body.exceptions).toHaveLength(1);
      expect(resSuperB.body.exceptions[0].claimId).toBe('CLM-FB-01');

      // platform_admin querying Firm A case
      const resPlatformA = await request(app)
        .get(`/api/cases/${caseFirmA._id}/exceptions`)
        .set('Authorization', `Bearer ${platformAdminToken}`);
      expect(resPlatformA.status).toBe(200);
      expect(resPlatformA.body.exceptions).toHaveLength(1);

      // platform_admin querying Firm B case
      const resPlatformB = await request(app)
        .get(`/api/cases/${caseFirmB._id}/exceptions`)
        .set('Authorization', `Bearer ${platformAdminToken}`);
      expect(resPlatformB.status).toBe(200);
      expect(resPlatformB.body.exceptions).toHaveLength(1);
    });

    it('[TENANT-04] Case with null or missing lawFirmId rejects non-super/platform admins (fail-closed)', async () => {
      await ReconciliationException.create({
        caseId: caseNoFirm._id,
        claimId: 'CLM-ORPHAN-01',
        paymentRail: 'ach',
        amount: 300.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Firm A admin attempting to query orphan case
      const resAdmin = await request(app)
        .get(`/api/cases/${caseNoFirm._id}/exceptions`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);
      expect(resAdmin.status).toBe(403);

      // super_admin CAN query orphan case
      const resSuper = await request(app)
        .get(`/api/cases/${caseNoFirm._id}/exceptions`)
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resSuper.status).toBe(200);
      expect(resSuper.body.exceptions).toHaveLength(1);
    });

    it('[TENANT-05] Cross-tenant exception resolution attempt is rejected with 403 Forbidden', async () => {
      const exB = await ReconciliationException.create({
        caseId: caseFirmB._id,
        claimId: 'CLM-FB-RESOLVE-01',
        paymentRail: 'ach',
        amount: 500.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Firm A admin attempting to resolve Firm B's exception
      const res = await request(app)
        .post(`/api/cases/${caseFirmB._id}/exceptions/${exB._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({ action: 'mark_resolved', reason: 'Cross-tenant attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/i);
    });

    it('[TENANT-06] Auditor with matching lawFirmId can READ exceptions (200) but CANNOT resolve them (403 Forbidden)', async () => {
      const exA = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-FA-AUD-01',
        paymentRail: 'ach',
        amount: 100.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Read succeeds
      const readRes = await request(app)
        .get(`/api/cases/${caseFirmA._id}/exceptions`)
        .set('Authorization', `Bearer ${firmAAuditorToken}`);
      expect(readRes.status).toBe(200);

      // Resolve fails with 403
      const writeRes = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${exA._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAuditorToken}`)
        .send({ action: 'mark_resolved', reason: 'Auditor resolution attempt' });
      expect(writeRes.status).toBe(403);
      expect(writeRes.body.error).toMatch(/Forbidden/i);
    });

    it('[TENANT-07] Unauthenticated request without JWT returns 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/cases/${caseFirmA._id}/exceptions`);
      expect(res.status).toBe(401);
    });

    it('[TENANT-08] Case lookup by string caseId enforces multi-tenant boundary', async () => {
      // Firm A admin querying Firm B case by string caseId
      const resCross = await request(app)
        .get(`/api/cases/${caseFirmB.caseId}/exceptions`)
        .set('Authorization', `Bearer ${firmAAdminToken}`);
      expect(resCross.status).toBe(403);

      // Firm B admin querying Firm B case by string caseId
      const resOwn = await request(app)
        .get(`/api/cases/${caseFirmB.caseId}/exceptions`)
        .set('Authorization', `Bearer ${firmBAdminToken}`);
      expect(resOwn.status).toBe(200);
    });
  });

  // =========================================================================
  // Dimension 2: Exception Resolution with Non-ObjectId Identifiers
  // =========================================================================
  describe('Dimension 2: Non-ObjectId Identifier Parsing & Resolution', () => {
    it('[ID-PARSE-01] Resolves exception smoothly when exceptionId is a string claimId without triggering CastError', async () => {
      const claimant = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-STRING-ID-9999',
        firstName: 'Marcus',
        lastName: 'Aurelius',
        email: 'marcus@stoic.example',
        settlementAmount: 450.0,
        status: 'returned',
        failureCode: 'R02'
      });

      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimantId: claimant._id,
        claimId: 'CLM-STRING-ID-9999',
        paymentRail: 'ach',
        amount: 450.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        returnReason: 'Account Closed',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Call resolve endpoint passing 'CLM-STRING-ID-9999' as exceptionId param
      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/CLM-STRING-ID-9999/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'mark_resolved',
          reason: 'Verified account closure resolved manually'
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Exception successfully resolved');
      expect(res.body.exception.resolved).toBe(true);
      expect(res.body.exception.claimId).toBe('CLM-STRING-ID-9999');

      // Verify DB record
      const refreshedEx = await ReconciliationException.findById(ex._id);
      expect(refreshedEx?.resolved).toBe(true);
      expect(refreshedEx?.resolutionStatus).toBe('resolved');
      expect(refreshedEx?.resolutionNotes).toBe('Verified account closure resolved manually');
    });

    it('[ID-PARSE-02] Resolves exception smoothly with complex non-ObjectId string (hyphens, hashes, colons)', async () => {
      const complexClaimId = 'CLAIM:LEGAL-2026#0042-ALPHA';

      const claimant = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: complexClaimId,
        firstName: 'Epictetus',
        lastName: 'Hierapolis',
        email: 'epictetus@stoic.example',
        settlementAmount: 175.5,
        status: 'returned',
        failureCode: 'R01'
      });

      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimantId: claimant._id,
        claimId: complexClaimId,
        paymentRail: 'ach',
        amount: 175.5,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${encodeURIComponent(complexClaimId)}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'requeue_sftp',
          reason: 'Re-queue complex claim ID for processing'
        });

      expect(res.status).toBe(200);
      expect(res.body.exception.claimId).toBe(complexClaimId);
      expect(res.body.exception.resolved).toBe(true);
    });

    it('[ID-PARSE-03] Resolves exception when exceptionId is a standard 24-hex ObjectId', async () => {
      const claimant = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-HEX-OBJ-01',
        firstName: 'Seneca',
        lastName: 'Corduba',
        email: 'seneca@stoic.example',
        settlementAmount: 600.0,
        status: 'returned',
        failureCode: 'R01'
      });

      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimantId: claimant._id,
        claimId: 'CLM-HEX-OBJ-01',
        paymentRail: 'ach',
        amount: 600.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'mark_resolved',
          reason: 'Resolved using standard ObjectId'
        });

      expect(res.status).toBe(200);
      expect(res.body.exception.id).toBe(ex._id.toString());
      expect(res.body.exception.resolved).toBe(true);
    });

    it('[ID-PARSE-04] Non-existent non-ObjectId identifier returns 404 EXCEPTION_NOT_FOUND without 500 or CastError', async () => {
      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/NON-EXISTENT-CLAIM-9999/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'mark_resolved',
          reason: 'Non-existent test'
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('EXCEPTION_NOT_FOUND');
      expect(res.body.message).toContain('NON-EXISTENT-CLAIM-9999');
    });

    it('[ID-PARSE-05] switch_to_check requires updatedAddress and validates 2-letter state code (400 Bad Request)', async () => {
      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-SCHEMA-VAL-01',
        paymentRail: 'ach',
        amount: 50.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // Missing updatedAddress
      const resMissing = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({ action: 'switch_to_check', reason: 'Missing address test' });
      expect(resMissing.status).toBe(400);

      // Invalid state code (not 2 letters)
      const resBadState = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'switch_to_check',
          updatedAddress: {
            street1: '123 Fake St',
            city: 'Springfield',
            state: 'CALIFORNIA',
            zip: '90210'
          }
        });
      expect(resBadState.status).toBe(400);
    });
  });

  // =========================================================================
  // Dimension 3: State Machine Round-Trip & Outbound Batch Spooling
  // =========================================================================
  describe('Dimension 3: State Machine Round-Trip & Outbound Batch Spooling', () => {
    it('[ROUND-TRIP-01] switch_to_check transitions claimant to "selected" and is bundled into outbound batch CSV & trailer totals', async () => {
      // 1. Create claimant in 'returned' state
      const claimant = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-SWITCH-CHECK-101',
        firstName: 'Benjamin',
        lastName: 'Franklin',
        email: 'ben@example.com',
        settlementAmount: 1250.75,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        failureCode: 'R02',
        rejectionReason: 'Account Closed'
      });

      // 2. Create exception
      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimantId: claimant._id,
        claimId: 'CLM-SWITCH-CHECK-101',
        paymentRail: 'ach',
        amount: 1250.75,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        returnReason: 'Account Closed',
        resolved: false,
        resolutionStatus: 'open'
      });

      // 3. Resolve via switch_to_check
      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'switch_to_check',
          reason: 'Reissuing physical check to updated street address',
          updatedAddress: {
            street1: '1776 Independence Way',
            street2: 'Apt 4B',
            city: 'Philadelphia',
            state: 'PA',
            zip: '19106'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.claimant.status).toBe('selected');
      expect(res.body.claimant.selectedPaymentMethod).toBe('physical_check');

      // Verify claimant in DB
      const verifiedClaimant = await Claimant.findById(claimant._id);
      expect(verifiedClaimant?.status).toBe('selected');
      expect(verifiedClaimant?.selectedPaymentMethod).toBe('physical_check');
      expect(verifiedClaimant?.address?.city).toBe('Philadelphia');
      expect(verifiedClaimant?.requeuedAt).toBeDefined();
      expect(verifiedClaimant?.failureCode).toBeUndefined();

      // 4. Compile and spool outbound batch
      const batchResult = await BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmA._id.toString());

      expect(batchResult.batchId).toBeDefined();
      expect(batchResult.totalRecords).toBe(1);
      expect(batchResult.totalAmount).toBe(1250.75);
      expect(batchResult.railBreakdown.check.count).toBe(1);
      expect(batchResult.railBreakdown.check.amount).toBe(1250.75);

      // Verify generated CSV content on disk
      const csvOnDisk = fs.readFileSync(batchResult.csvPath, 'utf8');
      expect(csvOnDisk).toContain('CLM-SWITCH-CHECK-101');
      expect(csvOnDisk).toContain('1776 Independence Way, Apt 4B');
      expect(csvOnDisk).toContain('Philadelphia');
      expect(csvOnDisk).toContain('PA');
      expect(csvOnDisk).toContain('19106');
      expect(csvOnDisk).toContain('1250.75');

      // Verify trailer record
      const lines = csvOnDisk.trim().split('\n');
      const trailerLine = lines[lines.length - 1];
      expect(trailerLine).toMatch(/^(TRAILER|T),1,1250\.75/);

      // 5. Verify claimant transitioned to queued_for_sftp after batch spooling
      const batchedClaimant = await Claimant.findById(claimant._id);
      expect(batchedClaimant?.status).toBe('queued_for_sftp');
      expect(batchedClaimant?.batchId).toBe(batchResult.batchId);
      expect(batchedClaimant?.batchFilename).toBe(batchResult.filename);
    });

    it('[ROUND-TRIP-02] requeue_sftp transitions claimant to "selected" and is bundled into outbound batch CSV & trailer totals', async () => {
      // 1. Create claimant in 'returned' state with valid ACH details
      const claimant = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-REQUEUE-ACH-202',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@computing.example',
        settlementAmount: 840.5,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        paymentDetails: {
          accountNumber: '987654321',
          routingNumber: '021000021',
          accountType: 'checking'
        },
        failureCode: 'R01',
        rejectionReason: 'Insufficient Funds'
      });

      // 2. Create exception
      const ex = await ReconciliationException.create({
        caseId: caseFirmA._id,
        claimantId: claimant._id,
        claimId: 'CLM-REQUEUE-ACH-202',
        paymentRail: 'ach',
        amount: 840.5,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      // 3. Resolve via requeue_sftp
      const res = await request(app)
        .post(`/api/cases/${caseFirmA._id}/exceptions/${ex._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAdminToken}`)
        .send({
          action: 'requeue_sftp',
          reason: 'Fund deposit confirmed, requeue for ACH batch'
        });

      expect(res.status).toBe(200);
      expect(res.body.claimant.status).toBe('selected');

      const verifiedClaimant = await Claimant.findById(claimant._id);
      expect(verifiedClaimant?.status).toBe('selected');
      expect(verifiedClaimant?.requeuedAt).toBeDefined();

      // 4. Compile and spool outbound batch
      const batchResult = await BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmA._id.toString());
      expect(batchResult.totalRecords).toBe(1);
      expect(batchResult.totalAmount).toBe(840.5);
      expect(batchResult.railBreakdown.ach.count).toBe(1);

      // Verify CSV on disk
      const csvOnDisk = fs.readFileSync(batchResult.csvPath, 'utf8');
      expect(csvOnDisk).toContain('CLM-REQUEUE-ACH-202');
      expect(csvOnDisk).toContain('021000021');
      expect(csvOnDisk).toContain('840.50');

      const lines = csvOnDisk.trim().split('\n');
      const trailerLine = lines[lines.length - 1];
      expect(trailerLine).toMatch(/^(TRAILER|T),1,840\.50/);

      // Verify claimant is now queued_for_sftp
      const batchedClaimant = await Claimant.findById(claimant._id);
      expect(batchedClaimant?.status).toBe('queued_for_sftp');
    });

    it('[ROUND-TRIP-03] Multi-claimant batch generation correctly segregates resolved vs non-eligible claimants', async () => {
      // 1. Claimant A: Resolved via switch_to_check ($150.00) -> status: selected
      const clmA = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-A',
        firstName: 'Claimant',
        lastName: 'A',
        email: 'a@example.com',
        settlementAmount: 150.0,
        status: 'selected',
        selectedPaymentMethod: 'physical_check',
        address: {
          street: '123 Main St',
          city: 'Atlanta',
          state: 'GA',
          zip: '30301'
        }
      });

      // 2. Claimant B: Resolved via requeue_sftp ($250.00) -> status: selected
      const clmB = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-B',
        firstName: 'Claimant',
        lastName: 'B',
        email: 'b@example.com',
        settlementAmount: 250.0,
        status: 'selected',
        selectedPaymentMethod: 'ach',
        paymentDetails: {
          accountNumber: '111222333',
          routingNumber: '021000021',
          accountType: 'savings'
        }
      });

      // 3. Claimant C: Standard selected claimant ($300.00) -> status: selected
      const clmC = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-C',
        firstName: 'Claimant',
        lastName: 'C',
        email: 'c@example.com',
        settlementAmount: 300.0,
        status: 'selected',
        selectedPaymentMethod: 'physical_check',
        address: {
          street: '456 Oak Ave',
          city: 'Savannah',
          state: 'GA',
          zip: '31401'
        }
      });

      // 4. Claimant D: Unresolved exception ($400.00) -> status: returned (NOT eligible)
      const clmD = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-D',
        firstName: 'Claimant',
        lastName: 'D',
        email: 'd@example.com',
        settlementAmount: 400.0,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        failureCode: 'R01'
      });

      // 5. Claimant E: Already batched ($500.00) -> status: queued_for_sftp (NOT eligible)
      const clmE = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-E',
        firstName: 'Claimant',
        lastName: 'E',
        email: 'e@example.com',
        settlementAmount: 500.0,
        status: 'queued_for_sftp',
        batchId: 'BATCH-PREVIOUS-001'
      });

      // 6. Claimant F: Resolved via resend_email ($600.00) -> status: pending_selection (NOT eligible)
      const clmF = await Claimant.create({
        caseId: caseFirmA._id,
        claimId: 'CLM-MULTI-F',
        firstName: 'Claimant',
        lastName: 'F',
        email: 'f@example.com',
        settlementAmount: 600.0,
        status: 'pending_selection'
      });

      // Compile batch
      const batchResult = await BatchGeneratorService.compileAndSpoolCaseBatch(caseFirmA._id.toString());

      // Only A, B, and C should be included: 150 + 250 + 300 = 700
      expect(batchResult.totalRecords).toBe(3);
      expect(batchResult.totalAmount).toBe(700.0);
      expect(batchResult.railBreakdown.check.count).toBe(2);
      expect(batchResult.railBreakdown.check.amount).toBe(450.0);
      expect(batchResult.railBreakdown.ach.count).toBe(1);
      expect(batchResult.railBreakdown.ach.amount).toBe(250.0);

      const csvContent = fs.readFileSync(batchResult.csvPath, 'utf8');
      expect(csvContent).toContain('CLM-MULTI-A');
      expect(csvContent).toContain('CLM-MULTI-B');
      expect(csvContent).toContain('CLM-MULTI-C');
      expect(csvContent).not.toContain('CLM-MULTI-D');
      expect(csvContent).not.toContain('CLM-MULTI-E');
      expect(csvContent).not.toContain('CLM-MULTI-F');

      const lines = csvContent.trim().split('\n');
      const trailerLine = lines[lines.length - 1];
      expect(trailerLine).toMatch(/^(TRAILER|T),3,700\.00/);

      // Check final statuses
      const updatedA = await Claimant.findById(clmA._id);
      expect(updatedA?.status).toBe('queued_for_sftp');
      const updatedB = await Claimant.findById(clmB._id);
      expect(updatedB?.status).toBe('queued_for_sftp');
      const updatedC = await Claimant.findById(clmC._id);
      expect(updatedC?.status).toBe('queued_for_sftp');

      // Excluded claimants must be untouched
      const updatedD = await Claimant.findById(clmD._id);
      expect(updatedD?.status).toBe('returned');
      const updatedE = await Claimant.findById(clmE._id);
      expect(updatedE?.status).toBe('queued_for_sftp');
      expect(updatedE?.batchId).toBe('BATCH-PREVIOUS-001');
      const updatedF = await Claimant.findById(clmF._id);
      expect(updatedF?.status).toBe('pending_selection');
    });
  });
});
