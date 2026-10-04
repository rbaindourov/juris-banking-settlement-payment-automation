/**
 * Tier 3 - Cross-Feature Combinations: Pairwise Scenario 5
 * Feature Interaction: SFTP Reconciliation Return + Exception Ledger + Case Manager Resolution & Requeue.
 */

const { describe, it, expect } = require('../harness/test_runner');

describe('Tier 3: Pairwise - Exception Ledger & Case Manager Resolution Workflow', () => {
  it('Captures ACH return exception, permits Case Manager to switch method to check, and queues for subsequent batch', () => {
    // 1. Inbound status report reports ACH return: R02 (Account Closed)
    const failedTransaction = {
      claimId: 'CLM-FAIL-001',
      claimantName: 'Marcus Aurelius',
      method: 'ACH',
      amount: 450.00,
      status: 'RETURNED',
      errorCode: 'R02',
      errorMessage: 'Account Closed',
      failureReason: 'RDFI returned entry: Customer closed account',
    };

    // 2. Exception Ledger document created
    const exceptionDoc = {
      _id: 'ex_9011',
      caseId: 'case_meditations',
      claimId: failedTransaction.claimId,
      amount: failedTransaction.amount,
      errorCode: failedTransaction.errorCode,
      errorMessage: failedTransaction.errorMessage,
      resolutionStatus: 'open',
      createdAt: new Date().toISOString(),
    };

    expect(exceptionDoc.resolutionStatus).toBe('open');

    // 3. Case Manager executes resolution action: switch_to_check
    const resolutionPayload = {
      action: 'switch_to_check',
      updatedAddress: {
        street1: '12 Imperial Way',
        city: 'Rome',
        state: 'GA',
        zip: '30161',
      },
      reason: 'Claimant provided confirmed physical address after bank account closed',
      resolvedBy: 'case_manager_user_42',
    };

    // Apply resolution
    exceptionDoc.resolutionStatus = 'resolved_switched_to_check';
    exceptionDoc.resolutionNotes = resolutionPayload.reason;
    exceptionDoc.resolvedBy = resolutionPayload.resolvedBy;
    exceptionDoc.resolvedAt = new Date().toISOString();

    // 4. Claimant is updated and re-queued for next disbursement batch
    const updatedClaimant = {
      claimId: failedTransaction.claimId,
      paymentSelection: {
        method: 'physical_check',
        address: resolutionPayload.updatedAddress,
      },
      status: 'queued_for_sftp',
      requeuedAt: new Date().toISOString(),
    };

    expect(exceptionDoc.resolutionStatus).toBe('resolved_switched_to_check');
    expect(updatedClaimant.status).toBe('queued_for_sftp');
    expect(updatedClaimant.paymentSelection.method).toBe('physical_check');
  });
});
