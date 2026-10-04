import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { parse as parseCsvSync } from 'csv-parse/sync';
import * as xlsx from 'xlsx';
import { Case, ICase } from '../models/Case';
import { Claimant, IClaimant, PaymentRail, PAYMENT_RAILS } from '../models/Claimant';

export function normalizePaymentMethod(methodStr: string): PaymentRail | undefined {
  if (!methodStr || typeof methodStr !== 'string') return undefined;
  const cleaned = methodStr.trim().toLowerCase().replace(/[\s_\-#.]+/g, '');
  if (cleaned === 'ach' || cleaned === 'directdeposit' || cleaned === 'bank' || cleaned === 'direct') return 'ach';
  if (cleaned === 'digitalcard' || cleaned === 'prepaid' || cleaned === 'prepaidcard' || cleaned === 'card') return 'digital_card';
  if (cleaned === 'debit' || cleaned === 'debitcard' || cleaned === 'pushtodebit') return 'debit_card';
  if (cleaned === 'check' || cleaned === 'physicalcheck' || cleaned === 'mail' || cleaned === 'mailedcheck') return 'physical_check';
  if (cleaned === 'paypal') return 'paypal';
  if (cleaned === 'venmo') return 'venmo';
  if (cleaned === 'zelle') return 'zelle';
  if (cleaned === 'bitcoin' || cleaned === 'btc') return 'bitcoin';
  return undefined;
}

export interface IngestionError {
  row: number;
  claimId?: string;
  field?: string;
  code: string;
  message: string;
}

export interface RawParsedClaimant {
  claimId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  settlementAmount: number;
  selectedPaymentMethod?: PaymentRail;
  paymentDetails?: any;
  status?: string;
  [key: string]: any;
}

export interface StageUploadResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  totalAllocation: number;
  settlementFundTotal: number;
  fundVariance: number;
  canCommit: boolean;
  errors: IngestionError[];
  preview: RawParsedClaimant[];
  stagedClaimants?: RawParsedClaimant[];
  existingAllocation?: number;
}

export interface CommitUploadResult {
  success: boolean;
  insertedCount: number;
  caseId: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common column header aliases mapped to canonical field names
const HEADER_MAPPINGS: Record<string, string> = {
  // Claim ID
  'claim id': 'claimId',
  'claim_id': 'claimId',
  'claimid': 'claimId',
  'claim #': 'claimId',
  'claim no': 'claimId',
  'claim number': 'claimId',
  'member id': 'claimId',
  'member_id': 'claimId',
  'memberid': 'claimId',
  'id': 'claimId',

  // First Name
  'first name': 'firstName',
  'first_name': 'firstName',
  'firstname': 'firstName',
  'first': 'firstName',
  'given name': 'firstName',

  // Last Name
  'last name': 'lastName',
  'last_name': 'lastName',
  'lastname': 'lastName',
  'last': 'lastName',
  'surname': 'lastName',
  'family name': 'lastName',

  // Full Name
  'name': 'fullName',
  'full name': 'fullName',
  'fullname': 'fullName',
  'claimant name': 'fullName',
  'claimant_name': 'fullName',

  // Email
  'email': 'email',
  'email address': 'email',
  'email_address': 'email',
  'e-mail': 'email',
  'mail': 'email',

  // Phone
  'phone': 'phone',
  'telephone': 'phone',
  'phone number': 'phone',
  'phone_number': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'tel': 'phone',

  // Settlement Amount
  'settlement amount': 'settlementAmount',
  'settlement_amount': 'settlementAmount',
  'settlementamount': 'settlementAmount',
  'settlement': 'settlementAmount',
  'amount': 'settlementAmount',
  'payment': 'settlementAmount',
  'payout': 'settlementAmount',
  'award': 'settlementAmount',

  // Street Address
  'address': 'street',
  'street': 'street',
  'street address': 'street',
  'street_address': 'street',
  'address 1': 'street',
  'address1': 'street',
  'street 1': 'street',
  'street1': 'street',
  'address line 1': 'street',

  // City
  'city': 'city',

  // State
  'state': 'state',
  'st': 'state',
  'province': 'state',

  // Zip / Postal
  'zip': 'zip',
  'zip code': 'zip',
  'zip_code': 'zip',
  'postal code': 'zip',
  'postal_code': 'zip',
  'postcode': 'zip',

  // Pre-assigned Payment Method & Details (Expanded rails: paypal, venmo, zelle, bitcoin, etc.)
  'payment method': 'selectedPaymentMethod',
  'payment_method': 'selectedPaymentMethod',
  'paymentmethod': 'selectedPaymentMethod',
  'method': 'selectedPaymentMethod',
  'rail': 'selectedPaymentMethod',
  'payment rail': 'selectedPaymentMethod',
  'payment_rail': 'selectedPaymentMethod',
  'preferred method': 'selectedPaymentMethod',
  'preferred_method': 'selectedPaymentMethod',
  'paypal email': 'paypalEmail',
  'paypal_email': 'paypalEmail',
  'paypal': 'paypalEmail',
  'venmo handle': 'venmoHandle',
  'venmo_handle': 'venmoHandle',
  'venmo': 'venmoHandle',
  'zelle contact': 'zelleContact',
  'zelle_contact': 'zelleContact',
  'zelle phone': 'zelleContact',
  'zelle_phone': 'zelleContact',
  'zelle': 'zelleContact',
  'bitcoin address': 'bitcoinAddress',
  'bitcoin_address': 'bitcoinAddress',
  'btc address': 'bitcoinAddress',
  'btc_address': 'bitcoinAddress',
  'crypto address': 'bitcoinAddress',
  'routing number': 'routingNumber',
  'routing_number': 'routingNumber',
  'routing': 'routingNumber',
  'account number': 'accountNumber',
  'account_number': 'accountNumber',
  'account': 'accountNumber'
};

export class IngestionService {
  /**
   * Generates a cryptographically secure 64-character hexadecimal token.
   */
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Normalizes header string to canonical key.
   */
  static normalizeHeader(header: string): string | null {
    if (!header || typeof header !== 'string') return null;
    const cleaned = header.trim().toLowerCase();
    if (HEADER_MAPPINGS[cleaned]) return HEADER_MAPPINGS[cleaned];
    const stripped = cleaned.replace(/[\s_\-#.]+/g, '');
    if (HEADER_MAPPINGS[stripped]) return HEADER_MAPPINGS[stripped];
    return null;
  }

  /**
   * Extracts 2D array of rows from Buffer or string (CSV or XLSX).
   */
  static extractRows(bufferOrString: Buffer | string, filename?: string): { rows: any[][]; isSpreadsheet: boolean } {
    if (!bufferOrString || (Buffer.isBuffer(bufferOrString) && bufferOrString.length === 0)) {
      return { rows: [], isSpreadsheet: false };
    }

    if (typeof bufferOrString === 'string' && bufferOrString.trim().length === 0) {
      return { rows: [], isSpreadsheet: false };
    }

    const isExcel =
      (filename && (filename.endsWith('.xlsx') || filename.endsWith('.xls'))) ||
      (Buffer.isBuffer(bufferOrString) &&
        bufferOrString.length > 4 &&
        ((bufferOrString[0] === 0x50 && bufferOrString[1] === 0x4b) || // PK zip (.xlsx)
          (bufferOrString[0] === 0xd0 && bufferOrString[1] === 0xcf))); // OLE (.xls)

    if (isExcel) {
      const buffer = Buffer.isBuffer(bufferOrString) ? bufferOrString : Buffer.from(bufferOrString);
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return { rows: [], isSpreadsheet: true };
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
      return { rows, isSpreadsheet: true };
    }

    // Default to CSV parser
    const content = Buffer.isBuffer(bufferOrString) ? bufferOrString.toString('utf-8') : bufferOrString;
    try {
      const parsed = parseCsvSync(content, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
      }) as any[][];
      return { rows: parsed, isSpreadsheet: false };
    } catch {
      // Fallback manual CSV split if csv-parse encounters edge-case
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
      const rows = lines.map(line => line.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      return { rows, isSpreadsheet: false };
    }
  }

  /**
   * Phase 1: Stages uploaded file buffer, parses and validates all rows against case constraints.
   */
  static async stageUpload(
    caseOrCaseId: ICase | string,
    fileBufferOrString: Buffer | string,
    filename?: string
  ): Promise<StageUploadResult> {
    let caseDoc: ICase | null = null;
    if (typeof caseOrCaseId === 'string') {
      caseDoc = await Case.findById(caseOrCaseId);
      if (!caseDoc) {
        // Try finding by custom caseId
        caseDoc = await Case.findOne({ caseId: caseOrCaseId });
      }
    } else {
      caseDoc = caseOrCaseId;
    }

    const settlementFundTotal = caseDoc ? caseDoc.settlementFundTotal : 0;
    const targetCaseId = caseDoc ? (caseDoc._id ? caseDoc._id.toString() : caseDoc.caseId) : undefined;

    // 1. Check for empty file
    const { rows } = this.extractRows(fileBufferOrString, filename);
    if (!rows || rows.length === 0) {
      return {
        totalRows: 0,
        validCount: 0,
        invalidCount: 0,
        totalAllocation: 0,
        settlementFundTotal,
        fundVariance: 0,
        canCommit: false,
        errors: [
          {
            row: 0,
            code: 'FILE_EMPTY',
            message: 'FILE_EMPTY: Uploaded file contains no data'
          }
        ],
        preview: []
      };
    }

    // 2. Parse and map headers
    const rawHeaderRow = rows[0].map(c => (c !== undefined && c !== null ? String(c).trim() : ''));
    const colMap = new Map<string, number>();

    rawHeaderRow.forEach((rawCol, idx) => {
      const canonical = this.normalizeHeader(rawCol);
      if (canonical && !colMap.has(canonical)) {
        colMap.set(canonical, idx);
      }
    });

    // Check mandatory headers: claimId, email, settlementAmount, and at least (firstName or fullName)
    const missingHeaders: string[] = [];
    if (!colMap.has('claimId')) missingHeaders.push('claim id');
    if (!colMap.has('email')) missingHeaders.push('email');
    if (!colMap.has('settlementAmount')) missingHeaders.push('settlement amount');
    if (!colMap.has('firstName') && !colMap.has('fullName')) missingHeaders.push('first name');

    if (missingHeaders.length > 0) {
      return {
        totalRows: rows.length - 1,
        validCount: 0,
        invalidCount: rows.length - 1,
        totalAllocation: 0,
        settlementFundTotal,
        fundVariance: 0,
        canCommit: false,
        errors: [
          {
            row: 1,
            code: 'MISSING_MANDATORY_HEADER',
            message: `MISSING_MANDATORY_HEADER: Required header(s) missing: ${missingHeaders.join(', ')}`
          }
        ],
        preview: []
      };
    }

    // 3. Process data rows
    const dataRows = rows.slice(1);
    const errors: IngestionError[] = [];
    const validClaimants: RawParsedClaimant[] = [];
    const seenClaimIdsInFile = new Map<string, number>();
    const fileClaimIds: string[] = [];

    // Pre-check existing claim IDs and committed allocation in database if caseDoc exists and MongoDB is connected
    let existingClaimIdsInDb = new Set<string>();
    let existingCommittedAllocation = 0;
    if (targetCaseId && mongoose.connection.readyState === 1) {
      const caseIdFilter = mongoose.isValidObjectId(targetCaseId)
        ? { $in: [new mongoose.Types.ObjectId(targetCaseId.toString()), targetCaseId.toString()] }
        : targetCaseId;

      try {
        const agg = await Claimant.aggregate([
          { $match: { caseId: caseIdFilter } },
          { $group: { _id: null, total: { $sum: '$settlementAmount' } } }
        ]).option({ maxTimeMS: 2000 });

        if (agg && agg.length > 0 && typeof agg[0].total === 'number') {
          existingCommittedAllocation = Math.round(agg[0].total * 100) / 100;
        }
      } catch {
        // If aggregate query fails or times out, proceed with 0 existing allocation
      }

      // Collect candidate claim IDs to query in batch
      for (const row of dataRows) {
        const rawClaimId = row[colMap.get('claimId')!];
        if (rawClaimId) fileClaimIds.push(String(rawClaimId).trim());
      }
      if (fileClaimIds.length > 0) {
        try {
          const existingRecords = await Claimant.find({
            caseId: caseIdFilter,
            claimId: { $in: fileClaimIds }
          }).select('claimId').maxTimeMS(2000);
          existingClaimIdsInDb = new Set(existingRecords.map(r => r.claimId));
        } catch {
          // If query fails or times out, proceed without DB duplicate check
        }
      }
    }

    let totalAllocation = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2; // 1-indexed, header is row 1
      const row = dataRows[i];
      if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
        continue; // Skip completely blank lines
      }

      let rowHasError = false;

      // Extract raw values
      const rawClaimId = row[colMap.get('claimId')!] !== undefined ? String(row[colMap.get('claimId')!]).trim() : '';
      const rawEmail = row[colMap.get('email')!] !== undefined ? String(row[colMap.get('email')!]).trim() : '';
      const rawAmount = row[colMap.get('settlementAmount')!];

      let firstName = '';
      let lastName = '';
      if (colMap.has('firstName')) {
        firstName = row[colMap.get('firstName')!] !== undefined ? String(row[colMap.get('firstName')!]).trim() : '';
      }
      if (colMap.has('lastName')) {
        lastName = row[colMap.get('lastName')!] !== undefined ? String(row[colMap.get('lastName')!]).trim() : '';
      }
      if (!firstName && colMap.has('fullName')) {
        const fullName = String(row[colMap.get('fullName')!] || '').trim();
        const parts = fullName.split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || 'Claimant';
      }
      if (!lastName && firstName) {
        lastName = 'Claimant';
      }

      const phone = colMap.has('phone') ? String(row[colMap.get('phone')!] || '').trim() : '';
      const street = colMap.has('street') ? String(row[colMap.get('street')!] || '').trim() : '';
      const city = colMap.has('city') ? String(row[colMap.get('city')!] || '').trim() : '';
      const state = colMap.has('state') ? String(row[colMap.get('state')!] || '').trim() : '';
      const zip = colMap.has('zip') ? String(row[colMap.get('zip')!] || '').trim() : '';

      // Validate Claim ID
      if (!rawClaimId) {
        rowHasError = true;
        errors.push({
          row: rowNum,
          field: 'claimId',
          code: 'MISSING_CLAIM_ID',
          message: 'Claim ID is required'
        });
      } else if (seenClaimIdsInFile.has(rawClaimId)) {
        rowHasError = true;
        const prevRow = seenClaimIdsInFile.get(rawClaimId);
        errors.push({
          row: rowNum,
          claimId: rawClaimId,
          field: 'claimId',
          code: 'DUPLICATE_CLAIM_ID',
          message: `DUPLICATE_CLAIM_ID: Claim ID "${rawClaimId}" was already defined on row ${prevRow}`
        });
      } else {
        seenClaimIdsInFile.set(rawClaimId, rowNum);
      }

      // Check DB duplication
      if (rawClaimId && existingClaimIdsInDb.has(rawClaimId)) {
        rowHasError = true;
        errors.push({
          row: rowNum,
          claimId: rawClaimId,
          field: 'claimId',
          code: 'DUPLICATE_DB_CLAIM_ID',
          message: `Claim ID "${rawClaimId}" already exists in this case in the database`
        });
      }

      // Validate Email
      if (!rawEmail || !EMAIL_REGEX.test(rawEmail)) {
        rowHasError = true;
        errors.push({
          row: rowNum,
          claimId: rawClaimId,
          field: 'email',
          code: 'INVALID_EMAIL_FORMAT',
          message: `Invalid email format: "${rawEmail}"`
        });
      }

      // Validate Names
      if (!firstName) {
        rowHasError = true;
        errors.push({
          row: rowNum,
          claimId: rawClaimId,
          field: 'firstName',
          code: 'MISSING_FIRST_NAME',
          message: 'First name is required'
        });
      }

      // Validate Settlement Amount
      let numericAmount = 0;
      if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') {
        rowHasError = true;
        errors.push({
          row: rowNum,
          claimId: rawClaimId,
          field: 'settlementAmount',
          code: 'INVALID_AMOUNT',
          message: 'Settlement amount is missing'
        });
      } else {
        const cleanAmountStr = String(rawAmount).replace(/[\$,]/g, '').trim();
        numericAmount = parseFloat(cleanAmountStr);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          rowHasError = true;
          errors.push({
            row: rowNum,
            claimId: rawClaimId,
            field: 'settlementAmount',
            code: 'INVALID_AMOUNT',
            message: `Invalid settlement amount: "${rawAmount}". Amount must be a positive number.`
          });
        }
      }

      if (!rowHasError) {
        totalAllocation += numericAmount;

        // Pre-assigned payment method & details (Expanded rails: paypal, venmo, zelle, bitcoin, ach, etc.)
        let selectedPaymentMethod: PaymentRail | undefined = undefined;
        let paymentDetails: any = undefined;

        const rawMethod = colMap.has('selectedPaymentMethod')
          ? String(row[colMap.get('selectedPaymentMethod')!] || '').trim()
          : '';
        if (rawMethod) {
          selectedPaymentMethod = normalizePaymentMethod(rawMethod);
        }

        const paypalEmail = colMap.has('paypalEmail') ? String(row[colMap.get('paypalEmail')!] || '').trim() : '';
        const venmoHandle = colMap.has('venmoHandle') ? String(row[colMap.get('venmoHandle')!] || '').trim() : '';
        const zelleContact = colMap.has('zelleContact') ? String(row[colMap.get('zelleContact')!] || '').trim() : '';
        const bitcoinAddress = colMap.has('bitcoinAddress') ? String(row[colMap.get('bitcoinAddress')!] || '').trim() : '';
        const routingNumber = colMap.has('routingNumber') ? String(row[colMap.get('routingNumber')!] || '').trim() : '';
        const accountNumber = colMap.has('accountNumber') ? String(row[colMap.get('accountNumber')!] || '').trim() : '';

        if (paypalEmail || venmoHandle || zelleContact || bitcoinAddress || routingNumber || accountNumber) {
          paymentDetails = {};
          if (paypalEmail) {
            paymentDetails.paypalEmail = paypalEmail;
            if (!selectedPaymentMethod) selectedPaymentMethod = 'paypal';
          }
          if (venmoHandle) {
            paymentDetails.venmoHandle = venmoHandle;
            if (!selectedPaymentMethod) selectedPaymentMethod = 'venmo';
          }
          if (zelleContact) {
            paymentDetails.zelleContact = zelleContact;
            if (!selectedPaymentMethod) selectedPaymentMethod = 'zelle';
          }
          if (bitcoinAddress) {
            paymentDetails.bitcoinAddress = bitcoinAddress;
            if (!selectedPaymentMethod) selectedPaymentMethod = 'bitcoin';
          }
          if (routingNumber || accountNumber) {
            paymentDetails.routingNumber = routingNumber;
            paymentDetails.accountNumber = accountNumber;
            if (!selectedPaymentMethod) selectedPaymentMethod = 'ach';
          }
        }

        validClaimants.push({
          claimId: rawClaimId,
          firstName,
          lastName,
          email: rawEmail.toLowerCase(),
          phone: phone || undefined,
          address: {
            street: street || undefined,
            city: city || undefined,
            state: state || undefined,
            zip: zip || undefined
          },
          settlementAmount: Math.round(numericAmount * 100) / 100,
          selectedPaymentMethod,
          paymentDetails,
          status: selectedPaymentMethod ? 'selected' : 'pending_selection'
        });
      }
    }

    totalAllocation = Math.round(totalAllocation * 100) / 100;
    const combinedAllocation = Math.round((totalAllocation + existingCommittedAllocation) * 100) / 100;
    const fundVariance = Math.round((combinedAllocation - settlementFundTotal) * 100) / 100;
    const isVarianceExceeded = settlementFundTotal > 0 ? fundVariance > 0.001 : combinedAllocation > 0;

    if (isVarianceExceeded) {
      errors.push({
        row: 0,
        code: 'SETTLEMENT_FUND_OVERALLOCATION',
        message: settlementFundTotal <= 0
          ? `Total claimant allocation ($${combinedAllocation.toFixed(2)}) exceeds case settlement fund ($${settlementFundTotal.toFixed(2)}) by $${combinedAllocation.toFixed(2)}`
          : existingCommittedAllocation > 0
          ? `Total claimant allocation ($${totalAllocation.toFixed(2)} plus existing committed $${existingCommittedAllocation.toFixed(2)} = $${combinedAllocation.toFixed(2)}) exceeds case settlement fund ($${settlementFundTotal.toFixed(2)}) by $${fundVariance.toFixed(2)}`
          : `Total claimant allocation ($${totalAllocation.toFixed(2)}) exceeds case settlement fund ($${settlementFundTotal.toFixed(2)}) by $${fundVariance.toFixed(2)}`
      });
    }

    const canCommit = errors.length === 0 && validClaimants.length > 0 && !isVarianceExceeded;

    return {
      totalRows: dataRows.length,
      validCount: validClaimants.length,
      invalidCount: errors.filter(e => e.row > 0).length,
      totalAllocation,
      settlementFundTotal,
      fundVariance,
      canCommit,
      errors,
      preview: validClaimants.slice(0, 25),
      stagedClaimants: validClaimants,
      existingAllocation: existingCommittedAllocation
    };
  }

  /**
   * Phase 2: Commits staged claimants to the database, generating secure 64-hex tokens.
   */
  static async commitUpload(
    caseOrCaseId: ICase | string,
    claimants: RawParsedClaimant[]
  ): Promise<CommitUploadResult> {
    let caseDoc: ICase | null = null;
    if (typeof caseOrCaseId === 'string') {
      caseDoc = await Case.findById(caseOrCaseId);
      if (!caseDoc) {
        caseDoc = await Case.findOne({ caseId: caseOrCaseId });
      }
    } else {
      caseDoc = caseOrCaseId;
    }

    if (!caseDoc) {
      throw new Error('Case not found');
    }

    const targetCaseId = caseDoc._id;
    const tokenExpiresAt = caseDoc.disbursementDeadline || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const docsToInsert = claimants.map(c => {
      const token = this.generateToken();
      return {
        caseId: targetCaseId,
        claimId: c.claimId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email.toLowerCase(),
        phone: c.phone || '',
        address: c.address || { street: '', city: '', state: '', zip: '' },
        settlementAmount: c.settlementAmount,
        status: c.selectedPaymentMethod ? 'selected' : (c.status || 'pending_selection'),
        paymentSelectionToken: token,
        tokenExpiresAt,
        selectedPaymentMethod: c.selectedPaymentMethod || undefined,
        paymentDetails: c.paymentDetails || undefined
      };
    });

    if (docsToInsert.length > 0) {
      await Claimant.insertMany(docsToInsert, { ordered: false });

      // If case was in draft, transition to active
      if (caseDoc.status === 'draft') {
        caseDoc.status = 'active';
        await caseDoc.save();
      }
    }

    return {
      success: true,
      insertedCount: docsToInsert.length,
      caseId: targetCaseId.toString()
    };
  }
}
