#!/usr/bin/env node
/**
 * Master E2E Test Suite Runner for Juris Banking
 * Usage:
 *   node tests/e2e/run_all.js
 *   node tests/e2e/run_all.js --tier=1
 *   node tests/e2e/run_all.js --tier=2
 *   node tests/e2e/run_all.js --tier=3
 *   node tests/e2e/run_all.js --tier=4
 *   node tests/e2e/run_all.js --feature=auth
 *   node tests/e2e/run_all.js --verbose
 */

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultRunner } = require('./harness/test_runner');
const config = require('./config');

const args = process.argv.slice(2);
const tierArg = args.find(a => a.startsWith('--tier='))?.split('=')[1] || 'all';
const featureArg = args.find(a => a.startsWith('--feature='))?.split('=')[1] || null;
const filterArg = args.find(a => a.startsWith('--filter='))?.split('=')[1] || null;
const verbose = args.includes('--verbose') || args.includes('-v');

async function isServerUp(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = http.get(
        {
          host: u.hostname,
          port: u.port || 80,
          path: '/api/health',
          timeout: 1000,
        },
        (res) => {
          resolve(res.statusCode === 200 || res.statusCode === 404);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch (_) {
      resolve(false);
    }
  });
}

async function waitForServer(urlStr, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const up = await isServerUp(urlStr);
    if (up) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  let spawnedServer = null;
  const targetPort = process.env.PORT || '5000';
  const targetUrl = process.env.TEST_API_URL || `http://localhost:${targetPort}`;
  config.apiUrl = targetUrl;

  const serverAlreadyUp = await isServerUp(targetUrl);
  if (!serverAlreadyUp) {
    console.log(`[Test Runner] Server not detected on ${targetUrl}. Spawning test server...`);
    const serverScript = `
      import { createApp } from './server/src/app';
      import { connectDb } from './server/src/config/db';
      async function run() {
        await connectDb();
        const app = createApp();
        app.listen(${targetPort}, () => {
          console.log('[TestServer] Ready on port ${targetPort}');
        });
      }
      run();
    `;

    spawnedServer = spawn('npx', ['tsx', '-e', serverScript], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        PORT: targetPort,
        NODE_ENV: 'test',
        MONGODB_URI: config.mongoUri,
        MONGODB_URI_TEST: config.mongoUri,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    spawnedServer.stdout.on('data', (d) => {
      if (verbose) process.stdout.write(`[ServerOut] ${d}`);
    });
    spawnedServer.stderr.on('data', (d) => {
      if (verbose) process.stderr.write(`[ServerErr] ${d}`);
    });

    const ready = await waitForServer(targetUrl, 25);
    if (!ready) {
      console.warn(`[Test Runner] Warning: Could not verify server on ${targetUrl}. Proceeding with offline/contract tests.`);
    } else {
      console.log(`[Test Runner] Test server active on ${targetUrl}`);
    }
  } else {
    console.log(`[Test Runner] Using existing server at ${targetUrl}`);
  }

  // Define test catalog
  const testFiles = [];

  // TIER 1: Feature Coverage
  if (tierArg === 'all' || tierArg === '1') {
    if (!featureArg || featureArg === 'auth') {
      testFiles.push('./tier1_features/test_auth_rbac.js');
    }
    if (!featureArg || featureArg === 'ingestion') {
      testFiles.push('./tier1_features/test_ingestion.js');
    }
    if (!featureArg || featureArg === 'quill') {
      testFiles.push('./tier1_features/test_quill_sanitization.js');
    }
    if (!featureArg || featureArg === 'portal') {
      testFiles.push('./tier1_features/test_claimant_portal.js');
    }
    if (!featureArg || featureArg === 'sftp') {
      testFiles.push('./tier1_features/test_dash_sftp.js');
    }
    if (!featureArg || featureArg === 'agenda') {
      testFiles.push('./tier1_features/test_agenda_scheduler.js');
    }
    if (!featureArg || featureArg === 'analytics') {
      testFiles.push('./tier1_features/test_analytics.js');
    }
  }

  // TIER 2: Boundary & Corner Cases
  if (tierArg === 'all' || tierArg === '2') {
    if (!featureArg || featureArg === 'auth') {
      testFiles.push('./tier2_boundaries/test_auth_boundaries.js');
    }
    if (!featureArg || featureArg === 'ingestion') {
      testFiles.push('./tier2_boundaries/test_ingestion_boundaries.js');
    }
    if (!featureArg || featureArg === 'quill') {
      testFiles.push('./tier2_boundaries/test_quill_boundaries.js');
    }
    if (!featureArg || featureArg === 'portal') {
      testFiles.push('./tier2_boundaries/test_portal_boundaries.js');
    }
    if (!featureArg || featureArg === 'sftp') {
      testFiles.push('./tier2_boundaries/test_sftp_boundaries.js');
    }
    if (!featureArg || featureArg === 'agenda') {
      testFiles.push('./tier2_boundaries/test_agenda_boundaries.js');
    }
    if (!featureArg || featureArg === 'analytics') {
      testFiles.push('./tier2_boundaries/test_analytics_boundaries.js');
    }
  }

  // TIER 3: Cross-Feature Combinations
  if (tierArg === 'all' || tierArg === '3') {
    testFiles.push('./tier3_pairwise/test_claimant_expiry_fallback.js');
    testFiles.push('./tier3_pairwise/test_excel_variance_rejection.js');
    testFiles.push('./tier3_pairwise/test_sftp_reconciliation_cycle.js');
    testFiles.push('./tier3_pairwise/test_quill_dispatch_magiclink.js');
    testFiles.push('./tier3_pairwise/test_exception_resolution_requeue.js');
    testFiles.push('./tier3_pairwise/test_rbac_tenant_isolation.js');
  }

  // TIER 4: Real-World Scenarios
  if (tierArg === 'all' || tierArg === '4') {
    testFiles.push('./tier4_realworld/test_class_action_lifecycle.js');
  }

  console.log(`[Test Runner] Loading ${testFiles.length} test suites (Tier: ${tierArg})...\n`);

  for (const f of testFiles) {
    try {
      require(f);
    } catch (err) {
      console.error(`[Test Runner] Error loading test suite ${f}:`, err);
    }
  }

  let testResult;
  try {
    testResult = await defaultRunner.run({
      filter: filterArg,
      verbose,
    });
  } finally {
    if (spawnedServer) {
      console.log('[Test Runner] Stopping spawned test server...');
      spawnedServer.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 500));
      if (!spawnedServer.killed) {
        spawnedServer.kill('SIGKILL');
      }
    }
  }

  if (testResult.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[Test Runner] Fatal error:', err);
  process.exit(1);
});
