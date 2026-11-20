import type { StageColor } from '@tdm/shared/workflow'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/** ₹15,00,000 (Indian grouping). Zero shows as a dash, as it usually means "not given". */
export const formatINR = (n: number | null | undefined) => (n ? inr.format(n) : '—')

/** ₹1.25 Cr, ₹4.20 L, ₹15.00 K, as the original TMS lists amounts. */
export function formatINRShort(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)} L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(2)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

const deadlineFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
export const formatDeadline = (date: string) => deadlineFmt.format(new Date(`${date}T00:00:00Z`))

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Days from today to a YYYY-MM-DD deadline (negative when past). */
export function daysUntil(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${localToday()}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** "25 days left", "Tomorrow", "Today" or "Expired", as in the original TMS. */
export function deadlineHint(date: string): {
  text: string
  tone: 'urgent' | 'soon' | 'normal' | 'past'
} {
  const d = daysUntil(date)
  if (d < 0) return { text: 'Expired', tone: 'past' }
  if (d === 0) return { text: 'Today', tone: 'urgent' }
  if (d === 1) return { text: 'Tomorrow', tone: 'soon' }
  if (d <= 7) return { text: `${d} days left`, tone: 'soon' }
  return { text: `${d} days left`, tone: 'normal' }
}

/** Solid stage badges, matching the status badges of the original TMS. */
export const stageColorClasses: Record<StageColor, string> = {
  gray: 'bg-[#7F7F7F] text-white',
  blue: 'bg-blue-500 text-white',
  indigo: 'bg-indigo-500 text-white',
  amber: 'bg-[#FC9A1D] text-white',
  teal: 'bg-[#008082] text-white',
  green: 'bg-[#7AA90D] text-white',
  red: 'bg-[#C40233] text-white',
  purple: 'bg-[#A855D4] text-white',
}

/** Small coloured dot for the sidebar. */
export const stageDotClasses: Record<StageColor, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-brand-500',
  indigo: 'bg-indigo-500',
  amber: 'bg-warning-500',
  teal: 'bg-teal-500',
  green: 'bg-success-500',
  red: 'bg-error-500',
  purple: 'bg-purple-500',
}
