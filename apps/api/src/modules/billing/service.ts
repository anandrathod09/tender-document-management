import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, ne, sql, sum } from 'drizzle-orm'
import type {
  BillingDetailsInput,
  BillingOverview,
  CheckoutInput,
  CheckoutOrder,
  ManualPaymentInput,
  PaymentSummary,
  PlanDetail,
  PlanInput,
  PriceBreakdown,
  SubscriptionState,
} from '@tdm/shared'
import { billingDetailsSchema, manualPaymentSchema, planSchema } from '@tdm/shared'
import type { z } from 'zod'
import { env } from '../../config/env'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  files,
  invoiceCounters,
  organizations,
  payments,
  plans,
  roles,
  tenders,
  users,
  type Organization,
  type Payment,
  type Plan,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import { button, COLORS, details, layout, note, p } from '../../lib/email-templates'
import { queueMail } from '../../lib/mailer'
import type { TenantAuth } from '../../types/express'
import { notify } from '../notifications/service'
import type { Actor } from '../users/service'
import { workspaceUrl } from '../users/invites'
import { invalidateOrganization } from '../workspace/service'
import { addPeriod, financialYear, gstBreakdown, gstFromTotal, planPrice } from './gst'
import {
  createRazorpayOrder,
  razorpayConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from './razorpay'

const DAY = 86_400_000

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export function toPlanDetail(p: Plan, clientCount = 0): PlanDetail {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    maxUsers: p.maxUsers,
    maxStorageGb: p.maxStorageGb,
    maxTendersPerMonth: p.maxTendersPerMonth,
    maxCompanies: p.maxCompanies,
    priceMonthlyInr: p.priceMonthlyInr,
    priceYearlyInr: p.priceYearlyInr,
    isPublic: p.isPublic,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    clientCount,
  }
}

/** Every plan with how many clients use it (owner panel). */
export async function listPlanDetails(): Promise<PlanDetail[]> {
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.maxUsers))
  const usage = await db
    .select({ planId: organizations.planId, n: count() })
    .from(organizations)
    .groupBy(organizations.planId)
  const byPlan = new Map(usage.map((u) => [u.planId, u.n]))
  return rows.map((p) => toPlanDetail(p, byPlan.get(p.id) ?? 0))
}

type PlanValues = z.output<typeof planSchema>

const planColumns = (input: PlanValues) => ({
  code: input.code,
  name: input.name,
  description: input.description ?? null,
  maxUsers: input.maxUsers,
  maxStorageGb: input.maxStorageGb,
  maxTendersPerMonth: input.maxTendersPerMonth,
  maxCompanies: input.maxCompanies,
  priceMonthlyInr: input.priceMonthlyInr,
  priceYearlyInr: input.priceYearlyInr,
  isPublic: input.isPublic,
  isActive: input.isActive,
  sortOrder: input.sortOrder,
})

const codeTaken = () => conflict('PLAN_CODE_TAKEN', 'Another plan already uses this code')

export async function createPlan(actor: Actor, raw: PlanInput): Promise<PlanDetail> {
  const input = planSchema.parse(raw)
  const id = randomUUID()
  try {
    await db.insert(plans).values({ id, ...planColumns(input) })
  } catch (err) {
    if (isDuplicateKeyError(err)) throw codeTaken()
    throw err
  }
  await writeAudit(db, {
    organizationId: null,
    actorType: 'platform',
    actorId: actor.id,
    action: 'plan.created',
    entity: 'plan',
    entityId: id,
    details: { code: input.code },
    ip: actor.ip,
  })
  const [p] = await db.select().from(plans).where(eq(plans.id, id))
  return toPlanDetail(p!)
}

export async function updatePlan(actor: Actor, id: string, raw: PlanInput): Promise<PlanDetail> {
  const input = planSchema.parse(raw)
  const [existing] = await db.select().from(plans).where(eq(plans.id, id)).limit(1)
  if (!existing) throw notFound('PLAN_NOT_FOUND', 'Plan not found')
  try {
    await db.update(plans).set(planColumns(input)).where(eq(plans.id, id))
  } catch (err) {
    if (isDuplicateKeyError(err)) throw codeTaken()
    throw err
  }
  await writeAudit(db, {
    organizationId: null,
    actorType: 'platform',
    actorId: actor.id,
    action: 'plan.updated',
    entity: 'plan',
    entityId: id,
    details: { code: input.code },
    ip: actor.ip,
  })
  return (await listPlanDetails()).find((p) => p.id === id)!
}

async function getPlan(conn: DbOrTx, id: string): Promise<Plan> {
  const [p] = await conn.select().from(plans).where(eq(plans.id, id)).limit(1)
  if (!p) throw notFound('PLAN_NOT_FOUND', 'Plan not found')
  return p
}

// ---------------------------------------------------------------------------
// The client's billing page
// ---------------------------------------------------------------------------

/** Where the client stands: trial, paid, in the grace period, or expired. */
export function subscriptionOf(
  org: Pick<Organization, 'status' | 'paidUntil' | 'trialEndsAt'>,
  now = new Date(),
): { state: SubscriptionState; endsAt: Date | null; graceEndsAt: Date | null } {
  const end = org.paidUntil ?? (org.status === 'trial' ? org.trialEndsAt : null)
  if (!end)
    return { state: org.status === 'trial' ? 'trial' : 'active', endsAt: null, graceEndsAt: null }
  const graceEndsAt = new Date(end.getTime() + env.BILLING_GRACE_DAYS * DAY)
  const state: SubscriptionState =
    now < end ? (org.paidUntil ? 'active' : 'trial') : now < graceEndsAt ? 'grace' : 'expired'
  return { state, endsAt: end, graceEndsAt }
}

export function toPaymentSummary(p: Payment, planName: string): PaymentSummary {
  return {
    id: p.id,
    plan: { id: p.planId, name: planName },
    cycle: p.cycle,
    method: p.method,
    status: p.status,
    baseAmount: p.baseAmount,
    cgst: p.cgst,
    sgst: p.sgst,
    igst: p.igst,
    totalAmount: p.totalAmount,
    gstRatePercent: env.GST_RATE_PERCENT,
    periodStart: p.periodStart?.toISOString() ?? null,
    periodEnd: p.periodEnd?.toISOString() ?? null,
    invoiceNumber: p.invoiceNumber,
    reference: p.reference,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

/** Paid payments (and failed ones), newest first. Unfinished checkouts are left out. */
export async function listPayments(orgId: string): Promise<PaymentSummary[]> {
  const rows = await db
    .select({ p: payments, planName: plans.name })
    .from(payments)
    .innerJoin(plans, eq(plans.id, payments.planId))
    .where(and(eq(payments.organizationId, orgId), ne(payments.status, 'created')))
    .orderBy(desc(payments.createdAt))
  return rows.map((r) => toPaymentSummary(r.p, r.planName))
}

async function loadOrg(conn: DbOrTx, orgId: string, lock = false): Promise<Organization> {
  const q = conn.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)
  const [org] = lock ? await q.for('update') : await q
  if (!org) throw notFound()
  return org
}

export async function getBillingOverview(auth: TenantAuth): Promise<BillingOverview> {
  const org = await loadOrg(db, auth.org.id)
  const plan = await getPlan(db, org.planId)
  const sub = subscriptionOf(org)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [[seats], [storage], [tendersMonth], [companies]] = await Promise.all([
    db
      .select({ n: count() })
      .from(users)
      .where(orgWhere(users, org.id, ne(users.status, 'suspended'))),
    db
      .select({ bytes: sum(files.sizeBytes) })
      .from(files)
      .where(orgWhere(files, org.id)),
    db
      .select({ n: count() })
      .from(tenders)
      .where(orgWhere(tenders, org.id, gte(tenders.createdAt, monthStart))),
    db
      .select({ n: count() })
      .from(biddingCompanies)
      .where(orgWhere(biddingCompanies, org.id, eq(biddingCompanies.isActive, true))),
  ])
  const choosable = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(asc(plans.sortOrder), asc(plans.maxUsers))

  return {
    plan: toPlanDetail(plan),
    cycle: org.billingCycle,
    state: sub.state,
    endsAt: sub.endsAt?.toISOString() ?? null,
    graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
    usage: {
      users: seats?.n ?? 0,
      storageBytes: Number(storage?.bytes ?? 0),
      tendersThisMonth: tendersMonth?.n ?? 0,
      companies: companies?.n ?? 0,
    },
    plans: choosable.map((p) => toPlanDetail(p)),
    onlinePayment: razorpayConfigured(),
    supportEmail: env.BILLING_SUPPORT_EMAIL || null,
    pricesIncludeGst: env.PRICES_INCLUDE_GST,
    gstRatePercent: env.GST_RATE_PERCENT,
    details: {
      billingName: org.billingName,
      billingAddress: org.billingAddress,
      billingGstin: org.billingGstin,
      billingStateCode: org.billingStateCode,
      billingEmail: org.billingEmail,
    },
    payments: await listPayments(org.id),
  }
}

export async function updateBillingDetails(
  auth: TenantAuth,
  raw: BillingDetailsInput,
  ip: string | null,
) {
  const input = billingDetailsSchema.parse(raw)
  // The state is part of the GSTIN, so they must agree.
  if (input.billingGstin && input.billingGstin.slice(0, 2) !== input.billingStateCode) {
    throw badRequest('VALIDATION_ERROR', 'The GSTIN does not belong to the chosen state', {
      fields: { billingGstin: 'This GSTIN is for another state' },
    })
  }
  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({
        billingName: input.billingName,
        billingAddress: input.billingAddress ?? null,
        billingGstin: input.billingGstin ?? null,
        billingStateCode: input.billingStateCode,
        billingEmail: input.billingEmail ?? null,
      })
      .where(eq(organizations.id, auth.org.id))
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'billing.details_updated',
      entity: 'organization',
      entityId: auth.org.id,
      ip,
    })
  })
  invalidateOrganization(auth.org.slug)
  return getBillingOverview(auth)
}

/** The plan must be on sale, at a price for that cycle. */
function sellablePrice(plan: Plan, cycle: CheckoutInput['cycle']): number {
  const price = planPrice(plan, cycle)
  if (!plan.isActive || !plan.isPublic || price === null || price <= 0) {
    throw conflict('PLAN_NOT_AVAILABLE', 'This plan cannot be bought online. Please contact us.')
  }
  return price
}

/** Price with GST, before paying. */
export async function quote(auth: TenantAuth, input: CheckoutInput): Promise<PriceBreakdown> {
  const org = await loadOrg(db, auth.org.id)
  const plan = await getPlan(db, input.planId)
  return gstBreakdown(sellablePrice(plan, input.cycle), org.billingStateCode)
}

/**
 * Starts an online payment: records it, then creates the Razorpay order the
 * browser opens. The period is only extended once the payment is confirmed.
 */
export async function startCheckout(
  auth: TenantAuth,
  input: CheckoutInput,
): Promise<CheckoutOrder> {
  if (!razorpayConfigured()) {
    throw conflict('ONLINE_PAYMENT_OFF', 'Online payment is not available yet. Please contact us.')
  }
  const org = await loadOrg(db, auth.org.id)
  if (!org.billingName || !org.billingStateCode) {
    throw conflict(
      'BILLING_DETAILS_MISSING',
      'Add your company name and state for the invoice first (Billing details).',
    )
  }
  const plan = await getPlan(db, input.planId)
  const breakdown = gstBreakdown(sellablePrice(plan, input.cycle), org.billingStateCode)

  const paymentId = randomUUID()
  await db.insert(payments).values({
    id: paymentId,
    organizationId: org.id,
    planId: plan.id,
    cycle: input.cycle,
    method: 'razorpay',
    status: 'created',
    baseAmount: breakdown.baseAmount,
    cgst: breakdown.cgst,
    sgst: breakdown.sgst,
    igst: breakdown.igst,
    totalAmount: breakdown.totalAmount,
    createdByUserId: auth.user.id,
  })
  const order = await createRazorpayOrder({
    amountPaise: breakdown.totalAmount * 100,
    receipt: paymentId,
    notes: { organization: org.slug, paymentId, plan: plan.code, cycle: input.cycle },
  })
  await db.update(payments).set({ razorpayOrderId: order.id }).where(eq(payments.id, paymentId))

  return {
    paymentId,
    keyId: env.RAZORPAY_KEY_ID!,
    orderId: order.id,
    amount: breakdown.totalAmount * 100,
    currency: 'INR',
    name: env.PRODUCT_NAME,
    description: `${plan.name} plan · ${input.cycle === 'yearly' ? '1 year' : '1 month'}`,
    prefill: { name: auth.user.name, email: org.billingEmail ?? auth.user.email },
    breakdown,
  }
}

/** Called by the browser after Razorpay checkout succeeds. */
export async function confirmPayment(
  auth: TenantAuth,
  input: {
    paymentId: string
    razorpayOrderId: string
    razorpayPaymentId: string
    razorpaySignature: string
  },
): Promise<PaymentSummary> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, input.paymentId), eq(payments.organizationId, auth.org.id)))
    .limit(1)
  if (!payment || payment.method !== 'razorpay')
    throw notFound('PAYMENT_NOT_FOUND', 'Payment not found')
  if (
    payment.razorpayOrderId !== input.razorpayOrderId ||
    !verifyPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)
  ) {
    throw badRequest(
      'PAYMENT_NOT_VERIFIED',
      'We could not verify this payment. Contact us if money was taken.',
    )
  }
  await markPaid(payment.id, { razorpayPaymentId: input.razorpayPaymentId })
  return (await listPayments(auth.org.id)).find((p) => p.id === payment.id)!
}

/**
 * Razorpay webhook: confirms payments even when the browser closed before it
 * could. Returns false when the signature is wrong.
 */
export async function handleRazorpayWebhook(rawBody: Buffer, signature: string): Promise<boolean> {
  if (!verifyWebhookSignature(rawBody, signature)) return false
  const event = JSON.parse(rawBody.toString('utf8')) as {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } }
  }
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return true
  const entity = event.payload?.payment?.entity
  if (!entity?.order_id || !entity.id) return true
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.razorpayOrderId, entity.order_id))
    .limit(1)
  if (payment) await markPaid(payment.id, { razorpayPaymentId: entity.id })
  return true
}

/** The next invoice number of the financial year, e.g. INV/2026-27/0007. */
async function nextInvoiceNumber(tx: DbOrTx, at: Date): Promise<string> {
  const fy = financialYear(at)
  await tx
    .insert(invoiceCounters)
    .values({ financialYear: fy, lastNumber: 1 })
    .onDuplicateKeyUpdate({ set: { lastNumber: sql`${invoiceCounters.lastNumber} + 1` } })
  const [row] = await tx
    .select({ n: invoiceCounters.lastNumber })
    .from(invoiceCounters)
    .where(eq(invoiceCounters.financialYear, fy))
  return `${env.INVOICE_PREFIX}/${fy}/${String(row!.n).padStart(4, '0')}`
}

/**
 * Marks a payment as paid, once: extends the client's paid period from
 * whichever is later, now or the current end; switches them to the plan;
 * numbers the invoice; tells the admins. Safe to call twice (webhook and
 * browser both confirm).
 */
async function markPaid(
  paymentId: string,
  extra: { razorpayPaymentId?: string },
  conn?: DbOrTx,
): Promise<void> {
  const run = async (tx: DbOrTx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for('update')
    if (!payment || payment.status === 'paid') return
    const org = await loadOrg(tx, payment.organizationId, true)
    const plan = await getPlan(tx, payment.planId)
    const now = new Date()
    // Starts when the current paid period (or the free trial) ends, so no days are lost.
    const currentEnd = org.paidUntil ?? (org.status === 'trial' ? org.trialEndsAt : null)
    const periodStart = currentEnd && currentEnd > now ? currentEnd : now
    const periodEnd = addPeriod(periodStart, payment.cycle)

    await tx
      .update(payments)
      .set({
        status: 'paid',
        paidAt: now,
        periodStart,
        periodEnd,
        invoiceNumber: await nextInvoiceNumber(tx, now),
        billTo: {
          name: org.billingName ?? org.name,
          address: org.billingAddress,
          gstin: org.billingGstin,
          stateCode: org.billingStateCode,
        },
        ...(extra.razorpayPaymentId && { razorpayPaymentId: extra.razorpayPaymentId }),
      })
      .where(eq(payments.id, payment.id))
    await tx
      .update(organizations)
      .set({
        planId: plan.id,
        billingCycle: payment.cycle,
        paidUntil: periodEnd,
        billingReminderFor: null,
        ...(org.status === 'trial' && { status: 'active' as const }),
      })
      .where(eq(organizations.id, org.id))
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: payment.createdByPlatformId ? 'platform' : 'system',
      actorId: payment.createdByPlatformId,
      action: 'billing.paid',
      entity: 'payment',
      entityId: payment.id,
      details: { method: payment.method, total: payment.totalAmount, plan: plan.code },
    })
    for (const admin of await adminsOf(tx, org.id)) {
      await notify(tx, {
        organizationId: org.id,
        userId: admin.id,
        type: 'billing.paid',
        title: 'Payment received',
        body: `₹${payment.totalAmount.toLocaleString('en-IN')} for the ${plan.name} plan. Paid until ${periodEnd.toISOString().slice(0, 10)}.`,
        link: '/billing',
      })
    }
    invalidateOrganization(org.slug)
  }
  if (conn) await run(conn)
  else await db.transaction(run)
}

async function adminsOf(conn: DbOrTx, orgId: string) {
  return conn
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId, eq(users.status, 'active'), eq(roles.key, 'admin')))
}

// ---------------------------------------------------------------------------
// Owner panel: payments received outside Razorpay
// ---------------------------------------------------------------------------

export async function recordManualPayment(
  actor: Actor,
  orgId: string,
  raw: ManualPaymentInput,
): Promise<PaymentSummary> {
  const input = manualPaymentSchema.parse(raw)
  const id = randomUUID()
  await db.transaction(async (tx) => {
    const org = await loadOrg(tx, orgId)
    const plan = await getPlan(tx, input.planId)
    let breakdown: PriceBreakdown
    if (input.totalAmount !== undefined) {
      breakdown = gstFromTotal(input.totalAmount, org.billingStateCode)
    } else {
      const price = planPrice(plan, input.cycle)
      if (price === null) {
        throw badRequest(
          'VALIDATION_ERROR',
          'This plan has no price for that cycle; enter the amount received',
          {
            fields: { totalAmount: 'Enter the amount received' },
          },
        )
      }
      breakdown = gstBreakdown(price, org.billingStateCode)
    }
    await tx.insert(payments).values({
      id,
      organizationId: org.id,
      planId: plan.id,
      cycle: input.cycle,
      method: 'manual',
      status: 'created',
      baseAmount: breakdown.baseAmount,
      cgst: breakdown.cgst,
      sgst: breakdown.sgst,
      igst: breakdown.igst,
      totalAmount: breakdown.totalAmount,
      reference: input.reference,
      notes: input.notes ?? null,
      createdByPlatformId: actor.id,
    })
    await markPaid(id, {}, tx)
  })
  return (await listPayments(orgId)).find((p) => p.id === id)!
}

export async function getPaymentForInvoice(
  orgId: string,
  paymentId: string,
): Promise<{ payment: Payment; plan: Plan; org: Organization }> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.organizationId, orgId)))
    .limit(1)
  if (!payment || payment.status !== 'paid' || !payment.invoiceNumber) {
    throw notFound('INVOICE_NOT_FOUND', 'Invoice not found')
  }
  return { payment, plan: await getPlan(db, payment.planId), org: await loadOrg(db, orgId) }
}

// ---------------------------------------------------------------------------
// Daily: renewal reminders, and (if turned on) suspension after the grace period
// ---------------------------------------------------------------------------

const REMINDER_DAYS = 7

export async function runBillingChecks(
  now = new Date(),
): Promise<{ reminded: number; suspended: number }> {
  const orgs = await db
    .select()
    .from(organizations)
    .where(sql`${organizations.status} in ('trial', 'active')`)
  let reminded = 0
  let suspended = 0
  for (const org of orgs) {
    const sub = subscriptionOf(org, now)
    if (!sub.endsAt) continue
    const daysLeft = Math.ceil((sub.endsAt.getTime() - now.getTime()) / DAY)

    if (
      daysLeft <= REMINDER_DAYS &&
      sub.state !== 'expired' &&
      org.billingReminderFor?.getTime() !== sub.endsAt.getTime()
    ) {
      await db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({ billingReminderFor: sub.endsAt })
          .where(eq(organizations.id, org.id))
        const admins = await adminsOf(tx, org.id)
        const recipients = new Set([
          ...admins.map((a) => a.email),
          ...(org.billingEmail ? [org.billingEmail] : []),
        ])
        const when = sub.endsAt!.toISOString().slice(0, 10)
        const what = sub.state === 'trial' ? 'free trial' : 'plan'
        for (const to of recipients) {
          await queueMail(
            tx,
            {
              to,
              subject: `Your ${env.PRODUCT_NAME} ${what} ${daysLeft > 0 ? `ends on ${when}` : 'has ended'}`,
              text: [
                `Hello,`,
                '',
                daysLeft > 0
                  ? `The ${what} for ${org.name} ends on ${when}.`
                  : `The ${what} for ${org.name} ended on ${when}.`,
                `Renew from Billing in your workspace: ${workspaceUrl(org.slug)}/billing`,
                env.BILLING_SUPPORT_EMAIL
                  ? `Questions? Write to ${env.BILLING_SUPPORT_EMAIL}.`
                  : '',
                '',
                env.PRODUCT_NAME,
              ].join('\n'),
              html: layout({
                heading: daysLeft > 0 ? 'Renewal Reminder' : 'Your Plan Has Ended',
                subheading: `${org.name} · ${env.PRODUCT_NAME}`,
                color: daysLeft > 0 ? COLORS.amber : COLORS.red,
                preheader: `Your ${what} ${daysLeft > 0 ? `ends on ${when}` : 'has ended'}`,
                body: [
                  p('Hello,'),
                  p(
                    daysLeft > 0
                      ? `The ${what} for ${org.name} ends soon. Renew now to keep using the workspace without interruption.`
                      : `The ${what} for ${org.name} has ended. Renew to continue using the workspace.`,
                  ),
                  details(
                    'Your plan',
                    [
                      ['Workspace', org.name],
                      [daysLeft > 0 ? 'Ends on' : 'Ended on', when],
                    ],
                    COLORS.amber,
                  ),
                  button(`${workspaceUrl(org.slug)}/billing`, 'Renew Now', COLORS.blue),
                  env.BILLING_SUPPORT_EMAIL
                    ? note('Questions?', `Write to ${env.BILLING_SUPPORT_EMAIL}.`)
                    : '',
                ].join(''),
              }),
            },
            org.id,
          )
        }
        for (const admin of admins) {
          await notify(tx, {
            organizationId: org.id,
            userId: admin.id,
            type: 'billing.reminder',
            title: daysLeft > 0 ? `Your ${what} ends on ${when}` : `Your ${what} has ended`,
            body: 'Renew to keep using the workspace without interruption.',
            link: '/billing',
          })
        }
      })
      reminded++
    }

    if (env.BILLING_AUTO_SUSPEND && sub.state === 'expired') {
      await db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({ status: 'suspended' })
          .where(eq(organizations.id, org.id))
        await writeAudit(tx, {
          organizationId: org.id,
          actorType: 'system',
          actorId: null,
          action: 'billing.suspended',
          entity: 'organization',
          entityId: org.id,
          details: { endedAt: sub.endsAt!.toISOString() },
        })
      })
      invalidateOrganization(org.slug)
      suspended++
    }
  }
  return { reminded, suspended }
}
