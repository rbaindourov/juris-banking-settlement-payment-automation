/**
 * Tier 1 - Feature Coverage: Claimant Batch Ingestion Pipeline
 * Tests 1.1 to 1.5: Valid CSV, Header Normalization, Two-Phase Staging, 64-hex Tokens, Excel Ingestion.
 */

const { describe, it, expect, before } = require('../harness/test_runner');
const { TestClient } = require('../harness/test_client');
const { generateClaimants, claimantsToCsv } = require('../harness/data_generators');
const config = require('../config');
const xlsx = require('xlsx');

describe('Tier 1: Feature Coverage - Claimant Batch Ingestion', () => {
  let client;
  let testCaseId;

  before(async () => {
    client = new TestClient(config.apiUrl);
    // Login or register law firm admin
    const email = `ingest_admin_${Date.now()}@firm-law.com`;
    await client.post('/api/auth/register', {
      email,
      password: 'AdminPassword123!',
      fullName: 'Ingestion Director',
      role: 'law_firm_admin',
      lawFirmId: 'firm_ingest_01',
    });

    const caseRes = await client.createCase({
      name: `Ingestion E2E Settlement ${Date.now()}`,
      docketNumber: `26-CV-${Math.floor(Math.random() * 90000 + 10000)}`,
      lawFirmId: 'firm_ingest_01',
      settlementFundTotal: 100000.00,
      disbursementDeadline: new Date(Date.now() + 30 * 86400000).toISOString(),
      fallbackPaymentMethod: 'physical_check',
    });
    testCaseId = caseRes.body.case?._id || caseRes.body.case?.id || caseRes.body._id;
  });

  it('1.1 Generates and parses a valid CSV roster with standard headers and verified schemas', async () => {
    const claimants = generateClaimants(25, { amountPerClaimant: 100.00 });
    const csvContent = claimantsToCsv(claimants);

    expect(csvContent).toBeDefined();
    expect(csvContent.split('\n').length).toBe(26); // Header + 25 rows

    // Verify row structure conforms to contract
    const headerRow = csvContent.split('\n')[0];
    expect(headerRow).toInclude('Claim ID');
    expect(headerRow).toInclude('Email');
    expect(headerRow).toInclude('Settlement Amount');
  });

  it('1.2 Normalizes disparate header aliases ("member_id", "email_address", "payment")', async () => {
    const rawAliasedCsv = [
      'member_id,First Name,Last Name,email_address,Telephone,payment,Address,City,State,Postal Code',
      'MEM-001,John,Doe,johndoe@example.com,+12055550100,150.00,123 Main St,Los Angeles,CA,90001',
      'MEM-002,Jane,Smith,janesmith@example.com,+12055550101,200.00,456 Elm St,San Francisco,CA,94102',
    ].join('\n');

    expect(rawAliasedCsv).toInclude('member_id');
    expect(rawAliasedCsv).toInclude('email_address');
    expect(rawAliasedCsv).toInclude('payment');

    const res = await client.postFile(
      `/api/cases/${testCaseId}/claimants/stage-upload`,
      rawAliasedCsv,
      'aliased.csv',
      'file',
      'text/csv'
    );
    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(2);
    expect(res.body.stagedClaimants[0].claimId).toBe('MEM-001');
    expect(res.body.stagedClaimants[0].email).toBe('johndoe@example.com');
    expect(res.body.stagedClaimants[0].settlementAmount).toBe(150.00);
  });

  it('1.3 Two-phase upload protocol: Staged Preview returns validation report without premature commit', async () => {
    const claimants = generateClaimants(10, { amountPerClaimant: 50.00, claimIdPrefix: 'STAGE' });
    const csvContent = claimantsToCsv(claimants);
    const expectedTotalAllocation = 10 * 50.00;

    const res = await client.postFile(
      `/api/cases/${testCaseId}/claimants/stage-upload`,
      csvContent,
      'claimants.csv',
      'file',
      'text/csv'
    );

    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(10);
    expect(res.body.invalidCount).toBe(0);
    expect(res.body.totalAllocation).toBe(expectedTotalAllocation);
    expect(res.body.fundVariance).toBeDefined();
    expect(res.body.errors).toBeDefined();
    expect(res.body.preview).toBeDefined();
    expect(res.body.preview.length).toBe(10);

    // Verify premature commit did NOT occur in database
    const listRes = await client.get(`/api/cases/${testCaseId}/claimants`);
    expect(listRes.status).toBe(200);
    const prematureClaimants = (listRes.body.claimants || []).filter(c => c.claimId.startsWith('STAGE'));
    expect(prematureClaimants.length).toBe(0);
  });

  it('1.4 Committed claimants are assigned unique 64-character hexadecimal tokens', async () => {
    const claimants = generateClaimants(5, { amountPerClaimant: 100.00, claimIdPrefix: 'COMM' });
    const csvContent = claimantsToCsv(claimants);

    const stageRes = await client.postFile(
      `/api/cases/${testCaseId}/claimants/stage-upload`,
      csvContent,
      'claimants_commit.csv',
      'file',
      'text/csv'
    );
    expect(stageRes.status).toBe(200);
    expect(stageRes.body.stagedClaimants.length).toBe(5);

    const commitRes = await client.post(
      `/api/cases/${testCaseId}/claimants/commit-upload`,
      { claimants: stageRes.body.stagedClaimants }
    );
    expect(commitRes.status).toBe(201);
    expect(commitRes.body.insertedCount).toBe(5);

    const listRes = await client.get(`/api/cases/${testCaseId}/claimants`);
    expect(listRes.status).toBe(200);
    const persistedClaimants = (listRes.body.claimants || []).filter(c => c.claimId.startsWith('COMM'));
    expect(persistedClaimants.length).toBe(5);

    const tokens = new Set();
    for (const c of persistedClaimants) {
      expect(c.paymentSelectionToken).toBeDefined();
      expect(c.paymentSelectionToken).toHaveLength(64);
      expect(c.paymentSelectionToken).toMatch(/^[0-9a-f]{64}$/);
      tokens.add(c.paymentSelectionToken);
    }
    expect(tokens.size).toBe(5);
  });

  it('1.5 Supports Excel (.xlsx) format claimant roster specification', async () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Claim ID', 'First Name', 'Last Name', 'Email', 'Settlement Amount', 'Street', 'City', 'State', 'Zip'],
      ['XLSX-CLM-001', 'Alice', 'Wonderland', 'alice@example-classaction.com', 1250.00, '100 Rabbit Hole Lane', 'Oxford', 'CA', '90210'],
      ['XLSX-CLM-002', 'Bob', 'Builder', 'bob@example-classaction.com', 750.00, '200 Construction Way', 'Denver', 'CO', '80201'],
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Roster');
    const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await client.postFile(
      `/api/cases/${testCaseId}/claimants/stage-upload`,
      xlsxBuffer,
      'roster.xlsx',
      'file',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    expect(res.status).toBe(200);
    expect(res.body.validCount).toBe(2);
    expect(res.body.invalidCount).toBe(0);
    expect(res.body.totalAllocation).toBe(2000.00);
    expect(res.body.stagedClaimants.length).toBe(2);
    expect(res.body.stagedClaimants[0].claimId).toBe('XLSX-CLM-001');
    expect(res.body.stagedClaimants[0].settlementAmount).toBe(1250.00);
    expect(res.body.stagedClaimants[0].email).toBe('alice@example-classaction.com');
  });
});

