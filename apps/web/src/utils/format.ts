import type { OrganizationStatus, UserStatus } from '@tdm/shared'

export type BadgeColor = 'success' | 'warning' | 'error' | 'info' | 'gray'

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—')
export const formatDateTime = (iso: string | null) =>
  iso ? dateTimeFmt.format(new Date(iso)) : 'Never'

export const userStatusBadge: Record<UserStatus, { label: string; color: BadgeColor }> = {
  active: { label: 'Active', color: 'success' },
  invited: { label: 'Invited', color: 'info' },
  suspended: { label: 'Suspended', color: 'error' },
}

export const orgStatusBadge: Record<OrganizationStatus, { label: string; color: BadgeColor }> = {
  trial: { label: 'Trial', color: 'info' },
  active: { label: 'Active', color: 'success' },
  suspended: { label: 'Suspended', color: 'error' },
  closed: { label: 'Closed', color: 'gray' },
}
