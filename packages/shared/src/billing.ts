import { z } from 'zod'
import {
  BILLING_CYCLES,
  PAYMENT_METHODS,
  type BillingCycle,
  type OrganizationStatus,
  type PaymentMethod,
  type PaymentStatus,
} from './workspace'

/** GST state codes, used to choose CGST + SGST (same state) or IGST (other state). */
export const GST_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
]
const STATE_CODES = GST_STATES.map((s) => s.code)

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const rupees = z.number().int().min(0).max(100_000_000)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()

/** A plan, as created or edited in the owner panel. Prices are whole rupees; empty = not sold that way. */
export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,50}$/, 'Use 2–50 lowercase letters, digits or hyphens'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: optionalText(255),
  maxUsers: z.number().int().min(1).max(10_000),
  maxStorageGb: z.number().int().min(1).max(10_000),
  maxTendersPerMonth: z.number().int().min(1).max(1_000_000),
  maxCompanies: z.number().int().min(1).max(1000).default(3),
  priceMonthlyInr: rupees.nullable(),
  priceYearlyInr: rupees.nullable(),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
})
export type PlanInput = z.input<typeof planSchema>

export const checkoutSchema = z.object({
  planId: z.uuid(),
  cycle: z.enum(BILLING_CYCLES),
})
export type CheckoutInput = z.infer<typeof checkoutSchema>

/** What Razorpay checkout hands back after a successful payment. */
export const confirmPaymentSchema = z.object({
  paymentId: z.uuid(),
  razorpayOrderId: z.string().trim().min(1).max(64),
  razorpayPaymentId: z.string().trim().min(1).max(64),
  razorpaySignature: z.string().trim().min(1).max(256),
})

/** "Bill to" details printed on the client's invoices. */
export const billingDetailsSchema = z.object({
  billingName: z.string().trim().min(1, 'Company name is required').max(200),
  billingAddress: optionalText(500),
  billingGstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || GSTIN_PATTERN.test(v), 'Enter a valid 15-character GSTIN')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  billingStateCode: z.enum(STATE_CODES as [string, ...string[]], {
    message: 'Choose the state',
  }),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email')
    .transform((v) => v || null)
    .nullable()
    .optional(),
})
export type BillingDetailsInput = z.input<typeof billingDetailsSchema>

/** A payment we received outside Razorpay (bank transfer, cheque), recorded in the owner panel. */
export const manualPaymentSchema = z.object({
  planId: z.uuid(),
  cycle: z.enum(BILLING_CYCLES),
  /** Total received; leave out to use the plan price with GST. */
  totalAmount: rupees.optional(),
  reference: z.string().trim().min(1, 'Enter the UTR or cheque number').max(100),
  notes: optionalText(500),
})
export type ManualPaymentInput = z.input<typeof manualPaymentSchema>

export interface PlanDetail {
  id: string
  code: string
  name: string
  description: string | null
  maxUsers: number
  maxStorageGb: number
  maxTendersPerMonth: number
  maxCompanies: number
  priceMonthlyInr: number | null
  priceYearlyInr: number | null
  isPublic: boolean
  isActive: boolean
  sortOrder: number
  /** Clients currently on this plan. */
  clientCount: number
}

/** Amounts in whole rupees. CGST+SGST within the seller's state, IGST otherwise. */
export interface PriceBreakdown {
  baseAmount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  gstRatePercent: number
}

export type SubscriptionState = 'trial' | 'active' | 'grace' | 'expired'

export interface PaymentSummary extends PriceBreakdown {
  id: string
  plan: { id: string; name: string }
  cycle: BillingCycle
  method: PaymentMethod
  status: PaymentStatus
  periodStart: string | null
  periodEnd: string | null
  invoiceNumber: string | null
  reference: string | null
  paidAt: string | null
  createdAt: string
}

export interface BillingDetails {
  billingName: string | null
  billingAddress: string | null
  billingGstin: string | null
  billingStateCode: string | null
  billingEmail: string | null
}

export interface BillingOverview {
  plan: PlanDetail
  cycle: BillingCycle | null
  state: SubscriptionState
  /** End of the paid period, or of the trial. */
  endsAt: string | null
  /** After this the client counts as expired. */
  graceEndsAt: string | null
  usage: {
    users: number
    storageBytes: number
    tendersThisMonth: number
    /** Active bidding companies. */
    companies: number
  }
  /** Plans the client can choose. */
  plans: PlanDetail[]
  /** Razorpay is set up; otherwise the client is asked to contact us. */
  onlinePayment: boolean
  supportEmail: string | null
  pricesIncludeGst: boolean
  gstRatePercent: number
  details: BillingDetails
  payments: PaymentSummary[]
}

/** Everything the browser needs to open Razorpay checkout. */
export interface CheckoutOrder {
  paymentId: string
  keyId: string
  orderId: string
  /** In paise. */
  amount: number
  currency: 'INR'
  name: string
  description: string
  prefill: { name: string; email: string }
  breakdown: PriceBreakdown
}

/** How many active bidding companies the client has, and how many the plan allows. */
export interface CompanyLimit {
  used: number
  max: number
}

// ---------------------------------------------------------------------------
// Owner panel: revenue

/** "2026-27": the Indian financial year, April to March. */
export const FINANCIAL_YEAR_PATTERN = /^\d{4}-\d{2}$/

export const revenueQuerySchema = z.object({
  fy: z.string().regex(FINANCIAL_YEAR_PATTERN, 'Pick a financial year').optional(),
  organizationId: z.string().max(36).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
})
export type RevenueQuery = z.infer<typeof revenueQuerySchema>

/** Paid payments added up. Amounts in whole rupees. */
export interface RevenueTotals {
  count: number
  baseAmount: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
}

export interface RevenueMonth extends RevenueTotals {
  /** YYYY-MM, by the paid date in India. */
  month: string
}

/**
 * A client to follow up: paid period ends soon (renewal), already ended
 * (overdue), or a trial that ends soon or has ended without a payment.
 */
export interface RevenueFollowUp {
  organization: { id: string; name: string; slug: string; status: OrganizationStatus }
  kind: 'renewal' | 'overdue' | 'trial_ending' | 'trial_ended'
  date: string
  plan: string
  cycle: BillingCycle | null
  /** Plan price for one period, before GST; null when priced on request. */
  expectedBase: number | null
}

export interface RevenueOverview {
  financialYear: string
  /** Financial years that can be picked, newest first. */
  years: string[]
  thisMonth: RevenueTotals
  year: RevenueTotals
  /** Clients with a paid period running now. */
  payingClients: number
  /** The 12 months of the financial year, April first. */
  months: RevenueMonth[]
  followUps: RevenueFollowUp[]
}

export interface RevenuePayment extends PaymentSummary {
  organization: { id: string; name: string; slug: string }
  billToName: string | null
  billToGstin: string | null
}
