import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env'
import { AppError } from '../../lib/errors'
import { logger } from '../../lib/logger'

/**
 * The few Razorpay calls we need, over its REST API (no SDK):
 * create an order, and check the signatures on a finished payment and on
 * webhooks. https://razorpay.com/docs/api/orders/
 */

export const razorpayConfigured = () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET)

export async function createRazorpayOrder(input: {
  amountPaise: number
  receipt: string
  notes: Record<string, string>
}): Promise<{ id: string }> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')
  let res: Response
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    logger.error({ err }, 'Razorpay order request failed')
    throw providerError()
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null
  if (!res.ok || typeof body?.id !== 'string') {
    logger.error({ status: res.status, body }, 'Razorpay refused the order')
    throw providerError()
  }
  return { id: body.id }
}

const providerError = () =>
  new AppError(
    502,
    'PAYMENT_PROVIDER_ERROR',
    'The payment service did not respond. Please try again in a minute.',
  )

function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(given, 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

/** The signature Razorpay checkout returns: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  if (!env.RAZORPAY_KEY_SECRET) return false
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return sameHex(expected, signature)
}

/** The X-Razorpay-Signature header: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex')
  return sameHex(expected, signature)
}
