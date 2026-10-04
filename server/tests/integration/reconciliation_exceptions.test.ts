import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { BatchGeneratorService } from '../../src/services/batchGenerator.service';
import { signToken } from '../../src/utils/jwt';

describe('Integration: Reconciliation Exception Management REST API', () => {
  let testCase: any;
  let adminToken: string;
  let auditorToken: string;
  let otherFirmToken: string;
  let otherFirmAuditorToken: string;
  let noFirmToken: string;

  beforeAll(async () => {
    await setupTestDb('rec_exceptions');
    adminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm1.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-001'
    });

    auditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm1.com',
      role: 'auditor',
      lawFirmId: 'FIRM-001'
    });

    otherFirmToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm2.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-OTHER-999'
    });

    otherFirmAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm2.com',
      role: 'auditor',
      lawFirmId: 'FIRM-OTHER-999'
    });

    noFirmToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'nofirm@example.com',
      role: 'case_manager'
    });
  });

  afterAll(async () => {
    await teardownTestDb('rec_exceptions');
  });

  beforeEach(async () => {
    await clearTestDb('rec_exceptions');
    testCase = await Case.create({
      caseId: 'CASE-EX-TEST-001',
      name: 'In re Tech Settlement',
      docketNumber: '1:24-cv-09821',
      lawFirmId: 'FIRM-001',
      settlementFundTotal: 50000,
      disbursementDeadline: new Date(Date.now() + 86400000 * 30),
      fallbackPaymentMethod: 'physical_check'
    });
  });

  it('GET /api/cases/:id/exceptions lists filterable exceptions with summary and pagination', async () => {
    // Seed 2 exceptions: 1 open, 1 resolved
    await ReconciliationException.create([
      {
        caseId: testCase._id,
        claimId: 'CLM-01',
        paymentRail: 'ach',
        amount: 150.0,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        returnReason: 'Customer closed account',
        resolved: false,
        resolutionStatus: 'open'
      },
      {
        caseId: testCase._id,
        claimId: 'CLM-02',
        paymentRail: 'digital_card',
        amount: 200.0,
        currency: 'USD',
        status: 'REJECTED',
        exceptionType: 'card_decline',
        returnCode: 'CARD_BLOCKED',
        returnReason: 'Card blocked',
        resolved: true,
        resolutionStatus: 'resolved'
      }
    ]);

    const res = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.exceptions.length).toBe(2);
    expect(res.body.pagination.totalRecords).toBe(2);
    expect(res.body.summary.openCount).toBe(1);
    expect(res.body.summary.resolvedCount).toBe(1);

    // Test filter by resolved=false
    const resOpen = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions?resolved=false`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resOpen.status).toBe(200);
    expect(resOpen.body.exceptions.length).toBe(1);
    expect(resOpen.body.exceptions[0].claimId).toBe('CLM-01');

    // Test filter by errorCode
    const resCode = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions?errorCode=CARD_BLOCKED`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resCode.status).toBe(200);
    expect(resCode.body.exceptions.length).toBe(1);
    expect(resCode.body.exceptions[0].claimId).toBe('CLM-02');
  });

  it('POST /api/cases/:id/exceptions/:exceptionId/resolve with switch_to_check updates claimant address and requeues for sftp', async () => {
    const claimant = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-SW-01',
      firstName: 'Marcus',
      lastName: 'Aurelius',
      email: 'marcus@example.com',
      settlementAmount: 450.0,
      status: 'returned',
      selectedPaymentMethod: 'ach',
      failureCode: 'R02'
    });

    const ex = await ReconciliationException.create({
      caseId: testCase._id,
      claimantId: claimant._id,
      claimId: 'CLM-SW-01',
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

    const payload = {
      action: 'switch_to_check',
      updatedAddress: {
        street1: '12 Imperial Way',
        city: 'Rome',
        state: 'GA',
        zip: '30161'
      },
      reason: 'Claimant provided confirmed physical address after bank account closed'
    };

    const res = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.exception.resolved).toBe(true);
    expect(res.body.exception.resolutionStatus).toBe('resolved_switched_to_check');

    const updatedClaimant = await Claimant.findById(claimant._id);
    expect(updatedClaimant?.status).toBe('selected');
    expect(updatedClaimant?.selectedPaymentMethod).toBe('physical_check');
    expect(updatedClaimant?.address?.city).toBe('Rome');
    expect(updatedClaimant?.address?.state).toBe('GA');
    expect(updatedClaimant?.requeuedAt).toBeDefined();
  });

  it('POST /api/cases/:id/exceptions/:exceptionId/resolve with resend_email resets selection token and status', async () => {
    const claimant = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-EM-01',
      firstName: 'Julia',
      lastName: 'Roberts',
      email: 'julia@example.com',
      settlementAmount: 300.0,
      status: 'rejected',
      failureCode: 'CARD_BLOCKED'
    });

    const ex = await ReconciliationException.create({
      caseId: testCase._id,
      claimantId: claimant._id,
      claimId: 'CLM-EM-01',
      paymentRail: 'digital_card',
      amount: 300.0,
      currency: 'USD',
      status: 'REJECTED',
      exceptionType: 'card_decline',
      returnCode: 'CARD_BLOCKED',
      resolved: false,
      resolutionStatus: 'open'
    });

    const res = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'resend_email',
        reason: 'Reset selection flow for new card entry'
      });

    expect(res.status).toBe(200);
    expect(res.body.exception.resolutionStatus).toBe('resolved_resent_email');

    const updatedClaimant = await Claimant.findById(claimant._id);
    expect(updatedClaimant?.status).toBe('pending_selection');
    expect(updatedClaimant?.paymentSelectionToken).toBeDefined();
  });

  it('auditor role can view exceptions (200 OK) but is blocked from resolving exceptions (403 Forbidden)', async () => {
    const ex = await ReconciliationException.create({
      caseId: testCase._id,
      claimId: 'CLM-AUD-01',
      amount: 100.0,
      status: 'RETURNED',
      exceptionType: 'ach_return',
      returnCode: 'R01',
      resolved: false,
      resolutionStatus: 'open'
    });

    // Auditor read succeeds
    const getRes = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions`)
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(getRes.status).toBe(200);

    // Auditor write is blocked
    const postRes = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ action: 'mark_resolved', reason: 'Audit close' });

    expect(postRes.status).toBe(403);
  });

  it('attempting to resolve non-existent exception ID returns 404 Not Found with EXCEPTION_NOT_FOUND', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/${fakeId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'mark_resolved' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('EXCEPTION_NOT_FOUND');
  });

  it('blocks cross-tenant access to another law firm case exceptions with 403 Forbidden', async () => {
    const res = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions`)
      .set('Authorization', `Bearer ${otherFirmToken}`);

    expect(res.status).toBe(403);
  });

  it('blocks cross-tenant access for auditor with mismatched lawFirmId with 403 Forbidden', async () => {
    const res = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions`)
      .set('Authorization', `Bearer ${otherFirmAuditorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden');
  });

  it('blocks access for user token with missing lawFirmId with 403 Forbidden', async () => {
    const res = await request(app)
      .get(`/api/cases/${testCase._id}/exceptions`)
      .set('Authorization', `Bearer ${noFirmToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden');
  });

  it('POST /api/cases/:id/exceptions/:exceptionId/resolve resolves smoothly via non-ObjectId claimId without CastError', async () => {
    const claimant = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-NON-OBJID-01',
      firstName: 'Seneca',
      lastName: 'Younger',
      email: 'seneca@example.com',
      settlementAmount: 120.0,
      status: 'returned',
      failureCode: 'R03'
    });

    const ex = await ReconciliationException.create({
      caseId: testCase._id,
      claimantId: claimant._id,
      claimId: 'CLM-NON-OBJID-01',
      paymentRail: 'ach',
      amount: 120.0,
      currency: 'USD',
      status: 'RETURNED',
      exceptionType: 'ach_return',
      returnCode: 'R03',
      returnReason: 'Unable to Locate Account',
      resolved: false,
      resolutionStatus: 'open'
    });

    // Invoke endpoint with string claimId 'CLM-NON-OBJID-01' instead of ObjectId
    const res = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/CLM-NON-OBJID-01/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'mark_resolved',
        reason: 'Resolved via non-ObjectId claimId lookup'
      });

    expect(res.status).toBe(200);
    expect(res.body.exception.resolved).toBe(true);
    expect(res.body.exception.claimId).toBe('CLM-NON-OBJID-01');

    const updatedEx = await ReconciliationException.findById(ex._id);
    expect(updatedEx?.resolved).toBe(true);
    expect(updatedEx?.resolutionStatus).toBe('resolved');
  });

  it('resolving exception via requeue_sftp transitions claimant to selected and enables bundling in compileAndSpoolCaseBatch', async () => {
    const claimant = await Claimant.create({
      caseId: testCase._id,
      claimId: 'CLM-BATCH-REQUEUE-01',
      firstName: 'Cleopatra',
      lastName: 'Ptolemy',
      email: 'cleo@example.com',
      settlementAmount: 880.0,
      status: 'returned',
      selectedPaymentMethod: 'ach',
      paymentDetails: {
        accountNumber: '123456789',
        routingNumber: '021000021',
        accountType: 'checking'
      },
      failureCode: 'R01'
    });

    const ex = await ReconciliationException.create({
      caseId: testCase._id,
      claimantId: claimant._id,
      claimId: 'CLM-BATCH-REQUEUE-01',
      paymentRail: 'ach',
      amount: 880.0,
      currency: 'USD',
      status: 'RETURNED',
      exceptionType: 'ach_return',
      returnCode: 'R01',
      returnReason: 'Insufficient Funds',
      resolved: false,
      resolutionStatus: 'open'
    });

    const res = await request(app)
      .post(`/api/cases/${testCase._id}/exceptions/${ex._id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'requeue_sftp',
        reason: 'Requeueing for next scheduled batch generation'
      });

    expect(res.status).toBe(200);
    expect(res.body.exception.resolved).toBe(true);
    expect(res.body.exception.resolutionStatus).toBe('resolved_requeued');

    const updatedClaimant = await Claimant.findById(claimant._id);
    expect(updatedClaimant?.status).toBe('selected');
    expect(updatedClaimant?.requeuedAt).toBeDefined();

    // Verify compileAndSpoolCaseBatch picks up the resolved claimant
    const batchResult = await BatchGeneratorService.compileAndSpoolCaseBatch(testCase._id.toString());
    expect(batchResult.batchId).toBeDefined();
    expect(batchResult.totalRecords).toBe(1);
    expect(batchResult.totalAmount).toBe(880.0);

    const batchedClaimant = await Claimant.findById(claimant._id);
    expect(batchedClaimant?.status).toBe('queued_for_sftp');
    expect(batchedClaimant?.batchId).toBe(batchResult.batchId);
  });
});
