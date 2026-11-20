/**
 * Creates (or resets) a demo set-up for local development, with fixed logins
 * that are documented in the README:
 *   - owner panel: owner@demo.test / demo-owner-password
 *   - demo client "demo": admin@demo.test / demo-password-1
 * plus a bidding company and a few sample tenders.
 *
 * Usage: npm run db:demo
 *
 * Refuses to run in production or on any domain other than localhost, so
 * these public passwords can never exist on a live server.
 */
import ExcelJS from 'exceljs'
import { asc, count, eq } from 'drizzle-orm'
import { env } from '../config/env'
import { addDays, todayIn } from '../lib/dates'
import { hashPassword } from '../lib/password'
import { provisionOrganization } from '../modules/owner/service'
import { importTenders } from '../modules/tenders/import'
import { db, pool } from './client'
import { orgWhere } from './scope'
import {
  biddingCompanies,
  organizations,
  plans,
  platformUsers,
  roles,
  tenders,
  users,
} from './schema'

export const DEMO = {
  ownerEmail: 'owner@demo.test',
  ownerPassword: 'demo-owner-password',
  slug: 'demo',
  adminEmail: 'admin@demo.test',
  adminPassword: 'demo-password-1',
} as const

function assertLocal() {
  const local = env.BASE_DOMAIN === 'localhost' || env.BASE_DOMAIN.endsWith('.localhost')
  if (env.NODE_ENV === 'production' || !local) {
    console.error(
      'db:demo only runs on a local development set-up (NODE_ENV not production, BASE_DOMAIN=localhost).',
    )
    process.exit(1)
  }
}

async function ensurePlan(): Promise<string> {
  const [first] = await db.select().from(plans).orderBy(asc(plans.sortOrder)).limit(1)
  if (first) return first.id
  const id = crypto.randomUUID()
  await db.insert(plans).values({
    id,
    code: 'standard',
    name: 'Standard',
    description: 'For growing bid teams',
    maxUsers: 25,
    maxStorageGb: 20,
    maxTendersPerMonth: 5000,
    maxCompanies: 5,
    priceMonthlyInr: 6999,
    priceYearlyInr: 69990,
  })
  return id
}

async function ensureOwner() {
  const passwordHash = await hashPassword(DEMO.ownerPassword)
  const [owner] = await db
    .select()
    .from(platformUsers)
    .where(eq(platformUsers.email, DEMO.ownerEmail))
    .limit(1)
  if (owner) {
    await db
      .update(platformUsers)
      .set({ passwordHash, status: 'active', totpSecret: null, totpEnabledAt: null })
      .where(eq(platformUsers.id, owner.id))
    return owner.id
  }
  const id = crypto.randomUUID()
  await db
    .insert(platformUsers)
    .values({ id, email: DEMO.ownerEmail, name: 'Demo Owner', passwordHash })
  return id
}

async function ensureClient(ownerId: string, planId: string) {
  let [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, DEMO.slug))
    .limit(1)
  if (!org) {
    await provisionOrganization(
      { type: 'platform', id: ownerId, ip: null },
      {
        name: 'Demo Infra Pvt Ltd',
        slug: DEMO.slug,
        planId,
        timezone: 'Asia/Kolkata',
        trialDays: 30,
        adminName: 'Demo Admin',
        adminEmail: DEMO.adminEmail,
      },
    )
    ;[org] = await db.select().from(organizations).where(eq(organizations.slug, DEMO.slug))
  }
  // The admin can sign in straight away with the documented password.
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(DEMO.adminPassword),
      status: 'active',
      inviteTokenHash: null,
      inviteExpiresAt: null,
      totpSecret: null,
      totpEnabledAt: null,
    })
    .where(orgWhere(users, org!.id, eq(users.email, DEMO.adminEmail)))
  // So the demo login is never blocked by "two-step login required".
  await db
    .update(organizations)
    .set({ requireTwoFactor: false, status: org!.status === 'suspended' ? 'trial' : org!.status })
    .where(eq(organizations.id, org!.id))
  return org!
}

async function ensureCompany(orgId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(biddingCompanies)
    .where(orgWhere(biddingCompanies, orgId))
  if ((row?.n ?? 0) > 0) return
  await db.insert(biddingCompanies).values({
    organizationId: orgId,
    name: 'Demo Infra Pvt Ltd',
    address: 'Plot 12, Ambad MIDC, Nashik 422010, Maharashtra',
    gstin: '27AAACD1234E1Z5',
    signatoryName: 'Anil Deshmukh',
    designation: 'Director',
    authorizedPerson: 'Rahul Patil',
    authorizedPersonPosition: 'Tender Manager',
  })
}

/** A small Tender247-style sheet with deadlines in the coming weeks. */
async function sampleSheet(): Promise<Buffer> {
  const today = todayIn('Asia/Kolkata')
  const indian = (iso: string) => iso.split('-').reverse().join('-')
  const rows = [
    [
      '98001',
      'GEM/2026/B/7365884',
      'Supply of Laptops - 40 Nos',
      3,
      'Indian Railways',
      'Mumbai',
      3200000,
    ],
    [
      '98002',
      'GEM/2026/B/7469548',
      'Office chairs and tables',
      11,
      'Municipal Corporation',
      'Pune',
      450000,
    ],
    [
      '97001',
      'PWD/NSK/2026/118',
      'Road resurfacing work, Nashik ring road',
      20,
      'Public Works Department',
      'Nashik',
      12500000,
    ],
  ] as const
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('GeM Tenders')
  ws.addRow([
    'T247 ID',
    'REFERENCE NO',
    'TENDER BRIEF',
    'Deadline',
    'Organization',
    'LOCATION',
    'ESTIMATED COST',
    'EMD',
  ])
  for (const [id, ref, brief, days, org, loc, cost] of rows) {
    ws.addRow([
      id,
      ref,
      brief,
      indian(addDays(today, days)),
      org,
      loc,
      cost,
      Math.round(cost * 0.02),
    ])
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Adds the sample tenders only to an empty demo client, so existing work is never changed. */
async function ensureTenders(orgId: string) {
  const [existing] = await db.select({ n: count() }).from(tenders).where(orgWhere(tenders, orgId))
  if ((existing?.n ?? 0) > 0) return 0
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, orgId, eq(users.email, DEMO.adminEmail)))
  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, orgId, eq(roles.id, user!.roleId)))
  const result = await importTenders(
    { org: org!, user: user!, role: role!, permissions: new Set(role!.permissions) },
    { buffer: await sampleSheet(), originalname: 'Demo-Tenders.xlsx' },
  )
  return result.created
}

async function main() {
  assertLocal()
  const planId = await ensurePlan()
  const ownerId = await ensureOwner()
  const org = await ensureClient(ownerId, planId)
  await ensureCompany(org.id)
  const created = await ensureTenders(org.id)

  const url = env.PUBLIC_URL_TEMPLATE.replace('{slug}', DEMO.slug)
  const ownerUrl = env.PUBLIC_URL_TEMPLATE.replace('{slug}', env.OWNER_SUBDOMAIN)
  console.log(`
Demo ready${created ? ` (${created} sample tenders added)` : ''}

  Demo client   ${url}
                ${DEMO.adminEmail} / ${DEMO.adminPassword}

  Owner panel   ${ownerUrl}
                ${DEMO.ownerEmail} / ${DEMO.ownerPassword}
`)
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
