import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:5000'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/juris_banking'),
  MONGODB_URI_TEST: z.string().default('mongodb://localhost:27017/juris_banking_test'),
  JWT_SECRET: z.string().default('super_secure_jwt_secret_change_in_production_min32chars_long!'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  COOKIE_SECRET: z.string().default('super_secure_cookie_secret_change_in_production_min32chars!'),
  SALT_ROUNDS: z.string().default('10').transform((val) => parseInt(val, 10)),
  EMAIL_PROVIDER: z.enum(['gmail_service', 'smtp', 'mock']).default('mock'),
  EMAIL_TRANSPORT: z.string().default('mock'),
  GMAIL_SERVICE_URL: z.string().default('http://localhost:8085'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 587)),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional().transform((val) => val === 'true'),
  EMAIL_FROM: z.string().default('Settlement Administrator <disbursements@juris-banking.local>'),
  TRACKING_BASE_URL: z.string().default('http://localhost:5000'),
  ENCRYPTION_KEY: z.string().optional(),

  // SFTP Configuration (Milestone 4)
  SFTP_HOST: z.string().default('127.0.0.1'),
  SFTP_PORT: z.string().default('2222').transform((val) => parseInt(val, 10)),
  SFTP_USER: z.string().default('dash_user'),
  SFTP_PASS: z.string().default('dash_pass'),
  SFTP_PASSWORD: z.string().optional(),
  SFTP_PRIVATE_KEY: z.string().optional(),
  SFTP_PRIVATE_KEY_PATH: z.string().optional(),
  SFTP_REMOTE_INBOUND_DIR: z.string().default('/inbound/disbursements'),
  SFTP_REMOTE_DIR_INBOUND: z.string().default('/inbound/disbursements'),
  SFTP_REMOTE_OUTBOUND_DIR: z.string().default('/outbound/reports'),
  SFTP_REMOTE_DIR_REPORTS: z.string().default('/outbound/reports'),
  SFTP_LOCAL_STORAGE_DIR: z.string().default('storage/sftp'),

  // Mock SFTP Server Defaults
  MOCK_SFTP_PORT: z.string().default('2222').transform((val) => parseInt(val, 10)),
  MOCK_SFTP_USER: z.string().default('dash_user'),
  MOCK_SFTP_PASS: z.string().default('dash_pass')
});

export const config = envSchema.parse({
  ...process.env,
  SFTP_PASS: process.env.SFTP_PASS || process.env.SFTP_PASSWORD || 'dash_pass',
  SFTP_PASSWORD: process.env.SFTP_PASSWORD || process.env.SFTP_PASS || 'dash_pass',
  SFTP_REMOTE_INBOUND_DIR: process.env.SFTP_REMOTE_INBOUND_DIR || process.env.SFTP_REMOTE_DIR_INBOUND || '/inbound/disbursements',
  SFTP_REMOTE_DIR_INBOUND: process.env.SFTP_REMOTE_DIR_INBOUND || process.env.SFTP_REMOTE_INBOUND_DIR || '/inbound/disbursements',
  SFTP_REMOTE_OUTBOUND_DIR: process.env.SFTP_REMOTE_OUTBOUND_DIR || process.env.SFTP_REMOTE_DIR_REPORTS || '/outbound/reports',
  SFTP_REMOTE_DIR_REPORTS: process.env.SFTP_REMOTE_DIR_REPORTS || process.env.SFTP_REMOTE_OUTBOUND_DIR || '/outbound/reports'
});
