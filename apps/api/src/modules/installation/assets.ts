import { and, asc, count, eq, like, or, sql, type SQL } from 'drizzle-orm'
import {
  assetListQuerySchema,
  type AssetListItem,
  type AssetPage,
  type WarrantyStatus,
} from '@tdm/shared'
import type { z } from 'zod'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  installationConsignees,
  installationReports,
  installedAssets,
  tenders,
  users,
} from '../../db/schema'
import { addDays, todayIn } from '../../lib/dates'
import type { TenantAuth } from '../../types/express'
import { visibilityScope } from '../tenders/service'
import { ownConsigneesOnly } from './service'

/** Engineers see the units on their own consignees only. */
const ownScope = (auth: TenantAuth) =>
  ownConsigneesOnly(auth) ? eq(installationConsignees.engineerId, auth.user.id) : undefined

type Query = z.output<typeof assetListQuerySchema>

// Warranty starts on the installation date, or the report date when no installation date is recorded.
export const warrantyStart = sql<
  string | null
>`COALESCE(${installedAssets.installedOn}, ${installationReports.reportDate})`
export const warrantyEnd = sql<
  string | null
>`CASE WHEN ${installedAssets.warrantyMonths} > 0 AND COALESCE(${installedAssets.installedOn}, ${installationReports.reportDate}) IS NOT NULL
  THEN DATE_ADD(COALESCE(${installedAssets.installedOn}, ${installationReports.reportDate}), INTERVAL ${installedAssets.warrantyMonths} MONTH) END`

function warrantyCondition(status: WarrantyStatus, today: string): SQL {
  const in30 = addDays(today, 30)
  const in90 = addDays(today, 90)
  switch (status) {
    case 'not_set':
      return sql`(${warrantyEnd}) IS NULL`
    case 'expired':
      return sql`(${warrantyEnd}) < ${today}`
    case 'expiring_30':
      return sql`(${warrantyEnd}) BETWEEN ${today} AND ${in30}`
    case 'expiring_90':
      return sql`(${warrantyEnd}) > ${in30} AND (${warrantyEnd}) <= ${in90}`
    case 'active':
      return sql`(${warrantyEnd}) > ${in90}`
  }
}

export function warrantyStatusOf(
  end: string | null,
  today: string,
): { status: WarrantyStatus; daysLeft: number | null } {
  if (!end) return { status: 'not_set', daysLeft: null }
  const daysLeft = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
  const status: WarrantyStatus =
    daysLeft < 0
      ? 'expired'
      : daysLeft <= 30
        ? 'expiring_30'
        : daysLeft <= 90
          ? 'expiring_90'
          : 'active'
  return { status, daysLeft }
}

const columns = {
  a: installedAssets,
  tenderRef: tenders.referenceNo,
  tenderTitle: tenders.title,
  customerName: installationReports.customerName,
  consigneeName: installationConsignees.name,
  engineerId: users.id,
  engineerName: users.name,
  warrantyStart,
  warrantyEnd,
}

function baseQuery(auth: TenantAuth, q: Partial<Query>, today: string) {
  const term = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const where = and(
    orgWhere(installedAssets, auth.org.id),
    visibilityScope(auth),
    ownScope(auth),
    q.tenderId ? eq(installedAssets.tenderId, q.tenderId) : undefined,
    q.engineerId ? eq(installationConsignees.engineerId, q.engineerId) : undefined,
    q.installStatus ? eq(installedAssets.installStatus, q.installStatus) : undefined,
    q.warranty ? warrantyCondition(q.warranty, today) : undefined,
    term
      ? or(
          like(installedAssets.itemName, term),
          like(installedAssets.serialNumber, term),
          like(installedAssets.monitorSerial, term),
          like(installedAssets.cpuSerial, term),
          like(installationReports.customerName, term),
          like(installationConsignees.name, term),
          like(tenders.referenceNo, term),
          like(users.name, term),
        )
      : undefined,
  )
  return where
}

function toItem(
  r: {
    a: typeof installedAssets.$inferSelect
    tenderRef: string
    tenderTitle: string
    customerName: string | null
    consigneeName: string
    engineerId: string | null
    engineerName: string | null
    warrantyStart: string | null
    warrantyEnd: string | null
  },
  today: string,
): AssetListItem {
  // MySQL returns DATE_ADD on a DATE as a date string; normalise to YYYY-MM-DD.
  const start = r.warrantyStart ? String(r.warrantyStart).slice(0, 10) : null
  const end = r.warrantyEnd ? String(r.warrantyEnd).slice(0, 10) : null
  const w = warrantyStatusOf(end, today)
  return {
    id: r.a.id,
    itemName: r.a.itemName,
    makeModel: r.a.makeModel,
    serialNumber: r.a.serialNumber,
    monitorSerial: r.a.monitorSerial,
    cpuSerial: r.a.cpuSerial,
    installStatus: r.a.installStatus,
    installedOn: r.a.installedOn,
    warrantyMonths: r.a.warrantyMonths,
    remarks: r.a.remarks,
    tender: { id: r.a.tenderId, referenceNo: r.tenderRef, title: r.tenderTitle },
    customerName: r.customerName,
    consignee: { id: r.a.consigneeId, name: r.consigneeName },
    engineer: r.engineerId ? { id: r.engineerId, name: r.engineerName ?? '' } : null,
    warrantyStart: start,
    warrantyEnd: end,
    daysLeft: w.daysLeft,
    warrantyStatus: w.status,
  }
}

function selectAssets() {
  return db
    .select(columns)
    .from(installedAssets)
    .innerJoin(installationConsignees, eq(installationConsignees.id, installedAssets.consigneeId))
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .innerJoin(tenders, eq(tenders.id, installedAssets.tenderId))
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
}

/** How many units fall in each warranty status, for the other filters on screen. */
async function warrantyCounts(
  auth: TenantAuth,
  query: Partial<Query>,
  today: string,
): Promise<Record<WarrantyStatus, number>> {
  const n = (status: WarrantyStatus) =>
    sql<number>`COALESCE(SUM(CASE WHEN ${warrantyCondition(status, today)} THEN 1 ELSE 0 END), 0)`
  const [r] = await db
    .select({
      expired: n('expired'),
      expiring_30: n('expiring_30'),
      expiring_90: n('expiring_90'),
      active: n('active'),
      not_set: n('not_set'),
    })
    .from(installedAssets)
    .innerJoin(installationConsignees, eq(installationConsignees.id, installedAssets.consigneeId))
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .innerJoin(tenders, eq(tenders.id, installedAssets.tenderId))
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
    .where(baseQuery(auth, { ...query, warranty: undefined }, today))
  return {
    expired: Number(r?.expired ?? 0),
    expiring_30: Number(r?.expiring_30 ?? 0),
    expiring_90: Number(r?.expiring_90 ?? 0),
    active: Number(r?.active ?? 0),
    not_set: Number(r?.not_set ?? 0),
  }
}

export async function listAssets(auth: TenantAuth, query: Query): Promise<AssetPage> {
  const today = todayIn(auth.org.timezone)
  const where = baseQuery(auth, query, today)
  const [total] = await db
    .select({ n: count() })
    .from(installedAssets)
    .innerJoin(installationConsignees, eq(installationConsignees.id, installedAssets.consigneeId))
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .innerJoin(tenders, eq(tenders.id, installedAssets.tenderId))
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
    .where(where)
  const rows = await selectAssets()
    .where(where)
    // Soonest warranty end first; units without a warranty last.
    .orderBy(sql`(${warrantyEnd}) IS NULL`, asc(warrantyEnd), asc(installedAssets.itemName))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return {
    items: rows.map((r) => toItem(r, today)),
    total: total?.n ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    warrantyCounts: await warrantyCounts(auth, query, today),
  }
}

/** Every visible unit matching the filters, for the Excel export (capped), in screen order. */
export async function allAssets(
  auth: TenantAuth,
  query: Partial<Query>,
  cap = 20_000,
): Promise<AssetListItem[]> {
  const today = todayIn(auth.org.timezone)
  const rows = await selectAssets()
    .where(baseQuery(auth, query, today))
    .orderBy(
      sql`(${warrantyEnd}) IS NULL`,
      asc(warrantyEnd),
      asc(tenders.referenceNo),
      asc(installationConsignees.sortOrder),
      asc(installedAssets.sortOrder),
    )
    .limit(cap)
  return rows.map((r) => toItem(r, today))
}

/** Units whose warranty ends within 90 days (for the reports page). */
export async function countEndingSoon(auth: TenantAuth): Promise<number> {
  const today = todayIn(auth.org.timezone)
  const [r] = await db
    .select({ n: count() })
    .from(installedAssets)
    .innerJoin(installationConsignees, eq(installationConsignees.id, installedAssets.consigneeId))
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .innerJoin(tenders, eq(tenders.id, installedAssets.tenderId))
    .where(
      and(
        orgWhere(installedAssets, auth.org.id),
        visibilityScope(auth),
        ownScope(auth),
        sql`(${warrantyEnd}) BETWEEN ${today} AND ${addDays(today, 90)}`,
      ),
    )
  return r?.n ?? 0
}
