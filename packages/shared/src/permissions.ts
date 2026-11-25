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
  /**
   * Work on the consignees they are the engineer of: fill in serial numbers,
   * installation status and remarks, set the engineer status, and attach documents.
   * People with this permission can be chosen as a consignee's engineer.
   */
  INSTALLATION_OWN: 'installation.own',
  /** Handle client feedback and service tickets. */
  TICKET_MANAGE: 'ticket.manage',
  /**
   * Add documents to the tenders they can see and make compliance letters.
   * Viewers don't have it: they only read.
   */
  TENDER_DOCUMENTS: 'tender.documents',
  /** See the Installed assets page. Agents don't have it unless the admin turns it on. */
  ASSET_VIEW: 'asset.view',
  /**
   * Read the installation report (consignees, engineers, serial numbers) of the
   * tenders they can see. Agents have it unless the admin turns it off.
   */
  INSTALLATION_VIEW: 'installation.view',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS)

/**
 * A role that works only on its own installation consignees (the Engineer
 * role). Such people must have a phone number, because admins call them
 * about installations.
 */
export function isEngineerRole(permissions: readonly string[]): boolean {
  return (
    permissions.includes(PERMISSIONS.INSTALLATION_OWN) &&
    !permissions.includes(PERMISSIONS.INSTALLATION_MANAGE)
  )
}

/** Can read installation reports: those who fill them in, engineers (their own part) and readers. */
export function canSeeInstallation(permissions: { has(p: string): boolean }): boolean {
  return (
    permissions.has(PERMISSIONS.INSTALLATION_MANAGE) ||
    permissions.has(PERMISSIONS.INSTALLATION_OWN) ||
    permissions.has(PERMISSIONS.INSTALLATION_VIEW)
  )
}

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
      PERMISSIONS.INSTALLATION_VIEW,
    ],
  },
  {
    key: 'engineer',
    name: 'Engineer',
    permissions: [
      PERMISSIONS.TENDER_VIEW_ASSIGNED,
      PERMISSIONS.TENDER_DOCUMENTS,
      PERMISSIONS.INSTALLATION_OWN,
      PERMISSIONS.TICKET_MANAGE,
      PERMISSIONS.ASSET_VIEW,
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    permissions: [
      PERMISSIONS.TENDER_VIEW_ALL,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.ASSET_VIEW,
      PERMISSIONS.INSTALLATION_VIEW,
    ],
  },
]
