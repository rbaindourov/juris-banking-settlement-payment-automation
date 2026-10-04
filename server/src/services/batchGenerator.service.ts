import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Case, ICase } from '../models/Case';
import { Claimant, IClaimant } from '../models/Claimant';
import { DisbursementBatch, IDisbursementBatch } from '../models/DisbursementBatch';
import { config } from '../config/env';
import { decryptAes256Gcm } from './portalValidation.service';

export interface BatchHeaderMeta {
  clientId?: string;
  caseId: string;
  caseName?: string;
  companyName?: string;
  docketNumber?: string;
  batchId: string;
  environment?: 'PRODUCTION' | 'TEST';
  timestamp?: string;
}

export type PaymentRailCode =
  | 'ACH'
  | 'DIGITAL_CARD'
  | 'PUSH_DEBIT'
  | 'PHYSICAL_CHECK'
  | 'PAYPAL'
  | 'VENMO'
  | 'ZELLE'
  | 'BITCOIN';

export interface BatchDetailItem {
  method: PaymentRailCode | string;
  claimId: string;
  claimantId?: string;
  firstName: string;
  lastName: string;
  amount: number;
  reference?: string;

  // ACH specific
  achRouting?: string;
  achAccount?: string;
  achType?: 'CHECKING' | 'SAVINGS' | string;

  // Card specific
  cardBrand?: 'MASTERCARD' | 'VISA' | string;
  channel?: string;
  email?: string;
  phone?: string;

  // Push Debit specific
  token?: string;
  last4?: string;
  bin?: string;
  network?: string;

  // Check specific
  payee?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  memo?: string;

  // Digital Wallets
  paypalAccount?: string;
  venmoHandle?: string;
  zelleRecipient?: string;
  bitcoinAddress?: string;

  // Raw source ID
  _claimantDocId?: string;
}

export interface CompiledBatchResult {
  batchId: string;
  filename: string;
  csvContent: string;
  csvPath: string;
  sha256: string;
  sha256Path: string;
  totalRecords: number;
  totalAmount: number;
  claimantIds: string[];
  railBreakdown: Record<string, { count: number; amount: number }>;
  batchDoc: IDisbursementBatch;
}

export class BatchGeneratorService {
  /**
   * RFC 4180 CSV escaping helper.
   */
  public static escapeCsvField(val: any): string {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes(';')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Computes SHA-256 hexadecimal lowercase hash.
   */
  public static computeSha256(content: string | Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Builds the formatted CSV string from structured header, details, and trailer records.
   */
  public static buildBatchCsv(
    headerMeta: BatchHeaderMeta,
    details: BatchDetailItem[],
    format: 'v2' | 'compact' = 'v2'
  ): {
    csvContent: string;
    sha256: string;
    totalAmount: number;
    breakdown: Record<string, { count: number; amount: number }>;
  } {
    if (!details || details.length === 0) {
      throw new Error('MIN_RECORDS: Outbound batch must contain at least 1 detail record');
    }

    const now = new Date();
    const timestampIso = headerMeta.timestamp || now.toISOString().replace(/\.\d{3}Z$/, 'Z');

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

    const detailLines: string[] = [];

    for (const d of details) {
      const amt = typeof d.amount === 'number' ? d.amount : parseFloat(d.amount as any) || 0;
      totalAmount = Math.round((totalAmount + amt) * 100) / 100;
      const ref = d.reference || `PAY-${headerMeta.caseId}-${d.claimId}`;
      const normMethod = (d.method || '').toUpperCase();

      if (normMethod === 'ACH' || normMethod === 'DIRECT_DEPOSIT') {
        countAch++;
        amountAch = Math.round((amountAch + amt) * 100) / 100;
        const rNum = d.achRouting ? parseInt(d.achRouting, 10) || 0 : 0;
        routingHashSum = (routingHashSum + rNum) % 10000000000;

        if (format === 'compact') {
          detailLines.push([
            'D', 'ACH', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.achRouting || '',
            d.achAccount || '',
            (d.achType || 'CHECKING').toUpperCase(),
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'ACH', d.claimId, d.claimantId || d.claimId,
            `"${d.firstName}"`, `"${d.lastName}"`, amt.toFixed(2), 'USD', ref,
            d.achRouting || '', d.achAccount || '', (d.achType || 'CHECKING').toUpperCase(),
            'PPD', 'SETTLEMENT',
            '', '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'DIGITAL_CARD' || normMethod === 'CARD') {
        countCard++;
        amountCard = Math.round((amountCard + amt) * 100) / 100;

        if (format === 'compact') {
          detailLines.push([
            'D', 'CARD', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.email || '',
            d.phone || '',
            (d.cardBrand || 'MASTERCARD').toUpperCase(),
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'DIGITAL_CARD', d.claimId, d.claimantId || d.claimId,
            `"${d.firstName}"`, `"${d.lastName}"`, amt.toFixed(2), 'USD', ref,
            (d.cardBrand || 'MASTERCARD').toUpperCase(),
            d.channel || 'EMAIL',
            d.email || '',
            d.phone || '',
            `"${d.firstName} ${d.lastName}"`,
            '24',
            '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'PUSH_DEBIT' || normMethod === 'DEBIT' || normMethod === 'DEBIT_CARD') {
        countDebit++;
        amountDebit = Math.round((amountDebit + amt) * 100) / 100;

        if (format === 'compact') {
          detailLines.push([
            'D', 'DEBIT', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.last4 || '0000',
            d.token || 'tok_debit',
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'PUSH_DEBIT', d.claimId, d.claimantId || d.claimId,
            `"${d.firstName}"`, `"${d.lastName}"`, amt.toFixed(2), 'USD', ref,
            d.token || 'tok_debit',
            d.last4 || '0000',
            d.bin || '411111',
            (d.network || 'VISA').toUpperCase(),
            `"${d.firstName} ${d.lastName}"`,
            '', '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'PHYSICAL_CHECK' || normMethod === 'CHECK') {
        countCheck++;
        amountCheck = Math.round((amountCheck + amt) * 100) / 100;
        const payeeName = d.payee || `${d.firstName} ${d.lastName}`.trim();
        const street1 = d.street1 || '123 Main St';
        const street2 = d.street2 || '';
        const city = d.city || 'Los Angeles';
        const state = (d.state || 'CA').toUpperCase();
        const zip = d.zip || '90001';
        const memo = d.memo || headerMeta.caseName || 'Settlement';

        if (format === 'compact') {
          detailLines.push([
            'D', 'CHECK', d.claimId,
            this.escapeCsvField(payeeName),
            this.escapeCsvField(street1),
            this.escapeCsvField(street2),
            this.escapeCsvField(city),
            state,
            zip,
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'PHYSICAL_CHECK', d.claimId, d.claimantId || d.claimId,
            this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
            amt.toFixed(2), 'USD', ref,
            this.escapeCsvField(payeeName),
            this.escapeCsvField(street1),
            this.escapeCsvField(street2),
            this.escapeCsvField(city),
            state,
            zip,
            'US',
            this.escapeCsvField(memo),
            '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'PAYPAL') {
        if (format === 'compact') {
          detailLines.push([
            'D', 'PAYPAL', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.paypalAccount || d.email || '',
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'PAYPAL', d.claimId, d.claimantId || d.claimId,
            this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
            amt.toFixed(2), 'USD', ref,
            d.paypalAccount || d.email || '',
            '', '', '', '', '', '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'VENMO') {
        if (format === 'compact') {
          detailLines.push([
            'D', 'VENMO', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.venmoHandle || d.phone || '',
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'VENMO', d.claimId, d.claimantId || d.claimId,
            this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
            amt.toFixed(2), 'USD', ref,
            d.venmoHandle || d.phone || '',
            '', '', '', '', '', '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'ZELLE') {
        if (format === 'compact') {
          detailLines.push([
            'D', 'ZELLE', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.zelleRecipient || d.phone || d.email || '',
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'D', 'ZELLE', d.claimId, d.claimantId || d.claimId,
            this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
            amt.toFixed(2), 'USD', ref,
            d.zelleRecipient || d.phone || d.email || '',
            '', '', '', '', '', '', '', '', '', ''
          ].join(','));
        }
      } else if (normMethod === 'BITCOIN') {
        if (format === 'compact') {
          detailLines.push([
            'D', 'BITCOIN', d.claimId,
            `"${d.firstName} ${d.lastName}"`,
            d.bitcoinAddress || '',
            amt.toFixed(2)
          ].join(','));
        } else {
          detailLines.push([
            'DETAIL', 'BITCOIN', d.claimId, d.claimantId || d.claimId,
            this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
            amt.toFixed(2), 'USD', ref,
            d.bitcoinAddress || '',
            '', '', '', '', '', '', '', '', '', ''
          ].join(','));
        }
      } else {
        // Fallback default
        detailLines.push([
          'DETAIL', normMethod, d.claimId, d.claimantId || d.claimId,
          this.escapeCsvField(d.firstName), this.escapeCsvField(d.lastName),
          amt.toFixed(2), 'USD', ref,
          '', '', '', '', '', '', '', '', '', '', ''
        ].join(','));
      }
    }

    let headerLine: string;
    let trailerLine: string;

    if (format === 'compact') {
      const companyName = headerMeta.companyName || headerMeta.caseName || 'Juris Banking';
      headerLine = [
        'H',
        headerMeta.batchId,
        headerMeta.caseId,
        this.escapeCsvField(companyName),
        details.length,
        totalAmount.toFixed(2),
        timestampIso
      ].join(',');

      const detailConcatHash = this.computeSha256(detailLines.join('\n'));
      trailerLine = [
        'T',
        details.length,
        totalAmount.toFixed(2),
        detailConcatHash
      ].join(',');
    } else {
      const env = headerMeta.environment || (config.NODE_ENV === 'production' ? 'PRODUCTION' : 'TEST');
      headerLine = [
        'HEADER',
        'DASH_SFTP_V2.0',
        headerMeta.clientId || 'FIRM-001',
        headerMeta.caseId,
        headerMeta.docketNumber || '1:24-cv-09821',
        headerMeta.batchId,
        timestampIso,
        env,
        'USD',
        details.length,
        totalAmount.toFixed(2)
      ].join(',');

      trailerLine = [
        'TRAILER',
        details.length,
        totalAmount.toFixed(2),
        countAch,
        amountAch.toFixed(2),
        countCard,
        amountCard.toFixed(2),
        countDebit,
        amountDebit.toFixed(2),
        countCheck,
        amountCheck.toFixed(2),
        String(routingHashSum).padStart(9, '0')
      ].join(',');
    }

    const csvContent = [headerLine, ...detailLines, trailerLine].join('\n');
    const sha256 = this.computeSha256(csvContent);

    const breakdown = {
      ach: { count: countAch, amount: amountAch },
      card: { count: countCard, amount: amountCard },
      debit: { count: countDebit, amount: amountDebit },
      check: { count: countCheck, amount: amountCheck }
    };

    return { csvContent, sha256, totalAmount, breakdown };
  }

  /**
   * Maps an individual claimant document into a BatchDetailItem.
   */
  public static mapClaimantToDetail(claimant: any, caseDoc: any): BatchDetailItem {
    const rawMethod = claimant.selectedPaymentMethod || caseDoc.fallbackPaymentMethod || 'physical_check';
    const norm = String(rawMethod).toLowerCase();
    const details = claimant.paymentDetails || {};

    let routing = details.routingNumber || details.achRouting || '';
    let account = '';

    if (details.encryptedAccountNumber) {
      try {
        account = decryptAes256Gcm(details.encryptedAccountNumber);
      } catch {
        account = details.encryptedAccountNumber;
      }
    } else {
      account = details.accountNumber || details.achAccount || '';
    }

    let mappedRail: PaymentRailCode = 'PHYSICAL_CHECK';
    if (norm === 'ach' || norm === 'direct_deposit') {
      mappedRail = 'ACH';
    } else if (norm === 'digital_card' || norm === 'card') {
      mappedRail = 'DIGITAL_CARD';
    } else if (norm === 'debit_card' || norm === 'push_to_debit' || norm === 'push_debit') {
      mappedRail = 'PUSH_DEBIT';
    } else if (norm === 'physical_check' || norm === 'check') {
      mappedRail = 'PHYSICAL_CHECK';
    } else if (norm === 'paypal') {
      mappedRail = 'PAYPAL';
    } else if (norm === 'venmo') {
      mappedRail = 'VENMO';
    } else if (norm === 'zelle') {
      mappedRail = 'ZELLE';
    } else if (norm === 'bitcoin') {
      mappedRail = 'BITCOIN';
    }

    const addr = details.address || claimant.address || {};

    return {
      method: mappedRail,
      claimId: claimant.claimId,
      claimantId: claimant._id ? claimant._id.toString() : claimant.id,
      firstName: claimant.firstName || '',
      lastName: claimant.lastName || '',
      amount: claimant.settlementAmount || 0,
      reference: `PAY-${caseDoc.caseId || caseDoc.id}-${claimant.claimId}`,

      // ACH
      achRouting: routing,
      achAccount: account,
      achType: details.accountType || 'CHECKING',

      // Card
      cardBrand: details.cardBrand || 'MASTERCARD',
      channel: details.channel || 'EMAIL',
      email: details.recipientEmail || claimant.email || '',
      phone: details.recipientPhone || claimant.phone || '',

      // Debit
      token: details.tokenRef || details.token || 'tok_debit_token',
      last4: details.cardLast4 || details.last4 || '0000',
      bin: details.bin || '411111',
      network: details.network || 'VISA',

      // Check
      payee: details.recipientName || `${claimant.firstName} ${claimant.lastName}`.trim(),
      street1: addr.street || addr.street1 || '123 Main St',
      street2: addr.street2 || '',
      city: addr.city || 'Los Angeles',
      state: addr.state || 'CA',
      zip: addr.zip || '90001',
      memo: caseDoc.name || 'Settlement',

      // Wallets
      paypalAccount: details.paypalAccount || claimant.email,
      venmoHandle: details.venmoIdentifier || details.venmoHandle,
      zelleRecipient: details.zelleRecipient || claimant.phone || claimant.email,
      bitcoinAddress: details.bitcoinAddress,

      _claimantDocId: claimant._id ? claimant._id.toString() : claimant.id
    };
  }

  /**
   * Spools the generated CSV and companion .sha256 digest atomically to storage/sftp/outbox/.
   */
  public static async spoolToOutbox(
    filename: string,
    csvContent: string
  ): Promise<{ csvPath: string; sha256Path: string; sha256: string }> {
    const outboxDir = path.resolve(process.cwd(), config.SFTP_LOCAL_STORAGE_DIR || 'storage/sftp', 'outbox');
    await fs.promises.mkdir(outboxDir, { recursive: true });

    const csvPath = path.join(outboxDir, filename);
    const tmpSalt = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${csvPath}.${tmpSalt}.tmp`;
    const sha256Path = `${csvPath}.sha256`;

    // 1. Write staging .tmp file
    await fs.promises.writeFile(tmpPath, csvContent, 'utf8');

    // 2. Atomic rename
    await fs.promises.rename(tmpPath, csvPath);

    // 3. Compute hash and write companion .sha256 digest
    const sha256 = this.computeSha256(csvContent);
    const companionContent = `${sha256}  ${filename}\n`;
    await fs.promises.writeFile(sha256Path, companionContent, 'utf8');

    return { csvPath, sha256Path, sha256 };
  }

  /**
   * Compiles and spools an outbound disbursement batch for a specific case.
   */
  public static async compileAndSpoolCaseBatch(
    caseIdentifier: string,
    options?: { requestedBy?: string; format?: 'v2' | 'compact' }
  ): Promise<CompiledBatchResult> {
    // 1. Look up Case
    const caseDoc = mongoose.isValidObjectId(caseIdentifier)
      ? (await Case.findById(caseIdentifier)) || (await Case.findOne({ caseId: caseIdentifier }))
      : await Case.findOne({ caseId: caseIdentifier });

    if (!caseDoc) {
      throw new Error(`Case not found for identifier: ${caseIdentifier}`);
    }

    const caseLookupIds = [caseDoc._id, (caseDoc as any).caseId, caseIdentifier].filter(Boolean);

    // 2. Query candidate eligible claimants
    const candidateClaimants = await Claimant.find({
      caseId: { $in: caseLookupIds },
      status: { $in: ['selected', 'deadline_expired'] }
    }).sort({ createdAt: 1 });

    if (!candidateClaimants || candidateClaimants.length === 0) {
      throw new Error('MIN_RECORDS: Outbound batch must contain at least 1 detail record');
    }

    // 3. Build collision-resistant identifiers
    const timestampStr = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '');
    const randomSalt = crypto.randomBytes(3).toString('hex');
    const cleanCaseId = (caseDoc.caseId || caseDoc._id.toString()).replace(/[^a-zA-Z0-9_-]/g, '_');
    const batchId = `BATCH-${cleanCaseId}-${timestampStr}-${randomSalt}`;
    const filename = `DASH_DISBURSE_${cleanCaseId}_${timestampStr}_${randomSalt}.csv`;

    const candidateIds = candidateClaimants.map((c) => c._id as mongoose.Types.ObjectId);

    // 4. Atomically transition eligible claimants to queued_for_sftp with this batchId
    await Claimant.updateMany(
      {
        _id: { $in: candidateIds },
        status: { $in: ['selected', 'deadline_expired'] }
      },
      {
        $set: {
          status: 'queued_for_sftp',
          batchId,
          batchFilename: filename,
          batchGeneratedAt: new Date()
        }
      }
    );

    // 5. Query only claimants that were successfully claimed by THIS batch invocation
    const claimants = await Claimant.find({
      _id: { $in: candidateIds },
      batchId
    }).sort({ createdAt: 1 });

    if (!claimants || claimants.length === 0) {
      throw new Error('MIN_RECORDS: Outbound batch must contain at least 1 detail record');
    }

    const detailItems = claimants.map((c) => this.mapClaimantToDetail(c, caseDoc));
    const headerMeta: BatchHeaderMeta = {
      clientId: caseDoc.lawFirmId || 'FIRM-001',
      caseId: caseDoc.caseId || caseDoc._id.toString(),
      caseName: caseDoc.name,
      companyName: caseDoc.name,
      docketNumber: caseDoc.docketNumber || '1:24-cv-09821',
      batchId,
      environment: config.NODE_ENV === 'production' ? 'PRODUCTION' : 'TEST'
    };

    const format = options?.format || 'v2';
    const { csvContent, sha256, totalAmount, breakdown } = this.buildBatchCsv(headerMeta, detailItems, format);

    // 6. Spool atomically to outbox
    const { csvPath, sha256Path } = await this.spoolToOutbox(filename, csvContent);

    const claimantIds = claimants.map((c) => c._id as mongoose.Types.ObjectId);

    // 7. Record DisbursementBatch document
    const batchDoc = await DisbursementBatch.create({
      batchId,
      caseId: caseDoc._id,
      filename,
      filePath: csvPath,
      sha256,
      totalRecords: detailItems.length,
      totalAmount,
      claimantIds,
      railBreakdown: breakdown,
      status: 'spooled',
      generatedBy: options?.requestedBy && mongoose.isValidObjectId(options.requestedBy) ? options.requestedBy : undefined,
      generatedAt: new Date()
    });

    return {
      batchId,
      filename,
      csvContent,
      csvPath,
      sha256,
      sha256Path,
      totalRecords: detailItems.length,
      totalAmount,
      claimantIds: claimantIds.map((id) => id.toString()),
      railBreakdown: breakdown,
      batchDoc
    };
  }
}
