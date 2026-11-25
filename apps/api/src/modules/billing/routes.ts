import express, { Router, type Request, type Response } from 'express'
import {
  billingDetailsSchema,
  checkoutSchema,
  confirmPaymentSchema,
  manualPaymentSchema,
  PERMISSIONS,
  planSchema,
  revenueQuerySchema,
} from '@tdm/shared'
import { getOrganizationDetail } from '../owner/service'
import { db } from '../../db/client'
import { logger } from '../../lib/logger'
import { parse } from '../../lib/validate'
import {
  authenticatePlatform,
  authenticateTenant,
  platformAuth,
  requirePermission,
  tenantAuth,
} from '../../middleware/auth'
import type { Actor } from '../users/service'
import { buildInvoicePdf } from './invoice'
import { exportRevenue, getRevenueOverview, listRevenuePayments } from './revenue'
import {
  confirmPayment,
  createPlan,
  getBillingOverview,
  getPaymentForInvoice,
  handleRazorpayWebhook,
  listPayments,
  listPlanDetails,
  quote,
  recordManualPayment,
  startCheckout,
  updateBillingDetails,
  updatePlan,
} from './service'

async function sendInvoice(res: Response, orgId: string, paymentId: string) {
  const data = await getPaymentForInvoice(orgId, paymentId)
  const pdf = await buildInvoicePdf(data)
  const name = `Invoice_${data.payment.invoiceNumber!.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`
  res
    .type('application/pdf')
    .setHeader('Content-Disposition', `attachment; filename="${name}"`)
    .send(Buffer.from(pdf))
}

/** The client's billing page. Only people who manage settings see money. */
export const billingRouter = Router()
billingRouter.use(authenticateTenant, requirePermission(PERMISSIONS.SETTINGS_MANAGE))

billingRouter.get('/', async (req, res) => {
  res.json(await getBillingOverview(tenantAuth(req)))
})

billingRouter.put('/details', async (req, res) => {
  const input = parse(billingDetailsSchema, req.body)
  res.json(await updateBillingDetails(tenantAuth(req), input, req.ip ?? null))
})

billingRouter.post('/quote', async (req, res) => {
  res.json(await quote(tenantAuth(req), parse(checkoutSchema, req.body)))
})

billingRouter.post('/checkout', async (req, res) => {
  res.json(await startCheckout(tenantAuth(req), parse(checkoutSchema, req.body)))
})

billingRouter.post('/confirm', async (req, res) => {
  res.json(await confirmPayment(tenantAuth(req), parse(confirmPaymentSchema, req.body)))
})

billingRouter.get('/payments/:id/invoice.pdf', async (req, res) => {
  await sendInvoice(res, tenantAuth(req).org.id, req.params.id as string)
})

/**
 * Razorpay calls this when a payment is captured. Mounted before the JSON
 * parser, because the signature covers the exact bytes sent.
 */
export const razorpayWebhookHandler = [
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req: Request, res: Response) => {
    const signature = req.get('x-razorpay-signature') ?? ''
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    try {
      const ok = await handleRazorpayWebhook(body, signature)
      res.status(ok ? 200 : 400).json({ ok })
    } catch (err) {
      logger.error({ err }, 'Razorpay webhook failed')
      // A non-2xx answer makes Razorpay retry later.
      res.status(500).json({ ok: false })
    }
  },
]

// ---------------------------------------------------------------------------
// Owner panel
// ---------------------------------------------------------------------------

const ownerActor = (req: Request): Actor => ({
  type: 'platform',
  id: platformAuth(req).user.id,
  ip: req.ip ?? null,
})

export const ownerBillingRouter = Router()
ownerBillingRouter.use(authenticatePlatform)

ownerBillingRouter.get('/plans', async (_req, res) => {
  res.json(await listPlanDetails())
})

ownerBillingRouter.post('/plans', async (req, res) => {
  res.status(201).json(await createPlan(ownerActor(req), parse(planSchema, req.body)))
})

ownerBillingRouter.put('/plans/:id', async (req, res) => {
  res.json(await updatePlan(ownerActor(req), req.params.id as string, parse(planSchema, req.body)))
})

ownerBillingRouter.get('/organizations/:id/payments', async (req, res) => {
  const org = await getOrganizationDetail(db, req.params.id as string)
  res.json(await listPayments(org.id))
})

ownerBillingRouter.post('/organizations/:id/payments', async (req, res) => {
  const org = await getOrganizationDetail(db, req.params.id as string)
  const input = parse(manualPaymentSchema, req.body)
  res.status(201).json(await recordManualPayment(ownerActor(req), org.id, input))
})

ownerBillingRouter.get('/organizations/:id/payments/:paymentId/invoice.pdf', async (req, res) => {
  await sendInvoice(res, req.params.id as string, req.params.paymentId as string)
})

/** Revenue across all clients: totals, months, payments and who to follow up. */
ownerBillingRouter.get('/revenue', async (req, res) => {
  res.json(await getRevenueOverview(parse(revenueQuerySchema, req.query)))
})

ownerBillingRouter.get('/revenue/payments', async (req, res) => {
  res.json(await listRevenuePayments(parse(revenueQuerySchema, req.query)))
})

/** The invoice register for the accountant (GST returns), with the same filters. */
ownerBillingRouter.get('/revenue/invoices.xlsx', async (req, res) => {
  const query = parse(revenueQuerySchema, req.query)
  const bytes = await exportRevenue(query)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Invoices_${query.fy ?? 'this-year'}.xlsx"`,
  )
  res.setHeader('Cache-Control', 'no-store')
  res.end(bytes)
})
