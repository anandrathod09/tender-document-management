import type { TicketPriority, TicketStatus } from '@tdm/shared'
import type { BadgeColor } from '@/utils/format'

export const ticketNo = (n: number) => `TKT-${String(n).padStart(4, '0')}`

export const statusColor: Record<TicketStatus, BadgeColor> = {
  new: 'info',
  assigned_to_oem: 'warning',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'gray',
  reopened: 'error',
}

export const priorityColor: Record<TicketPriority, BadgeColor> = {
  low: 'gray',
  medium: 'info',
  high: 'warning',
  critical: 'error',
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
