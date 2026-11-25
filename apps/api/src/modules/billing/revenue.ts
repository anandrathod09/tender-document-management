import { and, asc, desc, eq, gte, lt, ne } from 'drizzle-orm'
import type {
  RevenueFollowUp,
  RevenueMonth,
  RevenueOverview,
  RevenuePayment,
  RevenueQuery,
  RevenueTotals,
} from '@tdm/shared'
import { db } from '../../db/client'
import { organizations, payments, plans } from '../../db/schema'
import { monthsBetween, todayIn, tzOffsetMinutes } from '../../lib/dates'
import { asDate, buildWorkbook, type Column } from '../../lib/xlsx'
import { planPrice } from './gst'
import { toPaymentSummary } from './service'

/** Invoices are Indian (GST), so money is counted by the date in India. */
const TZ = 'Asia/Kolkata'
const DAY = 86_400_000
/** How far ahead renewals and trial ends are listed. */
export const FOLLOW_UP_DAYS = 30

/** The UTC moment India's day `date` (YYYY-MM-DD) starts. */
function startOfDayInIndia(date: string): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`)
  return new Date(midnightUtc.getTime() - tzOffsetMinutes(TZ, midnightUtc) * 60_000)
}

/** YYYY-MM-DD in India for a stored moment. */
const indiaDate = (d: Date) => todayIn(TZ, d)

/** Financial year of an Indian date: "2026-27" for 2026-04-01 to 2027-03-31. */
function yearOfIndiaDate(date: string): string {
  const y = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0)
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** First and last+1 moment of a financial year, e.g. "2026-27" = 1 Apr 2026 to 1 Apr 2027. */
function yearRange(fy: string) {
  const start = Number(fy.slice(0, 4))
  return {
    from: startOfDayInIndia(`${start}-04-01`),
    to: startOfDayInIndia(`${start + 1}-04-01`),
    months: monthsBetween(`${start}-04`, `${start + 1}-03`),
  }
}

const emptyTotals = (): RevenueTotals => ({
  count: 0,
  baseAmount: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  totalAmount: 0,
})

function add(
  t: RevenueTotals,
  p: Pick<RevenueTotals, 'baseAmount' | 'cgst' | 'sgst' | 'igst' | 'totalAmount'>,
) {
  t.count++
  t.baseAmount += p.baseAmount
  t.cgst += p.cgst
  t.sgst += p.sgst
  t.igst += p.igst
  t.totalAmount += p.totalAmount
}

/** Paid payments in a financial year (by paid date in India), with their client and plan. */
async function paidInYear(fy: string, query: Omit<RevenueQuery, 'fy'> = {}) {
  const { from, to } = yearRange(fy)
  return db
    .select({
      p: payments,
      planName: plans.name,
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
    })
    .from(payments)
    .innerJoin(plans, eq(plans.id, payments.planId))
    .innerJoin(organizations, eq(organizations.id, payments.organizationId))
    .where(
      and(
        eq(payments.status, 'paid'),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
        query.organizationId ? eq(payments.organizationId, query.organizationId) : undefined,
        query.method ? eq(payments.method, query.method) : undefined,
      ),
    )
    .orderBy(desc(payments.paidAt))
}

/** Financial years from the first paid payment up to the current one, newest first. */
async function yearsWithPayments(current: string): Promise<string[]> {
  const [first] = await db
    .select({ paidAt: payments.paidAt })
    .from(payments)
    .where(eq(payments.status, 'paid'))
    .orderBy(asc(payments.paidAt))
    .limit(1)
  const firstYear = Number(
    (first?.paidAt ? yearOfIndiaDate(indiaDate(first.paidAt)) : current).slice(0, 4),
  )
  const out: string[] = []
  for (let y = Number(current.slice(0, 4)); y >= firstYear; y--) {
    out.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`)
  }
  return out
}

/** Clients whose paid period or trial ends within FOLLOW_UP_DAYS, or already ended. */
async function followUps(now: Date): Promise<{ list: RevenueFollowUp[]; paying: number }> {
  const rows = await db
    .select({ o: organizations, plan: plans })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(ne(organizations.status, 'closed'))
  const soon = now.getTime() + FOLLOW_UP_DAYS * DAY
  const list: RevenueFollowUp[] = []
  let paying = 0
  for (const { o, plan } of rows) {
    const cycle = o.billingCycle ?? null
    const base = {
      organization: { id: o.id, name: o.name, slug: o.slug, status: o.status },
      plan: plan.name,
      cycle,
      expectedBase: planPrice(plan, cycle ?? 'yearly'),
    }
    if (o.paidUntil) {
      const end = o.paidUntil.getTime()
      if (end > now.getTime()) paying++
      if (end <= now.getTime())
        list.push({ ...base, kind: 'overdue', date: o.paidUntil.toISOString() })
      else if (end <= soon) list.push({ ...base, kind: 'renewal', date: o.paidUntil.toISOString() })
    } else if (o.trialEndsAt) {
      const end = o.trialEndsAt.getTime()
      const date = o.trialEndsAt.toISOString()
      if (end <= now.getTime()) list.push({ ...base, kind: 'trial_ended', date })
      else if (end <= soon) list.push({ ...base, kind: 'trial_ending', date })
    }
  }
  list.sort((a, b) => a.date.localeCompare(b.date))
  return { list, paying }
}

export async function getRevenueOverview(
  query: RevenueQuery,
  now = new Date(),
): Promise<RevenueOverview> {
  const current = yearOfIndiaDate(indiaDate(now))
  const fy = query.fy ?? current
  const { months } = yearRange(fy)
  const rows = await paidInYear(fy)

  const year = emptyTotals()
  const byMonth = new Map<string, RevenueMonth>(
    months.map((m) => [m, { month: m, ...emptyTotals() }]),
  )
  for (const { p } of rows) {
    add(year, p)
    const m = byMonth.get(indiaDate(p.paidAt!).slice(0, 7))
    if (m) add(m, p)
  }

  // "This month" is always the current calendar month, whichever year is shown.
  const thisMonthKey = indiaDate(now).slice(0, 7)
  const thisMonth = emptyTotals()
  for (const { p } of fy === current ? rows : await paidInYear(current)) {
    if (indiaDate(p.paidAt!).startsWith(thisMonthKey)) add(thisMonth, p)
  }

  const { list, paying } = await followUps(now)
  return {
    financialYear: fy,
    years: await yearsWithPayments(current),
    thisMonth,
    year,
    payingClients: paying,
    months: [...byMonth.values()],
    followUps: list,
  }
}

export async function listRevenuePayments(query: RevenueQuery): Promise<RevenuePayment[]> {
  const fy = query.fy ?? yearOfIndiaDate(indiaDate(new Date()))
  const rows = await paidInYear(fy, query)
  return rows.map((r) => ({
    ...toPaymentSummary(r.p, r.planName),
    organization: { id: r.orgId, name: r.orgName, slug: r.orgSlug },
    billToName: r.p.billTo?.name ?? null,
    billToGstin: r.p.billTo?.gstin ?? null,
  }))
}

/** The year's paid invoices for the accountant: one row per invoice, GST split out. */
export async function exportRevenue(query: RevenueQuery): Promise<Buffer> {
  const rows = await listRevenuePayments(query)
  const day = (iso: string | null) => asDate(iso && indiaDate(new Date(iso)))
  const money = '#,##0'
  const columns: Column<RevenuePayment>[] = [
    { header: 'Invoice date', width: 13, value: (r) => day(r.paidAt), format: 'dd-mm-yyyy' },
    { header: 'Invoice No', width: 18, value: (r) => r.invoiceNumber },
    { header: 'Client', width: 28, value: (r) => r.organization.name },
    { header: 'Billed to', width: 28, value: (r) => r.billToName },
    { header: 'GSTIN', width: 18, value: (r) => r.billToGstin },
    { header: 'Plan', width: 14, value: (r) => r.plan.name },
    { header: 'Billing', width: 9, value: (r) => r.cycle },
    { header: 'Period from', width: 13, value: (r) => day(r.periodStart), format: 'dd-mm-yyyy' },
    { header: 'Period to', width: 13, value: (r) => day(r.periodEnd), format: 'dd-mm-yyyy' },
    { header: 'Paid by', width: 9, value: (r) => (r.method === 'razorpay' ? 'Online' : 'Manual') },
    { header: 'Reference', width: 20, value: (r) => r.reference },
    { header: 'Taxable value', width: 14, value: (r) => r.baseAmount, format: money },
    { header: 'CGST', width: 11, value: (r) => r.cgst, format: money },
    { header: 'SGST', width: 11, value: (r) => r.sgst, format: money },
    { header: 'IGST', width: 11, value: (r) => r.igst, format: money },
    { header: 'Total', width: 13, value: (r) => r.totalAmount, format: money },
  ]
  // Oldest first, as an invoice register.
  return buildWorkbook('Invoices', columns, [...rows].reverse())
}
