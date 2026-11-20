import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

// Load .env from the working directory (apps/api) for local development.
// Values already set in the environment (PM2, CI, tests) are never overwritten.
const envFile = resolve(process.cwd(), '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  BASE_DOMAIN: z.string().trim().toLowerCase().min(1),
  OWNER_SUBDOMAIN: z.string().trim().toLowerCase().default('owner'),
  PUBLIC_URL_TEMPLATE: z.string().includes('{slug}'),
  TRUST_PROXY: z.string().default('loopback'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/),
  TEST_DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  COOKIE_SECURE: bool,
  // Key for secrets stored in the database (authenticator app keys). When
  // empty, one is derived from JWT_ACCESS_SECRET; set it before going live.
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters').optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM_ADDRESS: z.email(),
  PRODUCT_NAME: z.string().min(1).default('Tender Manager'),

  // Where uploaded files are kept (local disk driver). Relative to apps/api.
  STORAGE_DIR: z.string().min(1).default('storage'),
  // Run the background job worker inside this process. Set false when a
  // separate worker process is used.
  RUN_WORKER: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),

  // Billing. Seller details print on GST invoices; placeholders until set.
  BILLING_SELLER_NAME: z.string().default('Your Company Pvt Ltd'),
  BILLING_SELLER_ADDRESS: z.string().default('Your address, City, State PIN'),
  BILLING_SELLER_GSTIN: z.string().default(''),
  // Two-digit GST state code of the seller, e.g. 27 for Maharashtra.
  BILLING_SELLER_STATE_CODE: z
    .string()
    .regex(/^\d{2}$/)
    .default('27'),
  BILLING_SUPPORT_EMAIL: z.string().default(''),
  GST_RATE_PERCENT: z.coerce.number().min(0).max(28).default(18),
  // true: plan prices already include GST; false: GST is added on top.
  PRICES_INCLUDE_GST: bool,
  INVOICE_PREFIX: z.string().max(10).default('INV'),
  // Days after the paid period ends before a client counts as expired.
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  // Suspend clients automatically when the grace period is over (off: reminders only).
  BILLING_AUTO_SUSPEND: bool,
  // Razorpay. Online payment is offered only when the key ID and secret are set.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // Refuse to start with missing or unsafe settings instead of falling back to defaults.
  console.error('Invalid environment settings:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
