/**
 * scripts/capture_training_videos.mjs
 * ---------------------------------------------------------------------------
 * Autonomous Playwright Video Capture Pipeline for JurisBanking Training Videos.
 * Seeds a high-fidelity demonstration environment, orchestrates UX flows,
 * captures smooth 720p 60fps recordings, and transcodes to web-ready MP4s with ffmpeg.
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Playwright from installed node_modules cache
const PLAYWRIGHT_PATH = '/home/robert/Documents/projects/multipleDomainCMS/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js';
const pw = await import(PLAYWRIGHT_PATH);
const chromium = pw.default?.chromium || pw.chromium;

const DEMO_DB_URI = 'mongodb://127.0.0.1:27017/juris_banking_demo';
const JWT_SECRET = 'super_secure_jwt_secret_change_in_production_min32chars_long!';
const SERVER_PORT = 5000;
const CLIENT_PORT = 3000;
const RAW_VIDEO_DIR = path.join(ROOT_DIR, 'docs/videos/raw');
const OUTPUT_VIDEO_DIR = path.join(ROOT_DIR, 'docs/videos');
const POSTERS_DIR = path.join(ROOT_DIR, 'docs/videos/posters');

// Exactly 64-character hexadecimal token for claimant magic link portal
const DEMO_CLAIMANT_TOKEN = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

fs.mkdirSync(RAW_VIDEO_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_VIDEO_DIR, { recursive: true });
fs.mkdirSync(POSTERS_DIR, { recursive: true });

// Wait helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1500, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch (_) {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// 1. SEED DEMO DATABASE
// ---------------------------------------------------------------------------
async function seedDemoDatabase() {
  console.log('🌱 [Seeder] Connecting to demo MongoDB:', DEMO_DB_URI);
  await mongoose.connect(DEMO_DB_URI);

  const collections = await mongoose.connection.db.collections();
  for (const c of collections) {
    await c.drop().catch(() => {});
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  // 1. Create Law Firm Admin User
  const user = await mongoose.connection.db.collection('users').insertOne({
    email: 'admin@lawfirm.com',
    passwordHash,
    fullName: 'Robert Baindourov (Lead Counsel)',
    role: 'law_firm_admin',
    lawFirmId: 'FIRM_DEMO_01',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const userId = user.insertedId;
  const caseId = new mongoose.Types.ObjectId();

  // 2. Create Active Settlement Case
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await mongoose.connection.db.collection('cases').insertOne({
    _id: caseId,
    name: 'In re National Consumer Privacy Settlement',
    docketNumber: '24-CV-08912-EMC',
    lawFirmId: 'FIRM_DEMO_01',
    settlementFundTotal: 1250000.0,
    disbursementDeadline: deadline,
    fallbackPaymentMethod: 'physical_check',
    status: 'active',
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'es', 'zh', 'vi'],
    emailTemplate: {
      subject: 'Important Legal Notice: In re National Consumer Privacy Settlement Fund',
      bodyHtml:
        '<h2>Official Settlement Notice: {{case_name}}</h2><p>Dear {{claimant_first_name}} {{claimant_last_name}},</p><p>You are an eligible claimant with a confirmed settlement award of <strong>{{settlement_amount}}</strong>.</p><p>Select your payment preference before <strong>{{selection_deadline}}</strong>:</p><p><a href="{{payment_selection_link}}" class="btn-primary">Select Disbursement Method</a></p>'
    },
    landingPageText: {
      headline: 'Welcome to the National Consumer Privacy Settlement Election Portal',
      introHtml: '<p>Please confirm your identity and select your preferred disbursement method.</p>',
      faqAccordion: [
        {
          question: 'When will settlement funds be disbursed?',
          answer: 'Disbursements begin immediately following final reconciliation after the deadline.'
        },
        {
          question: 'Can I update my election after submission?',
          answer: 'Yes, elections may be modified prior to the deadline using your secure magic link.'
        }
      ],
      supportContact: {
        email: 'support@privacy-settlement.law',
        phone: '(800) 555-0199'
      }
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // 3. Create Demo Claimant for Magic Link Walkthrough (with 64-char hex token!)
  await mongoose.connection.db.collection('claimants').insertOne({
    claimId: 'CLM-DEMO-001',
    caseId,
    paymentSelectionToken: DEMO_CLAIMANT_TOKEN,
    claimantToken: DEMO_CLAIMANT_TOKEN,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane.doe@example.com',
    phone: '(555) 234-5678',
    address: {
      street: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      zip: '97477'
    },
    settlementAmount: 450.0,
    status: 'pending_selection',
    notificationStatus: 'opened',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // 4. Seed Diverse Claimants for Analytics Funnel & Method Breakdown
  const paymentRails = [
    { method: 'ach', count: 24, status: 'disbursed', label: 'Direct Deposit / ACH' },
    { method: 'digital_card', count: 18, status: 'disbursed', label: 'Digital Prepaid Card' },
    { method: 'physical_check', count: 12, status: 'disbursed', label: 'Mailed Physical Check' },
    { method: 'push_to_debit', count: 8, status: 'disbursed', label: 'Push to Debit' },
    { method: 'zelle', count: 6, status: 'selected', label: 'Zelle' },
    { method: 'venmo', count: 5, status: 'selected', label: 'Venmo' },
    { method: 'paypal', count: 5, status: 'selected', label: 'PayPal' },
    { method: 'bitcoin', count: 3, status: 'selected', label: 'Bitcoin' }
  ];

  let claimIdx = 2;
  for (const rail of paymentRails) {
    for (let i = 0; i < rail.count; i++) {
      const tok = `a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcde${String(claimIdx).padStart(2, '0')}`;
      await mongoose.connection.db.collection('claimants').insertOne({
        claimId: `CLM-STAT-${String(claimIdx).padStart(4, '0')}`,
        caseId,
        paymentSelectionToken: tok,
        claimantToken: tok,
        firstName: `Member${claimIdx}`,
        lastName: `Claimant`,
        email: `claimant${claimIdx}@example.org`,
        phone: `(555) 800-${String(claimIdx).padStart(4, '0')}`,
        address: { street: `${100 + claimIdx} Main St`, city: 'Los Angeles', state: 'CA', zip: '90001' },
        settlementAmount: 450.0,
        status: rail.status,
        selectedPaymentMethod: rail.method,
        paymentDetails: { rail: rail.method, verified: true },
        notificationStatus: 'delivered',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      claimIdx++;
    }
  }

  // Seed pending records
  for (let i = 0; i < 20; i++) {
    const pendTok = `b1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcde${String(claimIdx).padStart(2, '0')}`;
    await mongoose.connection.db.collection('claimants').insertOne({
      claimId: `CLM-PEND-${String(claimIdx).padStart(4, '0')}`,
      caseId,
      paymentSelectionToken: pendTok,
      claimantToken: pendTok,
      firstName: `Pending${i}`,
      lastName: `User`,
      email: `pending${i}@example.org`,
      settlementAmount: 450.0,
      status: 'pending_selection',
      notificationStatus: i % 2 === 0 ? 'opened' : 'dispatched',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    claimIdx++;
  }

  // Seed 2 NACHA return exceptions for the Exception Ledger
  const excTok1 = `c1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef1`;
  await mongoose.connection.db.collection('claimants').insertOne({
    claimId: `CLM-EXC-R01`,
    caseId,
    paymentSelectionToken: excTok1,
    claimantToken: excTok1,
    firstName: `Marcus`,
    lastName: `Vance`,
    email: `m.vance@example.com`,
    settlementAmount: 450.0,
    status: 'returned',
    selectedPaymentMethod: 'ach',
    paymentDetails: { routingNumber: '021000021', accountNumber: '883920192', returnCode: 'R01', returnReason: 'Insufficient Funds' },
    notificationStatus: 'failed',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const excTok2 = `c1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef2`;
  await mongoose.connection.db.collection('claimants').insertOne({
    claimId: `CLM-EXC-R03`,
    caseId,
    paymentSelectionToken: excTok2,
    claimantToken: excTok2,
    firstName: `Elena`,
    lastName: `Rostova`,
    email: `e.rostova@example.com`,
    settlementAmount: 450.0,
    status: 'returned',
    selectedPaymentMethod: 'ach',
    paymentDetails: { routingNumber: '121000358', accountNumber: '449201920', returnCode: 'R03', returnReason: 'No Account / Unable to Locate Account' },
    notificationStatus: 'failed',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await mongoose.disconnect();
  console.log('✅ [Seeder] Demo database seeded successfully. Primary Case ID:', caseId.toString());
  return { caseId: caseId.toString(), userId: userId.toString() };
}

// ---------------------------------------------------------------------------
// 2. VIDEO CAPTURE RUNNER
// ---------------------------------------------------------------------------
async function main() {
  console.log('🧹 [Pre-Flight] Ensuring ports 5000 and 3000 are free...');
  try {
    execSync('fuser -k 5000/tcp 3000/tcp 2>/dev/null || true');
  } catch (_) {}
  await sleep(1500);

  const { caseId } = await seedDemoDatabase();

  // Create JWT Auth Token for Law Firm Admin
  const adminToken = jwt.sign(
    {
      userId: '6ac2414ecc7d9617c1917f94',
      email: 'admin@lawfirm.com',
      role: 'law_firm_admin',
      fullName: 'Robert Baindourov (Lead Counsel)',
      lawFirmId: 'FIRM_DEMO_01'
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log('🚀 [Processes] Starting Server on port 5000...');
  const serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: path.join(ROOT_DIR, 'server'),
    env: {
      ...process.env,
      PORT: '5000',
      NODE_ENV: 'development',
      MONGODB_URI: DEMO_DB_URI,
      CLIENT_URL: 'http://localhost:3000'
    },
    stdio: 'inherit'
  });

  console.log('🚀 [Processes] Starting Client Vite Preview on port 3000...');
  const clientProcess = spawn('npx', ['vite', 'preview', '--port', '3000', '--host', '127.0.0.1'], {
    cwd: path.join(ROOT_DIR, 'client'),
    stdio: 'inherit'
  });

  const cleanup = () => {
    console.log('🧹 [Cleanup] Stopping background processes...');
    try { serverProcess.kill('SIGINT'); } catch (_) {}
    try { clientProcess.kill('SIGINT'); } catch (_) {}
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForHttp('http://127.0.0.1:5000/api/health', 30000);
    console.log('✅ Backend API responding at http://127.0.0.1:5000/api/health');

    await waitForHttp('http://127.0.0.1:3000/', 30000);
    console.log('✅ Client UI responding at http://127.0.0.1:3000/');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // =======================================================================
    // FLOW 1: LAW FIRM CASE SETUP & ROSTER INGESTION (18-22s)
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 1: Case Setup & Roster Ingestion...');
    const ctx1 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });

    await ctx1.addCookies([
      { name: 'token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: 'localhost', path: '/' }
    ]);

    const page1 = await ctx1.newPage();
    await page1.goto('http://localhost:3000/cases', { waitUntil: 'networkidle' });
    await sleep(2000);

    // Show Case List Header & Hover
    await page1.mouse.move(600, 200, { steps: 10 });
    await sleep(1200);

    // Click "+ Register New Case" button
    const newCaseBtn = page1.locator('button:has-text("Register New Case")').first();
    if (await newCaseBtn.isVisible()) {
      await newCaseBtn.hover();
      await sleep(1000);
      await newCaseBtn.click();
      await sleep(1500);

      // Fill out modal
      await page1.fill('input[placeholder*="Consumer Privacy"], input[name="name"], form input >> nth=0', 'In re Apex Data Breach Settlement');
      await sleep(600);
      await page1.fill('input[placeholder*="CV"], input[name="docketNumber"], form input >> nth=1', '24-CV-10492-JST');
      await sleep(600);
      await page1.fill('input[name="settlementFundTotal"], form input >> nth=2', '850000');
      await sleep(600);
      
      const deadlineInput = page1.locator('input[type="datetime-local"], input[name="disbursementDeadline"]').first();
      if (await deadlineInput.isVisible()) {
        await deadlineInput.fill('2026-11-15T17:00');
        await sleep(800);
      }

      // Close modal
      const cancelBtn = page1.locator('button:has-text("Cancel")').first();
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await sleep(1000);
      }
    }

    // Select the existing seeded case
    const caseCard = page1.locator(`text=In re National Consumer Privacy Settlement`).first();
    await caseCard.scrollIntoViewIfNeeded();
    await sleep(1000);
    await caseCard.click();
    await sleep(2000);

    // Navigate to Roster Ingestion Tab
    const ingestionTab = page1.locator('button:has-text("Roster Ingestion")').first();
    if (await ingestionTab.isVisible()) {
      await ingestionTab.hover();
      await sleep(800);
      await ingestionTab.click();
      await sleep(1500);
    }

    // Upload sample CSV
    const sampleCsvPath = path.join(ROOT_DIR, 'storage/sample_claimants_roster.csv');
    const fileInput = page1.locator('input[type="file"]').first();
    if (await fileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fileInput.setInputFiles(sampleCsvPath);
      await sleep(2000);

      // Click "Stage & Validate Roster"
      const stageBtn = page1.locator('button:has-text("Stage"), button:has-text("Validate")').first();
      if (await stageBtn.isVisible()) {
        await stageBtn.click();
        await sleep(2500);
      }

      // Scroll preview table
      await page1.mouse.wheel(0, 400);
      await sleep(2000);

      // Click "Commit Records"
      const commitBtn = page1.locator('button:has-text("Commit")').first();
      if (await commitBtn.isVisible()) {
        await commitBtn.click();
        await sleep(2500);
      }
    }

    await sleep(2000);
    const video1Obj = page1.video();
    await ctx1.close();
    const video1Path = await video1Obj.path();
    console.log('✅ Flow 1 captured:', video1Path);


    // =======================================================================
    // FLOW 2: QUILL WYSIWYG TEMPLATE DESIGNER & LOCALIZATION (20-25s)
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 2: Quill WYSIWYG & Localization...');
    const ctx2 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });

    await ctx2.addCookies([
      { name: 'token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: 'localhost', path: '/' }
    ]);

    const page2 = await ctx2.newPage();
    await page2.goto(`http://localhost:3000/cases/${caseId}`, { waitUntil: 'networkidle' });
    await sleep(2000);

    // Switch to Quill Template Designer Tab
    const templateTab = page2.locator('button:has-text("Quill Template Designer")').first();
    if (await templateTab.isVisible()) {
      await templateTab.hover();
      await sleep(800);
      await templateTab.click();
      await sleep(2000);
    }

    // Focus on Subject input
    const subjectInput = page2.locator('input[placeholder*="subject"], label:has-text("Subject") + input, input >> nth=0').first();
    if (await subjectInput.isVisible()) {
      await subjectInput.click();
      await subjectInput.press('End');
      await page2.keyboard.type(' - Election Deadline Nov 15');
      await sleep(1500);
    }

    // Scroll through Quill editor toolbar and content
    await page2.mouse.move(500, 350, { steps: 10 });
    await sleep(1000);

    // Hover dynamic merge tag pills
    const mergeTags = page2.locator('span:has-text("{{"), button:has-text("{{")');
    const tagCount = await mergeTags.count();
    for (let i = 0; i < Math.min(tagCount, 4); i++) {
      await mergeTags.nth(i).hover();
      await sleep(500);
    }

    // Click "Preview Live" button
    const previewBtn = page2.locator('button:has-text("Preview Live")').first();
    if (await previewBtn.isVisible()) {
      await previewBtn.hover();
      await sleep(800);
      await previewBtn.click();
      await sleep(2000);

      // Toggle Mobile Viewport in preview modal
      const mobileToggle = page2.locator('button:has-text("Mobile"), button:has-text("Smartphone")').first();
      if (await mobileToggle.isVisible()) {
        await mobileToggle.click();
        await sleep(1800);
      }

      // Toggle Desktop Viewport in preview modal
      const desktopToggle = page2.locator('button:has-text("Desktop")').first();
      if (await desktopToggle.isVisible()) {
        await desktopToggle.click();
        await sleep(1500);
      }

      // Close preview modal
      const closePreview = page2.locator('button:has-text("Close"), svg.lucide-x').first();
      if (await closePreview.isVisible()) {
        await closePreview.click();
        await sleep(1200);
      }
    }

    // Click Save Changes button
    const saveBtn = page2.locator('button:has-text("Save Changes")').first();
    if (await saveBtn.isVisible()) {
      await saveBtn.hover();
      await sleep(800);
      await saveBtn.click();
      await sleep(2500);
    }

    const video2Obj = page2.video();
    await ctx2.close();
    const video2Path = await video2Obj.path();
    console.log('✅ Flow 2 captured:', video2Path);


    // =======================================================================
    // FLOW 3: CLAIMANT PAYMENT SELECTION PORTAL (9 PAYMENT RAILS) (25-30s)
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 3: Claimant Payment Selection Portal...');
    const ctx3 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });

    const page3 = await ctx3.newPage();
    await page3.goto(`http://localhost:3000/claim/${DEMO_CLAIMANT_TOKEN}`, { waitUntil: 'networkidle' });
    await sleep(2500);

    // Showcase Claimant Header: Jane Doe | Confirmed Settlement Amount: $450.00
    await page3.mouse.move(640, 220, { steps: 10 });
    await sleep(1500);

    // Language Switcher Demonstration
    const langSelect = page3.locator('select').first();
    if (await langSelect.isVisible()) {
      await langSelect.selectOption('es');
      await sleep(2000);
      await langSelect.selectOption('zh');
      await sleep(1800);
      await langSelect.selectOption('vi');
      await sleep(1800);
      await langSelect.selectOption('en');
      await sleep(1500);
    }

    // Cycle through Payment Rails
    const rails = [
      'Direct Deposit',
      'Digital Prepaid Card',
      'Push to Debit',
      'Mailed Physical Check',
      'PayPal',
      'Venmo',
      'Zelle',
      'Bitcoin'
    ];

    for (const r of rails) {
      const railOption = page3.locator(`text=${r}`).first();
      if (await railOption.isVisible()) {
        await railOption.hover();
        await sleep(400);
        await railOption.click();
        await sleep(600);
      }
    }

    // Settle on Direct Deposit (ACH) and fill out bank details
    const achOption = page3.locator('text=Direct Deposit').first();
    if (await achOption.isVisible()) {
      await achOption.click();
      await sleep(1000);

      // Routing Number (with ABA validation)
      const routingInput = page3.locator('input[placeholder="021000021"]').first();
      if (await routingInput.isVisible()) {
        await routingInput.click();
        await routingInput.fill('021000021'); // JPMorgan Chase NY (Valid Mod 10)
        await sleep(1000);
      }

      // Account Number
      const acctInput = page3.locator('input[placeholder="123456789"]').first();
      if (await acctInput.isVisible()) {
        await acctInput.click();
        await acctInput.fill('123456789012');
        await sleep(800);
      }

      // Confirm Account Number
      const confirmAcct = page3.locator('input[placeholder="123456789"]').nth(1);
      if (await confirmAcct.isVisible()) {
        await confirmAcct.click();
        await confirmAcct.fill('123456789012');
        await sleep(600);
      }
    }

    // Scroll to Digital Signature & Affirmation Card
    await page3.mouse.wheel(0, 500);
    await sleep(1200);

    const affirmCheckbox = page3.locator('input[type="checkbox"]').first();
    if (await affirmCheckbox.isVisible()) {
      await affirmCheckbox.click();
      await sleep(800);
    }

    const signatureInput = page3.locator('input[placeholder*="legal name"], input[placeholder*="signature"], input[type="text"] >> nth=-1').first();
    if (await signatureInput.isVisible()) {
      await signatureInput.click();
      await page3.keyboard.type('Jane Doe', { delay: 100 });
      await sleep(1200);
    }

    // Submit Election
    const submitBtn = page3.locator('button:has-text("Submit Election"), button:has-text("Confirm & Submit"), button:has-text("Submit")').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.hover();
      await sleep(1000);
      await submitBtn.click();
      await sleep(3000);
    }

    // Review Receipt Page
    await page3.waitForURL(/receipt/, { timeout: 5000 }).catch(() => {});
    await page3.mouse.move(640, 300, { steps: 10 });
    await sleep(2500);
    await page3.mouse.wheel(0, 300);
    await sleep(2500);

    const video3Obj = page3.video();
    await ctx3.close();
    const video3Path = await video3Obj.path();
    console.log('✅ Flow 3 captured:', video3Path);


    // =======================================================================
    // FLOW 4: CASE ANALYTICS DASHBOARD & AGENDASH (22-26s)
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 4: Analytics Dashboard & Agendash...');
    const ctx4 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });

    await ctx4.addCookies([
      { name: 'token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: 'localhost', path: '/' }
    ]);

    const page4 = await ctx4.newPage();
    await page4.goto(`http://localhost:3000/cases/${caseId}/analytics`, { waitUntil: 'networkidle' });
    await sleep(2500);

    // Highlight Delivery Funnel Cards
    await page4.mouse.move(300, 220, { steps: 10 });
    await sleep(1200);
    await page4.mouse.move(600, 220, { steps: 10 });
    await sleep(1200);
    await page4.mouse.move(900, 220, { steps: 10 });
    await sleep(1200);

    // Scroll down to Recharts charts
    await page4.mouse.wheel(0, 350);
    await sleep(2000);

    // Hover over charts
    await page4.mouse.move(450, 450, { steps: 10 });
    await sleep(1500);
    await page4.mouse.move(800, 450, { steps: 10 });
    await sleep(1500);

    // Scroll to Exception Ledger
    await page4.mouse.wheel(0, 350);
    await sleep(2000);

    // Hover on NACHA Exception rows (R01 / R03)
    const excRow = page4.locator('text=R01, text=Insufficient Funds, text=CLM-EXC').first();
    if (await excRow.isVisible()) {
      await excRow.hover();
      await sleep(1800);
    }

    // Open Agendash Scheduler
    await page4.goto('http://localhost:5000/agendash', { waitUntil: 'networkidle' });
    await sleep(2500);
    await page4.mouse.wheel(0, 200);
    await sleep(2500);

    const video4Obj = page4.video();
    await ctx4.close();
    const video4Path = await video4Obj.path();
    console.log('✅ Flow 4 captured:', video4Path);

    await browser.close();

    // =======================================================================
    // 3. FFMPEG TRANSCODING & POSTER GENERATION
    // =======================================================================
    console.log('\n🎞️ [FFmpeg] Transcoding WebM recordings to high-compatibility MP4s...');

    const videoMap = [
      {
        src: video1Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '01_case_setup_and_roster_ingestion.mp4'),
        poster: path.join(POSTERS_DIR, '01_case_setup_and_roster_ingestion.jpg')
      },
      {
        src: video2Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '02_quill_wysiwyg_and_localization.mp4'),
        poster: path.join(POSTERS_DIR, '02_quill_wysiwyg_and_localization.jpg')
      },
      {
        src: video3Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '03_claimant_portal_and_payment_rails.mp4'),
        poster: path.join(POSTERS_DIR, '03_claimant_portal_and_payment_rails.jpg')
      },
      {
        src: video4Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '04_analytics_dashboard_and_agendash.mp4'),
        poster: path.join(POSTERS_DIR, '04_analytics_dashboard_and_agendash.jpg')
      }
    ];

    for (const v of videoMap) {
      console.log(`Transcoding: ${path.basename(v.dest)}...`);
      // H.264 high profile with yuv420p for universal browser & device playback
      execSync(`/usr/bin/ffmpeg -y -i "${v.src}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "${v.dest}"`, { stdio: 'ignore' });
      // Generate poster frame from second 2 of each video
      execSync(`/usr/bin/ffmpeg -y -ss 00:00:03 -i "${v.dest}" -vframes 1 -q:v 2 "${v.poster}"`, { stdio: 'ignore' });
      console.log(`✅ Generated: ${path.basename(v.dest)} (${(fs.statSync(v.dest).size / (1024 * 1024)).toFixed(2)} MB)`);
    }

    console.log('\n🎉 [Success] All 4 training videos captured, transcoded, and indexed successfully!');
  } finally {
    cleanup();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌ Error during video capture:', err);
  process.exit(1);
});
