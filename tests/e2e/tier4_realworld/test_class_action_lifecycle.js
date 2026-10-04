/**
 * Tier 4 - Real-World Application Scenario: Comprehensive Class-Action Settlement Lifecycle
 * Simulates full 12-stage end-to-end workflow with 1,000 claimants, all 4 rails, fallback, SFTP, and reconciliation.
 */

const { describe, it, expect, before, after } = require('../harness/test_runner');
const { MockSftpServer } = require('../harness/mock_sftp_server');
const { generateClaimants, buildDashBatchCsv, buildReconciliationReportCsv } = require('../harness/data_generators');
const {
  validateDashBatchCsv,
  validateSha256Checksum,
  validateReconciliationReport,
  isValidAbaRouting,
  isValidLuhn,
  sanitizeHtmlOracle,
  resolveMergeTagsOracle
} = require('../harness/oracles');

describe('Tier 4: Real-World Scenario - 1,000-Claimant Class Action Settlement Lifecycle', () => {
  let mockServer;
  let simulatedDatabase;

  before(async () => {
    mockServer = new MockSftpServer();
    await mockServer.start();
    mockServer.clearStorage();

    simulatedDatabase = {
      users: new Map(),
      cases: new Map(),
      claimants: new Map(),
      batches: new Map(),
      exceptions: new Map(),
      emailLogs: [],
    };
  });

  after(async () => {
    mockServer.clearStorage();
    await mockServer.stop();
  });

  it('Executes complete 12-stage class-action settlement lifecycle simulation from case creation to final reconciliation', async () => {
    // -------------------------------------------------------------------------
    // STAGE 1: Tenant Initialization & RBAC Identity Setup
    // -------------------------------------------------------------------------
    const firmId = 'firm_justice_partners';
    const adminUser = {
      id: 'usr_admin_01',
      email: 'admin@justicepartners-law.com',
      role: 'law_firm_admin',
      lawFirmId: firmId,
      fullName: 'Marcus Vance, Managing Partner',
    };
    simulatedDatabase.users.set(adminUser.id, adminUser);
    expect(adminUser.role).toBe('law_firm_admin');

    // -------------------------------------------------------------------------
    // STAGE 2: Settlement Case Registration
    // -------------------------------------------------------------------------
    const caseId = 'CASE-NEXUS-2026';
    const settlementCase = {
      caseId,
      name: 'In re Nexus Consumer Privacy Settlement',
      docketNumber: '3:24-cv-09821-WHA',
      lawFirmId: firmId,
      settlementFundTotal: 250000.00, // $250,000.00 pool
      disbursementDeadline: new Date('2026-11-30T23:59:59Z'),
      fallbackPaymentMethod: 'physical_check',
      status: 'active',
      emailTemplate: {
        subject: 'Action Required: In re Nexus Settlement Payment Election',
        bodyHtml: '<p>Dear {{claimant_first_name}}, please claim {{settlement_amount}} at {{payment_selection_link}} before {{selection_deadline}}.</p>',
      },
    };
    simulatedDatabase.cases.set(caseId, settlementCase);
    expect(settlementCase.settlementFundTotal).toBe(250000.00);

    // -------------------------------------------------------------------------
    // STAGE 3: 1,000-Row Roster Ingestion & Validation
    // -------------------------------------------------------------------------
    const raw1000Claimants = generateClaimants(1000, {
      amountPerClaimant: 250.00,
      claimIdPrefix: 'NEXUS',
    });

    // Verification of staged preview
    const totalAllocated = raw1000Claimants.reduce((sum, c) => sum + c.settlementAmount, 0);
    const fundVariance = totalAllocated - settlementCase.settlementFundTotal;

    expect(raw1000Claimants.length).toBe(1000);
    expect(totalAllocated).toBe(250000.00);
    expect(Math.abs(fundVariance)).toBeLessThan(0.001); // Perfect allocation balance

    // Commit to database and verify unique 64-hex tokens
    const tokenSet = new Set();
    for (const c of raw1000Claimants) {
      c.caseId = caseId;
      simulatedDatabase.claimants.set(c.claimId, c);
      tokenSet.add(c.claimantToken);
    }
    expect(tokenSet.size).toBe(1000); // 1,000 unique cryptographic tokens

    // -------------------------------------------------------------------------
    // STAGE 4: Quill WYSIWYG Template Authoring & Sanitization
    // -------------------------------------------------------------------------
    const rawQuillHtml = `
      <h2>Notice of Settlement Distribution</h2>
      <p>Hello <strong>{{claimant_first_name}} {{claimant_last_name}}</strong>,</p>
      <p>You have been approved for a distribution of <strong>{{settlement_amount}}</strong> in the matter of <em>{{case_name}}</em>.</p>
      <p><a href="{{payment_selection_link}}">Select Your Payment Option</a></p>
      <p>Deadline to select: {{selection_deadline}}</p>
      <script>var x = 1;</script>
    `;

    const sanitizedEmailTemplate = sanitizeHtmlOracle(rawQuillHtml);
    expect(sanitizedEmailTemplate).not.toInclude('<script>');
    expect(sanitizedEmailTemplate).toInclude('{{payment_selection_link}}');
    settlementCase.emailTemplate.bodyHtml = sanitizedEmailTemplate;

    // -------------------------------------------------------------------------
    // STAGE 5: Notification Email Dispatch & Event Tracking
    // -------------------------------------------------------------------------
    let dispatchedCount = 0;
    for (const c of raw1000Claimants) {
      const emailContext = {
        claimant_first_name: c.firstName,
        claimant_last_name: c.lastName,
        settlement_amount: `$${c.settlementAmount.toFixed(2)}`,
        case_name: settlementCase.name,
        payment_selection_link: `https://claims.nexus-settlement.org/claim/${c.claimantToken}`,
        selection_deadline: 'November 30, 2026',
      };
      const renderedBody = resolveMergeTagsOracle(sanitizedEmailTemplate, emailContext);
      expect(renderedBody).toInclude(c.firstName);
      expect(renderedBody).toInclude(c.claimantToken);

      c.status = 'notification_sent';
      dispatchedCount++;
    }
    expect(dispatchedCount).toBe(1000);

    // -------------------------------------------------------------------------
    // STAGE 6: Multi-Cohort Claimant Elections (Simulating Real Conversion)
    // -------------------------------------------------------------------------
    // Cohort A: 400 claimants choose ACH Direct Deposit
    // Cohort B: 250 claimants choose Digital Prepaid Card
    // Cohort C: 150 claimants choose Push to Debit Card
    // Cohort D: 100 claimants choose Mailed Physical Check
    // Cohort E: 100 claimants are non-responsive (remain pending until deadline)
    for (let i = 0; i < 400; i++) {
      const c = raw1000Claimants[i];
      c.status = 'method_selected';
      c.selectedMethod = 'ach';
      c.achRouting = '021000021'; // JPMorgan Chase (Mod 10 verified)
      c.achAccount = `998800${i}`;
      c.achType = 'CHECKING';
      expect(isValidAbaRouting(c.achRouting)).toBe(true);
    }

    for (let i = 400; i < 650; i++) {
      const c = raw1000Claimants[i];
      c.status = 'method_selected';
      c.selectedMethod = 'digital_card';
      c.cardBrand = 'MASTERCARD';
      c.deliveryChannel = 'EMAIL';
      c.deliveryEmail = c.email;
    }

    for (let i = 650; i < 800; i++) {
      const c = raw1000Claimants[i];
      c.status = 'method_selected';
      c.selectedMethod = 'push_to_debit';
      c.debitPan = '4111111111111111'; // Luhn verified
      c.debitToken = `tok_debit_vault_${i}`;
      c.debitLast4 = '1111';
      expect(isValidLuhn(c.debitPan)).toBe(true);
    }

    for (let i = 800; i < 900; i++) {
      const c = raw1000Claimants[i];
      c.status = 'method_selected';
      c.selectedMethod = 'physical_check';
      // Roster address confirmed
    }

    // Indices 900 to 999 remain unselected
    const responsiveCount = raw1000Claimants.filter(c => c.status === 'method_selected').length;
    const nonResponsiveCount = raw1000Claimants.filter(c => c.status === 'notification_sent').length;
    expect(responsiveCount).toBe(900);
    expect(nonResponsiveCount).toBe(100);

    // -------------------------------------------------------------------------
    // STAGE 7: Deadline Enforcement & Automatic Fallback Sweeper
    // -------------------------------------------------------------------------
    // Simulated Agenda job execution (case:enforce-deadline-fallback)
    let fallbackAssignedCount = 0;
    for (const c of raw1000Claimants) {
      if (c.status === 'notification_sent') {
        c.status = 'deadline_expired';
        c.selectedMethod = settlementCase.fallbackPaymentMethod; // physical_check
        c.fallbackAssigned = true;
        fallbackAssignedCount++;
      }
    }
    expect(fallbackAssignedCount).toBe(100);

    // -------------------------------------------------------------------------
    // STAGE 8: Dash Solutions Outbound Batch File Compilation
    // -------------------------------------------------------------------------
    const batchMeta = {
      clientId: 'FIRM-JUSTICE-01',
      caseId: settlementCase.caseId,
      docketNumber: settlementCase.docketNumber,
      batchId: 'BATCH-NEXUS-FINAL-001',
      caseName: settlementCase.name,
      environment: 'PRODUCTION',
    };

    const outboundDetailList = raw1000Claimants.map(c => {
      if (c.selectedMethod === 'ach') {
        return {
          method: 'ACH', claimId: c.claimId, firstName: c.firstName, lastName: c.lastName,
          amount: c.settlementAmount, achRouting: c.achRouting, achAccount: c.achAccount, achType: c.achType,
        };
      } else if (c.selectedMethod === 'digital_card') {
        return {
          method: 'DIGITAL_CARD', claimId: c.claimId, firstName: c.firstName, lastName: c.lastName,
          amount: c.settlementAmount, cardBrand: c.cardBrand, channel: c.deliveryChannel, email: c.deliveryEmail,
        };
      } else if (c.selectedMethod === 'push_to_debit') {
        return {
          method: 'PUSH_DEBIT', claimId: c.claimId, firstName: c.firstName, lastName: c.lastName,
          amount: c.settlementAmount, token: c.debitToken, last4: c.debitLast4, bin: '411111', network: 'VISA',
        };
      } else {
        // Physical Check (Elected or Fallback)
        return {
          method: 'PHYSICAL_CHECK', claimId: c.claimId, firstName: c.firstName, lastName: c.lastName,
          amount: c.settlementAmount, street1: c.street1, street2: c.street2, city: c.city, state: c.state, zip: c.zip,
        };
      }
    });

    const outboundBatchCsv = buildDashBatchCsv(batchMeta, outboundDetailList);
    const batchValidation = validateDashBatchCsv(outboundBatchCsv);

    expect(batchValidation.valid).toBe(true);
    expect(batchValidation.totalRecords).toBe(1000);
    expect(batchValidation.totalAmount).toBe(250000.00);
    expect(batchValidation.breakdown.ach.count).toBe(400);
    expect(batchValidation.breakdown.card.count).toBe(250);
    expect(batchValidation.breakdown.debit.count).toBe(150);
    expect(batchValidation.breakdown.check.count).toBe(200); // 100 elected + 100 fallback

    // -------------------------------------------------------------------------
    // STAGE 9: Atomic SFTP Upload to Mock SFTP Server
    // -------------------------------------------------------------------------
    const sftpClient = mockServer.createClientAdapter();
    const batchFilename = `DASH_DISBURSE_${settlementCase.caseId}_20261004120000.csv`;
    const tmpFilename = `${batchFilename}.tmp`;

    // 1. Staged upload to .tmp
    await sftpClient.put(outboundBatchCsv, `/inbound/disbursements/${tmpFilename}`);
    // 2. Atomic rename to final CSV
    await sftpClient.rename(`/inbound/disbursements/${tmpFilename}`, `/inbound/disbursements/${batchFilename}`);
    // 3. Upload companion .sha256 digest
    const companionSha256 = `${validateSha256Checksum(outboundBatchCsv, `${batchValidation.totalRecords}`, '').hash}  ${batchFilename}\n`;
    await sftpClient.put(companionSha256, `/inbound/disbursements/${batchFilename}.sha256`);

    const storedBatches = mockServer.getReceivedBatches();
    expect(storedBatches.length).toBe(1);
    expect(storedBatches[0].filename).toBe(batchFilename);

    // -------------------------------------------------------------------------
    // STAGE 10: Inbound Reconciliation & Exception Logging
    // -------------------------------------------------------------------------
    // Mock Dash returns:
    // - 980 items PAID
    // - 10 ACH items RETURNED (R02 Account Closed)
    // - 10 Debit items REJECTED (CARD_BLOCKED)
    const reconciliationRecords = [];

    // First 390 ACH -> PAID
    for (let i = 0; i < 390; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'ACH', amount: 250.00, status: 'PAID', dashRefId: `DASH-ACH-${i + 1000}`,
      });
    }
    // Next 10 ACH -> RETURNED (R02)
    for (let i = 390; i < 400; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'ACH', amount: 250.00, status: 'RETURNED', errorCode: 'R02', errorMessage: 'Customer closed account',
      });
    }
    // 250 Digital Cards -> PAID
    for (let i = 400; i < 650; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'DIGITAL_CARD', amount: 250.00, status: 'PAID', dashRefId: `DASH-VCD-${i + 1000}`,
      });
    }
    // 140 Debit -> PAID, 10 Debit -> REJECTED
    for (let i = 650; i < 790; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'PUSH_DEBIT', amount: 250.00, status: 'PAID', dashRefId: `DASH-DEB-${i + 1000}`,
      });
    }
    for (let i = 790; i < 800; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'PUSH_DEBIT', amount: 250.00, status: 'REJECTED', errorCode: 'CARD_BLOCKED', errorMessage: 'Card blocked by issuer',
      });
    }
    // 200 Checks -> PAID
    for (let i = 800; i < 1000; i++) {
      reconciliationRecords.push({
        claimId: raw1000Claimants[i].claimId,
        method: 'PHYSICAL_CHECK', amount: 250.00, status: 'PAID', dashRefId: `DASH-CHK-${i + 1000}`,
      });
    }

    const reportCsv = buildReconciliationReportCsv('REP-NEXUS-01', batchMeta.batchId, reconciliationRecords);
    mockServer.seedReconciliationReport('REPORT_STATUS_NEXUS_FINAL.csv', reportCsv);

    const reportValidation = validateReconciliationReport(reportCsv);
    expect(reportValidation.valid).toBe(true);
    expect(reportValidation.total).toBe(1000);

    // Apply reconciliation updates to claimant database
    let totalDisbursed = 0;
    let totalExceptions = 0;
    for (const r of reportValidation.records) {
      const claimant = simulatedDatabase.claimants.get(r.claimId);
      if (r.status === 'PAID') {
        claimant.status = 'disbursed';
        claimant.dashReferenceId = r.dashRefId;
        totalDisbursed++;
      } else {
        claimant.status = 'payment_failed';
        totalExceptions++;
        simulatedDatabase.exceptions.set(r.claimId, {
          caseId,
          claimId: r.claimId,
          errorCode: r.errorCode,
          status: 'open',
          amount: 250.00,
        });
      }
    }

    expect(totalDisbursed).toBe(980);
    expect(totalExceptions).toBe(20);

    // -------------------------------------------------------------------------
    // STAGE 11: Case Analytics & Funnel Integrity Verification
    // -------------------------------------------------------------------------
    const funnelMetrics = {
      uploaded: 1000,
      dispatched: 1000,
      visited: 900,
      selected: 900,
      fallback: 100,
      disbursed: totalDisbursed,
      exceptions: totalExceptions,
    };

    expect(funnelMetrics.uploaded).toBe(1000);
    expect(funnelMetrics.disbursed).toBe(980);
    expect(funnelMetrics.exceptions).toBe(20);

    const totalPaidDollars = totalDisbursed * 250.00;
    const totalPendingResolutionDollars = totalExceptions * 250.00;
    expect(totalPaidDollars).toBe(245000.00);
    expect(totalPendingResolutionDollars).toBe(5000.00);
    expect(totalPaidDollars + totalPendingResolutionDollars).toBe(settlementCase.settlementFundTotal);

    // -------------------------------------------------------------------------
    // STAGE 12: Exception Resolution & Audit Ledger Complete
    // -------------------------------------------------------------------------
    let resolvedCount = 0;
    for (const [claimId, ex] of simulatedDatabase.exceptions.entries()) {
      if (ex.errorCode === 'R02') {
        ex.status = 'resolved_switched_to_check';
        ex.notes = 'ACH returned: Customer closed account. Switched to Physical Check.';
      } else {
        ex.status = 'resolved_switched_to_card';
        ex.notes = 'Debit declined: Card blocked. Reissued to Digital Prepaid Card.';
      }
      ex.resolvedBy = adminUser.id;
      ex.resolvedAt = new Date().toISOString();
      resolvedCount++;
    }

    expect(resolvedCount).toBe(20);
    expect(simulatedDatabase.exceptions.get('NEXUS-000391').status).toBe('resolved_switched_to_check');
  });
});
