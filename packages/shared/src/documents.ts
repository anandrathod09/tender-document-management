import { z } from 'zod'
import type { LetterContent } from './letters'

export const FILE_KINDS = [
  'tender_document',
  'library',
  'company_logo',
  'company_signature',
  'compliance_pdf',
] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** Largest single upload. */
export const MAX_UPLOAD_MB = 25

/**
 * Declaration letters printed on the bidding company's letterhead, as in the
 * original TMS. The wording lives in the API.
 */
export const COMPLIANCE_LETTERS = [
  { key: 'tender_acceptance', title: 'Tender Acceptance Undertaking' },
  { key: 'blacklisting', title: 'Undertaking regarding Blacklisting / Non-Debarment' },
  { key: 'make_in_india', title: 'Make in India Self-Certification' },
  { key: 'minimum_wage', title: 'Undertaking on Minimum Wage Policy' },
  { key: 'land_border', title: 'Land Border Sharing Declaration' },
  { key: 'no_relative', title: 'Confirmation of No Relative in Tendering Authority' },
  { key: 'power_of_attorney', title: 'Power of Attorney' },
  { key: 'bid_security', title: 'Bid Security Declaration' },
  { key: 'no_litigation', title: 'Declaration of No Pending Litigation' },
  { key: 'non_bankruptcy', title: 'Declaration of Non-Bankruptcy' },
  { key: 'non_liquidation', title: 'Non-Liquidation Declaration' },
  { key: 'non_disclosure', title: 'Non-Disclosure Declaration' },
] as const
export type ComplianceLetterKey = (typeof COMPLIANCE_LETTERS)[number]['key']
const LETTER_KEYS = COMPLIANCE_LETTERS.map((l) => l.key) as [
  ComplianceLetterKey,
  ...ComplianceLetterKey[],
]

// ---------------------------------------------------------------------------
// Request rules
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()

export const companySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  address: z.string().trim().min(5, 'Address is required').max(1000),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[0-9]{2}[A-Z0-9]{13}$/,
      'GSTIN has 15 characters, starting with the 2-digit state code',
    )
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F')
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address'))
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  phone: optionalText(30),
  signatoryName: z.string().trim().min(1, 'Signatory name is required').max(120),
  designation: z.string().trim().min(1, 'Designation is required').max(120),
  authorizedPerson: optionalText(120),
  authorizedPersonPosition: optionalText(120),
  localContentPercent: optionalText(10),
  localValueLocation: optionalText(200),
  isActive: z.boolean().optional(),
})
export type CompanyInput = z.input<typeof companySchema>

export const updateTenderSchema = z.object({
  biddingCompanyId: z.uuid().nullable(),
})
export type UpdateTenderInput = z.infer<typeof updateTenderSchema>

export const libraryUploadSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  companyId: z
    .uuid()
    .or(z.literal(''))
    .transform((v) => v || null)
    .optional(),
})

export const createCompliancePackSchema = z
  .object({
    companyId: z.uuid(),
    departmentAddress: z.string().trim().max(500).default(''),
    letters: z.array(z.enum(LETTER_KEYS)).max(LETTER_KEYS.length).default([]),
    /** The client's own letters (letter templates). */
    templateIds: z.array(z.uuid()).max(50).default([]),
    libraryFileIds: z.array(z.uuid()).max(50).default([]),
    tenderFileIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine(
    (v) =>
      v.letters.length + v.templateIds.length + v.libraryFileIds.length + v.tenderFileIds.length >
      0,
    'Choose at least one letter or document',
  )
/** Stored with each compliance PDF request. */
export type CompliancePackRequest = Omit<
  z.output<typeof createCompliancePackSchema>,
  'companyId' | 'templateIds'
> & {
  templateIds?: string[]
  /** The client's own letters as they were when the PDF was requested. */
  customLetters?: LetterContent[]
}

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine((p) => new TextEncoder().encode(p).length <= 72, 'Password must be at most 72 bytes'),
})

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface FileSummary {
  id: string
  kind: FileKind
  title: string
  originalName: string
  mimeType: string
  sizeBytes: number
  companyId: string | null
  uploadedBy: { id: string; name: string } | null
  createdAt: string
}

export interface CompanySummary {
  id: string
  name: string
  address: string
  gstin: string | null
  pan: string | null
  email: string | null
  phone: string | null
  signatoryName: string
  designation: string
  authorizedPerson: string | null
  authorizedPersonPosition: string | null
  localContentPercent: string | null
  localValueLocation: string | null
  logoFileId: string | null
  signatureFileId: string | null
  isActive: boolean
}

export interface CompliancePackSummary {
  id: string
  status: 'queued' | 'ready' | 'failed'
  company: { id: string; name: string }
  request: CompliancePackRequest
  file: { id: string; sizeBytes: number } | null
  pageCount: number | null
  warnings: string[]
  error: string | null
  requestedBy: { id: string; name: string }
  createdAt: string
  finishedAt: string | null
}

export interface NotificationSummary {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read: boolean
  createdAt: string
}

export interface NotificationList {
  items: NotificationSummary[]
  unread: number
}
