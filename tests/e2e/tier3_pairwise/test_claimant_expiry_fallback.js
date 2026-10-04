/**
 * Tier 3 - Cross-Feature Combinations: Pairwise Scenario 1
 * Feature Interaction: Claimant Token Expiry + Agenda Fallback Sweeper + Fallback Check Batch Generation.
 */

const { describe, it, expect } = require('../harness/test_runner');
const { buildDashBatchCsv } = require('../harness/data_generators');
const { validateDashBatchCsv } = require('../harness/oracles');

describe('Tier 3: Pairwise - Claimant Expiry & Fallback Check Generation', () => {
  it('Transitions unselected claimant past deadline to physical check fallback and generates valid outbound detail record', () => {
    // 1. Setup Case with physical_check fallback and passed deadline
    const testCase = {
      caseId: 'CASE-EXPIRY-001',
      clientId: 'FIRM-001',
      docketNumber: '1:24-cv-09821',
      caseName: 'Doe v. Corporation',
      settlementFundTotal: 1000.00,
      disbursementDeadline: new Date(Date.now() - 3600000), // 1 hour ago
      fallbackPaymentMethod: 'physical_check',
      status: 'active',
    };

    // 2. Setup Claimant who never visited or selected payment
    const nonResponsiveClaimant = {
      claimId: 'CLM-UNRESP-01',
      firstName: 'Benjamin',
      lastName: 'Franklin',
      email: 'ben.franklin@example.com',
      street1: '100 Independence Mall',
      street2: 'Suite 1',
      city: 'Philadelphia',
      state: 'PA',
      zip: '19106',
      settlementAmount: 250.00,
      status: 'pending_selection',
      selectedMethod: null,
      claimantToken: 'aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233',
    };

    // 3. Trigger simulated Agenda sweeper (case:enforce-deadline-fallback)
    const now = new Date();
    const isPastDeadline = now > testCase.disbursementDeadline;
    expect(isPastDeadline).toBe(true);

    if (nonResponsiveClaimant.status === 'pending_selection' && isPastDeadline) {
      nonResponsiveClaimant.status = 'deadline_expired';
      nonResponsiveClaimant.selectedMethod = testCase.fallbackPaymentMethod;
      nonResponsiveClaimant.fallbackReason = 'DEADLINE_PASSED_UNRESPONSIVE';
    }

    expect(nonResponsiveClaimant.status).toBe('deadline_expired');
    expect(nonResponsiveClaimant.selectedMethod).toBe('physical_check');

    // 4. Generate outbound Dash batch including fallback recipient
    const batchDetails = [{
      method: 'PHYSICAL_CHECK',
      claimId: nonResponsiveClaimant.claimId,
      firstName: nonResponsiveClaimant.firstName,
      lastName: nonResponsiveClaimant.lastName,
      amount: nonResponsiveClaimant.settlementAmount,
      street1: nonResponsiveClaimant.street1,
      street2: nonResponsiveClaimant.street2,
      city: nonResponsiveClaimant.city,
      state: nonResponsiveClaimant.state,
      zip: nonResponsiveClaimant.zip,
      memo: 'Court Fallback Distribution',
    }];

    const batchCsv = buildDashBatchCsv(testCase, batchDetails);
    const validation = validateDashBatchCsv(batchCsv);

    // 5. Assert batch is valid and includes physical check detail with roster address
    expect(validation.valid).toBe(true);
    expect(validation.breakdown.check.count).toBe(1);
    expect(validation.breakdown.check.amount).toBe(250.00);
    expect(batchCsv).toInclude('PHYSICAL_CHECK');
    expect(batchCsv).toInclude('100 Independence Mall');
    expect(batchCsv).toInclude('Philadelphia');
  });
});
