import type { CheckoutOrder } from '@tdm/shared'

/** What Razorpay checkout returns after a successful payment. */
export interface RazorpaySuccess {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open(): void
  on(event: 'payment.failed', handler: (resp: { error?: { description?: string } }) => void): void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

let loading: Promise<void> | null = null

/** Loads Razorpay's checkout script once, only when someone pays. */
function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('Could not load the payment window. Check your connection and try again.'))
    }
    document.head.appendChild(s)
  })
  return loading
}

/**
 * Opens Razorpay checkout for an order. Resolves with the payment proof when
 * paid, with null when the person closes the window.
 */
export async function payWithRazorpay(order: CheckoutOrder): Promise<RazorpaySuccess | null> {
  await loadScript()
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: '#3b82f6' },
      handler: (resp: RazorpaySuccess) => resolve(resp),
      modal: { ondismiss: () => resolve(null) },
    })
    rzp.on('payment.failed', (resp) =>
      reject(new Error(resp.error?.description ?? 'The payment did not go through.')),
    )
    rzp.open()
  })
}
