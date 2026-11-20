import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/config/env'
import { db } from '../src/db/client'
import { notifications, organizations } from '../src/db/schema'
import { testOutbox } from '../src/lib/mailer'
import { addPeriod, financialYear, gstBreakdown } from '../src/modules/billing/gst'
import { rupeesInWords } from '../src/modules/billing/invoice'
import { runBillingChecks } from '../src/modules/billing/service'
import {
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  OWNER_HOST,
  resetDb,
  setupClient,
} from './helpers'
import { addUser } from './tender-helpers'

const ACME = hostOf('acme')

describe('GST and dates', () => {
  it('splits GST by state and rounds to whole rupees', () => {
    expect(gstBreakdown(1000, '27')).toEqual({
      baseAmount: 1000,
      cgst: 90,
      sgst: 90,
      igst: 0,
      totalAmount: 1180,
      gstRatePercent: 18,
    })
    expect(gstBreakdown(2499, '29')).toMatchObject({ igst: 450, cgst: 0, totalAmount: 2949 })
    // Unknown state: treated as the seller's state.
    expect(gstBreakdown(1000, null).cgst).toBe(90)
  })

  it('knows the financial year, adds months safely and writes amounts in words', () => {
    expect(financialYear(new Date('2027-03-31T10:00:00Z'))).toBe('2026-27')
    expect(financialYear(new Date('2027-04-01T10:00:00Z'))).toBe('2027-28')
    expect(addPeriod(new Date('2027-01-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    )
    expect(addPeriod(new Date('2027-01-31T00:00:00Z'), 'yearly').toISOString()).toBe(
      '2028-01-31T00:00:00.000Z',
    )
    expect(rupeesInWords(118000)).toBe('One Lakh Eighteen Thousand Rupees Only')
    expect(rupeesInWords(12_50_00_001)).toBe('Twelve Crore Fifty Lakh One Rupees Only')
  })
})

describe('billing', () => {
  let adminToken: string
  let ownerToken: string
  let orgId: string
  let planId: string
  let orders = 0

  const sign = (secret: string, data: string | Buffer) =>
    createHmac('sha256', secret).update(data).digest('hex')

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    ownerToken = await loginOwner()
    const client = await setupClient(ownerToken, await createPlan(), 'acme')
    adminToken = client.adminToken
    orgId = client.org.id
    // A plan clients can buy: ₹2,000 a month or ₹20,000 a year, plus GST.
    const plan = await owner().post('/owner/plans').send({
      code: 'pro',
      name: 'Pro',
      maxUsers: 10,
      maxStorageGb: 10,
      maxTendersPerMonth: 2000,
      priceMonthlyInr: 2000,
      priceYearlyInr: 20000,
    })
    expect(plan.status).toBe(201)
    planId = plan.body.id
    // Razorpay's order API, stubbed.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      orders++
      return new Response(JSON.stringify({ id: `order_test_${orders}`, status: 'created' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  const client = (token = adminToken) => ({
    get: (p: string) => request(app).get(`/api${p}`).set('Host', ACME).set(bearer(token)),
    post: (p: string) => request(app).post(`/api${p}`).set('Host', ACME).set(bearer(token)),
    put: (p: string) => request(app).put(`/api${p}`).set('Host', ACME).set(bearer(token)),
  })
  function owner() {
    return {
      get: (p: string) =>
        request(app).get(`/api${p}`).set('Host', OWNER_HOST).set(bearer(ownerToken)),
      post: (p: string) =>
        request(app).post(`/api${p}`).set('Host', OWNER_HOST).set(bearer(ownerToken)),
      put: (p: string) =>
        request(app).put(`/api${p}`).set('Host', OWNER_HOST).set(bearer(ownerToken)),
    }
  }
  const details = {
    billingName: 'Acme Infra Pvt Ltd',
    billingAddress: 'Plot 4, MIDC, Nashik',
    billingGstin: '27AAACA1234A1Z5',
    billingStateCode: '27',
    billingEmail: 'accounts@acme.test',
  }

  async function payOnline(cycle: 'monthly' | 'yearly') {
    const order = await client().post('/billing/checkout').send({ planId, cycle })
    expect(order.status).toBe(200)
    const razorpayPaymentId = `pay_${order.body.orderId}`
    const confirmed = await client()
      .post('/billing/confirm')
      .send({
        paymentId: order.body.paymentId,
        razorpayOrderId: order.body.orderId,
        razorpayPaymentId,
        razorpaySignature: sign(
          env.RAZORPAY_KEY_SECRET!,
          `${order.body.orderId}|${razorpayPaymentId}`,
        ),
      })
    return { order, confirmed }
  }

  it('shows the plan, usage and choices; only settings managers see it', async () => {
    const res = await client().get('/billing')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      state: 'trial',
      onlinePayment: true,
      gstRatePercent: 18,
      pricesIncludeGst: false,
      usage: { users: 1, storageBytes: 0, tendersThisMonth: 0, companies: 0 },
      payments: [],
    })
    expect(res.body.plans.map((p: { code: string }) => p.code)).toContain('pro')
    expect(new Date(res.body.endsAt).getTime()).toBeGreaterThan(Date.now())

    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect((await client(agent.token).get('/billing')).status).toBe(403)
  })

  it('pays online: details first, signature checked, period extended, GST invoice issued', async () => {
    const early = await client().post('/billing/checkout').send({ planId, cycle: 'monthly' })
    expect(early.body.error.code).toBe('BILLING_DETAILS_MISSING')

    const wrongState = await client()
      .put('/billing/details')
      .send({ ...details, billingStateCode: '29' })
    expect(wrongState.status).toBe(400)
    expect((await client().put('/billing/details').send(details)).status).toBe(200)

    const priced = await client().post('/billing/quote').send({ planId, cycle: 'monthly' })
    expect(priced.body).toMatchObject({ baseAmount: 2000, cgst: 180, sgst: 180, totalAmount: 2360 })

    // A forged signature is refused and nothing changes.
    const order = await client().post('/billing/checkout').send({ planId, cycle: 'monthly' })
    expect(order.body).toMatchObject({ keyId: 'rzp_test_key', amount: 236000, currency: 'INR' })
    const forged = await client()
      .post('/billing/confirm')
      .send({
        paymentId: order.body.paymentId,
        razorpayOrderId: order.body.orderId,
        razorpayPaymentId: 'pay_x',
        razorpaySignature: 'ab'.repeat(32),
      })
    expect(forged.body.error.code).toBe('PAYMENT_NOT_VERIFIED')

    const { confirmed } = await payOnline('monthly')
    expect(confirmed.status).toBe(200)
    expect(confirmed.body).toMatchObject({
      status: 'paid',
      method: 'razorpay',
      totalAmount: 2360,
      plan: { name: 'Pro' },
    })
    expect(confirmed.body.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/0001$/)

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
    expect(org).toMatchObject({ status: 'active', planId, billingCycle: 'monthly' })
    // Paying during the trial adds the month after the trial, so no trial days are lost.
    expect(org!.paidUntil!.toISOString()).toBe(
      addPeriod(org!.trialEndsAt!, 'monthly').toISOString(),
    )

    const overview = await client().get('/billing')
    expect(overview.body).toMatchObject({ state: 'active', plan: { code: 'pro' } })
    expect(overview.body.payments).toHaveLength(1)

    const pdf = await client().get(`/billing/payments/${confirmed.body.id}/invoice.pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF')

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId))
    expect(notes.map((n) => n.title)).toContain('Payment received')
  })

  it('the webhook confirms a payment once; the next period starts after the current one', async () => {
    await client().put('/billing/details').send(details)
    await payOnline('monthly')
    const [before] = await db.select().from(organizations).where(eq(organizations.id, orgId))

    const order = await client().post('/billing/checkout').send({ planId, cycle: 'yearly' })
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_hook', order_id: order.body.orderId } } },
      }),
    )
    const hook = (signature: string) =>
      request(app)
        .post('/api/billing/webhook')
        .set('Host', 'localhost')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signature)
        .send(body.toString('utf8'))
    expect((await hook('00'.repeat(32))).status).toBe(400)
    expect((await hook(sign(env.RAZORPAY_WEBHOOK_SECRET!, body))).status).toBe(200)
    expect((await hook(sign(env.RAZORPAY_WEBHOOK_SECRET!, body))).status).toBe(200)

    const [after] = await db.select().from(organizations).where(eq(organizations.id, orgId))
    expect(after!.billingCycle).toBe('yearly')
    expect(after!.paidUntil!.toISOString()).toBe(
      addPeriod(before!.paidUntil!, 'yearly').toISOString(),
    )
    const list = (await client().get('/billing')).body.payments as { invoiceNumber: string }[]
    expect(list.map((p) => p.invoiceNumber.slice(-4)).sort()).toEqual(['0001', '0002'])
  })

  it('offers "contact us" when Razorpay is not set up or the plan has no price', async () => {
    await client().put('/billing/details').send(details)
    const enterprise = await owner().post('/owner/plans').send({
      code: 'enterprise',
      name: 'Enterprise',
      maxUsers: 100,
      maxStorageGb: 100,
      maxTendersPerMonth: 100000,
      priceMonthlyInr: null,
      priceYearlyInr: null,
    })
    const noPrice = await client()
      .post('/billing/checkout')
      .send({ planId: enterprise.body.id, cycle: 'monthly' })
    expect(noPrice.body.error.code).toBe('PLAN_NOT_AVAILABLE')

    const saved = env.RAZORPAY_KEY_ID
    env.RAZORPAY_KEY_ID = undefined
    try {
      expect((await client().get('/billing')).body.onlinePayment).toBe(false)
      const off = await client().post('/billing/checkout').send({ planId, cycle: 'monthly' })
      expect(off.body.error.code).toBe('ONLINE_PAYMENT_OFF')
    } finally {
      env.RAZORPAY_KEY_ID = saved
    }
  })

  it('owner panel: manage plans, record a bank transfer, download its invoice', async () => {
    const dup = await owner().post('/owner/plans').send({
      code: 'pro',
      name: 'Pro again',
      maxUsers: 1,
      maxStorageGb: 1,
      maxTendersPerMonth: 1,
      priceMonthlyInr: 1,
      priceYearlyInr: null,
    })
    expect(dup.body.error.code).toBe('PLAN_CODE_TAKEN')
    const edited = await owner().put(`/owner/plans/${planId}`).send({
      code: 'pro',
      name: 'Pro',
      maxUsers: 12,
      maxStorageGb: 10,
      maxTendersPerMonth: 2000,
      priceMonthlyInr: 2500,
      priceYearlyInr: 25000,
      isPublic: false,
    })
    // maxCompanies was left out, so it falls back to 3.
    expect(edited.body).toMatchObject({
      maxUsers: 12,
      maxCompanies: 3,
      priceMonthlyInr: 2500,
      isPublic: false,
    })
    // A private plan is not offered to clients.
    const offered = (await client().get('/billing')).body.plans as { code: string }[]
    expect(offered.map((p) => p.code)).not.toContain('pro')

    // ₹29,500 received by bank transfer for a year: GST is worked out of the total.
    const paid = await owner().post(`/owner/organizations/${orgId}/payments`).send({
      planId,
      cycle: 'yearly',
      totalAmount: 29500,
      reference: 'UTR123456789',
    })
    expect(paid.status).toBe(201)
    expect(paid.body).toMatchObject({
      method: 'manual',
      status: 'paid',
      baseAmount: 25000,
      totalAmount: 29500,
      reference: 'UTR123456789',
    })
    const list = await owner().get(`/owner/organizations/${orgId}/payments`)
    expect(list.body).toHaveLength(1)
    const orgs = await owner().get('/owner/organizations')
    expect(orgs.body[0]).toMatchObject({ status: 'active', billingCycle: 'yearly' })

    const pdf = await owner().get(
      `/owner/organizations/${orgId}/payments/${paid.body.id}/invoice.pdf`,
    )
    expect(pdf.status).toBe(200)
    expect((await client().get('/billing')).body.payments).toHaveLength(1)
  })

  it("a client cannot confirm or download another client's payment", async () => {
    await client().put('/billing/details').send(details)
    const { confirmed } = await payOnline('monthly')
    const other = await setupClient(ownerToken, await createPlan(), 'bravo')
    const bravo = (p: string) =>
      request(app).get(`/api${p}`).set('Host', hostOf('bravo')).set(bearer(other.adminToken))
    expect((await bravo(`/billing/payments/${confirmed.body.id}/invoice.pdf`)).status).toBe(404)
    const steal = await request(app)
      .post('/api/billing/confirm')
      .set('Host', hostOf('bravo'))
      .set(bearer(other.adminToken))
      .send({
        paymentId: confirmed.body.id,
        razorpayOrderId: 'order_test_1',
        razorpayPaymentId: 'pay_x',
        razorpaySignature: sign(env.RAZORPAY_KEY_SECRET!, 'order_test_1|pay_x'),
      })
    expect(steal.status).toBe(404)
    expect((await bravo('/billing')).body.payments).toEqual([])
  })

  it('reminds once before the end, and suspends after the grace period only when turned on', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000)
    await db.update(organizations).set({ trialEndsAt: soon }).where(eq(organizations.id, orgId))
    testOutbox.length = 0

    expect(await runBillingChecks()).toEqual({ reminded: 1, suspended: 0 })
    expect(await runBillingChecks()).toEqual({ reminded: 0, suspended: 0 })

    // Long past the end and the grace period.
    const later = new Date(Date.now() + 30 * 86_400_000)
    expect((await runBillingChecks(later)).suspended).toBe(0)
    env.BILLING_AUTO_SUSPEND = true
    try {
      expect((await runBillingChecks(later)).suspended).toBe(1)
    } finally {
      env.BILLING_AUTO_SUSPEND = false
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId))
    expect(org!.status).toBe('suspended')
  })
})
