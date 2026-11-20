import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Points the API at the test database before any app code loads.
 * Imported first by both the global setup and every test worker.
 */
const envFile = resolve(process.cwd(), '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const testDb = process.env.TEST_DB_NAME || 'tender_saas_test'
if (!testDb.endsWith('_test')) {
  throw new Error(`TEST_DB_NAME must end with "_test" (got "${testDb}"), because tests wipe it`)
}

process.env.NODE_ENV = 'test'
process.env.DB_NAME = testDb
process.env.BASE_DOMAIN = 'localhost'
process.env.OWNER_SUBDOMAIN = 'owner'
process.env.PUBLIC_URL_TEMPLATE = 'http://{slug}.localhost:5173'
process.env.JWT_ACCESS_SECRET ||= 'test-secret-that-is-long-enough-for-the-env-check'
process.env.MAIL_FROM_ADDRESS ||= 'no-reply@example.com'
// Tests write files here and wipe it at the start of each run.
process.env.STORAGE_DIR = 'storage-test'
// Billing: test keys so online payment is on; Razorpay itself is stubbed in tests.
process.env.RAZORPAY_KEY_ID = 'rzp_test_key'
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret'
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_test_webhook_secret'
process.env.BILLING_SELLER_STATE_CODE = '27'
process.env.GST_RATE_PERCENT = '18'
process.env.PRICES_INCLUDE_GST = 'false'
process.env.BILLING_AUTO_SUSPEND = 'false'
