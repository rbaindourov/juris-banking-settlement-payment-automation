import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/config/db';
import { config } from '../../src/config/env';
import { resetAuthRateLimiter } from '../../src/middleware/rateLimiter';
import { User } from '../../src/models/User';
import { Case } from '../../src/models/Case';
import { Claimant } from '../../src/models/Claimant';
import { DisbursementBatch } from '../../src/models/DisbursementBatch';
import { ReconciliationException } from '../../src/models/ReconciliationException';

// Save the original base test URI before any per-suite mutation
const BASE_TEST_URI = process.env.ORIGINAL_MONGODB_URI_TEST || (config.MONGODB_URI_TEST || 'mongodb://localhost:27017/juris_banking_test').replace(/_test.*$/, '_test');

export function getTestDbUri(suiteName?: string): string {
  const baseUri = BASE_TEST_URI;
  if (suiteName) {
    const slug = suiteName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const runSalt = process.env.TEST_RUN_ID || process.ppid || process.pid;
    return `${baseUri}_${slug}_${runSalt}`;
  }
  const workerState = (globalThis as any).__vitest_worker__;
  const testPath = workerState?.filepath || (typeof expect !== 'undefined' && expect.getState ? expect.getState().testPath : undefined);
  if (testPath) {
    const basename = path.basename(testPath, '.test.ts');
    const cleanName = basename.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().substring(0, 18);
    const hash = crypto.createHash('md5').update(testPath).digest('hex').substring(0, 6);
    const runSalt = process.env.TEST_RUN_ID || process.ppid || process.pid;
    return `${baseUri}_${cleanName}_${runSalt}_${hash}`;
  }
  const workerId = process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID;
  if (workerId) {
    return `${baseUri}_w${workerId}`;
  }
  return `${baseUri}_${process.pid}`;
}

export async function setupTestDb(suiteName?: string): Promise<void> {
  await resetAuthRateLimiter();
  const uri = getTestDbUri(suiteName);
  process.env.MONGODB_URI_TEST = uri;
  (config as any).MONGODB_URI_TEST = uri;
  await connectDb(uri);
  // Guarantee all Mongoose unique indexes are synchronized before running tests
  await Promise.all([
    User.init(),
    Case.init(),
    Claimant.init(),
    DisbursementBatch.init(),
    ReconciliationException.init()
  ]);
}

export async function clearTestDb(suiteName?: string): Promise<void> {
  await resetAuthRateLimiter();
  const uri = getTestDbUri(suiteName);
  await connectDb(uri);
  // Allow any trailing event loop callbacks to flush
  await new Promise((resolve) => setImmediate(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    const collections = await mongoose.connection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
}

export async function teardownTestDb(suiteName?: string): Promise<void> {
  await resetAuthRateLimiter();
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      await mongoose.connection.db.dropDatabase();
    } catch {
      // Ignored if database is already dropped or connection is closing
    }
  }
  await disconnectDb();
}
