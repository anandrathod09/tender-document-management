import {
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  FolderOpen,
  HardDrive,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Rows3,
  Upload,
  Users,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { PERMISSIONS, type Permission } from '@tdm/shared/permissions'
import { inMenuFor, SIDEBAR_GROUPS, type StageColor, type StageType } from '@tdm/shared/workflow'

export interface MenuItem {
  label: string
  /** Path plus optional query, e.g. /tenders?stage=… */
  to: string
  icon?: Component
  /** Coloured dot instead of an icon (workflow stages). */
  dot?: StageColor
  count?: number
  /** Hidden unless the signed-in user has this permission. */
  permission?: Permission
}

export interface MenuGroup {
  title?: string
  items: MenuItem[]
}

interface MenuStage {
  id: string
  label: string
  color: StageColor
  type: StageType
  menuRoles: string[] | null
}

/**
 * Client workspace menu. The tender stages come from the client's own
 * workflow: only those the admin shows to this role, grouped under headings
 * by their kind (Tenders, Bidding, Results, After the win).
 */
export function tenantMenu(
  stages: MenuStage[],
  counts: Record<string, number>,
  total: number,
  roleKey: string,
): MenuGroup[] {
  const mine = stages.filter((s) => inMenuFor(s, roleKey))
  const stageItems = (title: string): MenuItem[] => {
    const types = SIDEBAR_GROUPS.find((g) => g.title === title)!.types
    return mine
      .filter((s) => types.includes(s.type))
      .map((s) => ({
        label: s.label,
        to: `/tenders?stage=${s.id}`,
        dot: s.color,
        count: counts[s.id] ?? 0,
      }))
  }
  return [
    { items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }] },
    {
      title: 'Tenders',
      items: [
        { label: 'All tenders', to: '/tenders', icon: Rows3, count: total },
        ...stageItems('Tenders'),
        {
          label: 'Import from Excel',
          to: '/tenders/import',
          icon: Upload,
          permission: PERMISSIONS.TENDER_IMPORT,
        },
      ],
    },
    { title: 'Bidding', items: stageItems('Bidding') },
    { title: 'Results', items: stageItems('Results') },
    {
      title: 'After the win',
      items: [
        ...stageItems('After the win'),
        {
          label: 'Installed assets',
          to: '/assets',
          icon: HardDrive,
          permission: PERMISSIONS.ASSET_VIEW,
        },
        {
          label: 'Service tickets',
          to: '/tickets',
          icon: LifeBuoy,
          permission: PERMISSIONS.TICKET_MANAGE,
        },
        { label: 'Reports', to: '/reports', icon: BarChart3, permission: PERMISSIONS.REPORT_VIEW },
      ],
    },
    {
      title: 'Manage',
      items: [
        { label: 'Document library', to: '/library', icon: FolderOpen },
        {
          label: 'Bidding companies',
          to: '/settings/companies',
          icon: Landmark,
          permission: PERMISSIONS.COMPANY_MANAGE,
        },
        {
          label: 'Letter templates',
          to: '/settings/letters',
          icon: FileText,
          permission: PERMISSIONS.COMPANY_MANAGE,
        },
        { label: 'Users', to: '/users', icon: Users, permission: PERMISSIONS.USER_MANAGE },
        {
          label: 'Workflow stages',
          to: '/settings/stages',
          icon: ListChecks,
          permission: PERMISSIONS.WORKFLOW_MANAGE,
        },
        {
          label: 'Billing',
          to: '/billing',
          icon: CreditCard,
          permission: PERMISSIONS.SETTINGS_MANAGE,
        },
      ],
    },
  ]
}

/** Owner panel menu (our own team). */
export const ownerMenu: MenuGroup[] = [
  {
    items: [
      { label: 'Clients', to: '/organizations', icon: Building2 },
      { label: 'Plans', to: '/plans', icon: CreditCard },
    ],
  },
]
