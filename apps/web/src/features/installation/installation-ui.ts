import type { InstallationItemRow, InstalledAssetRow, InstallStatus, SerialType } from '@tdm/shared'
import type { BadgeColor } from '@/utils/format'

/** The two template types of the old TMS "Select Report Template" popup. */
export const TEMPLATE_TYPES: { value: SerialType; label: string; description: string }[] = [
  {
    value: 'split',
    label: 'Report template 1 (Monitor Serial No, CPU Serial No, Installation Status, Remark)',
    description: 'Includes separate Monitor and CPU serial numbers',
  },
  {
    value: 'common',
    label: 'Report template 2 (Serial No, Installation Status, Remark)',
    description: 'Includes a single common serial number for all items',
  },
]

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

/** The template's rows: saved units, then empty rows up to its quantity. */
export function rowsOf(item: InstallationItemRow): (InstalledAssetRow | null)[] {
  const rows: (InstalledAssetRow | null)[] = [...item.units]
  while (rows.length < item.quantity) rows.push(null)
  return rows
}

export function warrantyText(months: number): string {
  return `${Math.floor(months / 12)} Year(s) ${months % 12} Month(s)`
}
