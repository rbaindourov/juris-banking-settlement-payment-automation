/**
 * Juris Banking - Test Data Generators & Vectors
 * Generates valid & corrupt datasets, routing vectors, and batch files.
 */

const crypto = require('node:crypto');

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White'
];

const STREET_NAMES = [
  'Oak Street', 'Maple Avenue', 'Cedar Lane', 'Pine Road', 'Elm Street',
  'Washington Boulevard', 'Lakeview Drive', 'Park Avenue', 'Sunset Boulevard', 'Highland Drive'
];

const CITIES = [
  { city: 'Los Angeles', state: 'CA', zip: '90001' },
  { city: 'San Francisco', state: 'CA', zip: '94102' },
  { city: 'New York', state: 'NY', zip: '10001' },
  { city: 'Chicago', state: 'IL', zip: '60601' },
  { city: 'Houston', state: 'TX', zip: '77001' },
  { city: 'Miami', state: 'FL', zip: '33101' },
  { city: 'Seattle', state: 'WA', zip: '98101' },
  { city: 'Denver', state: 'CO', zip: '80201' },
];

/**
 * Known valid Federal Reserve ABA routing numbers across districts:
 */
const VALID_ABA_ROUTINGS = [
  { routing: '021000021', bank: 'JPMorgan Chase (NY)' },
  { routing: '111000025', bank: 'Bank of America (TX)' },
  { routing: '121000358', bank: 'Wells Fargo (CA)' },
  { routing: '021000089', bank: 'Citibank (NY)' },
  { routing: '071000288', bank: 'Chase Bank USA (IL)' },
  { routing: '041000124', bank: 'PNC Bank (OH)' },
  { routing: '051000017', bank: 'Truist Bank (VA)' },
  { routing: '091000019', bank: 'US Bank (MN)' },
  { routing: '081000032', bank: 'Regions Bank (MO)' },
  { routing: '061000104', bank: 'Regions Bank (GA)' },
];

/**
 * Invalid ABA routing numbers for negative testing:
 */
const INVALID_ABA_ROUTINGS = [
  { routing: '123456789', reason: 'Sequential digits - fails Mod 10 checksum' },
  { routing: '000000000', reason: 'Illegal Federal Reserve prefix 00' },
  { routing: '999999999', reason: 'Illegal Federal Reserve prefix 99' },
  { routing: '021000022', reason: 'Off-by-one check digit (expected 1, got 2)' },
  { routing: '02100002', reason: 'Only 8 digits (short)' },
  { routing: '0210000210', reason: '10 digits (long)' },
  { routing: '02100002A', reason: 'Contains alphanumeric character' },
  { routing: '         ', reason: 'Whitespace string' },
];

/**
 * Generates an array of claimant objects or CSV string.
 */
function generateClaimants(count = 100, options = {}) {
  const claimants = [];
  const amountPerClaimant = options.amountPerClaimant || 250.00;
  const prefix = options.claimIdPrefix || 'CLM';

  for (let i = 1; i <= count; i++) {
    const fn = FIRST_NAMES[i % FIRST_NAMES.length];
    const ln = LAST_NAMES[i % LAST_NAMES.length];
    const cityObj = CITIES[i % CITIES.length];
    const streetNum = 100 + (i * 7) % 8900;
    const streetName = STREET_NAMES[i % STREET_NAMES.length];
    const claimId = `${prefix}-${String(i).padStart(6, '0')}`;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@example-claimant.com`;
    const phone = `+1${String(2000000000 + i)}`;
    const token = crypto.randomBytes(32).toString('hex');

    claimants.push({
      claimId,
      firstName: fn,
      lastName: ln,
      email,
      phone,
      street1: `${streetNum} ${streetName}`,
      street2: i % 5 === 0 ? `Apt ${100 + i}` : '',
      city: cityObj.city,
      state: cityObj.state,
      zip: cityObj.zip,
      settlementAmount: amountPerClaimant,
      claimantToken: token,
      status: 'pending_notification',
    });
  }

  return claimants;
}

/**
 * Formats claimant array into standard CSV string.
 */
function claimantsToCsv(claimants) {
  const headers = [
    'Claim ID', 'First Name', 'Last Name', 'Email', 'Phone',
    'Address 1', 'Address 2', 'City', 'State', 'ZIP Code', 'Settlement Amount'
  ];

  const rows = [headers.join(',')];

  for (const c of claimants) {
    const row = [
      c.claimId,
      `"${c.firstName}"`,
      `"${c.lastName}"`,
      c.email,
      c.phone,
      `"${c.street1}"`,
      `"${c.street2 || ''}"`,
      `"${c.city}"`,
      c.state,
      c.zip,
      c.settlementAmount.toFixed(2)
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Generates corrupt CSV variations for boundary / negative testing.
 */
function generateCorruptCsv(type) {
  switch (type) {
    case 'EMPTY':
      return '';

    case 'MISSING_HEADERS':
      return 'Some Random Header,Another Field\nval1,val2\nval3,val4';

    case 'MISSING_EMAIL_HEADER':
      return 'Claim ID,First Name,Last Name,Settlement Amount\nCLM-001,John,Doe,100.00';

    case 'DUPLICATE_CLAIM_IDS':
      return [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-DUP-01,John,Doe,john@example.com,100.00',
        'CLM-DUP-02,Jane,Smith,jane@example.com,150.00',
        'CLM-DUP-01,Johnny,Duplicate,johnny@example.com,200.00', // duplicate CLM-DUP-01
      ].join('\n');

    case 'INVALID_EMAILS':
      return [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-ERR-01,John,Doe,notanemail,100.00',
        'CLM-ERR-02,Jane,Smith,@missinguser.com,150.00',
        'CLM-ERR-03,Bob,Brown,spaces in email@test.com,200.00',
      ].join('\n');

    case 'NEGATIVE_AMOUNTS':
      return [
        'Claim ID,First Name,Last Name,Email,Settlement Amount',
        'CLM-NEG-01,John,Doe,john@example.com,-50.00',
        'CLM-NEG-02,Jane,Smith,jane@example.com,0.00',
        'CLM-NEG-03,Bob,Brown,bob@example.com,NaN',
      ].join('\n');

    case 'SPECIAL_CHARS':
      return [
        'Claim ID,First Name,Last Name,Email,Address 1,City,State,ZIP Code,Settlement Amount',
        'CLM-SPEC-01,"Doe, Jr.","O\'Connor",doc@example.com,"123 Main St, Apt ""B""",New York,NY,10001,100.00',
        'CLM-SPEC-02,"Smith; LLC","Van Der Beek",van@example.com,"456 Elm St\nSuite 100",Dallas,TX,75001,150.00',
      ].join('\n');

    case 'NULL_BYTE_INJECTION':
      return 'Claim ID,First Name,Last Name,Email,Settlement Amount\nCLM-001,John\0Malicious,Doe,john@example.com,100.00';

    case 'XSS_INJECTION':
      return [
        'Claim ID,First Name,Last Name,Email,Address 1,City,State,ZIP Code,Settlement Amount',
        'CLM-XSS-01,"<script>alert(1)</script>","<img src=x onerror=alert(2)>",xss@example.com,"123 Hack Way",NYC,NY,10001,100.00',
      ].join('\n');

    default:
      throw new Error(`Unknown corrupt CSV type: ${type}`);
  }
}

/**
 * Builds a standard Dash Solutions Outbound CSV string from structured data.
 */
function buildDashBatchCsv(metadata, detailList) {
  const now = new Date();
  const timestampIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  let totalAmount = 0;
  let countAch = 0;
  let amountAch = 0;
  let countCard = 0;
  let amountCard = 0;
  let countDebit = 0;
  let amountDebit = 0;
  let countCheck = 0;
  let amountCheck = 0;
  let routingHashSum = 0;

  const detailLines = [];

  for (const d of detailList) {
    totalAmount += d.amount;
    const ref = d.reference || `PAY-${metadata.caseId}-${d.claimId}`;

    if (d.method === 'ACH') {
      countAch++;
      amountAch += d.amount;
      routingHashSum = (routingHashSum + parseInt(d.achRouting, 10)) % 10000000000;
      detailLines.push([
        'DETAIL', 'ACH', d.claimId, d.claimantId || d.claimId,
        `"${d.firstName}"`, `"${d.lastName}"`, d.amount.toFixed(2), 'USD', ref,
        d.achRouting, d.achAccount, d.achType || 'CHECKING', 'PPD', 'SETTLEMENT',
        '', '', '', '', '', ''
      ].join(','));
    } else if (d.method === 'DIGITAL_CARD') {
      countCard++;
      amountCard += d.amount;
      detailLines.push([
        'DETAIL', 'DIGITAL_CARD', d.claimId, d.claimantId || d.claimId,
        `"${d.firstName}"`, `"${d.lastName}"`, d.amount.toFixed(2), 'USD', ref,
        d.cardBrand || 'MASTERCARD', d.channel || 'EMAIL', d.email || '', d.phone || '',
        `"${d.firstName} ${d.lastName}"`, '24',
        '', '', '', '', ''
      ].join(','));
    } else if (d.method === 'PUSH_DEBIT') {
      countDebit++;
      amountDebit += d.amount;
      detailLines.push([
        'DETAIL', 'PUSH_DEBIT', d.claimId, d.claimantId || d.claimId,
        `"${d.firstName}"`, `"${d.lastName}"`, d.amount.toFixed(2), 'USD', ref,
        d.token || 'tok_mock_debit_123', d.last4 || '4412', d.bin || '411111', d.network || 'VISA',
        `"${d.firstName} ${d.lastName}"`,
        '', '', '', '', '', ''
      ].join(','));
    } else if (d.method === 'PHYSICAL_CHECK') {
      countCheck++;
      amountCheck += d.amount;
      detailLines.push([
        'DETAIL', 'PHYSICAL_CHECK', d.claimId, d.claimantId || d.claimId,
        `"${d.firstName}"`, `"${d.lastName}"`, d.amount.toFixed(2), 'USD', ref,
        `"${d.payee || `${d.firstName} ${d.lastName}`}"`,
        `"${d.street1 || '123 Main St'}"`, `"${d.street2 || ''}"`,
        `"${d.city || 'Los Angeles'}"`, d.state || 'CA', d.zip || '90001',
        'US', `"${d.memo || metadata.caseName || 'Settlement'}"`,
        '', '', ''
      ].join(','));
    }
  }

  const header = [
    'HEADER', 'DASH_SFTP_V2.0',
    metadata.clientId || 'FIRM-001',
    metadata.caseId || 'CASE-001',
    metadata.docketNumber || '1:24-cv-09821',
    metadata.batchId || `BATCH-${Date.now()}`,
    timestampIso,
    metadata.environment || 'TEST',
    'USD',
    detailList.length,
    totalAmount.toFixed(2)
  ].join(',');

  const trailer = [
    'TRAILER',
    detailList.length,
    totalAmount.toFixed(2),
    countAch, amountAch.toFixed(2),
    countCard, amountCard.toFixed(2),
    countDebit, amountDebit.toFixed(2),
    countCheck, amountCheck.toFixed(2),
    String(routingHashSum).padStart(9, '0')
  ].join(',');

  return [header, ...detailLines, trailer].join('\n');
}

/**
 * Builds inbound reconciliation report CSV.
 */
function buildReconciliationReportCsv(reportId, batchId, statusRecords) {
  const headers = [
    'REPORT_ID', 'BATCH_ID', 'CLAIM_ID', 'PAYMENT_REFERENCE',
    'PAYMENT_METHOD', 'AMOUNT', 'CURRENCY', 'STATUS',
    'DASH_REFERENCE_ID', 'SETTLEMENT_DATE', 'PROCESSED_TIMESTAMP',
    'ERROR_CODE', 'ERROR_MESSAGE', 'FAILURE_REASON'
  ];

  const rows = [headers.join(',')];
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString();

  for (const r of statusRecords) {
    const row = [
      reportId,
      batchId,
      r.claimId,
      r.reference || `PAY-${batchId}-${r.claimId}`,
      r.method || 'ACH',
      r.amount.toFixed(2),
      'USD',
      r.status, // PAID, REJECTED, RETURNED
      r.status === 'PAID' ? (r.dashRefId || `DASH-REF-${Math.floor(Math.random() * 900000 + 100000)}`) : '',
      dateStr,
      timeStr,
      r.errorCode || '',
      r.errorMessage ? `"${r.errorMessage}"` : '',
      r.failureReason ? `"${r.failureReason}"` : ''
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

module.exports = {
  VALID_ABA_ROUTINGS,
  INVALID_ABA_ROUTINGS,
  generateClaimants,
  claimantsToCsv,
  generateCorruptCsv,
  buildDashBatchCsv,
  buildReconciliationReportCsv,
};
