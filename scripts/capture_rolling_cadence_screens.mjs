/**
 * scripts/capture_rolling_cadence_screens.mjs
 * ---------------------------------------------------------------------------
 * Autonomous Playwright Screen Capture Pipeline for JurisBanking Milestone 4.
 * Seeds a high-fidelity settlement cadence environment in native MongoDB,
 * starts the backend API and client preview servers, orchestrates UI views,
 * and captures 4 publication-grade high-resolution Retina screenshots in docs/images/.
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

// 1. Resolve Playwright module with robust fallback
let pw;
try {
  pw = await import('playwright');
} catch (e) {
  pw = await import('/home/robert/Documents/projects/multipleDomainCMS/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js');
}
const chromium = pw.default?.chromium || pw.chromium;

// 2. Constants & Configuration
const SERVER_PORT = 5000;
const CLIENT_PORT = 3000;
const SEED_DB_URI = 'mongodb://127.0.0.1:27017/juris_banking_cadence_seed';
const JWT_SECRET = 'super_secure_jwt_secret_change_in_production_min32chars_long!';
const IMAGES_DIR = path.join(ROOT_DIR, 'docs/images');

fs.mkdirSync(IMAGES_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHttp(url, timeoutMs = 30000) {
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

// 3. Database Seeder
async function seedCadenceEnvironment() {
  console.log('🌱 [Seeder] Connecting to seed MongoDB:', SEED_DB_URI);
  await mongoose.connect(SEED_DB_URI);

  const collections = await mongoose.connection.db.collections();
  for (const c of collections) {
    await c.drop().catch(() => {});
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  // A. Admin User
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

  // B. Settlement Case
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await mongoose.connection.db.collection('cases').insertOne({
    _id: caseId,
    name: 'In re Apex Data Breach Settlement',
    docketNumber: '24-CV-10492-JST',
    lawFirmId: 'FIRM_DEMO_01',
    settlementFundTotal: 5600000.0,
    disbursementDeadline: deadline,
    fallbackPaymentMethod: 'physical_check',
    status: 'active',
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'es', 'zh', 'vi'],
    emailTemplate: {
      subject: 'Official Court-Approved Settlement Award Notice: In re Apex Data Breach',
      bodyHtml:
        '<h2>Official Court Notice: In re Apex Data Breach Settlement</h2><p>Dear {{claimant_first_name}} {{claimant_last_name}},</p><p>You are an eligible claimant with an approved payment of <strong>{{settlement_amount}}</strong>.</p><p>Select your electronic payment rail before <strong>{{selection_deadline}}</strong>:</p><p><a href="{{payment_selection_link}}" class="btn-primary">Select Disbursement Method</a></p>'
    },
    landingPageText: {
      headline: 'Apex Data Breach Settlement Claimant Election Portal',
      introHtml: '<p>Please confirm your identity and select your preferred disbursement method.</p>',
      faqAccordion: [
        {
          question: 'When will settlement funds be disbursed?',
          answer: 'Electronic disbursements initiate within 48 hours of preference confirmation.'
        }
      ]
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // C. Notification Cadence Configuration
  await mongoose.connection.db.collection('notificationcadences').insertOne({
    caseId,
    lawFirmId: 'FIRM_DEMO_01',
    name: 'Apex Data Breach Settlement Rolling Cadence',
    status: 'active',
    stages: [
      {
        stageKey: 'initial_notice',
        stageName: 'Initial Court-Approved Notice',
        enabled: true,
        triggerType: 'deadline_relative',
        offsetHours: 0,
        status: 'completed',
        templates: {
          en: {
            subject: 'Official Court Notice: Claim Your Apex Settlement Award',
            bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>You are an eligible claimant with an approved award of <strong>{{settlement_amount}}</strong>. Please select your payment method by <strong>{{selection_deadline}}</strong>: <a href="{{payment_selection_link}}">Select Payment Preference</a>.</p>'
          },
          es: {
            subject: 'Aviso Judicial Oficial: Reclame su indemnización del acuerdo de Apex',
            bodyHtml: '<p>Estimado/a {{claimant_first_name}},</p><p>Usted es un reclamante elegible con un pago aprobado de <strong>{{settlement_amount}}</strong>. Seleccione su método de pago antes del <strong>{{selection_deadline}}</strong>: <a href="{{payment_selection_link}}">Seleccionar Preferencia de Pago</a>.</p>'
          },
          zh: {
            subject: '法院正式通知：领取您的 Apex 和解金',
            bodyHtml: '<p>尊敬的 {{claimant_first_name}}：</p><p>您是合资格申请人，批准的赔偿金为 <strong>{{settlement_amount}}</strong>。请在 <strong>{{selection_deadline}}</strong> 之前选择您的付款方式：<a href="{{payment_selection_link}}">选择付款方式</a>。</p>'
          },
          vi: {
            subject: 'Thông Báo Chính Thức Của Tòa Án: Nhận Khoản Bồi Thường Apex Của Quý Vị',
            bodyHtml: '<p>Kính gửi {{claimant_first_name}},</p><p>Quý vị là người khiếu nại đủ điều kiện với số tiền bồi thường là <strong>{{settlement_amount}}</strong>. Vui lòng chọn phương thức thanh toán trước ngày <strong>{{selection_deadline}}</strong>: <a href="{{payment_selection_link}}">Chọn Phương Thức Thanh Toán</a>.</p>'
          }
        }
      },
      {
        stageKey: 'reminder_14d',
        stageName: '14-Day Payment Preference Reminder',
        enabled: true,
        triggerType: 'deadline_relative',
        offsetHours: -336,
        status: 'in_progress',
        templates: {
          en: {
            subject: 'Reminder: 14 Days Remaining to Select Your Settlement Disbursement Rail',
            bodyHtml: '<p>Dear {{claimant_first_name}},</p><p>This is a reminder that you have 14 days remaining before the selection deadline (<strong>{{selection_deadline}}</strong>) for your <strong>{{settlement_amount}}</strong> payment award. Choose Direct Deposit, Zelle, Venmo, or PayPal here: <a href="{{payment_selection_link}}">Confirm Preference</a>.</p>'
          },
          es: {
            subject: 'Recordatorio: Quedan 14 días para seleccionar su método de pago',
            bodyHtml: '<p>Estimado/a {{claimant_first_name}},</p><p>Le recordamos que quedan 14 días para seleccionar su preferencia de pago de <strong>{{settlement_amount}}</strong> antes de la fecha límite: <a href="{{payment_selection_link}}">Confirmar Preferencia</a>.</p>'
          },
          zh: {
            subject: '提醒：距选择和解金付款方式仅剩 14 天',
            bodyHtml: '<p>尊敬的 {{claimant_first_name}}：</p><p>距您的 <strong>{{settlement_amount}}</strong> 和解金选择截止日期还有 14 天：<a href="{{payment_selection_link}}">确认付款偏好</a>。</p>'
          },
          vi: {
            subject: 'Nhắc nhở: Còn 14 ngày để chọn phương thức nhận tiền bồi thường',
            bodyHtml: '<p>Kính gửi {{claimant_first_name}},</p><p>Quý vị còn 14 ngày để xác nhận phương thức nhận khoản tiền <strong>{{settlement_amount}}</strong> trước thời hạn: <a href="{{payment_selection_link}}">Xác Nhận Phương Thức</a>.</p>'
          }
        }
      },
      {
        stageKey: 'urgent_warning_7d',
        stageName: '7-Day Urgent Deadline Warning',
        enabled: true,
        triggerType: 'deadline_relative',
        offsetHours: -168,
        status: 'scheduled',
        templates: {
          en: {
            subject: 'URGENT: 7 Days Remaining to Claim Electronic Payment for Apex Settlement',
            bodyHtml: '<p>Urgent Notice for {{claimant_first_name}}: Your electronic payment window closes in 7 days on <strong>{{selection_deadline}}</strong>. Avoid paper check delays by selecting direct deposit: <a href="{{payment_selection_link}}">Select Now</a>.</p>'
          }
        }
      },
      {
        stageKey: 'final_notice_48h',
        stageName: '48-Hour Final Notice & Default Warning',
        enabled: true,
        triggerType: 'deadline_relative',
        offsetHours: -48,
        status: 'paused',
        templates: {
          en: {
            subject: 'FINAL WARNING: 48 Hours Before Default Physical Check Issuance',
            bodyHtml: '<p>Final Warning for {{claimant_first_name}}: Electronic selection closes in 48 hours. After this time, a physical paper check will be mailed to your address on file: <a href="{{payment_selection_link}}">Select Digital Payment</a>.</p>'
          }
        }
      },
      {
        stageKey: 'post_deadline_fallback',
        stageName: 'Post-Deadline Fallback Confirmation',
        enabled: true,
        triggerType: 'deadline_relative',
        offsetHours: 24,
        status: 'draft',
        templates: {
          en: {
            subject: 'Notice: Payment Window Closed — Physical Paper Check Dispatched',
            bodyHtml: '<p>Dear {{claimant_first_name}}, the election deadline has passed. Your award of <strong>{{settlement_amount}}</strong> has been queued for physical check disbursement.</p>'
          }
        }
      }
    ],
    throttling: {
      batchSize: 500,
      intervalMinutes: 15,
      rateLimitPerSecond: 25,
      dailyCap: 10000,
      quietHoursEnabled: true,
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      timezone: 'America/New_York'
    },
    suppression: {
      skipCompletedPayments: true,
      suppressBounced: true,
      checkGlobalSuppression: true,
      skipUnsubscribed: true
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // D. Waves
  await mongoose.connection.db.collection('emailwaves').insertMany([
    {
      waveId: 'WAVE-APEX-001',
      caseId,
      stage: 'initial_notice',
      stageName: 'Initial Court-Approved Notice',
      status: 'completed',
      scheduledDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      completedDate: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
      totalSubBatches: 25,
      completedSubBatches: 25,
      throttlingConfig: { batchSize: 500, intervalMinutes: 15, rateLimitPerSecond: 25 },
      telemetry: {
        eligible: 12450,
        queued: 12450,
        dispatched: 12450,
        skipped_completed: 0,
        suppressed_bounced: 320,
        failed: 12,
        opened: 8420,
        clicked: 5180
      },
      controlState: { isPaused: false },
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      waveId: 'WAVE-APEX-002',
      caseId,
      stage: 'reminder_14d',
      stageName: '14-Day Payment Preference Reminder',
      status: 'in_progress',
      scheduledDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      actualStartTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      totalSubBatches: 18,
      completedSubBatches: 11,
      throttlingConfig: { batchSize: 500, intervalMinutes: 15, rateLimitPerSecond: 25 },
      telemetry: {
        eligible: 8920,
        queued: 3420,
        dispatched: 5500,
        skipped_completed: 2150,
        suppressed_bounced: 1180,
        failed: 24,
        opened: 3410,
        clicked: 2190
      },
      controlState: { isPaused: false },
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      waveId: 'WAVE-APEX-003',
      caseId,
      stage: 'urgent_warning_7d',
      stageName: '7-Day Urgent Deadline Warning',
      status: 'scheduled',
      scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      totalSubBatches: 14,
      completedSubBatches: 0,
      throttlingConfig: { batchSize: 500, intervalMinutes: 15, rateLimitPerSecond: 25 },
      telemetry: {
        eligible: 6770,
        queued: 6770,
        dispatched: 0,
        skipped_completed: 0,
        suppressed_bounced: 0,
        failed: 0,
        opened: 0,
        clicked: 0
      },
      controlState: { isPaused: false },
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      waveId: 'WAVE-APEX-004',
      caseId,
      stage: 'final_notice_48h',
      stageName: '48-Hour Final Notice & Default Warning',
      status: 'paused',
      scheduledDate: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
      totalSubBatches: 10,
      completedSubBatches: 3,
      throttlingConfig: { batchSize: 500, intervalMinutes: 15, rateLimitPerSecond: 25 },
      telemetry: {
        eligible: 4200,
        queued: 2700,
        dispatched: 1500,
        skipped_completed: 450,
        suppressed_bounced: 180,
        failed: 6,
        opened: 910,
        clicked: 580
      },
      controlState: {
        isPaused: true,
        pausedAt: new Date(Date.now() - 30 * 60 * 1000),
        cancelReason: 'Administrative hold pending judicial status conference'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);

  // E. Baseline Claimants for Ingestion & Claimants Tab
  const claimants = [];
  for (let i = 1; i <= 50; i++) {
    claimants.push({
      claimId: `CLM-APEX-${String(i).padStart(4, '0')}`,
      caseId,
      firstName: `Claimant${i}`,
      lastName: `Apex`,
      email: `claimant${i}@apex-settlement.org`,
      settlementAmount: 450.0,
      status: i <= 15 ? 'selected' : 'pending_selection',
      selectedPaymentMethod: i <= 15 ? 'ach' : undefined,
      notificationStatus: 'delivered',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  await mongoose.connection.db.collection('claimants').insertMany(claimants);

  await mongoose.disconnect();
  console.log('✅ [Seeder] Environment seeded successfully. Primary Case ID:', caseId.toString());
  return { caseId: caseId.toString(), userId: userId.toString() };
}

// 4. Main Capture Runner
async function main() {
  console.log('🧹 [Pre-Flight] Clearing ports 5000 and 3000...');
  try {
    execSync('fuser -k 5000/tcp 3000/tcp 2>/dev/null || true');
  } catch (_) {}
  await sleep(1500);

  // Ensure client dist is present
  if (!fs.existsSync(path.join(ROOT_DIR, 'client/dist/index.html'))) {
    console.log('📦 [Pre-Flight] Building client dist bundle...');
    execSync('npm run build:client', { cwd: ROOT_DIR, stdio: 'inherit' });
  }

  const { caseId, userId } = await seedCadenceEnvironment();

  const adminToken = jwt.sign(
    {
      userId,
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
      MONGODB_URI: SEED_DB_URI,
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
    console.log('🧹 [Cleanup] Halting processes...');
    try { serverProcess.kill('SIGINT'); } catch (_) {}
    try { clientProcess.kill('SIGINT'); } catch (_) {}
    try { execSync('fuser -k 5000/tcp 3000/tcp 2>/dev/null || true'); } catch (_) {}
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForHttp('http://127.0.0.1:5000/api/health', 30000);
    console.log('✅ Backend API responding at http://127.0.0.1:5000/api/health');

    await waitForHttp('http://127.0.0.1:3000/', 30000);
    console.log('✅ Client UI responding at http://127.0.0.1:3000/');

    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } catch (launchErr) {
      const fallbackExecutable = path.join(process.env.HOME || '/home/robert', '.cache/ms-playwright/chromium-1243/chrome-linux/chrome');
      if (fs.existsSync(fallbackExecutable)) {
        browser = await chromium.launch({
          headless: true,
          executablePath: fallbackExecutable,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      } else {
        throw launchErr;
      }
    }

    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 3 // High-DPI / Ultra-Retina Capture (ensuring individual cards >= 1750px wide >= 1440px threshold)
    });

    await context.addCookies([
      { name: 'token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'token', value: adminToken, domain: '127.0.0.1', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: '127.0.0.1', path: '/' }
    ]);

    const page = await context.newPage();

    // Mock/Intercept claimant roster preview to ensure exact mathematical breakdown
    await page.route('**/api/cases/*/claimants*', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('limit') === '1000') {
        const mockClaimants = [
          ...Array.from({ length: 8920 }, (_, i) => ({
            claimId: `CLM-ELG-${i}`,
            status: 'pending_selection',
            email: `claimant${i}@eligible.org`
          })),
          ...Array.from({ length: 2150 }, (_, i) => ({
            claimId: `CLM-CMP-${i}`,
            status: 'selected',
            email: `claimant${i}@completed.org`
          })),
          ...Array.from({ length: 1180 }, (_, i) => ({
            claimId: `CLM-BNC-${i}`,
            status: 'pending_selection',
            email: `claimant${i}@bounced.org`,
            bounced: true
          })),
          ...Array.from({ length: 200 }, (_, i) => ({
            claimId: `CLM-INV-${i}`,
            status: 'pending_selection',
            email: `invalid-email-${i}`
          }))
        ];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            caseId,
            claimants: mockClaimants,
            total: 12450,
            page: 1,
            limit: 1000,
            totalPages: 1
          })
        });
      }
      return route.continue();
    });

    console.log(`🌐 Navigating to Cadence Console: http://localhost:3000/cases/${caseId}/cadence`);
    await page.goto(`http://localhost:3000/cases/${caseId}/cadence`, { waitUntil: 'networkidle' });
    await sleep(2500);

    // Ensure sticky header does not occlude elements when scrolled into view
    await page.addStyleTag({
      content: `
        header[role="banner"] {
          position: absolute !important;
          top: 0 !important;
        }
      `
    });

    // =======================================================================
    // 1. CAPTURE: 01_cadence_timeline_stage_builder.png
    // =======================================================================
    console.log('📸 [Capture 1/4] Capturing Cadence Timeline & Stage Builder...');
    // Click Stage 2 (14-Day Payment Preference Reminder)
    const stage2Btn = page.locator('button:has-text("14-Day Reminder"), button:has-text("Stage 2")').first();
    if (await stage2Btn.isVisible()) {
      await stage2Btn.click();
      await sleep(1000);
    }

    const stageBuilderLocator = page.locator('#subpanel-designer > div:first-child');
    await stageBuilderLocator.scrollIntoViewIfNeeded();
    await sleep(800);
    const img1Path = path.join(IMAGES_DIR, '01_cadence_timeline_stage_builder.png');
    await stageBuilderLocator.screenshot({ path: img1Path });
    console.log(`   Saved: ${img1Path} (${fs.statSync(img1Path).size} bytes)`);

    // =======================================================================
    // 2. CAPTURE: 02_batch_throttling_settings.png
    // =======================================================================
    console.log('📸 [Capture 2/4] Capturing Batch Throttling Settings Card...');
    const throttlingCardLocator = page.locator('h3:has-text("Rolling Batch Throttling & Dispatch Schedule")').locator('xpath=ancestor::div[contains(@class, "fintech-card")][1]');
    await throttlingCardLocator.scrollIntoViewIfNeeded();
    await sleep(800);
    const img2Path = path.join(IMAGES_DIR, '02_batch_throttling_settings.png');
    await throttlingCardLocator.screenshot({ path: img2Path });
    console.log(`   Saved: ${img2Path} (${fs.statSync(img2Path).size} bytes)`);

    // =======================================================================
    // 3. CAPTURE: 03_eligibility_suppression_preview.png
    // =======================================================================
    console.log('📸 [Capture 3/4] Capturing Recipient Eligibility Preview Card...');
    const eligibilityCardLocator = page.locator('h3:has-text("Dynamic Pre-Dispatch Recipient Eligibility Preview")').locator('xpath=ancestor::div[contains(@class, "fintech-card")][1]');
    await eligibilityCardLocator.scrollIntoViewIfNeeded();
    await sleep(800);
    const img3Path = path.join(IMAGES_DIR, '03_eligibility_suppression_preview.png');
    await eligibilityCardLocator.screenshot({ path: img3Path });
    console.log(`   Saved: ${img3Path} (${fs.statSync(img3Path).size} bytes)`);

    // =======================================================================
    // 4. CAPTURE: 04_live_wave_telemetry_controls.png
    // =======================================================================
    console.log('📸 [Capture 4/4] Capturing Live Wave Telemetry Console & Reschedule Modal...');
    // Switch to Sub-Tab 2: Live Wave Telemetry & Controls
    const telemetryTabBtn = page.locator('#subtab-telemetry');
    await telemetryTabBtn.click();
    await page.waitForSelector('#subpanel-telemetry', { state: 'visible' });
    await sleep(1500);

    // Target the Reschedule button for Wave 3 (7-Day Urgent Deadline Warning)
    const rescheduleBtn = page.locator('button[aria-label*="Reschedule wave"]').nth(1);
    if (await rescheduleBtn.isVisible()) {
      await rescheduleBtn.click();
      await page.waitForSelector('.modal-container', { state: 'visible' });
      await sleep(800);

      // Fill in realistic judicial audit justification
      const reasonTextarea = page.locator('.modal-container textarea, #reschedule-reason');
      if (await reasonTextarea.isVisible()) {
        await reasonTextarea.fill('Administrative schedule alignment: 48-hour extension granted pursuant to judicial case management order in Docket 24-CV-10492.');
        await sleep(500);
      }
    }

    const img4Path = path.join(IMAGES_DIR, '04_live_wave_telemetry_controls.png');
    // Capture high-res viewport screenshot showing both background telemetry funnels and active modal
    await page.screenshot({ path: img4Path });
    console.log(`   Saved: ${img4Path} (${fs.statSync(img4Path).size} bytes)`);

    await browser.close();
    console.log('🎉 [Success] All 4 visual UX screens captured successfully!');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('❌ Fatal capture error:', err);
  process.exit(1);
});
