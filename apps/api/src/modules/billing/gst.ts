import type { BillingCycle, PriceBreakdown } from '@tdm/shared'
import { env } from '../../config/env'
import type { Plan } from '../../db/schema'

/** The plan's price for a cycle in whole rupees, or null when it is not sold that way. */
export function planPrice(plan: Plan, cycle: BillingCycle): number | null {
  return cycle === 'yearly' ? plan.priceYearlyInr : plan.priceMonthlyInr
}

/**
 * Splits a price into the taxable amount and GST. Within the seller's state
 * the tax is CGST + SGST (half each); for another state it is IGST. When the
 * client's state is not known yet, it is treated as the seller's state.
 */
export function gstBreakdown(price: number, buyerStateCode: string | null): PriceBreakdown {
  const rate = env.GST_RATE_PERCENT
  let baseAmount: number
  let tax: number
  if (env.PRICES_INCLUDE_GST) {
    baseAmount = Math.round((price * 100) / (100 + rate))
    tax = price - baseAmount
  } else {
    baseAmount = price
    tax = Math.round((price * rate) / 100)
  }
  const sameState =
    (buyerStateCode ?? env.BILLING_SELLER_STATE_CODE) === env.BILLING_SELLER_STATE_CODE
  const cgst = sameState ? Math.floor(tax / 2) : 0
  const sgst = sameState ? tax - cgst : 0
  const igst = sameState ? 0 : tax
  return { baseAmount, cgst, sgst, igst, totalAmount: baseAmount + tax, gstRatePercent: rate }
}

/** Splits a total that was actually received (manual payments) back into base and GST. */
export function gstFromTotal(total: number, buyerStateCode: string | null): PriceBreakdown {
  const rate = env.GST_RATE_PERCENT
  const baseAmount = Math.round((total * 100) / (100 + rate))
  const tax = total - baseAmount
  const sameState =
    (buyerStateCode ?? env.BILLING_SELLER_STATE_CODE) === env.BILLING_SELLER_STATE_CODE
  const cgst = sameState ? Math.floor(tax / 2) : 0
  return {
    baseAmount,
    cgst,
    sgst: sameState ? tax - cgst : 0,
    igst: sameState ? 0 : tax,
    totalAmount: total,
    gstRatePercent: rate,
  }
}

/** Indian financial year of a date, e.g. "2026-27" (April to March). */
export function financialYear(d: Date): string {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** Adds whole months (or 12 for a year), keeping the day where the month allows. */
export function addPeriod(from: Date, cycle: BillingCycle): Date {
  const months = cycle === 'yearly' ? 12 : 1
  const d = new Date(from)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}
