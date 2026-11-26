import { z } from 'zod'

/**
 * The tender details an Excel sheet can fill in. An import profile says which
 * column heading holds each one; Tender247 exports use built-in headings.
 */
export const IMPORT_FIELDS = [
  {
    key: 'referenceNo',
    label: 'Reference number',
    hint: 'Used to recognise a tender on re-upload',
  },
  { key: 'sourceTenderId', label: 'Portal tender ID', hint: 'Used when the reference is empty' },
  { key: 'title', label: 'Tender brief', hint: 'Required. A link in this cell is kept' },
  { key: 'deadline', label: 'Deadline', hint: 'Required' },
  { key: 'buyerOrganization', label: 'Buyer organization' },
  { key: 'location', label: 'Location' },
  { key: 'estimatedCost', label: 'Estimated cost' },
  { key: 'value', label: 'Bid value', hint: 'Used instead of estimated cost when filled' },
  { key: 'emd', label: 'EMD' },
  { key: 'documentFee', label: 'Document fee' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'sheetType', label: 'GeM / Non-GeM', hint: 'Otherwise taken from the sheet name' },
  { key: 'msmeExemption', label: 'MSME exemption' },
  { key: 'startupExemption', label: 'Startup exemption' },
  { key: 'eligibilityCriteria', label: 'Eligibility criteria' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'documentsRequired', label: 'Documents required from seller' },
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]['key']
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]]

/** Which column heading holds each field. Fields left out are not imported. */
export type ImportColumns = Partial<Record<ImportField, string>>

const heading = z.string().trim().min(1).max(200)

export const importProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  columns: z
    .partialRecord(z.enum(IMPORT_FIELD_KEYS), heading)
    .refine((c) => c.title && c.deadline, {
      message: 'Choose the columns for the tender brief and the deadline',
    })
    .refine((c) => c.referenceNo || c.sourceTenderId, {
      message: 'Choose the column for the reference number or the portal tender ID',
    }),
})
export type ImportProfileInput = z.infer<typeof importProfileSchema>

export interface ImportProfileSummary {
  id: string
  name: string
  columns: ImportColumns
  createdAt: string
  updatedAt: string
}

export interface ImportSheetInfo {
  name: string
  headings: string[]
  /** Rows below the heading row. */
  rows: number
}

/** What is in an uploaded file, so a client can map its columns before importing. */
export interface ImportInspectResult {
  sheets: ImportSheetInfo[]
  /** Columns that look like a known field, by their heading. */
  suggested: ImportColumns
  /** The file is a tender list exported from this app (Export to Excel), not a portal download. */
  ownExport: boolean
}
