import {
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import {
  agentLocked,
  allowedNextStages,
  deadlineLocked,
  canSeeInstallation,
  PERMISSIONS,
  STAGE_TYPES,
  type Assignee,
  type AssignTenderInput,
  type BulkTenderActionInput,
  type BulkTenderResult,
  type DashboardData,
  type MoveTenderInput,
  type StageCount,
  type StageHistoryEntry,
  type StageType,
  type TenderDetail,
  type TenderSortField,
  type TenderPage,
  type TenderConsigneeSummary,
  type TenderSummary,
  type UpdateTenderInput,
  tenderListQuerySchema,
} from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  importRuns,
  installationConsignees,
  installationReports,
  roles,
  tenders,
  tenderStageHistory,
  users,
  workflowStages,
  type Tender,
  type WorkflowStage,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { addDays, todayIn } from '../../lib/dates'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { notify } from '../notifications/service'
import { emailUser, tenderAssignedEmail } from '../notifications/emails'
import { firstStageOfType, getStage, listStages } from '../workflow/service'

export type ListQuery = z.output<typeof tenderListQuerySchema>

const agents = alias(users, 'agent')

/**
 * Which tenders the user may see. Users with "view all" see every tender of
 * their client; others only the tenders assigned to them.
 */
export function visibilityScope(auth: TenantAuth): SQL | undefined {
  if (auth.permissions.has(PERMISSIONS.TENDER_VIEW_ALL)) return undefined
  if (auth.permissions.has(PERMISSIONS.TENDER_VIEW_ASSIGNED)) {
    // Assigned as the bid agent, or as the engineer on one of its installation consignees.
    const asEngineer = db
      .select({ tenderId: installationReports.tenderId })
      .from(installationConsignees)
      .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
      .where(
        orgWhere(
          installationConsignees,
          auth.org.id,
          eq(installationConsignees.engineerId, auth.user.id),
        ),
      )
    return or(eq(tenders.assignedAgentId, auth.user.id), inArray(tenders.id, asEngineer))
  }
  throw forbidden()
}

const summaryColumns = {
  id: tenders.id,
  referenceNo: tenders.referenceNo,
  sourceTenderId: tenders.sourceTenderId,
  title: tenders.title,
  buyerOrganization: tenders.buyerOrganization,
  location: tenders.location,
  estimatedCost: tenders.estimatedCost,
  emd: tenders.emd,
  deadline: tenders.deadline,
  sheetType: tenders.sheetType,
  briefUrl: tenders.briefUrl,
  excelUpdatedAt: tenders.excelUpdatedAt,
  deadlineMissedAt: tenders.deadlineMissedAt,
  createdAt: tenders.createdAt,
  assignedAt: tenders.assignedAt,
  stageChangedAt: tenders.stageChangedAt,
  stageId: workflowStages.id,
  stageLabel: workflowStages.label,
  stageType: workflowStages.type,
  stageColor: workflowStages.color,
  agentId: agents.id,
  agentName: agents.name,
  agentEmail: agents.email,
  agentPhone: agents.phone,
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number]

function toSummary(r: SummaryRow): TenderSummary {
  return {
    id: r.id,
    referenceNo: r.referenceNo,
    sourceTenderId: r.sourceTenderId,
    title: r.title,
    buyerOrganization: r.buyerOrganization,
    location: r.location,
    estimatedCost: Number(r.estimatedCost),
    emd: Number(r.emd),
    deadline: r.deadline,
    sheetType: r.sheetType,
    briefUrl: r.briefUrl,
    stage: { id: r.stageId!, label: r.stageLabel!, type: r.stageType!, color: r.stageColor! },
    assignedAgent: r.agentId
      ? { id: r.agentId, name: r.agentName ?? '', email: r.agentEmail ?? '', phone: r.agentPhone }
      : null,
    assignedAt: r.assignedAt ? r.assignedAt.toISOString() : null,
    stageChangedAt: r.stageChangedAt.toISOString(),
    excelUpdatedAt: r.excelUpdatedAt ? r.excelUpdatedAt.toISOString() : null,
    reopenedAfterDeadline: r.deadlineMissedAt !== null,
    createdAt: r.createdAt.toISOString(),
    stageComment: null,
    consignees: [],
  }
}

/** Runs `fn` on slices of ids, so big exports don't build one huge IN (...) list. */
async function inChunks<R>(ids: string[], fn: (slice: string[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < ids.length; i += 1000) out.push(...(await fn(ids.slice(i, i + 1000))))
  return out
}

type WithStage = { id: string; stage: { id: string }; stageComment: string | null }
type WithConsignees = { id: string; consignees: TenderConsigneeSummary[] }

/**
 * Adds the comment of each tender's move into its current stage, shown on
 * lists such as Completed ("Completion Notes", as in the old TMS).
 */
export async function withStageComments<T extends WithStage>(
  auth: TenantAuth,
  items: T[],
): Promise<T[]> {
  if (!items.length) return items
  const rows = await inChunks(
    items.map((t) => t.id),
    (ids) =>
      db
        .select({
          tenderId: tenderStageHistory.tenderId,
          toStageId: tenderStageHistory.toStageId,
          comment: tenderStageHistory.comment,
        })
        .from(tenderStageHistory)
        .where(orgWhere(tenderStageHistory, auth.org.id, inArray(tenderStageHistory.tenderId, ids)))
        .orderBy(desc(tenderStageHistory.createdAt)),
  )
  // Newest first, so the first match per tender and stage is the latest move.
  const latest = new Map<string, string | null>()
  for (const r of rows) {
    const key = `${r.tenderId}:${r.toStageId}`
    if (!latest.has(key)) latest.set(key, r.comment)
  }
  for (const t of items) t.stageComment = latest.get(`${t.id}:${t.stage.id}`) ?? null
  return items
}

/**
 * Adds each tender's installation consignees and their engineers (the old
 * "Engineer Tenders" columns). Engineers only see their own consignees.
 */
export async function withConsignees<T extends WithConsignees>(
  auth: TenantAuth,
  items: T[],
): Promise<T[]> {
  // Roles the admin hides installation reports from don't see consignees either.
  if (!items.length || !canSeeInstallation(auth.permissions)) return items
  const engineers = alias(users, 'consignee_engineer')
  const ownOnly =
    !auth.permissions.has(PERMISSIONS.INSTALLATION_MANAGE) &&
    auth.permissions.has(PERMISSIONS.INSTALLATION_OWN)
  const rows = await inChunks(
    items.map((t) => t.id),
    (ids) =>
      db
        .select({
          tenderId: installationReports.tenderId,
          id: installationConsignees.id,
          name: installationConsignees.name,
          designation: installationConsignees.designation,
          engineerId: engineers.id,
          engineerName: engineers.name,
          engineerEmail: engineers.email,
          engineerPhone: engineers.phone,
        })
        .from(installationConsignees)
        .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
        .leftJoin(engineers, eq(engineers.id, installationConsignees.engineerId))
        .where(
          orgWhere(
            installationConsignees,
            auth.org.id,
            inArray(installationReports.tenderId, ids),
            ownOnly ? eq(installationConsignees.engineerId, auth.user.id) : undefined,
          ),
        )
        .orderBy(asc(installationConsignees.sortOrder)),
  )
  const byTender = new Map<string, TenderConsigneeSummary[]>()
  for (const r of rows) {
    const list = byTender.get(r.tenderId) ?? []
    list.push({
      id: r.id,
      name: r.name,
      designation: r.designation,
      engineer: r.engineerId
        ? {
            id: r.engineerId,
            name: r.engineerName ?? '',
            email: r.engineerEmail ?? '',
            phone: r.engineerPhone,
          }
        : null,
    })
    byTender.set(r.tenderId, list)
  }
  for (const t of items) t.consignees = byTender.get(t.id) ?? []
  return items
}

function selectSummaries(conn: DbOrTx) {
  return conn
    .select(summaryColumns)
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .leftJoin(agents, eq(agents.id, tenders.assignedAgentId))
}

/** Escapes % and _ so a search for "50%" means the characters, not a wildcard. */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** The filters of the tender list, shared with the Excel export so both always match. */
export function tenderListWhere(auth: TenantAuth, query: ListQuery): SQL {
  const orgId = auth.org.id
  let assigned: SQL | undefined
  if (query.assignedTo === 'me') assigned = eq(tenders.assignedAgentId, auth.user.id)
  else if (query.assignedTo === 'none') assigned = isNull(tenders.assignedAgentId)
  else if (query.assignedTo) assigned = eq(tenders.assignedAgentId, query.assignedTo)

  const where = orgWhere(
    tenders,
    orgId,
    visibilityScope(auth),
    query.stageId ? eq(tenders.stageId, query.stageId) : undefined,
    query.stageType?.length ? inArray(workflowStages.type, query.stageType) : undefined,
    assigned,
    query.q
      ? or(
          like(tenders.referenceNo, likeTerm(query.q)),
          like(tenders.title, likeTerm(query.q)),
          like(tenders.buyerOrganization, likeTerm(query.q)),
          like(tenders.sourceTenderId, likeTerm(query.q)),
          like(tenders.location, likeTerm(query.q)),
          // A consignee or its engineer, as in the old Engineer Tenders search.
          inArray(
            tenders.id,
            db
              .select({ id: installationReports.tenderId })
              .from(installationConsignees)
              .innerJoin(
                installationReports,
                eq(installationReports.id, installationConsignees.reportId),
              )
              .leftJoin(users, eq(users.id, installationConsignees.engineerId))
              .where(
                orgWhere(
                  installationConsignees,
                  orgId,
                  or(
                    like(installationConsignees.name, likeTerm(query.q)),
                    like(users.name, likeTerm(query.q)),
                  ),
                ),
              ),
          ),
        )
      : undefined,
  )
  return where
}

const SORT_COLUMNS: Record<TenderSortField, AnyMySqlColumn> = {
  deadline: tenders.deadline,
  referenceNo: tenders.referenceNo,
  title: tenders.title,
  buyerOrganization: tenders.buyerOrganization,
  location: tenders.location,
  estimatedCost: tenders.estimatedCost,
  emd: tenders.emd,
  sheetType: tenders.sheetType,
  stage: workflowStages.sortOrder,
  assignedAgent: agents.name,
  assignedAt: tenders.assignedAt,
  stageChangedAt: tenders.stageChangedAt,
  createdAt: tenders.createdAt,
}

/** "deadline" sorts low to high, "-deadline" high to low; ties go by deadline, then reference. */
export function tenderListOrder(sort: ListQuery['sort']) {
  const field = (sort.startsWith('-') ? sort.slice(1) : sort) as TenderSortField
  const dir = sort.startsWith('-') ? desc : asc
  const order = [dir(SORT_COLUMNS[field])]
  if (field !== 'deadline') order.push(asc(tenders.deadline))
  order.push(asc(tenders.referenceNo))
  return order
}

export async function listTenders(auth: TenantAuth, query: ListQuery): Promise<TenderPage> {
  const where = tenderListWhere(auth, query)
  const order = tenderListOrder(query.sort)

  const [totalRow] = await db
    .select({ n: count() })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .where(where)
  const rows = await selectSummaries(db)
    .where(where)
    .orderBy(...order)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  return {
    items: await withStageComments(auth, await withConsignees(auth, rows.map(toSummary))),
    total: totalRow?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  }
}

/** Number of visible tenders in each stage, for the sidebar. */
export async function stageCounts(auth: TenantAuth): Promise<StageCount[]> {
  const rows = await db
    .select({ stageId: tenders.stageId, count: count() })
    .from(tenders)
    .where(orgWhere(tenders, auth.org.id, visibilityScope(auth)))
    .groupBy(tenders.stageId)
  return rows
}

/** Loads a tender the user may see, or 404 (never 403, so IDs of hidden tenders are not confirmed). */
export async function getVisibleTender(
  conn: DbOrTx,
  auth: TenantAuth,
  id: string,
): Promise<Tender> {
  const [tender] = await conn
    .select()
    .from(tenders)
    .where(orgWhere(tenders, auth.org.id, eq(tenders.id, id), visibilityScope(auth)))
    .limit(1)
  if (!tender) throw notFound('TENDER_NOT_FOUND', 'Tender not found')
  return tender
}

const fromStages = alias(workflowStages, 'from_stage')
const toStages = alias(workflowStages, 'to_stage')

async function getHistory(
  conn: DbOrTx,
  orgId: string,
  tenderId: string,
): Promise<StageHistoryEntry[]> {
  const rows = await conn
    .select({
      id: tenderStageHistory.id,
      fromId: fromStages.id,
      fromLabel: fromStages.label,
      toId: toStages.id,
      toLabel: toStages.label,
      comment: tenderStageHistory.comment,
      userId: users.id,
      userName: users.name,
      at: tenderStageHistory.createdAt,
    })
    .from(tenderStageHistory)
    .innerJoin(toStages, eq(toStages.id, tenderStageHistory.toStageId))
    .leftJoin(fromStages, eq(fromStages.id, tenderStageHistory.fromStageId))
    .leftJoin(users, eq(users.id, tenderStageHistory.changedBy))
    .where(orgWhere(tenderStageHistory, orgId, eq(tenderStageHistory.tenderId, tenderId)))
    .orderBy(desc(tenderStageHistory.createdAt))
  return rows.map((r) => ({
    id: r.id,
    from: r.fromId ? { id: r.fromId, label: r.fromLabel ?? '' } : null,
    to: { id: r.toId, label: r.toLabel },
    comment: r.comment,
    changedBy: r.userId ? { id: r.userId, name: r.userName ?? '' } : null,
    at: r.at.toISOString(),
  }))
}

export async function getTenderDetail(
  conn: DbOrTx,
  auth: TenantAuth,
  id: string,
): Promise<TenderDetail> {
  const t = await getVisibleTender(conn, auth, id)
  const [summary] = await selectSummaries(conn)
    .where(orgWhere(tenders, auth.org.id, eq(tenders.id, t.id)))
    .limit(1)
  const [company] = t.biddingCompanyId
    ? await conn
        .select({ id: biddingCompanies.id, name: biddingCompanies.name })
        .from(biddingCompanies)
        .where(orgWhere(biddingCompanies, auth.org.id, eq(biddingCompanies.id, t.biddingCompanyId)))
        .limit(1)
    : []
  return {
    ...toSummary(summary!),
    documentFee: Number(t.documentFee),
    msmeExemption: t.msmeExemption,
    startupExemption: t.startupExemption,
    quantity: t.quantity,
    eligibilityCriteria: t.eligibilityCriteria,
    checklist: t.checklist,
    documentsRequired: t.documentsRequired,
    awardAmount: t.awardAmount === null ? null : Number(t.awardAmount),
    awardNumber: t.awardNumber,
    biddingCompany: company ?? null,
    sourceFile: t.sourceFile,
    excelUpdate: t.excelUpdate ?? null,
    history: await getHistory(conn, auth.org.id, t.id),
  }
}

/** Checks that tenders may be moved into the stage, and returns the stage. */
async function moveTarget(tx: DbOrTx, orgId: string, stageId: string): Promise<WorkflowStage> {
  const target = await getStage(tx, orgId, stageId).catch(() => {
    throw badRequest('STAGE_NOT_FOUND', 'That stage does not exist in this workspace')
  })
  if (!target.isVisible) throw badRequest('STAGE_HIDDEN', 'That stage is hidden')
  return target
}

/**
 * Checks the client's move rules (who may move a tender from its stage to
 * which stages), and the deadline rule: after the deadline, a tender still
 * being prepared can only go to the missed-deadline stage.
 */
function assertMoveAllowed(
  auth: TenantAuth,
  stages: WorkflowStage[],
  tender: Tender,
  target: WorkflowStage,
) {
  const from = stages.find((s) => s.id === tender.stageId)
  if (!from) return
  const locked = deadlineLocked(
    from,
    { deadline: tender.deadline, reopenedAfterDeadline: tender.deadlineMissedAt !== null },
    todayIn(auth.org.timezone),
  )
  const allowed = allowedNextStages(stages.map(movable), movable(from), {
    manager: auth.permissions.has(PERMISSIONS.TENDER_ASSIGN),
    locked,
  })
  if (allowed.some((s) => s.id === target.id)) return
  if (locked) {
    const missed = stages.find((s) => s.systemRole === 'missed_deadline')
    throw badRequest(
      'DEADLINE_PASSED',
      `The deadline of ${tender.referenceNo} has passed, so it can only be moved to "${missed?.label ?? 'Not bidded'}"`,
    )
  }
  throw badRequest(
    'MOVE_NOT_ALLOWED',
    `${tender.referenceNo} can't be moved from "${from.label}" to "${target.label}"`,
  )
}

const movable = (s: WorkflowStage) => ({
  ...s,
  agentNext: s.agentNext ?? null,
  managerNext: s.managerNext ?? null,
})

/** The comment to store for a move, following the stage's comment setting. */
function moveComment(target: WorkflowStage, raw: string | undefined): string | null {
  const comment = target.commentMode === 'off' ? null : raw?.trim() || null
  if (target.commentMode === 'required' && !comment) {
    throw badRequest('VALIDATION_ERROR', 'A comment is required for this stage', [
      { field: 'comment', message: `Add a comment to move the tender to "${target.label}"` },
    ])
  }
  return comment
}

/** Moves one tender (already loaded and checked) and records it in the history. */
async function applyMove(
  tx: DbOrTx,
  auth: TenantAuth,
  tender: Tender,
  target: WorkflowStage,
  comment: string | null,
  award?: { awardAmount: number; awardNumber: string | null },
) {
  const orgId = auth.org.id
  await tx
    .update(tenders)
    .set({
      stageId: target.id,
      stageChangedAt: new Date(),
      // A manual move ends any pending "restore after missed deadline".
      previousStageId: null,
      ...(target.systemRole === 'missed_deadline' &&
        !tender.deadlineMissedAt && { deadlineMissedAt: new Date() }),
      ...award,
    })
    .where(orgWhere(tenders, orgId, eq(tenders.id, tender.id)))

  await tx.insert(tenderStageHistory).values({
    organizationId: orgId,
    tenderId: tender.id,
    fromStageId: tender.stageId,
    toStageId: target.id,
    comment,
    changedBy: auth.user.id,
  })
}

/**
 * Moves a tender into another stage. The stage's comment setting decides
 * whether a comment is required, allowed or ignored; a "won" stage also
 * needs the award amount.
 */
export async function moveTender(auth: TenantAuth, id: string, input: MoveTenderInput) {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const tender = await getVisibleTender(tx, auth, id)
    const target = await moveTarget(tx, orgId, input.stageId)
    if (target.id === tender.stageId)
      throw conflict('SAME_STAGE', 'The tender is already in this stage')
    assertMoveAllowed(auth, await listStages(tx, orgId), tender, target)
    const comment = moveComment(target, input.comment)
    if (target.type === 'won' && input.awardAmount === undefined) {
      throw badRequest('VALIDATION_ERROR', 'Enter the award amount', [
        { field: 'awardAmount', message: 'Enter the award amount' },
      ])
    }

    await applyMove(
      tx,
      auth,
      tender,
      target,
      comment,
      target.type === 'won'
        ? { awardAmount: input.awardAmount!, awardNumber: input.awardNumber || null }
        : undefined,
    )
    // Tell the person working on the tender when someone else moves it.
    if (tender.assignedAgentId && tender.assignedAgentId !== auth.user.id) {
      await notify(tx, {
        organizationId: orgId,
        userId: tender.assignedAgentId,
        type: 'tender.moved',
        title: `Moved to ${target.label}`,
        body: `${tender.referenceNo} · by ${auth.user.name}${comment ? `: ${comment}` : ''}`,
        link: `/tenders/${tender.id}`,
      })
    }
    return getTenderDetail(tx, auth, tender.id)
  })
}

/** Sets the company the tender is bid under (its letterhead is used for compliance letters). */
export async function updateTender(auth: TenantAuth, id: string, input: UpdateTenderInput) {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const tender = await getVisibleTender(tx, auth, id)
    if (input.biddingCompanyId) {
      const [company] = await tx
        .select({ isActive: biddingCompanies.isActive })
        .from(biddingCompanies)
        .where(orgWhere(biddingCompanies, orgId, eq(biddingCompanies.id, input.biddingCompanyId)))
        .limit(1)
      if (!company)
        throw badRequest('COMPANY_NOT_FOUND', 'That company does not exist in this workspace')
      if (!company.isActive) throw badRequest('COMPANY_INACTIVE', 'That company is marked inactive')
    }
    await tx
      .update(tenders)
      .set({ biddingCompanyId: input.biddingCompanyId })
      .where(orgWhere(tenders, orgId, eq(tenders.id, tender.id)))
    return getTenderDetail(tx, auth, tender.id)
  })
}

/** Checks that the user can be given tenders, and returns their name. */
async function assigneeName(tx: DbOrTx, orgId: string, agentId: string | null) {
  if (!agentId) return null
  const [agent] = await tx
    .select({ name: users.name })
    .from(users)
    .where(orgWhere(users, orgId, eq(users.id, agentId), eq(users.status, 'active')))
    .limit(1)
  if (!agent)
    throw badRequest('USER_NOT_FOUND', 'That user is not an active member of this workspace')
  return agent.name
}

/**
 * Sets a tender's assignee. A tender still in an open stage moves to the
 * first "preparing" stage, as in the original TMS.
 */
async function applyAssign(
  tx: DbOrTx,
  auth: TenantAuth,
  tender: Tender,
  agentId: string | null,
  agentName: string | null,
  note?: string,
) {
  const orgId = auth.org.id
  const current = await getStage(tx, orgId, tender.stageId)
  if (agentLocked(current)) {
    throw badRequest(
      'AGENT_LOCKED',
      `${tender.referenceNo} is in ${current.label}: its agent can no longer be changed. Move it back to reopen it first.`,
    )
  }
  const back = current.type === 'open' || current.key === 'rejected'
  const next = agentId && back ? await firstStageOfType(tx, orgId, 'preparing') : null

  await tx
    .update(tenders)
    .set({
      assignedAgentId: agentId,
      assignedAt: agentId ? new Date() : null,
      ...(next && { stageId: next.id, stageChangedAt: new Date() }),
    })
    .where(orgWhere(tenders, orgId, eq(tenders.id, tender.id)))

  if (next) {
    await tx.insert(tenderStageHistory).values({
      organizationId: orgId,
      tenderId: tender.id,
      fromStageId: current.id,
      toStageId: next.id,
      comment: `Assigned to ${agentName}${note ? `: ${note}` : ''}`,
      changedBy: auth.user.id,
    })
  }
  await writeAudit(tx, {
    organizationId: orgId,
    actorType: 'user',
    actorId: auth.user.id,
    action: agentId ? 'tender.assigned' : 'tender.unassigned',
    entity: 'tender',
    entityId: tender.id,
    details: { agentId, previousAgentId: tender.assignedAgentId, ...(note && { note }) },
  })
}

/** Assigns a tender to a team member, or removes the assignment. */
export async function assignTender(auth: TenantAuth, id: string, input: AssignTenderInput) {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const tender = await getVisibleTender(tx, auth, id)
    const agentName = await assigneeName(tx, orgId, input.agentId)
    await applyAssign(tx, auth, tender, input.agentId, agentName, input.note)
    if (
      input.agentId &&
      input.agentId !== auth.user.id &&
      input.agentId !== tender.assignedAgentId
    ) {
      await notify(tx, {
        organizationId: orgId,
        userId: input.agentId,
        type: 'tender.assigned',
        title: 'Tender assigned to you',
        body: `${tender.referenceNo} · ${tender.title}${noteFrom(auth, input.note)}`,
        link: `/tenders/${tender.id}`,
      })
      await emailUser(
        tx,
        auth.org,
        input.agentId,
        'tender_assigned',
        tenderAssignedEmail([tender], auth.user.name, input.note),
      )
    }
    return getTenderDetail(tx, auth, tender.id)
  })
}

/** A note added when assigning, as shown at the end of the notification. */
const noteFrom = (auth: TenantAuth, note?: string) =>
  note ? ` — Note from ${auth.user.name}: ${note}` : ''

const refList = (list: Tender[]) =>
  list
    .slice(0, 5)
    .map((t) => t.referenceNo)
    .join(', ') + (list.length > 5 ? ` and ${list.length - 5} more` : '')

/**
 * Moves or assigns several tenders in one go, all or nothing. Each tender is
 * checked and recorded exactly as a single change would be; tenders already
 * in that stage (or with that assignee) are left alone. Each person gets one
 * notification for the whole batch instead of one per tender.
 */
export async function bulkTenderAction(
  auth: TenantAuth,
  input: BulkTenderActionInput,
): Promise<BulkTenderResult> {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(tenders)
      .where(orgWhere(tenders, orgId, inArray(tenders.id, input.ids), visibilityScope(auth)))
      .for('update')
    // The same answer as for a single tender the user cannot see.
    if (rows.length !== input.ids.length)
      throw notFound('TENDER_NOT_FOUND', 'Some of the selected tenders were not found')

    let updated = 0
    // Recipient -> their tenders in this batch.
    const toNotify = new Map<string, Tender[]>()
    const remember = (userId: string | null, t: Tender) => {
      if (!userId || userId === auth.user.id) return
      toNotify.set(userId, [...(toNotify.get(userId) ?? []), t])
    }

    if (input.action === 'move') {
      const target = await moveTarget(tx, orgId, input.stageId)
      if (target.type === 'won') {
        throw badRequest(
          'BULK_WON',
          'Move won tenders one at a time, so each one gets its award amount',
        )
      }
      const comment = moveComment(target, input.comment)
      const stages = await listStages(tx, orgId)
      // All or nothing: check every tender before moving any.
      for (const t of rows) if (t.stageId !== target.id) assertMoveAllowed(auth, stages, t, target)
      for (const t of rows) {
        if (t.stageId === target.id) continue
        await applyMove(tx, auth, t, target, comment)
        remember(t.assignedAgentId, t)
        updated++
      }
      for (const [userId, list] of toNotify) {
        await notify(tx, {
          organizationId: orgId,
          userId,
          type: 'tender.moved',
          title:
            list.length === 1
              ? `Moved to ${target.label}`
              : `${list.length} tenders moved to ${target.label}`,
          body: `${refList(list)} · by ${auth.user.name}${comment ? `: ${comment}` : ''}`,
          link: list.length === 1 ? `/tenders/${list[0]!.id}` : `/tenders?stage=${target.id}`,
        })
      }
    } else {
      const agentName = await assigneeName(tx, orgId, input.agentId)
      for (const t of rows) {
        if (t.assignedAgentId === input.agentId) continue
        await applyAssign(tx, auth, t, input.agentId, agentName, input.note)
        remember(input.agentId, t)
        updated++
      }
      for (const [userId, list] of toNotify) {
        const one = list.length === 1 ? list[0]! : null
        await notify(tx, {
          organizationId: orgId,
          userId,
          type: 'tender.assigned',
          title: one ? 'Tender assigned to you' : `${list.length} tenders assigned to you`,
          body: one
            ? `${one.referenceNo} · ${one.title}${noteFrom(auth, input.note)}`
            : `${refList(list)} · by ${auth.user.name}${input.note ? `: ${input.note}` : ''}`,
          link: one ? `/tenders/${one.id}` : '/tenders?assigned=me',
        })
        // One email for the whole batch, like the notification.
        await emailUser(
          tx,
          auth.org,
          userId,
          'tender_assigned',
          tenderAssignedEmail(list, auth.user.name, input.note),
        )
      }
    }
    return { updated, unchanged: rows.length - updated }
  })
}

/** Active team members a tender can be assigned to. */
export async function listAssignees(orgId: string): Promise<Assignee[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: roles.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId, eq(users.status, 'active')))
    .orderBy(asc(users.name))
  return rows.map(({ createdAt, ...r }) => ({ ...r, memberSince: createdAt.toISOString() }))
}

const UPCOMING_DAYS = 7
const ACTIVE_TYPES: StageType[] = ['open', 'preparing', 'review']

export async function getDashboard(auth: TenantAuth): Promise<DashboardData> {
  const orgId = auth.org.id
  const scope = visibilityScope(auth)

  const byType = await db
    .select({
      type: workflowStages.type,
      n: count(),
      value: sql<string>`coalesce(sum(${tenders.awardAmount}), 0)`,
    })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .where(orgWhere(tenders, orgId, scope))
    .groupBy(workflowStages.type)

  const counts = Object.fromEntries(STAGE_TYPES.map((t) => [t, 0])) as Record<StageType, number>
  let wonValue = 0
  for (const row of byType) {
    counts[row.type] = row.n
    if (row.type === 'won') wonValue = Number(row.value)
  }
  const decided = counts.won + counts.lost

  const today = todayIn(auth.org.timezone)
  const upcoming = await selectSummaries(db)
    .where(
      orgWhere(
        tenders,
        orgId,
        scope,
        inArray(workflowStages.type, ACTIVE_TYPES),
        gte(tenders.deadline, today),
        lte(tenders.deadline, addDays(today, UPCOMING_DAYS)),
      ),
    )
    .orderBy(asc(tenders.deadline))
    .limit(10)

  const [lastImport] = await db
    .select({
      fileName: importRuns.fileName,
      at: importRuns.createdAt,
      created: importRuns.created,
    })
    .from(importRuns)
    .where(orgWhere(importRuns, orgId, eq(importRuns.status, 'completed')))
    .orderBy(desc(importRuns.createdAt))
    .limit(1)

  return {
    counts,
    upcoming: upcoming.map(toSummary),
    wonValue,
    winRate: decided > 0 ? counts.won / decided : null,
    lastImport: lastImport ? { ...lastImport, at: lastImport.at.toISOString() } : null,
  }
}
