import { and, count, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import {
  INSTALL_STATUSES,
  PERMISSIONS,
  STAGE_TYPES,
  WARRANTY_LABELS,
  reportQuerySchema,
  type AgentRow,
  type AssetListItem,
  type MonthlyRow,
  type ReportSummary,
  type StageType,
} from '@tdm/shared'
import type { z } from 'zod'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  tenders,
  tenderStageHistory,
  users,
  workflowStages,
} from '../../db/schema'
import { addDays, monthsBetween, tzOffsetMinutes } from '../../lib/dates'
import { badRequest } from '../../lib/errors'
import { asDate, buildWorkbook, type Column } from '../../lib/xlsx'
import type { TenantAuth } from '../../types/express'
import { allAssets, countEndingSoon } from '../installation/assets'
import {
  tenderListOrder,
  tenderListWhere,
  visibilityScope,
  type ListQuery,
} from '../tenders/service'
import { countOpenTickets } from '../tickets/service'

type Range = z.output<typeof reportQuerySchema>

const MAX_RANGE_DAYS = 3 * 366

/** The UTC moments that bound the client's own calendar days `from`..`to`. */
function utcBounds(auth: TenantAuth, r: Range) {
  if (r.from > r.to) throw badRequest('VALIDATION_ERROR', 'The start date is after the end date')
  const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000
  if (days > MAX_RANGE_DAYS)
    throw badRequest('VALIDATION_ERROR', 'Choose a period of at most 3 years')
  const offset = tzOffsetMinutes(auth.org.timezone)
  return {
    offset,
    start: new Date(Date.parse(`${r.from}T00:00:00Z`) - offset * 60_000),
    end: new Date(Date.parse(`${addDays(r.to, 1)}T00:00:00Z`) - offset * 60_000),
  }
}

const monthOf = (d: Date, offset: number) =>
  new Date(d.getTime() + offset * 60_000).toISOString().slice(0, 7)

/**
 * Bidding performance for a period: tenders added, bids submitted, won and
 * lost per month (counted when the tender entered that kind of stage), and
 * per agent. Agents without "view all" see only their own tenders.
 */
export async function getSummary(auth: TenantAuth, range: Range): Promise<ReportSummary> {
  const orgId = auth.org.id
  const scope = visibilityScope(auth)
  const { offset, start, end } = utcBounds(auth, range)
  const months = monthsBetween(range.from, range.to)
  const monthly = new Map<string, MonthlyRow>(
    months.map((m) => [m, { month: m, added: 0, submitted: 0, won: 0, lost: 0, wonValue: 0 }]),
  )

  const added = await db
    .select({ createdAt: tenders.createdAt })
    .from(tenders)
    .where(
      orgWhere(tenders, orgId, scope, gte(tenders.createdAt, start), lt(tenders.createdAt, end)),
    )
  for (const t of added) {
    const row = monthly.get(monthOf(t.createdAt, offset))
    if (row) row.added++
  }

  // Each tender counts once per month and kind, even if it moved back and forth.
  const moves = await db
    .select({
      tenderId: tenderStageHistory.tenderId,
      at: tenderStageHistory.createdAt,
      type: workflowStages.type,
      award: tenders.awardAmount,
    })
    .from(tenderStageHistory)
    .innerJoin(workflowStages, eq(workflowStages.id, tenderStageHistory.toStageId))
    .innerJoin(tenders, eq(tenders.id, tenderStageHistory.tenderId))
    .where(
      and(
        orgWhere(tenderStageHistory, orgId),
        scope,
        inArray(workflowStages.type, ['submitted', 'won', 'lost']),
        gte(tenderStageHistory.createdAt, start),
        lt(tenderStageHistory.createdAt, end),
      ),
    )
  const seen = new Set<string>()
  for (const m of moves) {
    const month = monthOf(m.at, offset)
    const key = `${month}|${m.type}|${m.tenderId}`
    const row = monthly.get(month)
    if (!row || seen.has(key)) continue
    seen.add(key)
    if (m.type === 'submitted') row.submitted++
    if (m.type === 'won') {
      row.won++
      row.wonValue += Number(m.award ?? 0)
    }
    if (m.type === 'lost') row.lost++
  }
  const rows = [...monthly.values()]
  const sum = (k: keyof Omit<MonthlyRow, 'month'>) => rows.reduce((n, r) => n + r[k], 0)
  const won = sum('won')
  const lost = sum('lost')

  // Per agent: tenders assigned in the period, by the kind of stage they are in now.
  const agentsAlias = alias(users, 'agent')
  const assigned = await db
    .select({
      agentId: tenders.assignedAgentId,
      agentName: agentsAlias.name,
      type: workflowStages.type,
      award: tenders.awardAmount,
    })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .innerJoin(agentsAlias, eq(agentsAlias.id, tenders.assignedAgentId))
    .where(
      orgWhere(
        tenders,
        orgId,
        scope,
        isNotNull(tenders.assignedAgentId),
        gte(tenders.assignedAt, start),
        lt(tenders.assignedAt, end),
      ),
    )
  const agents = new Map<string, AgentRow>()
  for (const a of assigned) {
    const row =
      agents.get(a.agentId!) ??
      agents
        .set(a.agentId!, {
          agent: { id: a.agentId!, name: a.agentName },
          assigned: 0,
          inProgress: 0,
          submitted: 0,
          won: 0,
          lost: 0,
          wonValue: 0,
          winRate: null,
        })
        .get(a.agentId!)!
    row.assigned++
    if (a.type === 'preparing' || a.type === 'review') row.inProgress++
    if (a.type === 'submitted') row.submitted++
    if (a.type === 'won' || a.type === 'execution' || a.type === 'closed') {
      row.won++
      row.wonValue += Number(a.award ?? 0)
    }
    if (a.type === 'lost') row.lost++
  }
  for (const r of agents.values()) r.winRate = r.won + r.lost ? r.won / (r.won + r.lost) : null

  const byType = Object.fromEntries(STAGE_TYPES.map((t) => [t, 0])) as Record<StageType, number>
  const current = await db
    .select({ type: workflowStages.type, n: count() })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .where(orgWhere(tenders, orgId, scope))
    .groupBy(workflowStages.type)
  for (const c of current) byType[c.type] = c.n

  return {
    from: range.from,
    to: range.to,
    totals: {
      added: sum('added'),
      submitted: sum('submitted'),
      won,
      lost,
      wonValue: sum('wonValue'),
      winRate: won + lost ? won / (won + lost) : null,
    },
    monthly: rows,
    agents: [...agents.values()].sort((a, b) => b.won - a.won || b.assigned - a.assigned),
    byStageType: byType,
    openTickets: auth.permissions.has(PERMISSIONS.TICKET_MANAGE)
      ? await countOpenTickets(orgId)
      : 0,
    warrantiesEndingSoon: await countEndingSoon(auth),
  }
}

// ---------------------------------------------------------------------------
// Excel exports
// ---------------------------------------------------------------------------

const EXPORT_CAP = 20_000
const MONEY = '#,##0'
const DATE = 'dd-mm-yyyy'

/** The tender list as shown (same filters and order), as an Excel file. */
export async function exportTenders(auth: TenantAuth, query: ListQuery): Promise<Buffer> {
  const agentsAlias = alias(users, 'agent')
  const rows = await db
    .select({
      t: tenders,
      stage: workflowStages.label,
      stageType: workflowStages.type,
      agent: agentsAlias.name,
      company: biddingCompanies.name,
    })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .leftJoin(agentsAlias, eq(agentsAlias.id, tenders.assignedAgentId))
    .leftJoin(biddingCompanies, eq(biddingCompanies.id, tenders.biddingCompanyId))
    .where(tenderListWhere(auth, query))
    .orderBy(...tenderListOrder(query.sort))
    .limit(EXPORT_CAP)
  type R = (typeof rows)[number]
  const columns: Column<R>[] = [
    { header: 'Reference no.', width: 28, value: (r) => r.t.referenceNo },
    { header: 'Tender247 ID', width: 14, value: (r) => r.t.sourceTenderId },
    { header: 'Tender brief', width: 60, value: (r) => r.t.title },
    { header: 'Buyer', width: 32, value: (r) => r.t.buyerOrganization },
    { header: 'Location', width: 18, value: (r) => r.t.location },
    { header: 'GeM', width: 7, value: (r) => (r.t.sheetType === 'gem' ? 'Yes' : 'No') },
    {
      header: 'Estimated value (₹)',
      width: 18,
      value: (r) => Number(r.t.estimatedCost),
      format: MONEY,
    },
    { header: 'EMD (₹)', width: 12, value: (r) => Number(r.t.emd), format: MONEY },
    { header: 'Document fee (₹)', width: 14, value: (r) => Number(r.t.documentFee), format: MONEY },
    { header: 'Deadline', width: 12, value: (r) => asDate(r.t.deadline), format: DATE },
    { header: 'Stage', width: 18, value: (r) => r.stage },
    { header: 'Assigned to', width: 20, value: (r) => r.agent },
    { header: 'Bidding company', width: 24, value: (r) => r.company },
    {
      header: 'Award amount (₹)',
      width: 16,
      value: (r) => (r.t.awardAmount === null ? null : Number(r.t.awardAmount)),
      format: MONEY,
    },
    { header: 'Award / PO no.', width: 16, value: (r) => r.t.awardNumber },
    { header: 'Added on', width: 12, value: (r) => r.t.createdAt, format: DATE },
  ]
  return buildWorkbook('Tenders', columns, rows)
}

/** Installed units with warranty dates, as an Excel file. */
export async function exportAssets(auth: TenantAuth): Promise<Buffer> {
  const rows = await allAssets(auth, {}, EXPORT_CAP)
  const installLabel: Record<(typeof INSTALL_STATUSES)[number], string> = {
    installed: 'Yes',
    not_installed: 'No',
    pending: 'Pending',
  }
  const columns: Column<AssetListItem>[] = [
    { header: 'Tender reference', width: 26, value: (r) => r.tender.referenceNo },
    { header: 'Customer', width: 28, value: (r) => r.customerName },
    { header: 'Consignee', width: 24, value: (r) => r.consignee.name },
    { header: 'Engineer', width: 18, value: (r) => r.engineer?.name },
    { header: 'Item', width: 36, value: (r) => r.itemName },
    { header: 'Make / model', width: 20, value: (r) => r.makeModel },
    { header: 'Serial number', width: 20, value: (r) => r.serialNumber },
    { header: 'Monitor serial', width: 18, value: (r) => r.monitorSerial },
    { header: 'CPU serial', width: 18, value: (r) => r.cpuSerial },
    { header: 'Installed', width: 10, value: (r) => installLabel[r.installStatus] },
    { header: 'Installed on', width: 12, value: (r) => asDate(r.installedOn), format: DATE },
    { header: 'Warranty (months)', width: 10, value: (r) => r.warrantyMonths },
    { header: 'Warranty ends', width: 13, value: (r) => asDate(r.warrantyEnd), format: DATE },
    { header: 'Warranty status', width: 18, value: (r) => WARRANTY_LABELS[r.warrantyStatus] },
    { header: 'Remarks', width: 30, value: (r) => r.remarks },
  ]
  return buildWorkbook('Installed assets', columns, rows)
}
