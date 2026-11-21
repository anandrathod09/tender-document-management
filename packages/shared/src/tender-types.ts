import type { CommentMode, StageColor, StageSystemRole, StageType } from './workflow'

/** Shapes returned by the tender and workflow API. Dates are ISO strings; deadlines are YYYY-MM-DD. */

export interface StageSummary {
  id: string
  key: string
  label: string
  defaultLabel: string
  type: StageType
  color: StageColor
  commentMode: CommentMode
  isVisible: boolean
  systemRole: StageSystemRole | null
  sortOrder: number
  /** Added by the client (can be deleted while unused); default stages can only be hidden. */
  isCustom: boolean
  /** Stage keys an Agent may move a tender to from here; null = any stage. */
  agentNext: string[] | null
  /** Extra stage keys an admin may move to; null = any stage. */
  managerNext: string[] | null
  /** Role keys that see the stage in their sidebar menu; null = everyone. */
  menuRoles: string[] | null
}

export interface StageRef {
  id: string
  label: string
  type: StageType
  color: StageColor
}

export interface StageCount {
  stageId: string
  count: number
}

export type SheetType = 'gem' | 'non_gem'

export interface TenderSummary {
  id: string
  referenceNo: string
  sourceTenderId: string | null
  title: string
  buyerOrganization: string | null
  location: string | null
  estimatedCost: number
  emd: number
  deadline: string
  sheetType: SheetType
  /** Link to the tender on the source portal (Tender247). */
  briefUrl: string | null
  stage: StageRef
  assignedAgent: TenderPerson | null
  /** When the current assignee was given the tender. */
  assignedAt: string | null
  /** When the tender entered its current stage. */
  stageChangedAt: string
  /** When the last Excel upload changed this tender, if it did. */
  excelUpdatedAt: string | null
  /** It missed its deadline once and an admin brought it back, so the deadline rule no longer applies. */
  reopenedAfterDeadline: boolean
  createdAt: string
}

export interface TenderPerson {
  id: string
  name: string
  email: string
  phone: string | null
}

/** A team member a tender can be assigned to. */
export interface Assignee extends TenderPerson {
  role: string
  memberSince: string
}

export interface ExcelChange {
  field: string
  label: string
  from?: string | number | null
  to?: string | number | null
}

export interface ExcelUpdateInfo {
  at: string
  changes: ExcelChange[]
  /** Set when the upload extended the deadline of a tender that had missed it. */
  restoredTo?: string
}

export interface StageHistoryEntry {
  id: string
  from: { id: string; label: string } | null
  to: { id: string; label: string }
  comment: string | null
  changedBy: { id: string; name: string } | null
  at: string
}

export interface TenderDetail extends TenderSummary {
  documentFee: number
  msmeExemption: string | null
  startupExemption: string | null
  quantity: string | null
  eligibilityCriteria: string | null
  checklist: string | null
  documentsRequired: string | null
  awardAmount: number | null
  awardNumber: string | null
  biddingCompany: { id: string; name: string } | null
  sourceFile: string | null
  excelUpdate: ExcelUpdateInfo | null
  history: StageHistoryEntry[]
}

export interface TenderPage {
  items: TenderSummary[]
  total: number
  page: number
  pageSize: number
}

export interface BulkTenderResult {
  /** Tenders that were changed. */
  updated: number
  /** Tenders left as they were (already in that stage or with that assignee). */
  unchanged: number
}

export interface ImportRowIssue {
  sheet: string
  row: number
  message: string
}

export interface ImportResult {
  id: string
  fileName: string
  /** "Tender247 export" or the name of the saved layout used. */
  layout: string
  created: number
  updated: number
  unchanged: number
  restored: number
  skipped: { expired: number; noReference: number; duplicateInFile: number; invalid: number }
  issues: ImportRowIssue[]
}

export interface DashboardData {
  /** Tenders per stage type. */
  counts: Record<StageType, number>
  upcoming: TenderSummary[]
  wonValue: number
  /** Won ÷ (won + lost), or null when nothing has been decided yet. */
  winRate: number | null
  /** The latest successful Excel upload. */
  lastImport: { fileName: string; at: string; created: number } | null
}
