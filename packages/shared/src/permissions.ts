/**
 * Named actions a role can be allowed to do. The API checks these on every
 * protected endpoint; the web app uses them to show or hide menu items.
 */
export const PERMISSIONS = {
  TENDER_VIEW_ALL: 'tender.view_all',
  TENDER_VIEW_ASSIGNED: 'tender.view_assigned',
  TENDER_ASSIGN: 'tender.assign',
  TENDER_MOVE_STAGE: 'tender.move_stage',
  TENDER_IMPORT: 'tender.import',
  COMPANY_MANAGE: 'company.manage',
  USER_MANAGE: 'user.manage',
  WORKFLOW_MANAGE: 'workflow.manage',
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  SETTINGS_MANAGE: 'settings.manage',
  /** Fill in installation reports (consignees, serial numbers) for won tenders. */
  INSTALLATION_MANAGE: 'installation.manage',
  /** Handle client feedback and service tickets. */
  TICKET_MANAGE: 'ticket.manage',
  /**
   * Add documents to the tenders they can see and make compliance letters.
   * Viewers don't have it: they only read.
   */
  TENDER_DOCUMENTS: 'tender.documents',
  /** See the Installed assets page. Agents don't have it unless the admin turns it on. */
  ASSET_VIEW: 'asset.view',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

export type DefaultRoleKey = 'admin' | 'agent' | 'engineer' | 'viewer'

/** Roles copied into every new client workspace. */
export const DEFAULT_ROLES: { key: DefaultRoleKey; name: string; permissions: Permission[] }[] = [
  { key: 'admin', name: 'Admin', permissions: ALL_PERMISSIONS },
  {
    key: 'agent',
    name: 'Agent',
    permissions: [
      PERMISSIONS.TENDER_VIEW_ASSIGNED,
      PERMISSIONS.TENDER_MOVE_STAGE,
      PERMISSIONS.TENDER_DOCUMENTS,
      PERMISSIONS.REPORT_VIEW,
    ],
  },
  {
    key: 'engineer',
    name: 'Engineer',
    permissions: [
      PERMISSIONS.TENDER_VIEW_ASSIGNED,
      PERMISSIONS.TENDER_DOCUMENTS,
      PERMISSIONS.INSTALLATION_MANAGE,
      PERMISSIONS.TICKET_MANAGE,
      PERMISSIONS.ASSET_VIEW,
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    permissions: [PERMISSIONS.TENDER_VIEW_ALL, PERMISSIONS.REPORT_VIEW, PERMISSIONS.ASSET_VIEW],
  },
]
