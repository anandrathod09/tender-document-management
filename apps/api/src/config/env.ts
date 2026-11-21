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

  // Where uploaded files are kept: "local" (a folder on this server) or "s3"
  // (Amazon S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO...).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  // Local driver: the folder, relative to apps/api.
  STORAGE_DIR: z.string().min(1).default('storage'),
  // S3 driver. S3_ENDPOINT is empty for Amazon S3, or the provider's URL, e.g.
  // https://<account>.r2.cloudflarestorage.com or https://blr1.digitaloceanspaces.com
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // true for MinIO and some providers that need bucket-in-path URLs.
  S3_FORCE_PATH_STYLE: bool,
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

/**
 * Settings that are fine on a laptop but unsafe on a live server. In
 * production the API refuses to start until they are fixed.
 */
export function productionProblems(e: z.infer<typeof schema>): string[] {
  if (e.NODE_ENV !== 'production') return []
  const problems: string[] = []
  const local = e.BASE_DOMAIN === 'localhost' || e.BASE_DOMAIN.endsWith('.localhost')
  if (local) problems.push('BASE_DOMAIN: set your real domain, e.g. yourproduct.com')
  if (!e.PUBLIC_URL_TEMPLATE.startsWith('https://'))
    problems.push(
      'PUBLIC_URL_TEMPLATE: must start with https://, e.g. https://{slug}.yourproduct.com',
    )
  if (!e.COOKIE_SECURE)
    problems.push('COOKIE_SECURE: must be true (sign-in cookies over HTTPS only)')
  if (!e.ENCRYPTION_KEY)
    problems.push('ENCRYPTION_KEY: set its own random value (openssl rand -hex 32)')
  if (e.JWT_ACCESS_SECRET.length < 48)
    problems.push('JWT_ACCESS_SECRET: use at least 48 random characters (openssl rand -hex 32)')
  if (e.ENCRYPTION_KEY && e.ENCRYPTION_KEY === e.JWT_ACCESS_SECRET)
    problems.push('ENCRYPTION_KEY: must differ from JWT_ACCESS_SECRET')
  if (e.STORAGE_DRIVER === 's3' && !(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY))
    problems.push(
      'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: needed with STORAGE_DRIVER=s3',
    )
  return problems
}

const problems = productionProblems(parsed.data)
if (problems.length) {
  console.error('Unsafe settings for production (NODE_ENV=production):')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
