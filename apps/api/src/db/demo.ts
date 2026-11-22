/**
 * Creates (or resets) a demo set-up for local development, with fixed logins
 * that are documented in the README:
 *   - owner panel: owner@demo.test / demo-owner-password
 *   - demo client "demo": admin@demo.test / demo-password-1
 *   - an Agent in the demo client: agent@demo.test / demo-password-1
 *   - an Engineer in the demo client: engineer@demo.test / demo-password-1
 *   - a Viewer (read only) in the demo client: viewer@demo.test / demo-password-1
 * plus a bidding company and a few sample tenders.
 *
 * Usage: npm run db:demo
 *
 * Refuses to run in production or on any domain other than localhost, so
 * these public passwords can never exist on a live server.
 */
import ExcelJS from 'exceljs'
import { asc, count, desc, eq, isNull } from 'drizzle-orm'
import { installationReportSchema } from '@tdm/shared'
import { env } from '../config/env'
import { addDays, todayIn } from '../lib/dates'
import { hashPassword } from '../lib/password'
import { provisionOrganization } from '../modules/owner/service'
import { saveReport } from '../modules/installation/service'
import { importTenders } from '../modules/tenders/import'
import { assignTender, moveTender } from '../modules/tenders/service'
import type { TenantAuth } from '../types/express'
import { db, pool } from './client'
import { orgWhere } from './scope'
import {
  biddingCompanies,
  installationConsignees,
  installationReports,
  organizations,
  plans,
  platformUsers,
  roles,
  tenders,
  users,
  workflowStages,
} from './schema'

export const DEMO = {
  ownerEmail: 'owner@demo.test',
  ownerPassword: 'demo-owner-password',
  slug: 'demo',
  adminEmail: 'admin@demo.test',
  adminPassword: 'demo-password-1',
  agentEmail: 'agent@demo.test',
  engineerEmail: 'engineer@demo.test',
  viewerEmail: 'viewer@demo.test',
  /** The agent's, engineer's and viewer's password. */
  memberPassword: 'demo-password-1',
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

/** Acts as the demo admin, so demo data goes through the normal app rules. */
async function adminAuth(orgId: string): Promise<TenantAuth> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, orgId, eq(users.email, DEMO.adminEmail)))
  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, orgId, eq(roles.id, user!.roleId)))
  return { org: org!, user: user!, role: role!, permissions: new Set(role!.permissions) }
}

/** Adds the sample tenders only to an empty demo client, so existing work is never changed. */
async function ensureTenders(orgId: string) {
  const [existing] = await db.select({ n: count() }).from(tenders).where(orgWhere(tenders, orgId))
  if ((existing?.n ?? 0) > 0) return 0
  const result = await importTenders(await adminAuth(orgId), {
    buffer: await sampleSheet(),
    originalname: 'Demo-Tenders.xlsx',
  })
  return result.created
}

/** Creates or resets a demo team member with a role and the demo password. */
async function ensureMember(orgId: string, roleKey: string, email: string, name: string) {
  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, orgId, eq(roles.key, roleKey)))
  if (!role) return null
  const passwordHash = await hashPassword(DEMO.memberPassword)
  const [existing] = await db
    .select()
    .from(users)
    .where(orgWhere(users, orgId, eq(users.email, email)))
  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash,
        roleId: role.id,
        status: 'active',
        inviteTokenHash: null,
        inviteExpiresAt: null,
        totpSecret: null,
        totpEnabledAt: null,
      })
      .where(orgWhere(users, orgId, eq(users.id, existing.id)))
    return existing
  }
  await db
    .insert(users)
    .values({ organizationId: orgId, email, name, passwordHash, roleId: role.id, status: 'active' })
  const [created] = await db
    .select()
    .from(users)
    .where(orgWhere(users, orgId, eq(users.email, email)))
  return created!
}

/**
 * An Agent login, to see the app as an agent does (only their assigned
 * tenders, fewer menu items). If they have no tenders yet, the two oldest
 * unassigned ones are assigned to them.
 */
async function ensureAgent(orgId: string) {
  const agent = await ensureMember(orgId, 'agent', DEMO.agentEmail, 'Demo Agent')
  if (!agent) return 0
  const [mine] = await db
    .select({ n: count() })
    .from(tenders)
    .where(orgWhere(tenders, orgId, eq(tenders.assignedAgentId, agent.id)))
  if ((mine?.n ?? 0) > 0) return 0
  const free = await db
    .select({ id: tenders.id })
    .from(tenders)
    .where(orgWhere(tenders, orgId, isNull(tenders.assignedAgentId)))
    .orderBy(asc(tenders.createdAt))
    .limit(2)
  const auth = await adminAuth(orgId)
  for (const t of free) await assignTender(auth, t.id, { agentId: agent.id })
  return free.length
}

/** The normal path a tender takes from "Assigned" to the engineer, as the admin moves it. */
const PATH_TO_ENGINEER = [
  'in-progress',
  'price-review',
  'ready-to-bid',
  'submitted',
  'won',
  'assigned-to-engineer',
] as const

/**
 * An Engineer login. Engineers see only the tenders where they are the
 * engineer on a consignee, so if they have none, one tender is taken through
 * the normal steps (assigned to the demo agent, bid, won, assigned to
 * engineer) and given a consignee with the demo engineer and two units.
 * A tender that already has an installation report is never touched.
 * Returns the reference number of that tender, or null when nothing changed.
 */
async function ensureEngineer(orgId: string): Promise<string | null> {
  const engineer = await ensureMember(orgId, 'engineer', DEMO.engineerEmail, 'Demo Engineer')
  if (!engineer) return null
  const [linked] = await db
    .select({ n: count() })
    .from(installationConsignees)
    .where(
      orgWhere(installationConsignees, orgId, eq(installationConsignees.engineerId, engineer.id)),
    )
  if ((linked?.n ?? 0) > 0) return null

  const auth = await adminAuth(orgId)
  const stages = await db.select().from(workflowStages).where(orgWhere(workflowStages, orgId))
  const byKey = new Map(stages.map((s) => [s.key, s]))
  const afterWin = new Set(
    stages.filter((s) => s.type === 'won' || s.type === 'execution').map((s) => s.id),
  )
  const all = await db
    .select()
    .from(tenders)
    .where(orgWhere(tenders, orgId))
    .orderBy(desc(tenders.createdAt))

  // A won tender with no installation report yet (an existing report is never
  // replaced), else a free tender walked along the normal path.
  const withReport = new Set(
    (
      await db
        .select({ tenderId: installationReports.tenderId })
        .from(installationReports)
        .where(orgWhere(installationReports, orgId))
    ).map((r) => r.tenderId),
  )
  let tender = all.find((t) => afterWin.has(t.stageId) && !withReport.has(t.id))
  if (tender && stages.find((s) => s.id === tender!.stageId)?.type === 'won') {
    const next = byKey.get('assigned-to-engineer')
    if (next) await moveTender(auth, tender.id, { stageId: next.id, comment: 'Demo data' })
  }
  if (!tender) {
    const free = all.find((t) => !t.assignedAgentId && t.deadline >= todayIn(auth.org.timezone))
    const [agent] = await db
      .select({ id: users.id })
      .from(users)
      .where(orgWhere(users, orgId, eq(users.email, DEMO.agentEmail)))
    if (!free || !agent) return null
    try {
      await assignTender(auth, free.id, { agentId: agent.id })
      for (const key of PATH_TO_ENGINEER) {
        const stage = byKey.get(key)
        if (!stage) throw new Error(`stage "${key}" is missing`)
        await moveTender(auth, free.id, {
          stageId: stage.id,
          comment: 'Demo data',
          ...(stage.type === 'won' && { awardAmount: Math.round(free.estimatedCost ?? 100000) }),
        })
      }
    } catch (err) {
      console.warn(`Could not prepare a tender for the demo engineer: ${(err as Error).message}`)
      return null
    }
    tender = free
  }

  await saveReport(
    auth,
    tender.id,
    installationReportSchema.parse({
      customerName: tender.buyerOrganization,
      consignees: [
        {
          name: `${tender.buyerOrganization ?? 'Customer'} – Main office`,
          designation: 'Store officer',
          phone: '9800000000',
          engineerId: engineer.id,
          items: [
            {
              itemName: 'Desktop computer\ni5, 16GB RAM, 512GB SSD, 22 inch monitor',
              serialType: 'split',
              warrantyMonths: 36,
              quantity: 3,
              units: [{ monitorSerial: 'DEMO-MON-01', cpuSerial: 'DEMO-CPU-01' }],
            },
            {
              itemName: 'Laser printer',
              warrantyMonths: 12,
              quantity: 2,
              units: [{ serialNumber: 'DEMO-0001' }, { serialNumber: 'DEMO-0002' }],
            },
          ],
        },
      ],
    }),
  )
  return tender.referenceNo
}

async function main() {
  assertLocal()
  const planId = await ensurePlan()
  const ownerId = await ensureOwner()
  const org = await ensureClient(ownerId, planId)
  await ensureCompany(org.id)
  const created = await ensureTenders(org.id)
  const assigned = await ensureAgent(org.id)
  await ensureMember(org.id, 'viewer', DEMO.viewerEmail, 'Demo Viewer')
  const engineerTender = await ensureEngineer(org.id)

  const url = env.PUBLIC_URL_TEMPLATE.replace('{slug}', DEMO.slug)
  const ownerUrl = env.PUBLIC_URL_TEMPLATE.replace('{slug}', env.OWNER_SUBDOMAIN)
  console.log(`
Demo ready${created ? ` (${created} sample tenders added)` : ''}

  Demo client   ${url}
                ${DEMO.adminEmail} / ${DEMO.adminPassword}   (Admin)
                ${DEMO.agentEmail} / ${DEMO.memberPassword}   (Agent${assigned ? `, ${assigned} tenders assigned` : ''})
                ${DEMO.engineerEmail} / ${DEMO.memberPassword}   (Engineer${engineerTender ? `, engineer on ${engineerTender}` : ''})
                ${DEMO.viewerEmail} / ${DEMO.memberPassword}   (Viewer, read only)

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
