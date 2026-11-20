import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { GST_STATES } from '@tdm/shared'
import { env } from '../../config/env'
import type { Organization, Payment, Plan } from '../../db/schema'

/**
 * A GST tax invoice for a paid plan period, built fresh from the payment row
 * (whose amounts and "bill to" were frozen when it was paid). The standard
 * PDF fonts have no rupee sign, so amounts are written "Rs.".
 */

/** SAC for software provided as a service; change if your accountant advises another. */
const SAC_CODE = '998314'

const stateName = (code: string | null) =>
  code ? `${GST_STATES.find((s) => s.code === code)?.name ?? ''} (${code})` : '—'

const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN')}.00`

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}
function belowThousand(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ')
}

/** Rupees in words with Indian grouping: "One Lakh Twenty Thousand Rupees Only". */
export function rupeesInWords(n: number): string {
  if (n === 0) return 'Zero Rupees Only'
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000
  if (crore) parts.push(`${belowThousand(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (rest) parts.push(belowThousand(rest))
  return `${parts.join(' ')} Rupees Only`
}

export async function buildInvoicePdf(input: {
  payment: Payment
  plan: Plan
  org: Organization
}): Promise<Uint8Array> {
  const { payment, plan, org } = input
  // Dates are shown in the client's own time zone (Indian time by default).
  const timeZone = org.timezone || 'Asia/Kolkata'
  const date = (d: Date) =>
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone })
  const doc = await PDFDocument.create()
  doc.setTitle(`Invoice ${payment.invoiceNumber}`)
  const page = doc.addPage([595, 842])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const grey = rgb(0.4, 0.4, 0.45)
  const line = rgb(0.85, 0.86, 0.88)
  const left = 48
  const right = 547
  let y = 790

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    yy: number,
    opts: {
      font?: PDFFont
      size?: number
      color?: ReturnType<typeof rgb>
      alignRight?: boolean
    } = {},
  ) => {
    const font = opts.font ?? regular
    const size = opts.size ?? 10
    const w = font.widthOfTextAtSize(s, size)
    p.drawText(s, {
      x: opts.alignRight ? x - w : x,
      y: yy,
      size,
      font,
      color: opts.color ?? rgb(0.1, 0.1, 0.12),
    })
  }
  /** Wraps text to a width; returns the y below it. */
  const para = (s: string, x: number, yy: number, width: number, size = 10, font = regular) => {
    for (const rawLine of s.split('\n')) {
      let lineText = ''
      for (const word of rawLine.split(/\s+/)) {
        const next = lineText ? `${lineText} ${word}` : word
        if (font.widthOfTextAtSize(next, size) > width && lineText) {
          text(page, lineText, x, yy, { size, font })
          yy -= size + 3
          lineText = word
        } else lineText = next
      }
      if (lineText) {
        text(page, lineText, x, yy, { size, font })
        yy -= size + 3
      }
    }
    return yy
  }
  const rule = (yy: number) =>
    page.drawLine({
      start: { x: left, y: yy },
      end: { x: right, y: yy },
      thickness: 1,
      color: line,
    })

  // Heading
  text(page, 'TAX INVOICE', left, y, { font: bold, size: 18 })
  text(page, env.BILLING_SELLER_NAME, right, y, { font: bold, size: 12, alignRight: true })
  y -= 16
  let sellerY = y
  for (const l of env.BILLING_SELLER_ADDRESS.split(/\n|,\s*(?=[A-Z0-9])/).slice(0, 4)) {
    text(page, l.trim(), right, sellerY, { size: 9, color: grey, alignRight: true })
    sellerY -= 12
  }
  if (env.BILLING_SELLER_GSTIN) {
    text(page, `GSTIN: ${env.BILLING_SELLER_GSTIN}`, right, sellerY, { size: 9, alignRight: true })
    sellerY -= 12
  }
  text(page, `State: ${stateName(env.BILLING_SELLER_STATE_CODE)}`, right, sellerY, {
    size: 9,
    color: grey,
    alignRight: true,
  })
  y = Math.min(y - 10, sellerY - 18)
  rule(y)
  y -= 22

  // Invoice facts and bill-to
  const billTo = payment.billTo ?? { name: org.name, address: null, gstin: null, stateCode: null }
  text(page, 'Bill to', left, y, { font: bold, size: 10 })
  text(page, 'Invoice no.', 340, y, { size: 9, color: grey })
  text(page, payment.invoiceNumber ?? '', right, y, { font: bold, size: 10, alignRight: true })
  y -= 14
  text(page, 'Invoice date', 340, y, { size: 9, color: grey })
  text(page, date(payment.paidAt ?? payment.createdAt), right, y, { size: 10, alignRight: true })
  y -= 14
  text(page, 'Place of supply', 340, y, { size: 9, color: grey })
  text(page, stateName(billTo.stateCode ?? env.BILLING_SELLER_STATE_CODE), right, y, {
    size: 10,
    alignRight: true,
  })
  let billY = y + 14
  billY = para(billTo.name, left, billY, 260, 10, bold)
  if (billTo.address) billY = para(billTo.address, left, billY, 260, 9)
  if (billTo.gstin) {
    text(page, `GSTIN: ${billTo.gstin}`, left, billY, { size: 9 })
    billY -= 12
  }
  y = Math.min(y, billY) - 24

  // Line item
  page.drawRectangle({
    x: left,
    y: y - 6,
    width: right - left,
    height: 22,
    color: rgb(0.96, 0.97, 0.98),
  })
  text(page, 'Description', left + 8, y, { font: bold, size: 9 })
  text(page, 'SAC', 360, y, { font: bold, size: 9 })
  text(page, 'Amount', right - 8, y, { font: bold, size: 9, alignRight: true })
  y -= 26
  const period =
    payment.periodStart && payment.periodEnd
      ? `${date(payment.periodStart)} to ${date(payment.periodEnd)}`
      : ''
  const desc = `${env.PRODUCT_NAME}: ${plan.name} plan, ${payment.cycle === 'yearly' ? 'yearly' : 'monthly'} subscription${period ? `\nPeriod: ${period}` : ''}`
  const itemTop = y
  y = para(desc, left + 8, y, 290, 10)
  text(page, SAC_CODE, 360, itemTop, { size: 10 })
  text(page, rs(payment.baseAmount), right - 8, itemTop, { size: 10, alignRight: true })
  y -= 8
  rule(y)
  y -= 18

  // Totals
  const rate = env.GST_RATE_PERCENT
  const rows: [string, number][] = [['Taxable value', payment.baseAmount]]
  if (payment.igst) rows.push([`IGST @ ${rate}%`, payment.igst])
  else {
    rows.push([`CGST @ ${rate / 2}%`, payment.cgst])
    rows.push([`SGST @ ${rate / 2}%`, payment.sgst])
  }
  for (const [label, amount] of rows) {
    text(page, label, 360, y, { size: 10, color: grey })
    text(page, rs(amount), right - 8, y, { size: 10, alignRight: true })
    y -= 16
  }
  page.drawLine({
    start: { x: 352, y: y + 8 },
    end: { x: right, y: y + 8 },
    thickness: 1,
    color: line,
  })
  y -= 4
  text(page, 'Total', 360, y, { font: bold, size: 11 })
  text(page, rs(payment.totalAmount), right - 8, y, { font: bold, size: 11, alignRight: true })
  y -= 22
  y = para(`Amount in words: ${rupeesInWords(payment.totalAmount)}`, left, y, right - left, 9)
  y -= 14

  // Payment
  text(page, 'Payment', left, y, { font: bold, size: 10 })
  y -= 14
  const how =
    payment.method === 'razorpay'
      ? `Paid online (Razorpay)${payment.razorpayPaymentId ? `, payment ID ${payment.razorpayPaymentId}` : ''}`
      : `Received by bank transfer / cheque${payment.reference ? `, reference ${payment.reference}` : ''}`
  y = para(`${how} on ${date(payment.paidAt ?? payment.createdAt)}.`, left, y, right - left, 9)

  text(page, 'This is a computer-generated invoice and does not need a signature.', left, 60, {
    size: 8,
    color: grey,
  })
  if (env.BILLING_SUPPORT_EMAIL) {
    text(page, `Questions: ${env.BILLING_SUPPORT_EMAIL}`, right, 60, {
      size: 8,
      color: grey,
      alignRight: true,
    })
  }
  return doc.save()
}
