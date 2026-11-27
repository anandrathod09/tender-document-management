import { z } from 'zod'
import { STAGE_TYPES } from './workflow'

// ---------------------------------------------------------------------------
// Installation reports (the old TMS "Hardware Installation Report")
// ---------------------------------------------------------------------------

export const ENGINEER_STATUSES = [
  'assigned',
  'site_visit',
  'design',
  'execution',
  'completed',
] as const
export type EngineerStatus = (typeof ENGINEER_STATUSES)[number]
export const ENGINEER_STATUS_LABELS: Record<EngineerStatus, string> = {
  assigned: 'Assigned',
  site_visit: 'Site visit',
  design: 'Design',
  execution: 'Installing',
  completed: 'Completed',
}

export const INSTALL_STATUSES = ['installed', 'not_installed', 'pending'] as const
export type InstallStatus = (typeof INSTALL_STATUSES)[number]

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-19')
  .or(z.literal(''))
  .transform((v) => v || null)
  .nullable()
  .optional()
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()

/**
 * How a report template records serial numbers (the old TMS "Report template 1 / 2"):
 * one common serial per row, or a monitor serial and a CPU serial per row.
 */
export const SERIAL_TYPES = ['common', 'split'] as const
export type SerialType = (typeof SERIAL_TYPES)[number]
export const SERIAL_TYPE_LABELS: Record<SerialType, string> = {
  common: 'Serial No, Installation Status, Remark',
  split: 'Monitor Serial No, CPU Serial No, Installation Status, Remark',
}

/** One row of a report template: a physical unit. */
export const unitInputSchema = z.object({
  /** Present for units already saved; keeps links from service tickets. */
  id: z.uuid().optional(),
  serialNumber: text(100),
  monitorSerial: text(100),
  cpuSerial: text(100),
  installStatus: z.enum(INSTALL_STATUSES).default('pending'),
  installedOn: isoDate,
  remarks: text(500),
})
export type UnitInput = z.output<typeof unitInputSchema>

/** Rows with nothing filled in are placeholders: they are not saved as units. */
export function isBlankUnit(u: UnitInput): boolean {
  return (
    !u.serialNumber &&
    !u.monitorSerial &&
    !u.cpuSerial &&
    !u.remarks &&
    !u.installedOn &&
    u.installStatus === 'pending'
  )
}

/** A report template inside a consignee: one item (name and configuration) and its rows. */
export const itemInputSchema = z.object({
  id: z.uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name and configuration is required').max(500),
  serialType: z.enum(SERIAL_TYPES).default('common'),
  warrantyMonths: z.number().int().min(0).max(240).default(0),
  /** Rows to show and print; rows left empty are kept as placeholders only. */
  quantity: z.number().int().min(1).max(500).default(1),
  units: z.array(unitInputSchema).max(500).default([]),
})

export const consigneeInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Consignee name is required').max(200),
  designation: text(120),
  phone: text(30),
  email: text(254),
  fax: text(30),
  engineerId: z.uuid().nullable().optional(),
  status: z.enum(ENGINEER_STATUSES).default('assigned'),
  callAlignedDate: isoDate,
  items: z.array(itemInputSchema).max(100).default([]),
})

/** What the engineer on a consignee may change: its status and the rows of its templates. */
export const consigneeWorkSchema = z.object({
  status: z.enum(ENGINEER_STATUSES),
  items: z
    .array(z.object({ id: z.uuid(), units: z.array(unitInputSchema).max(500).default([]) }))
    .max(100)
    .default([]),
})

export const installationReportSchema = z.object({
  biddingCompanyId: z.uuid().nullable().optional(),
  poNumber: text(100),
  poDate: isoDate,
  reportDate: isoDate,
  customerName: text(200),
  customerAddress: text(1000),
  stateOffice: text(200),
  contactPersonName: text(120),
  contactPersonDesignation: text(120),
  contactPersonPhone: text(30),
  department: text(200),
  consignees: z.array(consigneeInputSchema).max(500).default([]),
})
export type InstallationReportInput = z.input<typeof installationReportSchema>

export interface InstalledAssetRow {
  id: string
  itemName: string
  makeModel: string | null
  serialNumber: string | null
  monitorSerial: string | null
  cpuSerial: string | null
  installStatus: InstallStatus
  installedOn: string | null
  warrantyMonths: number
  remarks: string | null
}

export interface InstallationItemRow {
  id: string
  itemName: string
  serialType: SerialType
  warrantyMonths: number
  quantity: number
  units: InstalledAssetRow[]
}

export interface ConsigneeRow {
  id: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  fax: string | null
  engineer: { id: string; name: string; email: string; phone: string | null } | null
  status: EngineerStatus
  callAlignedDate: string | null
  items: InstallationItemRow[]
  /** Files the engineer or admin attached to this consignee (certificates, site photos). */
  documents: ConsigneeDocument[]
}

export interface ConsigneeDocument {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  uploadedBy: { id: string; name: string } | null
  createdAt: string
}

export interface InstallationReport {
  id: string
  tenderId: string
  biddingCompanyId: string | null
  poNumber: string | null
  poDate: string | null
  reportDate: string | null
  customerName: string | null
  customerAddress: string | null
  stateOffice: string | null
  contactPersonName: string | null
  contactPersonDesignation: string | null
  contactPersonPhone: string | null
  department: string | null
  consignees: ConsigneeRow[]
  /** True for an engineer: only their own consignees are included. */
  ownOnly: boolean
  updatedAt: string
}

/** A consignee with its tender and progress, for the engineer's "My Assigned Installations". */
export interface InstallationSite {
  id: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  callAlignedDate: string | null
  status: EngineerStatus
  engineer: { id: string; name: string } | null
  tender: {
    id: string
    referenceNo: string
    title: string
    buyerOrganization: string | null
    location: string | null
    value: number
    stageLabel: string
  }
  /** Rows across its report templates (the quantity to install). */
  totalItems: number
  installedItems: number
}

// ---------------------------------------------------------------------------
// Installed assets (one row per installed unit, with warranty)
// ---------------------------------------------------------------------------

export const WARRANTY_STATUSES = [
  'expired',
  'expiring_30',
  'expiring_90',
  'active',
  'not_set',
] as const
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number]
export const WARRANTY_LABELS: Record<WarrantyStatus, string> = {
  expired: 'Expired',
  expiring_30: 'Ends within 30 days',
  expiring_90: 'Ends in 31–90 days',
  active: 'Active',
  not_set: 'Not set',
}

export const assetListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  warranty: z.enum(WARRANTY_STATUSES).optional(),
  installStatus: z.enum(INSTALL_STATUSES).optional(),
  engineerId: z.uuid().optional(),
  tenderId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export interface AssetListItem extends InstalledAssetRow {
  tender: { id: string; referenceNo: string; title: string }
  customerName: string | null
  consignee: { id: string; name: string }
  engineer: { id: string; name: string } | null
  warrantyStart: string | null
  warrantyEnd: string | null
  daysLeft: number | null
  warrantyStatus: WarrantyStatus
}

export interface AssetPage {
  items: AssetListItem[]
  total: number
  page: number
  pageSize: number
  /** Units per warranty status, for the same filters except the warranty one. */
  warrantyCounts: Record<WarrantyStatus, number>
}

// ---------------------------------------------------------------------------
// Client feedback and service tickets
// ---------------------------------------------------------------------------

export const TICKET_TYPES = ['complaint', 'query', 'suggestion', 'appreciation'] as const
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const TICKET_STATUSES = [
  'new',
  'assigned_to_oem',
  'in_progress',
  'resolved',
  'closed',
  'reopened',
] as const
export type TicketType = (typeof TICKET_TYPES)[number]
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]
export type TicketStatus = (typeof TICKET_STATUSES)[number]
/** Who raised the ticket: staff in the app, or a customer on the public support page. */
export const TICKET_SOURCES = ['staff', 'support_page'] as const
export type TicketSource = (typeof TICKET_SOURCES)[number]
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  assigned_to_oem: 'With OEM',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
}
/** Statuses that mean the ticket still needs work. */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = [
  'new',
  'assigned_to_oem',
  'in_progress',
  'reopened',
]

export const createTicketSchema = z.object({
  title: z.string().trim().min(3, 'Give the ticket a short title').max(200),
  description: z.string().trim().min(1, 'Describe the problem or feedback').max(5000),
  type: z.enum(TICKET_TYPES).default('complaint'),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  tenderId: z.uuid().nullable().optional(),
  assetId: z.uuid().nullable().optional(),
  customerName: text(200),
  contactName: text(120),
  contactPhone: text(30),
  contactEmail: text(254),
  assignedTo: z.uuid().nullable().optional(),
})
export type CreateTicketInput = z.input<typeof createTicketSchema>

export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES),
    priority: z.enum(TICKET_PRIORITIES),
    assignedTo: z.uuid().nullable(),
    oemReference: text(100),
    resolutionNotes: text(5000),
    satisfaction: z.number().int().min(1).max(5).nullable(),
    /** Added to the ticket's history. */
    note: z.string().trim().max(2000).optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateTicketInput = z.input<typeof updateTicketSchema>

export const ticketListQuerySchema = z.object({
  status: z.enum([...TICKET_STATUSES, 'open'] as const).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  q: z.string().trim().max(200).optional(),
  assignedTo: z.union([z.literal('me'), z.uuid()]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export interface TicketSummary {
  id: string
  number: number
  title: string
  type: TicketType
  priority: TicketPriority
  status: TicketStatus
  source: TicketSource
  customerName: string | null
  tender: { id: string; referenceNo: string } | null
  asset: { id: string; itemName: string; serialNumber: string | null } | null
  assignedTo: { id: string; name: string } | null
  createdAt: string
  updatedAt: string
}

export interface TicketDetail extends TicketSummary {
  description: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  oemReference: string | null
  resolutionNotes: string | null
  resolvedAt: string | null
  satisfaction: number | null
  /** Empty when a customer raised it on the support page. */
  createdBy: { id: string; name: string } | null
  updates: {
    id: string
    status: TicketStatus | null
    note: string | null
    /** Empty for the customer's own entry from the support page. */
    by: { id: string; name: string } | null
    at: string
  }[]
}

export interface TicketPage {
  items: TicketSummary[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------------------
// Public support page (no sign-in): customers check warranty by serial number
// and raise a service request.
// ---------------------------------------------------------------------------

export const MAX_SUPPORT_EMAILS = 5

export interface SupportPageInfo {
  /** The client has turned the page on. */
  enabled: boolean
  /** The client's name, shown at the top of the page. */
  name: string
}

export const supportLookupSchema = z.object({
  serial: z.string().trim().min(1, 'Enter the serial number').max(100),
})

/** in = still covered, out = ended, unknown = no warranty recorded for the unit. */
export const WARRANTY_COVERS = ['in', 'out', 'unknown'] as const
export type WarrantyCover = (typeof WARRANTY_COVERS)[number]

/** Only what a customer may see: no tender, prices, engineers or contacts. */
export interface PublicAsset {
  id: string
  itemName: string
  /** The serial number that matched. */
  serialNumber: string
  customerName: string | null
  installedOn: string | null
  warrantyEnd: string | null
  daysLeft: number | null
  warranty: WarrantyCover
}

export const publicTicketSchema = z.object({
  serial: z.string().trim().min(1).max(100),
  assetId: z.uuid(),
  contactName: z.string().trim().min(1, 'Enter your name').max(120),
  contactPhone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => {
      const digits = v.replace(/\D/g, '').length
      return digits >= 7 && digits <= 15
    }, 'Enter a valid phone number'),
  contactEmail: z
    .union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address or leave it empty'))])
    .optional()
    .transform((v) => v || null),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the problem (at least 10 characters)')
    .max(2000),
  /** Hidden from people; a bot that fills it in is ignored. */
  website: z.string().max(200).optional(),
})
export type PublicTicketInput = z.input<typeof publicTicketSchema>

export interface PublicTicketResult {
  /** e.g. TKT-0042 */
  ticketNo: string
  warranty: WarrantyCover
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export interface MonthlyRow {
  /** YYYY-MM */
  month: string
  added: number
  submitted: number
  won: number
  lost: number
  wonValue: number
}

export interface AgentRow {
  agent: { id: string; name: string }
  assigned: number
  inProgress: number
  submitted: number
  won: number
  lost: number
  wonValue: number
  winRate: number | null
}

export interface ReportSummary {
  from: string
  to: string
  totals: {
    added: number
    submitted: number
    won: number
    lost: number
    wonValue: number
    winRate: number | null
  }
  monthly: MonthlyRow[]
  agents: AgentRow[]
  byStageType: Record<(typeof STAGE_TYPES)[number], number>
  openTickets: number
  warrantiesEndingSoon: number
}
