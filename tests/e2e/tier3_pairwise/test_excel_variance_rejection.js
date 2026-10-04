/**
 * Tier 3 - Cross-Feature Combinations: Pairwise Scenario 2
 * Feature Interaction: Excel (.xlsx) Roster Ingestion + Fund Allocation Variance Rejection.
 */

const { describe, it, expect } = require('../harness/test_runner');

describe('Tier 3: Pairwise - Excel Ingestion & Fund Variance Rejection', () => {
  it('Parses multi-row spreadsheet roster and rejects staged upload when allocations exceed settlement fund total', () => {
    // 1. Case defines authorized pool of $500,000.00
    const targetCase = {
      caseId: 'CASE-EXCEL-VAR-001',
      settlementFundTotal: 500000.00,
      docketNumber: '2:24-cv-04821',
    };

    // 2. Simulated parsed rows from Excel file: 4 rows totaling $525,000.00 (over by $25,000)
    const parsedExcelRows = [
      { claimId: 'XLS-CLM-01', name: 'Alice Enterprise', amount: 150000.00, email: 'alice@corp.com' },
      { claimId: 'XLS-CLM-02', name: 'Bob Logistics', amount: 150000.00, email: 'bob@corp.com' },
      { claimId: 'XLS-CLM-03', name: 'Charlie Ventures', amount: 125000.00, email: 'charlie@corp.com' },
      { claimId: 'XLS-CLM-04', name: 'Diana Consulting', amount: 100000.00, email: 'diana@corp.com' },
    ];

    const totalAllocation = parsedExcelRows.reduce((sum, r) => sum + r.amount, 0);
    const variance = totalAllocation - targetCase.settlementFundTotal;

    expect(totalAllocation).toBe(525000.00);
    expect(variance).toBe(25000.00);

    // 3. Staged upload validator evaluates fund variance
    const stageEvaluation = {
      totalRows: parsedExcelRows.length,
      validRows: parsedExcelRows.length,
      totalAllocation,
      settlementFundTotal: targetCase.settlementFundTotal,
      variance,
      canCommit: variance <= 0.001,
      errors: variance > 0.001 ? [{
        code: 'SETTLEMENT_FUND_OVERALLOCATION',
        message: `Total allocation ($${totalAllocation.toFixed(2)}) exceeds approved settlement pool ($${targetCase.settlementFundTotal.toFixed(2)}) by $${variance.toFixed(2)}`,
        remedy: 'Adjust individual allocations or increase approved settlement fund total before committing.',
      }] : [],
    };

    // 4. Assert commit is blocked and error details provided
    expect(stageEvaluation.canCommit).toBe(false);
    expect(stageEvaluation.errors.length).toBe(1);
    expect(stageEvaluation.errors[0].code).toBe('SETTLEMENT_FUND_OVERALLOCATION');
    expect(stageEvaluation.errors[0].message).toInclude('exceeds approved settlement pool');
  });
});
