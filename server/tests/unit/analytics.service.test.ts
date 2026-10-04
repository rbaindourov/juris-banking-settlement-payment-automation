import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { AnalyticsService } from '../../src/services/analytics.service';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';

describe('Unit: AnalyticsService Mathematical & Aggregation Logic', () => {
  beforeEach(async () => {
    await setupTestDb('analytics_unit');
    await clearTestDb('analytics_unit');
  });

  afterEach(async () => {
    await teardownTestDb('analytics_unit');
  });

  describe('1. Delivery Funnel Analytics (Boundary 2.1 & 2.2)', () => {
    it('handles zero-claimant empty case without division-by-zero or NaN errors (Boundary 2.1)', async () => {
      const emptyCase = await Case.create({
        name: 'Empty Case',
        docketNumber: '1:24-cv-000',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const funnel = await AnalyticsService.calculateFunnel(emptyCase, [emptyCase._id]);

      expect(funnel.uploaded).toBe(0);
      expect(funnel.dispatched).toBe(0);
      expect(funnel.delivered).toBe(0);
      expect(funnel.visited).toBe(0);
      expect(funnel.selected).toBe(0);
      expect(funnel.disbursed).toBe(0);

      expect(funnel.deliveryRate).toBe(0);
      expect(funnel.clickRate).toBe(0);
      expect(funnel.conversionRate).toBe(0);
      expect(funnel.disbursementRate).toBe(0);
      expect(isNaN(funnel.deliveryRate)).toBe(false);
      expect(isNaN(funnel.clickRate)).toBe(false);
      expect(isNaN(funnel.conversionRate)).toBe(false);
    });

    it('handles 100% conversion rates without rounding overflow (Boundary 2.2)', async () => {
      const fullCase = await Case.create({
        name: 'Full Conversion Case',
        docketNumber: '1:24-cv-100',
        lawFirmId: 'firm_001',
        settlementFundTotal: 2500,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // Create 5 claimants, all progressed to disbursed
      for (let i = 1; i <= 5; i++) {
        await Claimant.create({
          caseId: fullCase._id,
          claimId: `CLM-100-${i}`,
          firstName: `User${i}`,
          lastName: 'Test',
          email: `user${i}@example.com`,
          settlementAmount: 500.0,
          status: 'disbursed',
          emailSent: true,
          emailOpened: true,
          linkClicked: true,
          selectedPaymentMethod: 'ach',
          selectedAt: new Date(),
          disbursedAt: new Date()
        });
      }

      const funnel = await AnalyticsService.calculateFunnel(fullCase, [fullCase._id]);

      expect(funnel.uploaded).toBe(5);
      expect(funnel.dispatched).toBe(5);
      expect(funnel.delivered).toBe(5);
      expect(funnel.visited).toBe(5);
      expect(funnel.selected).toBe(5);
      expect(funnel.disbursed).toBe(5);

      expect(funnel.deliveryRate).toBe(100);
      expect(funnel.clickRate).toBe(100);
      expect(funnel.conversionRate).toBe(100);
      expect(funnel.disbursementRate).toBe(100);
      expect(funnel.dropOff.dispatchToDelivery).toBe(0);
      expect(funnel.dropOff.deliveryToVisit).toBe(0);
      expect(funnel.dropOff.visitToSelect).toBe(0);
      expect(funnel.dropOff.selectToDisburse).toBe(0);
    });

    it('calculates accurate multi-stage funnel drop-offs and conversion rates', async () => {
      const testCase = await Case.create({
        name: 'Funnel Stage Test',
        docketNumber: '1:24-cv-200',
        lawFirmId: 'firm_001',
        settlementFundTotal: 10000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // 4 Claimants with varying progression
      // c1: disbursed
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-F1',
        firstName: 'F1',
        lastName: 'Test',
        email: 'f1@example.com',
        settlementAmount: 250,
        status: 'disbursed',
        emailSent: true,
        linkClicked: true,
        selectedPaymentMethod: 'ach',
        selectedAt: new Date(),
        disbursedAt: new Date()
      });

      // c2: selected (not disbursed yet)
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-F2',
        firstName: 'F2',
        lastName: 'Test',
        email: 'f2@example.com',
        settlementAmount: 250,
        status: 'selected',
        emailSent: true,
        linkClicked: true,
        selectedPaymentMethod: 'digital_card',
        selectedAt: new Date()
      });

      // c3: visited portal only
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-F3',
        firstName: 'F3',
        lastName: 'Test',
        email: 'f3@example.com',
        settlementAmount: 250,
        status: 'pending_selection',
        emailSent: true,
        linkClicked: true
      });

      // c4: bounced email
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-F4',
        firstName: 'F4',
        lastName: 'Test',
        email: 'f4@example.com',
        settlementAmount: 250,
        status: 'pending_selection',
        emailSent: true,
        bounced: true
      });

      const funnel = await AnalyticsService.calculateFunnel(testCase, [testCase._id]);

      expect(funnel.uploaded).toBe(4);
      expect(funnel.dispatched).toBe(4);
      expect(funnel.delivered).toBe(3); // 4 dispatched - 1 bounced = 3
      expect(funnel.visited).toBe(3);   // f1, f2, f3
      expect(funnel.selected).toBe(2);  // f1, f2
      expect(funnel.disbursed).toBe(1); // f1

      expect(funnel.deliveryRate).toBeCloseTo(75.0, 0.01); // 3 / 4 * 100
      expect(funnel.conversionRate).toBeCloseTo(66.67, 0.01); // 2 / 3 * 100
      expect(funnel.disbursementRate).toBeCloseTo(50.0, 0.01); // 1 / 2 * 100
    });
  });

  describe('2. Payment Method Distribution (All 9 Rails & Addendum 2)', () => {
    it('categorizes and sums selections across all 9 payment rails including aliases and fallback', async () => {
      const testCase = await Case.create({
        name: '9 Rails Case',
        docketNumber: '1:24-cv-300',
        lawFirmId: 'firm_001',
        settlementFundTotal: 9000,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      const railsData = [
        { method: 'ach', amount: 100 },
        { method: 'direct_deposit', amount: 100 }, // alias to ach
        { method: 'digital_card', amount: 200 },
        { method: 'debit_card', amount: 150 },
        { method: 'push_to_debit', amount: 150 }, // alias to debit_card
        { method: 'physical_check', amount: 300 },
        { method: 'paypal', amount: 400 },
        { method: 'venmo', amount: 250 },
        { method: 'zelle', amount: 350 },
        { method: 'bitcoin', amount: 500 }
      ];

      for (let i = 0; i < railsData.length; i++) {
        const item = railsData[i];
        await Claimant.create({
          caseId: testCase._id,
          claimId: `CLM-RAIL-${i}`,
          firstName: `User${i}`,
          lastName: 'Rail',
          email: `user${i}@rail.com`,
          settlementAmount: item.amount,
          status: 'selected',
          selectedPaymentMethod: item.method,
          selectedAt: new Date()
        });
      }

      // 1 Fallback expired claimant
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-RAIL-FALLBACK',
        firstName: 'Fallback',
        lastName: 'User',
        email: 'fallback@rail.com',
        settlementAmount: 200,
        status: 'deadline_expired',
        selectedPaymentMethod: 'physical_check',
        fallbackReason: 'DEADLINE_PASSED_UNRESPONSIVE'
      });

      const result = await AnalyticsService.calculateMethodDistribution(testCase, [testCase._id]);

      expect(result.totalSelected).toBe(11);
      expect(result.methods.length).toBe(9); // Exactly 9 canonical rails

      const achRail = result.methods.find((m) => m.method === 'ach');
      expect(achRail?.count).toBe(2); // ach + direct_deposit
      expect(achRail?.totalAmount).toBe(200);

      const debitRail = result.methods.find((m) => m.method === 'debit_card');
      expect(debitRail?.count).toBe(2); // debit_card + push_to_debit
      expect(debitRail?.totalAmount).toBe(300);

      const fallbackRail = result.methods.find((m) => m.method === 'court_fallback');
      expect(fallbackRail?.count).toBe(1);
      expect(fallbackRail?.totalAmount).toBe(200);

      const btcRail = result.methods.find((m) => m.method === 'bitcoin');
      expect(btcRail?.count).toBe(1);
      expect(btcRail?.totalAmount).toBe(500);
    });
  });

  describe('3. Financial Summary & Balances', () => {
    it('calculates fund balances, outstanding funds, and exception counts', async () => {
      const testCase = await Case.create({
        name: 'Financial Summary Case',
        docketNumber: '1:24-cv-400',
        lawFirmId: 'firm_001',
        settlementFundTotal: 100000.0,
        disbursementDeadline: new Date(Date.now() + 86400000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active'
      });

      // 1. Disbursed claimant: $40,000
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-01',
        firstName: 'Disbursed',
        lastName: 'User',
        email: 'disbursed@test.com',
        settlementAmount: 40000.0,
        status: 'disbursed',
        selectedPaymentMethod: 'ach'
      });

      // 2. Selected (undisbursed) claimant: $30,000
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-02',
        firstName: 'Selected',
        lastName: 'User',
        email: 'selected@test.com',
        settlementAmount: 30000.0,
        status: 'selected',
        selectedPaymentMethod: 'digital_card'
      });

      // 3. Pending unselected claimant: $30,000
      await Claimant.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-03',
        firstName: 'Pending',
        lastName: 'User',
        email: 'pending@test.com',
        settlementAmount: 30000.0,
        status: 'pending_selection'
      });

      // 2 Open Exceptions and 1 Resolved Exception
      await ReconciliationException.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-01',
        amount: 250,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false,
        resolutionStatus: 'open'
      });

      await ReconciliationException.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-02',
        amount: 250,
        currency: 'USD',
        status: 'REJECTED',
        exceptionType: 'card_decline',
        returnCode: 'CARD_BLOCKED',
        resolved: false,
        resolutionStatus: 'open'
      });

      await ReconciliationException.create({
        caseId: testCase._id,
        claimId: 'CLM-FIN-03',
        amount: 250,
        currency: 'USD',
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        resolved: true,
        resolutionStatus: 'resolved'
      });

      const summary = await AnalyticsService.calculateFinancialSummary(testCase, [testCase._id]);

      expect(summary.settlementFundTotal).toBe(100000.0);
      expect(summary.totalAllocated).toBe(100000.0);
      expect(summary.totalClaimed).toBe(70000.0); // 40,000 disbursed + 30,000 selected
      expect(summary.totalDisbursed).toBe(40000.0);
      expect(summary.totalOutstanding).toBe(60000.0); // 100,000 - 40,000
      expect(summary.remainingUnclaimedFund).toBe(30000.0); // 100,000 - 70,000
      expect(summary.fundVariance).toBe(0.0); // 100,000 - 100,000

      expect(summary.openExceptionsCount).toBe(2);
      expect(summary.totalExceptionsCount).toBe(3);
      expect(summary.reconciliationDiscrepanciesCount).toBe(2);
    });
  });
});
