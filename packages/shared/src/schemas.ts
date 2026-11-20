import { z } from 'zod'
import { COMMENT_MODES, STAGE_COLORS, STAGE_LABEL_MAX, STAGE_TYPES } from './workflow'
import { ORGANIZATION_STATUSES, RESERVED_SUBDOMAINS, SLUG_PATTERN } from './workspace'

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'))
  .pipe(z.string().max(254))
const personName = z.string().trim().min(1, 'Name is required').max(120)

/** bcrypt only uses the first 72 bytes, so longer passwords are refused rather than silently cut. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'Password must be at most 72 bytes')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
})
export type LoginInput = z.infer<typeof loginSchema>

/** A 6-digit code from the authenticator app, or a backup code like "k7m2-x9qp". */
const twoFactorCode = z.string().trim().min(6, 'Enter the code').max(20)

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1).max(2000),
  code: twoFactorCode,
})
export const twoFactorCodeSchema = z.object({ code: twoFactorCode })
export const disableTwoFactorSchema = z.object({ password: z.string().min(1).max(200) })
export const workspaceSettingsSchema = z.object({ requireTwoFactor: z.boolean() })

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    SLUG_PATTERN,
    'Use 3–63 lowercase letters, digits or hyphens; no hyphen at the start or end',
  )
  .refine(
    (s) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(s),
    'This subdomain is reserved',
  )

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(200),
  slug: slugSchema,
  planId: z.uuid(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  trialDays: z.number().int().min(0).max(90).default(14),
  adminName: personName,
  adminEmail: email,
})
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    planId: z.uuid(),
    status: z.enum(ORGANIZATION_STATUSES).exclude(['closed']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>

const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+0-9 ()-]*$/, 'Use digits, spaces, + and - only')
  .transform((v) => v || null)
  .nullable()

export const inviteUserSchema = z.object({
  name: personName,
  email,
  phone: phone.optional(),
  roleId: z.uuid(),
})
export type InviteUserInput = z.infer<typeof inviteUserSchema>

export const updateUserSchema = z
  .object({
    name: personName,
    phone,
    roleId: z.uuid(),
    status: z.enum(['active', 'suspended']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateUserInput = z.infer<typeof updateUserSchema>

// ---------------------------------------------------------------------------
// Workflow stages and tenders
// ---------------------------------------------------------------------------

export const updateStageSchema = z
  .object({
    /** null puts the default name back. */
    label: z.string().trim().min(1, 'Name is required').max(STAGE_LABEL_MAX).nullable(),
    commentMode: z.enum(COMMENT_MODES),
    isVisible: z.boolean(),
    color: z.enum(STAGE_COLORS),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type UpdateStageInput = z.infer<typeof updateStageSchema>

/** A client's own extra stage. Its type decides how reports and deadline rules treat it. */
export const createStageSchema = z.object({
  label: z.string().trim().min(1, 'Name is required').max(STAGE_LABEL_MAX),
  type: z.enum(STAGE_TYPES),
  color: z.enum(STAGE_COLORS).default('gray'),
  commentMode: z.enum(COMMENT_MODES).default('optional'),
  /** Placed right after this stage; at the end when left out. */
  afterStageId: z.uuid().optional(),
})
export type CreateStageInput = z.input<typeof createStageSchema>

export const reorderStagesSchema = z.object({
  /** Every stage id of the workspace, in the new order. */
  ids: z.array(z.uuid()).min(1).max(200),
})

export const moveTenderSchema = z.object({
  stageId: z.uuid(),
  comment: z.string().trim().max(2000).optional(),
  /** Needed when moving into a "won" stage. */
  awardAmount: z.number().nonnegative().max(1e13).optional(),
  awardNumber: z.string().trim().max(100).optional(),
})
export type MoveTenderInput = z.infer<typeof moveTenderSchema>

const assignNote = z.string().trim().max(1000).optional()

export const assignTenderSchema = z.object({
  /** null removes the assignment. */
  agentId: z.uuid().nullable(),
  /** Sent to the person with the notification, and kept in the tender's history. */
  note: assignNote,
})
export type AssignTenderInput = z.infer<typeof assignTenderSchema>

/** Columns the tender list can be sorted by; a leading "-" sorts high to low. */
export const TENDER_SORT_FIELDS = [
  'deadline',
  'referenceNo',
  'title',
  'buyerOrganization',
  'location',
  'estimatedCost',
  'emd',
  'sheetType',
  'stage',
  'assignedAgent',
  'assignedAt',
  'stageChangedAt',
  'createdAt',
] as const
export type TenderSortField = (typeof TENDER_SORT_FIELDS)[number]
export const TENDER_SORTS = TENDER_SORT_FIELDS.flatMap((f) => [f, `-${f}`] as const)
export type TenderSort = TenderSortField | `-${TenderSortField}`

export const tenderListQuerySchema = z.object({
  stageId: z.uuid().optional(),
  /** One kind or several, comma-separated: "preparing,review". */
  stageType: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(STAGE_TYPES)).optional()),
  q: z.string().trim().max(200).optional(),
  /** "me", "none" or a user ID. */
  assignedTo: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  sort: z.enum(TENDER_SORTS as [TenderSort, ...TenderSort[]]).default('deadline'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type TenderListQuery = z.input<typeof tenderListQuerySchema>

/** The most tenders one bulk action can change. */
export const BULK_TENDER_MAX = 100
const bulkIds = z
  .array(z.uuid())
  .min(1, 'Select at least one tender')
  .max(BULK_TENDER_MAX, `Select at most ${BULK_TENDER_MAX} tenders at a time`)
  .refine((ids) => new Set(ids).size === ids.length, 'A tender is listed twice')

/** The same action on several tenders at once, from the tender list. */
export const bulkTenderActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    ids: bulkIds,
    stageId: z.uuid(),
    comment: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal('assign'),
    ids: bulkIds,
    /** null removes the assignment. */
    agentId: z.uuid().nullable(),
    note: assignNote,
  }),
])
export type BulkTenderActionInput = z.infer<typeof bulkTenderActionSchema>
