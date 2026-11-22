/**
 * Moves one client from the original single-client TMS into a workspace on
 * the new platform.
 *
 *   npm run migrate:tms -- --source tender_dada --slug ostnashik --name "OST Nashik" \
 *     --uploads D:/Projects/TMS/tms/backend/uploads \
 *     --company-images D:/Projects/TMS/tms/frontend/public/images/companies \
 *     --dry-run
 *
 * --dry-run does everything inside a transaction and then rolls it back, and
 * only checks that files exist, so it is safe to run as often as needed.
 * The old database is only read, never changed.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { count, eq, inArray } from 'drizzle-orm'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { DEFAULT_ROLES, type EngineerStatus, type InstallStatus } from '@tdm/shared'
import { env } from '../config/env'
import { todayIn } from '../lib/dates'
import { writeAudit } from '../lib/audit'
import { createDefaultStages } from '../modules/workflow/service'
import { storeFile } from '../modules/files/service'
import { db, pool } from './client'
import {
  biddingCompanies,
  installationConsignees,
  installationItems,
  installationReports,
  installedAssets,
  organizations,
  plans,
  roles,
  tenders,
  tenderStageHistory,
  users,
  workflowStages,
} from './schema'

export interface MigrationOptions {
  /** Name of the old TMS database (on the same MySQL server unless sourceHost is given). */
  source: string
  sourceHost?: string
  sourcePort?: number
  sourceUser?: string
  sourcePassword?: string
  slug: string
  name?: string
  planCode?: string
  timezone?: string
  /** The old backend's uploads folder. Files are skipped (and listed) without it. */
  uploadsDir?: string
  /** The old frontend's public/images/companies folder, for logos and signatures. */
  companyImagesDir?: string
  dryRun?: boolean
}

export interface MigrationReport {
  dryRun: boolean
  organization: { id: string; slug: string; created: boolean }
  users: { migrated: number; invited: number; suspended: number; skipped: number }
  companies: number
  tenders: number
  byStage: Record<string, number>
  historyEntries: number
  installation: {
    reports: number
    consignees: number
    templates: number
    units: number
    emptyRows: number
  }
  files: {
    library: number
    tenderDocuments: number
    consigneeDocuments: number
    companyImages: number
    missing: string[]
  }
  warnings: string[]
}

class DryRunRollback extends Error {}

/** The three companies the original TMS had built in, with their letterhead details. */
const OLD_COMPANIES: Record<
  string,
  {
    name: string
    address: string
    signatory: string
    designation: string
    authorized: string
    position: string
    localContent: string
    location: string
    imageDir: string
  }
> = {
  maxstationary: {
    name: 'Max Stationary',
    address: '123 Business Park, Mumbai - 400001',
    signatory: 'Rajesh Kumar',
    designation: 'Director',
    authorized: 'Rajesh Kumar',
    position: 'Director',
    localContent: '35',
    location: 'Mumbai',
    imageDir: 'maxstationary',
  },
  ostnasik: {
    name: 'OST Nasik',
    address: '456 Industrial Area, Nashik - 422001',
    signatory: 'Priya Sharma',
    designation: 'Branch Manager',
    authorized: 'Priya Sharma',
    position: 'Branch Manager',
    localContent: '28',
    location: 'Nashik',
    imageDir: 'ostnasik',
  },
  'shradhha-ent': {
    name: 'SHRADDHA ENTERPRISES',
    address: 'Preeti Pushp, Plot No 12, Kartikiya Nagar, Kamatwade, Ambad, Nashik - 422010',
    signatory: 'SHRADDHA RAJU SHIRSAT',
    designation: 'PROPRIETOR',
    authorized: 'SHRADDHA R SHIRSAT',
    position: 'PROPRIETOR',
    localContent: '21',
    location: 'Nashik',
    imageDir: 'shraddha-enterprises',
  },
}

/** Old workflowStatus → key of the matching default stage. */
const STAGE_MAP: Record<string, string> = {
  new: 'new',
  watchlist: 'watchlist',
  'in-progress': 'in-progress',
  'assigned-to-agent': 'assigned',
  'price-review': 'price-review',
  'criteria-review': 'criteria-review',
  'not-fit': 'not-fit',
  'not-bidded': 'not-bidded',
  'ready-to-bid': 'ready-to-bid',
  submitted: 'submitted',
  'under-query': 'under-query',
  won: 'won',
  lost: 'lost',
  'assigned-to-engineer': 'assigned-to-engineer',
  completed: 'completed',
}

const ENGINEER_STATUS_MAP: Record<string, EngineerStatus> = {
  assigned: 'assigned',
  'site-visit': 'site_visit',
  design: 'design',
  execution: 'execution',
  completed: 'completed',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max = 255): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s || /^(na|n\/a|null|undefined)$/i.test(s)) return null
  return s.slice(0, max)
}
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'object') return v as T
  try {
    return JSON.parse(String(v)) as T
  } catch {
    return fallback
  }
}

export async function migrateFromTms(opts: MigrationOptions): Promise<MigrationReport> {
  const timezone = opts.timezone ?? 'Asia/Kolkata'
  const dateOf = (v: unknown): string | null => {
    if (!v) return null
    const d = v instanceof Date ? v : new Date(String(v))
    return Number.isNaN(d.getTime()) ? null : todayIn(timezone, d)
  }
  const timeOf = (v: unknown, fallback: Date): Date => {
    if (!v) return fallback
    const d = v instanceof Date ? v : new Date(String(v))
    return Number.isNaN(d.getTime()) ? fallback : d
  }

  const source = await mysql.createConnection({
    host: opts.sourceHost ?? env.DB_HOST,
    port: opts.sourcePort ?? env.DB_PORT,
    user: opts.sourceUser ?? env.DB_USER,
    password: opts.sourcePassword ?? env.DB_PASSWORD,
    database: opts.source,
    timezone: 'Z',
    dateStrings: false,
  })
  const [tableRows] = await source.query<RowDataPacket[]>(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [opts.source],
  )
  const hasTable = new Set(tableRows.map((r) => String(r.t)))
  const read = async (table: string) =>
    hasTable.has(table)
      ? ((await source.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``))[0] as Record<
          string,
          unknown
        >[])
      : []

  const oldUsers = await read('users')
  const oldTenders = await read('tenders')
  const oldReports = await read('tender_reports')
  const oldLibrary = [...(await read('tender_documents')), ...(await read('media_documents'))]
  await source.end()

  const report: MigrationReport = {
    dryRun: !!opts.dryRun,
    organization: { id: '', slug: opts.slug, created: false },
    users: { migrated: 0, invited: 0, suspended: 0, skipped: 0 },
    companies: 0,
    tenders: 0,
    byStage: {},
    historyEntries: 0,
    installation: { reports: 0, consignees: 0, templates: 0, units: 0, emptyRows: 0 },
    files: { library: 0, tenderDocuments: 0, consigneeDocuments: 0, companyImages: 0, missing: [] },
    warnings: [],
  }

  /** Finds an old upload on disk from the path stored in the old database. */
  const findUpload = (stored: unknown): string | null => {
    const p = str(stored, 1000)
    if (!p || !opts.uploadsDir) return null
    const rel = p
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^.*?uploads\//, '')
    const full = isAbsolute(rel) ? rel : join(opts.uploadsDir, rel)
    return existsSync(full) ? full : null
  }

  try {
    await db.transaction(async (tx) => {
      // ---- Already moved? -----------------------------------------------------
      // Old records keep their ids, so the same old database can only be moved once.
      const oldTenderIds = oldTenders.map((t) => String(t.id)).filter((id) => UUID.test(id))
      if (oldTenderIds.length) {
        const [hit] = await tx
          .select({ slug: organizations.slug })
          .from(tenders)
          .innerJoin(organizations, eq(organizations.id, tenders.organizationId))
          .where(inArray(tenders.id, oldTenderIds.slice(0, 500)))
          .limit(1)
        if (hit) {
          throw new Error(
            `This old database was already moved into workspace "${hit.slug}". ` +
              'Each old TMS can be moved once; rehearse on a fresh copy of the database instead.',
          )
        }
      }

      // ---- Organization, roles, stages --------------------------------------
      let [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.slug, opts.slug))
        .limit(1)
      if (org) {
        const [t] = await tx
          .select({ n: count() })
          .from(tenders)
          .where(eq(tenders.organizationId, org.id))
        if ((t?.n ?? 0) > 0) {
          throw new Error(
            `Workspace "${opts.slug}" already has tenders. Migrate into a new, empty workspace.`,
          )
        }
      } else {
        if (!opts.name)
          throw new Error('The workspace does not exist yet: give --name to create it')
        const [plan] = await tx
          .select()
          .from(plans)
          .where(eq(plans.code, opts.planCode ?? 'standard'))
          .limit(1)
        if (!plan)
          throw new Error(`Plan "${opts.planCode ?? 'standard'}" not found (run the seed first)`)
        const id = crypto.randomUUID()
        await tx.insert(organizations).values({
          id,
          slug: opts.slug,
          name: opts.name,
          status: 'active',
          planId: plan.id,
          timezone,
        })
        await tx.insert(roles).values(
          DEFAULT_ROLES.map((r) => ({
            id: crypto.randomUUID(),
            organizationId: id,
            key: r.key,
            name: r.name,
            permissions: r.permissions,
            isSystem: true,
          })),
        )
        await createDefaultStages(tx, id)
        ;[org] = await tx.select().from(organizations).where(eq(organizations.id, id))
        report.organization.created = true
      }
      const orgId = org!.id
      report.organization.id = orgId

      const roleRows = await tx.select().from(roles).where(eq(roles.organizationId, orgId))
      const roleId = (key: string) => roleRows.find((r) => r.key === key)?.id
      const stageRows = await tx
        .select()
        .from(workflowStages)
        .where(eq(workflowStages.organizationId, orgId))
      const stageByKey = new Map(stageRows.map((s) => [s.key, s]))
      const stage = (key: string) => {
        const s = stageByKey.get(key)
        if (!s) throw new Error(`The workspace has no "${key}" stage`)
        return s
      }

      // ---- Users ---------------------------------------------------------------
      const userMap = new Map<string, string>()
      const userCompany = new Map<string, string>()
      const emails = new Set(
        (
          await tx.select({ email: users.email }).from(users).where(eq(users.organizationId, orgId))
        ).map((u) => u.email),
      )
      for (const u of oldUsers) {
        const type = String(u.userType)
        const email = str(u.email, 254)?.toLowerCase()
        if (type === 'client') {
          report.users.skipped++
          report.warnings.push(
            `User ${email ?? u.id}: buyer-side "client" logins are not carried over.`,
          )
          continue
        }
        const role = roleId(type === 'admin' ? 'admin' : type === 'engineer' ? 'engineer' : 'agent')
        if (!email || !role || emails.has(email)) {
          report.users.skipped++
          report.warnings.push(
            `User ${email ?? u.id}: skipped (${!email ? 'no email' : 'email already used'}).`,
          )
          continue
        }
        emails.add(email)
        const hash = str(u.password_hash, 100)
        const oldStatus = String(u.status ?? 'active')
        const status =
          oldStatus === 'inactive' || oldStatus === 'suspended'
            ? 'suspended'
            : hash
              ? 'active'
              : 'invited'
        const id = UUID.test(String(u.id)) ? String(u.id) : crypto.randomUUID()
        const name =
          [str(u.first_name), str(u.last_name)].filter(Boolean).join(' ') ||
          str(u.username, 120) ||
          email
        await tx.insert(users).values({
          id,
          organizationId: orgId,
          email,
          name: name.slice(0, 120),
          phone: str(u.phone, 30),
          passwordHash: hash,
          roleId: role,
          status,
          lastLoginAt: u.lastLogin ? timeOf(u.lastLogin, new Date()) : null,
          createdAt: timeOf(u.createdAt, new Date()),
        })
        userMap.set(String(u.id), id)
        if (u.company) userCompany.set(id, String(u.company))
        if (status === 'invited') report.users.invited++
        else if (status === 'suspended') report.users.suspended++
        report.users.migrated++
      }
      if (report.users.invited) {
        report.warnings.push(
          `${report.users.invited} user(s) never set a password in the old system: send them an invitation from Users.`,
        )
      }
      const mapUser = (v: unknown) => (v ? (userMap.get(String(v)) ?? null) : null)

      // ---- Bidding companies ------------------------------------------------
      const companyKeys = new Set<string>()
      for (const u of oldUsers) if (u.company) companyKeys.add(String(u.company))
      for (const t of oldTenders) if (t.company) companyKeys.add(String(t.company))
      for (const r of oldReports)
        if (r.selectedCompanyProfile) companyKeys.add(String(r.selectedCompanyProfile))
      const companyMap = new Map<string, string>()
      for (const key of companyKeys) {
        const c = OLD_COMPANIES[key]
        if (!c) {
          report.warnings.push(
            `Company "${key}" is not one of the three known companies; add it by hand.`,
          )
          continue
        }
        const id = crypto.randomUUID()
        await tx.insert(biddingCompanies).values({
          id,
          organizationId: orgId,
          name: c.name,
          address: c.address,
          signatoryName: c.signatory,
          designation: c.designation,
          authorizedPerson: c.authorized,
          authorizedPersonPosition: c.position,
          localContentPercent: c.localContent,
          localValueLocation: c.location,
        })
        companyMap.set(key, id)
        report.companies++
        if (opts.companyImagesDir) {
          for (const which of ['logo', 'signature'] as const) {
            const path = join(opts.companyImagesDir, c.imageDir, `${which}.png`)
            if (!existsSync(path)) continue
            report.files.companyImages++
            if (opts.dryRun) continue
            const file = await storeFile(tx, {
              organizationId: orgId,
              kind: which === 'logo' ? 'company_logo' : 'company_signature',
              bytes: await readFile(path),
              originalName: `${which}.png`,
              title: `${c.name} ${which}`,
              companyId: id,
            })
            await tx
              .update(biddingCompanies)
              .set(which === 'logo' ? { logoFileId: file.id } : { signatureFileId: file.id })
              .where(eq(biddingCompanies.id, id))
          }
        }
      }
      if (report.companies) {
        report.warnings.push(
          'Company letterhead details and images come from the old app’s built-in settings: check them under Manage → Bidding companies.',
        )
      }

      // ---- Tenders and their history -----------------------------------------
      const refs = new Set<string>()
      const tenderMap = new Map<string, string>()
      for (const t of oldTenders) {
        const id = UUID.test(String(t.id)) ? String(t.id) : crypto.randomUUID()
        const stageKey =
          String(t.status) === 'rejected'
            ? 'rejected'
            : (STAGE_MAP[String(t.workflowStatus ?? 'new')] ?? 'new')
        const current = stage(stageKey)
        let ref = str(t.referenceNo, 191) ?? str(t.t247Id, 191) ?? id
        if (refs.has(ref.toLowerCase())) {
          const unique = `${ref} (${t.t247Id ?? id.slice(0, 8)})`.slice(0, 191)
          report.warnings.push(
            `Reference "${ref}" appears twice; the second was saved as "${unique}".`,
          )
          ref = unique
        }
        refs.add(ref.toLowerCase())

        const createdAt = timeOf(t.createdAt, new Date())
        const updatedAt = timeOf(t.updatedAt, createdAt)
        const agentId = mapUser(t.assignedToAgent)
        // The tender's own company, else the company of the agent working on it.
        const companyKey = t.company
          ? String(t.company)
          : agentId
            ? userCompany.get(agentId)
            : undefined
        const companyId: string | null = (companyKey && companyMap.get(companyKey)) || null
        const won = ['won', 'execution', 'closed'].includes(current.type)
        const previous =
          stageKey === 'not-bidded' && t.previousWorkflowStatus
            ? (stageByKey.get(STAGE_MAP[String(t.previousWorkflowStatus)] ?? '')?.id ?? null)
            : null
        const deadline = dateOf(t.deadline) ?? dateOf(createdAt)!

        await tx.insert(tenders).values({
          id,
          organizationId: orgId,
          source: 'tender247',
          sourceTenderId: str(t.t247Id, 100),
          referenceNo: ref,
          title: str(t.tenderBrief, 60_000) ?? ref,
          briefUrl: str(t.tenderBriefLink, 2000),
          buyerOrganization: str(t.organization),
          location: str(t.location),
          estimatedCost: num(t.estimatedCost),
          emd: num(t.emd),
          documentFee: num(t.documentFees),
          deadline,
          sheetType: String(t.sheetType) === 'GeM' ? 'gem' : 'non_gem',
          msmeExemption: str(t.msmeExemption),
          startupExemption: str(t.startupExemption),
          quantity: str(t.quantity),
          eligibilityCriteria: str(t.eligibilityCriteria, 60_000),
          checklist: str(t.checklist, 60_000),
          documentsRequired: str(t.documentRequiredFromSeller, 60_000),
          sourceFile: str(t.sourceFile),
          stageId: current.id,
          previousStageId: previous,
          stageChangedAt: updatedAt,
          // The old expiredAt: set when the deadline was missed, kept after an admin reopened it.
          deadlineMissedAt: t.expiredAt
            ? timeOf(t.expiredAt, updatedAt)
            : stageKey === 'not-bidded'
              ? updatedAt
              : null,
          assignedAgentId: agentId,
          assignedAt: agentId ? timeOf(t.agentAssignedAt, updatedAt) : null,
          biddingCompanyId: companyId,
          awardAmount: won ? num(t.winningAmount) || num(t.contractValue) || null : null,
          awardNumber: str(t.awardNumber, 100),
          createdAt,
          updatedAt,
        })
        tenderMap.set(String(t.id), id)
        report.tenders++
        report.byStage[current.label] = (report.byStage[current.label] ?? 0) + 1

        // The old system kept notes per step, not a history: rebuild one from them.
        type Entry = { key: string; at: Date; comment: string; by: string | null }
        const entries: Entry[] = []
        const note = (key: string, text: unknown, at: unknown, by: unknown, prefix = '') => {
          const comment = str(text, 2000)
          if (comment)
            entries.push({
              key,
              at: timeOf(at, updatedAt),
              comment: prefix + comment,
              by: mapUser(by),
            })
        }
        note('assigned', t.assignmentNotes, t.agentAssignedAt, null)
        note('price-review', t.priceReviewNotes, t.priceReviewedAt, t.priceReviewedBy)
        note('criteria-review', t.criteriaReviewNotes, t.criteriaReviewedAt, t.criteriaReviewedBy)
        note(
          'submitted',
          t.agentSubmissionNotes,
          t.agentSubmissionDate ?? t.bidSubmissionDate,
          t.assignedToAgent,
        )
        note('under-query', t.underQueryNotes, t.underQueryReviewedAt, t.underQueryReviewedBy)
        note('won', t.wonNotes, t.wonReviewedAt ?? t.wonAt, t.wonReviewedBy)
        note('lost', t.lostNotes, t.lostReviewedAt ?? t.lostAt, t.lostReviewedBy)
        note('rejected', t.rejectionComment, t.rejectedAt, t.rejectedBy)
        note('completed', t.tenderCompletedNotes, t.engineerCompletionDate, null)
        entries.sort((a, b) => a.at.getTime() - b.at.getTime())

        const history: (typeof tenderStageHistory.$inferInsert)[] = [
          {
            organizationId: orgId,
            tenderId: id,
            fromStageId: null,
            toStageId: stage('new').id,
            comment: 'Added in the previous system',
            changedBy: null,
            createdAt,
          },
        ]
        let last = stage('new').id
        for (const e of entries) {
          const to = stageByKey.get(e.key)?.id ?? current.id
          history.push({
            organizationId: orgId,
            tenderId: id,
            fromStageId: last,
            toStageId: to,
            comment: e.comment,
            changedBy: e.by,
            createdAt: e.at,
          })
          last = to
        }
        // General notes (including the old system's automatic ones) go on the final entry,
        // not on a stage they may not belong to.
        const generalNotes = str(t.agentNotes, 1500)
        // Old timestamps often coincide (e.g. won date = last update): keep this entry last.
        const lastAt = history.at(-1)!.createdAt as Date
        const finalAt = new Date(Math.max(updatedAt.getTime(), lastAt.getTime() + 1))
        if (last !== current.id || generalNotes) {
          history.push({
            organizationId: orgId,
            tenderId: id,
            fromStageId: last,
            toStageId: current.id,
            comment: generalNotes
              ? `Carried over from the previous system. Notes: ${generalNotes}`
              : 'Stage carried over from the previous system',
            changedBy: null,
            createdAt: finalAt,
          })
        }
        await tx.insert(tenderStageHistory).values(history)
        report.historyEntries += history.length

        // Compliance PDFs uploaded in the old system become tender documents.
        for (const f of json<
          { filename?: string; originalName?: string; url?: string; uploadedAt?: string }[]
        >(t.compliance_file, [])) {
          const path = findUpload(f.url ?? (f.filename ? `compliance/${f.filename}` : null))
          if (!path) {
            report.files.missing.push(
              `Compliance PDF ${f.originalName ?? f.filename ?? '?'} (tender ${ref})`,
            )
            continue
          }
          report.files.tenderDocuments++
          if (!opts.dryRun) {
            await storeFile(tx, {
              organizationId: orgId,
              kind: 'tender_document',
              bytes: await readFile(path),
              originalName: f.originalName ?? f.filename ?? basename(path),
              title: `Compliance PDF (previous system)`,
              tenderId: id,
            })
          }
        }
      }

      // ---- Installation reports -------------------------------------------------
      const tendersWithReport = new Set<string>()
      for (const r of oldReports) {
        const tenderId = tenderMap.get(String(r.tenderId))
        if (!tenderId) {
          report.warnings.push(
            `Installation report ${String(r.id)} points to a missing tender; skipped.`,
          )
          continue
        }
        if (tendersWithReport.has(tenderId)) {
          report.warnings.push(
            `Tender ${tenderId} had more than one installation report; only the first was kept.`,
          )
          continue
        }
        tendersWithReport.add(tenderId)
        const reportId = crypto.randomUUID()
        const reportDate = dateOf(r.reportDate)
        await tx.insert(installationReports).values({
          id: reportId,
          organizationId: orgId,
          tenderId,
          biddingCompanyId: r.selectedCompanyProfile
            ? (companyMap.get(String(r.selectedCompanyProfile)) ?? null)
            : null,
          poNumber: str(r.purchaseOrderNumber, 100),
          poDate: dateOf(r.poDate),
          reportDate,
          customerName: str(r.customerName, 200),
          customerAddress: str(r.customerAddress, 2000),
          stateOffice: str(r.stateOffice, 200),
          contactPersonName: str(r.contactPersonName, 120),
          contactPersonDesignation: str(r.contactPersonDesignation, 120),
          contactPersonPhone: str(r.contactPersonNumber, 30),
          department: str(r.department, 200),
          createdAt: timeOf(r.createdAt, new Date()),
        })
        report.installation.reports++

        type OldCard = {
          title?: string
          itemName?: string
          warrantyYears?: number
          warrantyMonths?: number
          quantity?: number
          visibleFields?: Record<string, boolean>
          itemGroups?: { fieldValues?: Record<string, string> }[]
        }
        type OldConsignee = {
          name?: string
          designation?: string
          number?: string
          emailId?: string
          faxNumber?: string
          assignedEngineerId?: string
          engineerStatus?: string
          callAlignedDate?: string
          reportCards?: OldCard[]
          documents?: { fileName?: string; fileKey?: string; fileUrl?: string }[]
        }
        for (const [ci, c] of json<OldConsignee[]>(r.consignees, []).entries()) {
          const consigneeId = crypto.randomUUID()
          await tx.insert(installationConsignees).values({
            id: consigneeId,
            organizationId: orgId,
            reportId,
            name: str(c.name, 200) ?? `Consignee ${ci + 1}`,
            designation: str(c.designation, 120),
            phone: str(c.number, 30),
            email: str(c.emailId, 254),
            fax: str(c.faxNumber, 30),
            engineerId: mapUser(c.assignedEngineerId),
            status: ENGINEER_STATUS_MAP[c.engineerStatus ?? ''] ?? 'assigned',
            callAlignedDate: dateOf(c.callAlignedDate),
            sortOrder: ci,
          })
          report.installation.consignees++
          for (const [ki, card] of (c.reportCards ?? []).entries()) {
            // One old "Report Template" = one template here, with its own serial type.
            const groups = card.itemGroups ?? []
            const vf = card.visibleFields ?? {}
            const split =
              vf.monitorSerialNumber === true ||
              vf.cpuSerialNumber === true ||
              groups.some(
                (g) => g.fieldValues?.monitorSerialNumber || g.fieldValues?.cpuSerialNumber,
              )
            const itemId = crypto.randomUUID()
            const itemName = str(card.itemName, 500) ?? str(card.title, 500) ?? 'Item'
            const warranty = num(card.warrantyYears) * 12 + num(card.warrantyMonths)
            await tx.insert(installationItems).values({
              id: itemId,
              organizationId: orgId,
              consigneeId,
              itemName,
              serialType: split ? 'split' : 'common',
              warrantyMonths: warranty,
              // The old quantity is kept, so empty rows still show (and print) as rows to fill.
              quantity: Math.max(1, Math.min(500, num(card.quantity) || groups.length)),
              sortOrder: ki,
            })
            report.installation.templates++
            let order = 0
            for (const g of groups) {
              const fv = g.fieldValues ?? {}
              const installed = String(fv.installationStatus ?? '').toLowerCase()
              const serialNumber = str(fv.serialNumberCommon, 100)
              const monitorSerial = str(fv.monitorSerialNumber, 100)
              const cpuSerial = str(fv.cpuSerialNumber, 100)
              const remarks = str(fv.remarks, 500)
              const makeModel = str(fv.makeAndModel, 200)
              // Rows with nothing filled in were placeholders: not imported as units.
              if (
                !serialNumber &&
                !monitorSerial &&
                !cpuSerial &&
                !remarks &&
                !makeModel &&
                installed !== 'yes'
              ) {
                report.installation.emptyRows++
                continue
              }
              const installStatus: InstallStatus =
                installed === 'yes' ? 'installed' : installed === 'no' ? 'not_installed' : 'pending'
              await tx.insert(installedAssets).values({
                organizationId: orgId,
                consigneeId,
                itemId,
                tenderId,
                itemName,
                makeModel,
                serialNumber,
                monitorSerial,
                cpuSerial,
                installStatus,
                warrantyMonths: warranty,
                remarks,
                sortOrder: order++,
              })
              report.installation.units++
            }
          }
          for (const d of c.documents ?? []) {
            const path = findUpload(d.fileKey ?? d.fileUrl)
            if (!path) {
              report.files.missing.push(`Consignee document ${d.fileName ?? '?'} (${c.name ?? ''})`)
              continue
            }
            report.files.consigneeDocuments++
            if (!opts.dryRun) {
              await storeFile(tx, {
                organizationId: orgId,
                kind: 'consignee_document',
                bytes: await readFile(path),
                originalName: d.fileName ?? basename(path),
                tenderId,
                consigneeId,
              })
            }
          }
        }
      }

      // Engineers assigned in the old system without an installation report keep their assignment.
      for (const t of oldTenders) {
        const tenderId = tenderMap.get(String(t.id))
        const engineerId = mapUser(t.assignedToEngineer)
        if (!tenderId || !engineerId || tendersWithReport.has(tenderId)) continue
        const reportId = crypto.randomUUID()
        await tx
          .insert(installationReports)
          .values({ id: reportId, organizationId: orgId, tenderId })
        await tx.insert(installationConsignees).values({
          organizationId: orgId,
          reportId,
          name: str(t.organization, 200) ?? 'Main site',
          engineerId,
          status: ENGINEER_STATUS_MAP[String(t.engineerStatus ?? '')] ?? 'assigned',
        })
        report.installation.reports++
        report.installation.consignees++
      }

      // ---- Document library -------------------------------------------------------
      for (const d of oldLibrary) {
        const path = findUpload(d.filePath ?? d.file_path ?? d.fileUrl ?? d.filename)
        const title = str(d.title, 200) ?? str(d.originalName, 200) ?? 'Document'
        if (!path) {
          report.files.missing.push(`Library document "${title}"`)
          continue
        }
        report.files.library++
        if (!opts.dryRun) {
          await storeFile(tx, {
            organizationId: orgId,
            kind: 'library',
            bytes: await readFile(path),
            originalName: basename(path),
            title,
            uploadedBy: mapUser(d.uploadedBy),
          })
        }
      }
      if (!opts.uploadsDir) report.warnings.push('No --uploads folder given: no files were copied.')

      await writeAudit(tx, {
        organizationId: orgId,
        actorType: 'system',
        actorId: null,
        action: 'organization.migrated',
        entity: 'organization',
        entityId: orgId,
        details: { source: opts.source, tenders: report.tenders, users: report.users.migrated },
      })

      if (opts.dryRun) throw new DryRunRollback()
    })
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err
  }
  return report
}

export function formatReport(r: MigrationReport): string {
  const lines = [
    r.dryRun ? 'DRY RUN: nothing was saved.' : 'Migration finished.',
    `Workspace: ${r.organization.slug}${r.organization.created ? ' (created)' : ''}`,
    `Users: ${r.users.migrated} migrated (${r.users.invited} need an invitation, ${r.users.suspended} suspended), ${r.users.skipped} skipped`,
    `Bidding companies: ${r.companies}`,
    `Tenders: ${r.tenders}`,
    ...Object.entries(r.byStage)
      .sort((a, b) => b[1] - a[1])
      .map(([stage, n]) => `  ${stage}: ${n}`),
    `Stage history entries: ${r.historyEntries}`,
    `Installation reports: ${r.installation.reports} (${r.installation.consignees} consignees, ${r.installation.templates} report templates, ${r.installation.units} units; ${r.installation.emptyRows} empty rows skipped)`,
    `Files: ${r.files.library} library, ${r.files.tenderDocuments} tender documents, ${r.files.consigneeDocuments} consignee documents, ${r.files.companyImages} company images${r.dryRun ? ' (checked, not copied)' : ''}`,
  ]
  if (r.files.missing.length)
    lines.push(
      `Missing files (${r.files.missing.length}):`,
      ...r.files.missing.map((m) => `  - ${m}`),
    )
  if (r.warnings.length) lines.push('Notes:', ...r.warnings.map((w) => `  - ${w}`))
  return lines.join('\n')
}

// Run directly: npm run migrate:tms -- --source … --slug …
if (process.argv[1] && /migrate-from-tms\.(ts|js)$/.test(process.argv[1])) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      slug: { type: 'string' },
      name: { type: 'string' },
      plan: { type: 'string' },
      timezone: { type: 'string' },
      uploads: { type: 'string' },
      'company-images': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  })
  try {
    if (!values.source || !values.slug) {
      console.error(
        'Usage: npm run migrate:tms -- --source <old db> --slug <subdomain> [--name "Client"] [--uploads <dir>] [--company-images <dir>] [--dry-run]',
      )
      process.exitCode = 1
    } else {
      const r = await migrateFromTms({
        source: values.source,
        slug: values.slug,
        name: values.name,
        planCode: values.plan,
        timezone: values.timezone,
        uploadsDir: values.uploads ? resolve(values.uploads) : undefined,
        companyImagesDir: values['company-images'] ? resolve(values['company-images']) : undefined,
        dryRun: values['dry-run'],
      })
      console.log(formatReport(r))
    }
  } catch (err) {
    console.error(`Migration failed, nothing was saved: ${(err as Error).message}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
