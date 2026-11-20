/**
 * Sets up the platform for first use:
 *   - creates the default plan if no plans exist
 *   - creates an owner-panel account
 *
 * Usage: npm run db:seed -- --owner-email you@example.com --owner-name "Your Name"
 * A random password is printed once; change it after the first sign-in.
 */
import { parseArgs } from 'node:util'
import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { hashPassword } from '../lib/password'
import { randomToken } from '../lib/tokens'
import { db, pool } from './client'
import { plans, platformUsers } from './schema'

const { values } = parseArgs({
  options: {
    'owner-email': { type: 'string' },
    'owner-name': { type: 'string' },
  },
})

async function main() {
  const [planCount] = await db.select({ n: count() }).from(plans)
  if ((planCount?.n ?? 0) === 0) {
    // Placeholder plans and prices (in rupees, before GST) until pricing is decided.
    // Change them in the owner panel under Plans.
    await db.insert(plans).values([
      {
        code: 'starter',
        name: 'Starter',
        description: 'For small teams getting started',
        maxUsers: 5,
        maxStorageGb: 5,
        maxTendersPerMonth: 1000,
        maxCompanies: 3,
        priceMonthlyInr: 2499,
        priceYearlyInr: 24990,
        sortOrder: 10,
      },
      {
        code: 'standard',
        name: 'Standard',
        description: 'For growing bid teams',
        maxUsers: 25,
        maxStorageGb: 20,
        maxTendersPerMonth: 5000,
        maxCompanies: 5,
        priceMonthlyInr: 6999,
        priceYearlyInr: 69990,
        sortOrder: 20,
      },
      {
        code: 'enterprise',
        name: 'Enterprise',
        description: 'Large teams; priced on request',
        maxUsers: 200,
        maxStorageGb: 200,
        maxTendersPerMonth: 50000,
        maxCompanies: 20,
        priceMonthlyInr: null,
        priceYearlyInr: null,
        sortOrder: 30,
      },
    ])
    console.log('Created plans: Starter, Standard, Enterprise')
  }

  const emailArg = values['owner-email']
  if (!emailArg) {
    console.log('No --owner-email given; skipped creating an owner account.')
    return
  }
  const email = z.email().parse(emailArg.trim().toLowerCase())
  const name = values['owner-name']?.trim() || 'Owner'

  const [existing] = await db
    .select({ id: platformUsers.id })
    .from(platformUsers)
    .where(eq(platformUsers.email, email))
    .limit(1)
  if (existing) {
    console.log(`Owner account ${email} already exists; nothing changed.`)
    return
  }

  const password = randomToken(12)
  await db.insert(platformUsers).values({
    email,
    name,
    passwordHash: await hashPassword(password),
    role: 'owner',
  })
  console.log(`\nOwner account created\n  Email:    ${email}\n  Password: ${password}\n`)
  console.log('This password is shown only once. Store it in your password manager.')
}

try {
  await main()
} finally {
  await pool.end()
}
