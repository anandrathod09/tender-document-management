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

export const assetInputSchema = z.object({
  /** Present for units already saved; keeps links from service tickets. */
  id: z.uuid().optional(),
  itemName: z.string().trim().min(1, 'Item name is required').max(500),
  makeModel: text(200),
  serialNumber: text(100),
  monitorSerial: text(100),
  cpuSerial: text(100),
  installStatus: z.enum(INSTALL_STATUSES).default('pending'),
  installedOn: isoDate,
  warrantyMonths: z.number().int().min(0).max(240).default(0),
  remarks: text(500),
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
  assets: z.array(assetInputSchema).max(2000).default([]),
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

export interface ConsigneeRow {
  id: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  fax: string | null
  engineer: { id: string; name: string } | null
  status: EngineerStatus
  callAlignedDate: string | null
  assets: InstalledAssetRow[]
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
  updatedAt: string
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
  expiring_90: 'Ends within 90 days',
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
  createdBy: { id: string; name: string }
  updates: {
    id: string
    status: TicketStatus | null
    note: string | null
    by: { id: string; name: string }
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
