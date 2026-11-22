import type { InstallationItemRow, InstalledAssetRow, InstallStatus, SerialType } from '@tdm/shared'
import type { BadgeColor } from '@/utils/format'

/** What the "Add item" popup returns. */
export interface NewItem {
  itemName: string
  serialType: SerialType
  quantity: number
  warrantyMonths: number
}

/** Same heading style as the sections of the Tender Overview card. */
export const SECTION_HEADING =
  'text-sm font-semibold tracking-wider text-gray-700 uppercase dark:text-gray-300'

/**
 * How an item records serial numbers (the old TMS "Report template 1 / 2"):
 * one serial number per unit, or a monitor and a CPU serial number per unit.
 */
export const SERIAL_TYPE_OPTIONS: { value: SerialType; label: string; hint: string }[] = [
  {
    value: 'common',
    label: 'One serial number',
    hint: 'Printers, UPS, signal controllers…',
  },
  {
    value: 'split',
    label: 'Monitor and CPU serial numbers',
    hint: 'Desktop computers with a separate monitor',
  },
]
export const SERIAL_TYPE_SHORT: Record<SerialType, string> = {
  common: 'One serial number',
  split: 'Monitor + CPU serials',
}

export const INSTALL_BADGE: Record<InstallStatus, { label: string; color: BadgeColor }> = {
  installed: { label: 'Installed', color: 'success' },
  pending: { label: 'Pending', color: 'warning' },
  not_installed: { label: 'Not installed', color: 'error' },
}

export const INSTALLED_OPTIONS: { value: InstallStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'installed', label: 'Yes' },
  { value: 'not_installed', label: 'No' },
]

/** The item's rows: saved units, then empty rows up to its quantity. */
export function rowsOf(item: InstallationItemRow): (InstalledAssetRow | null)[] {
  const rows: (InstalledAssetRow | null)[] = [...item.units]
  while (rows.length < item.quantity) rows.push(null)
  return rows
}

export function warrantyText(months: number): string {
  if (!months) return 'No warranty'
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y && `${y} year${y > 1 ? 's' : ''}`, m && `${m} month${m > 1 ? 's' : ''}`]
    .filter(Boolean)
    .join(' ')
}
