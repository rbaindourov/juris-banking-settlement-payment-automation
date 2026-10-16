/**
 * scripts/capture_rolling_cadence_videos.mjs
 * ---------------------------------------------------------------------------
 * Autonomous Playwright Video Capture Pipeline for JurisBanking Flows 5 & 6:
 *   - Flow 5: 05_rolling_cadence_and_throttling_designer.mp4 (+ .jpg poster)
 *   - Flow 6: 06_live_wave_telemetry_and_controls.mp4 (+ .jpg poster)
 *
 * Seeds a realistic settlement cadence & multi-wave environment in native MongoDB,
 * launches the backend API (port 5000) and Vite preview server (port 3000),
 * records 1280x720 HD walkthroughs, transcodes to universal H.264 MP4s via FFmpeg,
 * extracts high-clarity poster frames, and cleans up temporary raw .webm buffers.
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

let pw;
try {
  pw = await import('playwright');
} catch (e) {
  pw = await import('/home/robert/Documents/projects/multipleDomainCMS/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js');
}
const chromium = pw.default?.chromium || pw.chromium;

const SERVER_PORT = 5000;
const CLIENT_PORT = 3000;
const SEED_DB_URI = 'mongodb://127.0.0.1:27017/juris_banking_cadence_video_seed';
const JWT_SECRET = 'super_secure_jwt_secret_change_in_production_min32chars_long!';

const RAW_VIDEO_DIR = path.join(ROOT_DIR, 'docs/videos/raw');
const OUTPUT_VIDEO_DIR = path.join(ROOT_DIR, 'docs/videos');
const POSTERS_DIR = path.join(ROOT_DIR, 'docs/videos/posters');

fs.mkdirSync(RAW_VIDEO_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_VIDEO_DIR, { recursive: true });
fs.mkdirSync(POSTERS_DIR, { recursive: true });

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

async function seedCadenceEnvironment() {
  console.log('🌱 [Seeder] Connecting to seed MongoDB:', SEED_DB_URI);
  await mongoose.connect(SEED_DB_URI);

  const collections = await mongoose.connection.db.collections();
  for (const c of collections) {
    await c.drop().catch(() => {});
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

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
          },
          es: {
            subject: 'URGENTE: Quedan 7 días para reclamar el pago electrónico del acuerdo de Apex',
            bodyHtml: '<p>Aviso urgente para {{claimant_first_name}}: Su ventana de pago electrónico cierra en 7 días el <strong>{{selection_deadline}}</strong>.</p>'
          },
          zh: {
            subject: '紧急：距领取 Apex 电子和解金仅剩 7 天',
            bodyHtml: '<p>紧急通知 {{claimant_first_name}}：您的电子付款窗口将在 7 天后（<strong>{{selection_deadline}}</strong>）关闭。</p>'
          },
          vi: {
            subject: 'KHẨN CẤP: Còn 7 ngày để nhận thanh toán điện tử cho thỏa thuận Apex',
            bodyHtml: '<p>Thông báo khẩn cho {{claimant_first_name}}: Thời hạn thanh toán điện tử sẽ đóng sau 7 ngày vào <strong>{{selection_deadline}}</strong>.</p>'
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

  const claimants = [];
  for (let i = 1; i <= 60; i++) {
    claimants.push({
      claimId: `CLM-APEX-${String(i).padStart(4, '0')}`,
      caseId,
      firstName: `Claimant${i}`,
      lastName: `Apex`,
      email: `claimant${i}@apex-settlement.org`,
      settlementAmount: 450.0,
      status: i <= 18 ? 'selected' : 'pending_selection',
      selectedPaymentMethod: i <= 18 ? 'ach' : undefined,
      notificationStatus: 'delivered',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  await mongoose.connection.db.collection('claimants').insertMany(claimants);

  await mongoose.disconnect();
  console.log('✅ [Seeder] Video seed environment ready. Case ID:', caseId.toString());
  return { caseId: caseId.toString(), userId: userId.toString() };
}

function attachClaimantRosterMock(page, caseId) {
  return page.route('**/api/cases/*/claimants*', async (route) => {
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
}

async function main() {
  console.log('🧹 [Pre-Flight] Clearing ports 5000 and 3000...');
  try {
    execSync('fuser -k 5000/tcp 3000/tcp 2>/dev/null || true');
  } catch (_) {}
  await sleep(1500);

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
    try { serverProcess.kill('SIGTERM'); } catch (_) {}
    try { clientProcess.kill('SIGTERM'); } catch (_) {}
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    await waitForHttp('http://127.0.0.1:5000/api/health', 30000);
    await waitForHttp('http://127.0.0.1:3000/', 30000);

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

    const authCookies = [
      { name: 'token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: 'localhost', path: '/' },
      { name: 'token', value: adminToken, domain: '127.0.0.1', path: '/' },
      { name: 'juris_auth_token', value: adminToken, domain: '127.0.0.1', path: '/' }
    ];

    // =======================================================================
    // FLOW 5: MULTI-STAGE CADENCE TIMELINE & BATCH THROTTLING DESIGNER
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 5: Rolling Cadence & Batch Throttling Designer...');
    const ctx5 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });
    await ctx5.addCookies(authCookies);

    const page5 = await ctx5.newPage();
    await attachClaimantRosterMock(page5, caseId);

    // 1. Open Case Detail and navigate to Notification Cadence tab
    await page5.goto(`http://localhost:3000/cases/${caseId}/cadence`, { waitUntil: 'networkidle' });
    await sleep(2200);

    // 2. Step through the 5 stages in the Rolling Cadence Timeline Builder
    const stageSelectors = [
      'button:has-text("Initial Notice"), button:has-text("Stage 1")',
      'button:has-text("14-Day Reminder"), button:has-text("Stage 2")',
      'button:has-text("7-Day Warning"), button:has-text("Stage 3")',
      'button:has-text("48-Hour Final"), button:has-text("Stage 4")',
      'button:has-text("Post-Deadline"), button:has-text("Stage 5")'
    ];

    for (const sel of stageSelectors) {
      const btn = page5.locator(sel).first();
      if (await btn.isVisible()) {
        await btn.hover();
        await sleep(500);
        await btn.click();
        await sleep(900);
      }
    }

    // Return to Stage 2 (14-Day Reminder) to showcase localized templates
    const stage2Btn = page5.locator('button:has-text("14-Day Reminder"), button:has-text("Stage 2")').first();
    if (await stage2Btn.isVisible()) {
      await stage2Btn.click();
      await sleep(1000);
    }

    // 3. Cycle through localized language tabs (EN -> ES -> ZH -> VI -> EN)
    const langTabs = [
      'button:has-text("Español (ES)"), button:has-text("ES")',
      'button:has-text("中文 (ZH)"), button:has-text("ZH")',
      'button:has-text("Tiếng Việt (VI)"), button:has-text("VI")',
      'button:has-text("English (EN)"), button:has-text("EN")'
    ];

    for (const langSel of langTabs) {
      const tab = page5.locator(langSel).first();
      if (await tab.isVisible()) {
        await tab.hover();
        await sleep(400);
        await tab.click();
        await sleep(1000);
      }
    }

    // Click a dynamic merge tag pill
    const mergePill = page5.locator('button:has-text("{{settlement_amount}}")').first();
    if (await mergePill.isVisible()) {
      await mergePill.hover();
      await sleep(500);
      await mergePill.click();
      await sleep(900);
    }

    // 4. Scroll down to Rolling Batch Throttling & Dispatch Schedule card
    const throttlingHeader = page5.locator('h3:has-text("Rolling Batch Throttling & Dispatch Schedule")').first();
    if (await throttlingHeader.isVisible()) {
      await throttlingHeader.scrollIntoViewIfNeeded();
      await sleep(1200);
    } else {
      await page5.mouse.wheel(0, 480);
      await sleep(1200);
    }

    // Click through pacing presets (Conservative -> High Throughput -> Balanced Standard)
    const presetLabels = ['Conservative', 'High Throughput', 'Balanced Standard'];
    for (const label of presetLabels) {
      const presetBtn = page5.locator(`button:has-text("${label}")`).first();
      if (await presetBtn.isVisible()) {
        await presetBtn.hover();
        await sleep(450);
        await presetBtn.click();
        await sleep(900);
      }
    }

    // 5. Scroll down to Dynamic Pre-Dispatch Recipient Eligibility Preview card
    const eligibilityHeader = page5.locator('h3:has-text("Dynamic Pre-Dispatch Recipient Eligibility Preview")').first();
    if (await eligibilityHeader.isVisible()) {
      await eligibilityHeader.scrollIntoViewIfNeeded();
      await sleep(1500);
    } else {
      await page5.mouse.wheel(0, 420);
      await sleep(1500);
    }

    // Click Re-sync Roster button if present
    const resyncBtn = page5.locator('button:has-text("Re-sync"), button:has-text("Refresh")').first();
    if (await resyncBtn.isVisible()) {
      await resyncBtn.hover();
      await sleep(500);
      await resyncBtn.click();
      await sleep(1500);
    }

    // Save Configuration button hover
    const saveCadenceBtn = page5.locator('button:has-text("Save Cadence"), button:has-text("Save Configuration")').first();
    if (await saveCadenceBtn.isVisible()) {
      await saveCadenceBtn.scrollIntoViewIfNeeded();
      await saveCadenceBtn.hover();
      await sleep(1200);
    }

    const video5Obj = page5.video();
    await ctx5.close();
    const video5Path = await video5Obj.path();
    console.log('✅ Flow 5 captured:', video5Path);

    // =======================================================================
    // FLOW 6: LIVE WAVE TELEMETRY FUNNEL & OPERATIONAL WAVE CONTROLS
    // =======================================================================
    console.log('🎬 [Capture] Recording Flow 6: Live Wave Telemetry & Operational Controls...');
    const ctx6 = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_VIDEO_DIR, size: { width: 1280, height: 720 } }
    });
    await ctx6.addCookies(authCookies);

    const page6 = await ctx6.newPage();
    await attachClaimantRosterMock(page6, caseId);

    await page6.goto(`http://localhost:3000/cases/${caseId}/cadence`, { waitUntil: 'networkidle' });
    await sleep(1800);

    // 1. Switch to Sub-Tab 2: Live Wave Telemetry & Controls
    const telemetryTabBtn = page6.locator('#subtab-telemetry');
    if (await telemetryTabBtn.isVisible()) {
      await telemetryTabBtn.hover();
      await sleep(600);
      await telemetryTabBtn.click();
      await page6.waitForSelector('#subpanel-telemetry', { state: 'visible' });
      await sleep(2000);
    }

    // 2. Pan across the telemetry funnel metrics on Wave 1 & Wave 2
    await page6.mouse.move(320, 340, { steps: 10 });
    await sleep(1000);
    await page6.mouse.move(640, 340, { steps: 10 });
    await sleep(1000);
    await page6.mouse.move(920, 340, { steps: 10 });
    await sleep(1000);

    // Scroll slightly to focus on Wave 2 (In Progress) and Wave 3 (Scheduled)
    await page6.mouse.wheel(0, 260);
    await sleep(1400);

    // 3. Demonstrate Pause and Resume on Wave 2 (14-Day Reminder)
    const pauseBtn = page6.locator('button[aria-label*="Pause wave 14-Day"], button:has-text("Pause Wave")').first();
    if (await pauseBtn.isVisible()) {
      await pauseBtn.hover();
      await sleep(600);
      await pauseBtn.click();
      await page6.waitForSelector('.modal-container', { state: 'visible' }).catch(() => {});
      await sleep(900);

      const pauseReasonInput = page6.locator('#pause-reason-input');
      if (await pauseReasonInput.isVisible()) {
        await pauseReasonInput.click();
        await page6.keyboard.type('Brief verification of SMTP bounce suppression threshold', { delay: 20 });
        await sleep(800);
      }

      const confirmPauseBtn = page6.locator('.modal-container button:has-text("Confirm Pause")').first();
      if (await confirmPauseBtn.isVisible()) {
        await confirmPauseBtn.hover();
        await sleep(500);
        await confirmPauseBtn.click();
        await sleep(1600);
      }
    }

    const resumeBtn = page6.locator('button[aria-label*="Resume wave 14-Day"], button:has-text("Resume Wave")').first();
    if (await resumeBtn.isVisible()) {
      await resumeBtn.hover();
      await sleep(600);
      await resumeBtn.click();
      await page6.waitForSelector('.modal-container', { state: 'visible' }).catch(() => {});
      await sleep(900);

      const confirmResumeBtn = page6.locator('.modal-container button:has-text("Confirm Resume")').first();
      if (await confirmResumeBtn.isVisible()) {
        await confirmResumeBtn.hover();
        await sleep(500);
        await confirmResumeBtn.click();
        await sleep(1600);
      }
    }

    // 4. Click Reschedule on Wave 3 (7-Day Urgent Deadline Warning)
    const rescheduleBtn = page6.locator('button[aria-label*="Reschedule wave 7-Day"], button:has-text("Reschedule")').first();
    if (await rescheduleBtn.isVisible()) {
      await rescheduleBtn.scrollIntoViewIfNeeded();
      await rescheduleBtn.hover();
      await sleep(600);
      await rescheduleBtn.click();
      await page6.waitForSelector('.modal-container', { state: 'visible' }).catch(() => {});
      await sleep(1000);

      const presetBtn = page6.locator('.modal-container button:has-text("+3 Days")').first();
      if (await presetBtn.isVisible()) {
        await presetBtn.hover();
        await sleep(400);
        await presetBtn.click();
        await sleep(800);
      }

      // Type judicial docket justification into #reschedule-reason
      const reasonTextarea = page6.locator('#reschedule-reason, .modal-container textarea').first();
      if (await reasonTextarea.isVisible()) {
        await reasonTextarea.click();
        await page6.keyboard.type(
          'Administrative schedule alignment: 48-hour extension granted pursuant to judicial case management order in Docket 24-CV-10492.',
          { delay: 20 }
        );
        await sleep(1400);
      }

      // Click Confirm Reschedule button inside modal
      const confirmRescheduleBtn = page6.locator('.modal-container button[type="submit"], .modal-container button:has-text("Confirm Reschedule")').first();
      if (await confirmRescheduleBtn.isVisible()) {
        await confirmRescheduleBtn.hover();
        await sleep(700);
        await confirmRescheduleBtn.click();
        await sleep(2000);
      }
    }

    const video6Obj = page6.video();
    await ctx6.close();
    const video6Path = await video6Obj.path();
    console.log('✅ Flow 6 captured:', video6Path);

    await browser.close();

    // =======================================================================
    // FFMPEG TRANSCODING & POSTER EXTRACTION
    // =======================================================================
    console.log('\n🎞️ [FFmpeg] Transcoding Flow 5 & Flow 6 WebM recordings to H.264 MP4s...');

    const videoMap = [
      {
        src: video5Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '05_rolling_cadence_and_throttling_designer.mp4'),
        poster: path.join(POSTERS_DIR, '05_rolling_cadence_and_throttling_designer.jpg'),
        posterTimestamp: '00:00:04'
      },
      {
        src: video6Path,
        dest: path.join(OUTPUT_VIDEO_DIR, '06_live_wave_telemetry_and_controls.mp4'),
        poster: path.join(POSTERS_DIR, '06_live_wave_telemetry_and_controls.jpg'),
        posterTimestamp: '00:00:10'
      }
    ];

    for (const v of videoMap) {
      console.log(`Transcoding: ${path.basename(v.dest)}...`);
      execSync(
        `/usr/bin/ffmpeg -y -i "${v.src}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "${v.dest}"`,
        { stdio: 'ignore' }
      );
      execSync(
        `/usr/bin/ffmpeg -y -ss ${v.posterTimestamp} -i "${v.dest}" -vframes 1 -q:v 2 "${v.poster}"`,
        { stdio: 'ignore' }
      );
      console.log(
        `✅ Generated: ${path.basename(v.dest)} (${(fs.statSync(v.dest).size / (1024 * 1024)).toFixed(2)} MB) + poster (${(fs.statSync(v.poster).size / 1024).toFixed(1)} KB)`
      );
    }

    // Clean up temporary raw .webm files so git working tree stays clean
    if (fs.existsSync(RAW_VIDEO_DIR)) {
      for (const file of fs.readdirSync(RAW_VIDEO_DIR)) {
        fs.unlinkSync(path.join(RAW_VIDEO_DIR, file));
      }
      fs.rmdirSync(RAW_VIDEO_DIR);
    }

    console.log('\n🎉 [Success] Flows 5 & 6 tutorial videos and posters generated!');
  } finally {
    cleanup();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌ Error during rolling cadence video capture:', err);
  process.exit(1);
});
