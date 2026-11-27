import { randomUUID } from 'node:crypto'
import {
  boolean,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'
import type {
  CompliancePackRequest,
  ExcelUpdateInfo,
  ImportColumns,
  ImportRowIssue,
  LetterBlock,
  Permission,
} from '@tdm/shared'
import {
  COMMENT_MODES,
  ENGINEER_STATUSES,
  FILE_KINDS,
  INSTALL_STATUSES,
  ORGANIZATION_STATUSES,
  STAGE_COLORS,
  STAGE_SYSTEM_ROLES,
  BILLING_CYCLES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SERIAL_TYPES,
  STAGE_TYPES,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TICKET_TYPES,
  USER_STATUSES,
} from '@tdm/shared'

/*
 * Conventions
 * - IDs are UUID strings created by the app.
 * - All times are UTC (the connection's time zone is set to +00:00).
 * - Every table that holds a client's data has `organization_id`, and the
 *   indexes used for lists start with it. Query those tables only through
 *   `orgWhere()` in ./scope.ts.
 */

const id = () =>
  varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID())

const createdAt = () =>
  datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date())

const updatedAt = () =>
  datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())

const organizationId = () =>
  varchar('organization_id', { length: 36 })
    .notNull()
    .references(() => organizations.id)

// ---------------------------------------------------------------------------
// Platform tables (not owned by a client)
// ---------------------------------------------------------------------------

export const plans = mysqlTable('plans', {
  id: id(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  maxUsers: int('max_users').notNull(),
  maxStorageGb: int('max_storage_gb').notNull(),
  maxTendersPerMonth: int('max_tenders_per_month').notNull(),
  // Active bidding companies (letterheads) a client can have.
  maxCompanies: int('max_companies').notNull().default(3),
  priceMonthlyInr: int('price_monthly_inr'),
  // Price for a whole year, usually a discount on 12 months. Empty: not sold yearly.
  priceYearlyInr: int('price_yearly_inr'),
  description: varchar('description', { length: 255 }),
  // Shown to clients on their billing page (otherwise only we can assign it).
  isPublic: boolean('is_public').notNull().default(true),
  // Retired plans stay on the clients that have them but cannot be chosen again.
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: createdAt(),
})

export const organizations = mysqlTable('organizations', {
  id: id(),
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  status: mysqlEnum('status', ORGANIZATION_STATUSES).notNull().default('trial'),
  planId: varchar('plan_id', { length: 36 })
    .notNull()
    .references(() => plans.id),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
  settings: json('settings').$type<Record<string, unknown>>(),
  // Every user must set up two-step login before using the workspace.
  requireTwoFactor: boolean('require_two_factor').notNull().default(false),
  // Billing: paid up to this moment, and how the client pays.
  paidUntil: datetime('paid_until', { mode: 'date', fsp: 3 }),
  billingCycle: mysqlEnum('billing_cycle', BILLING_CYCLES),
  // Printed on invoices ("bill to").
  billingName: varchar('billing_name', { length: 200 }),
  billingAddress: text('billing_address'),
  billingGstin: varchar('billing_gstin', { length: 15 }),
  billingStateCode: varchar('billing_state_code', { length: 2 }),
  billingEmail: varchar('billing_email', { length: 254 }),
  // The period end a renewal reminder was last sent for, so it is sent once.
  billingReminderFor: datetime('billing_reminder_for', { mode: 'date', fsp: 3 }),
  // Built-in declaration letters this client does not use (hidden from the compliance list).
  hiddenLetters: json('hidden_letters').$type<string[]>(),
  trialEndsAt: datetime('trial_ends_at', { mode: 'date', fsp: 3 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * A payment for a plan period: an online Razorpay payment (created first,
 * then paid) or one we record by hand (bank transfer, cheque). Amounts are
 * whole rupees.
 */
export const payments = mysqlTable(
  'payments',
  {
    id: id(),
    organizationId: varchar('organization_id', { length: 36 })
      .notNull()
      .references(() => organizations.id),
    planId: varchar('plan_id', { length: 36 })
      .notNull()
      .references(() => plans.id),
    cycle: mysqlEnum('cycle', BILLING_CYCLES).notNull(),
    method: mysqlEnum('method', PAYMENT_METHODS).notNull(),
    status: mysqlEnum('status', PAYMENT_STATUSES).notNull().default('created'),
    baseAmount: int('base_amount').notNull(),
    cgst: int('cgst').notNull().default(0),
    sgst: int('sgst').notNull().default(0),
    igst: int('igst').notNull().default(0),
    totalAmount: int('total_amount').notNull(),
    // The period this payment covers (set when it is paid).
    periodStart: datetime('period_start', { mode: 'date', fsp: 3 }),
    periodEnd: datetime('period_end', { mode: 'date', fsp: 3 }),
    razorpayOrderId: varchar('razorpay_order_id', { length: 64 }),
    razorpayPaymentId: varchar('razorpay_payment_id', { length: 64 }),
    // Manual payments: UTR or cheque number, and a note.
    reference: varchar('reference', { length: 100 }),
    notes: varchar('notes', { length: 500 }),
    invoiceNumber: varchar('invoice_number', { length: 40 }),
    // "Bill to" as it was when paid, so old invoices never change.
    billTo: json('bill_to').$type<{
      name: string
      address: string | null
      gstin: string | null
      stateCode: string | null
    }>(),
    paidAt: datetime('paid_at', { mode: 'date', fsp: 3 }),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    createdByPlatformId: varchar('created_by_platform_id', { length: 36 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_org_created_idx').on(t.organizationId, t.createdAt),
    uniqueIndex('payments_razorpay_order_uq').on(t.razorpayOrderId),
    uniqueIndex('payments_invoice_uq').on(t.invoiceNumber),
  ],
)

/** The last invoice number used in each financial year (e.g. "2026-27"). */
export const invoiceCounters = mysqlTable('invoice_counters', {
  financialYear: varchar('financial_year', { length: 9 }).primaryKey(),
  lastNumber: int('last_number').notNull().default(0),
})

export type Payment = typeof payments.$inferSelect

/** Our own team, for the owner panel. Separate from client users on purpose. */
export const platformUsers = mysqlTable('platform_users', {
  id: id(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  role: mysqlEnum('role', ['owner', 'support']).notNull().default('owner'),
  status: mysqlEnum('status', ['active', 'disabled']).notNull().default('active'),
  tokenVersion: int('token_version').notNull().default(0),
  // Two-step login. The secret is encrypted (lib/secrets.ts); it is set but
  // not yet enabled while the user is still scanning the QR code.
  totpSecret: varchar('totp_secret', { length: 255 }),
  totpEnabledAt: datetime('totp_enabled_at', { mode: 'date', fsp: 3 }),
  // Last time step accepted, so each code works only once.
  totpLastStep: int('totp_last_step'),
  // SHA-256 hashes of the unused backup codes.
  totpRecoveryCodes: json('totp_recovery_codes').$type<string[]>(),
  lastLoginAt: datetime('last_login_at', { mode: 'date', fsp: 3 }),
  createdAt: createdAt(),
})

// ---------------------------------------------------------------------------
// Client-owned tables
// ---------------------------------------------------------------------------

export const roles = mysqlTable(
  'roles',
  {
    id: id(),
    organizationId: organizationId(),
    key: varchar('key', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    permissions: json('permissions').$type<Permission[]>().notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('roles_org_key_uq').on(t.organizationId, t.key)],
)

export const users = mysqlTable(
  'users',
  {
    id: id(),
    organizationId: organizationId(),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 30 }),
    // Empty until the invitation is accepted and a password is set.
    passwordHash: varchar('password_hash', { length: 100 }),
    roleId: varchar('role_id', { length: 36 })
      .notNull()
      .references(() => roles.id),
    status: mysqlEnum('status', USER_STATUSES).notNull().default('invited'),
    // Raised on logout-everywhere, password change, suspension or role change;
    // tokens carrying an older version stop working.
    tokenVersion: int('token_version').notNull().default(0),
    // Two-step login. The secret is encrypted (lib/secrets.ts); it is set but
    // not yet enabled while the user is still scanning the QR code.
    totpSecret: varchar('totp_secret', { length: 255 }),
    totpEnabledAt: datetime('totp_enabled_at', { mode: 'date', fsp: 3 }),
    // Last time step accepted, so each code works only once.
    totpLastStep: int('totp_last_step'),
    // SHA-256 hashes of the unused backup codes.
    totpRecoveryCodes: json('totp_recovery_codes').$type<string[]>(),
    inviteTokenHash: varchar('invite_token_hash', { length: 64 }),
    inviteExpiresAt: datetime('invite_expires_at', { mode: 'date', fsp: 3 }),
    // Emails the person switched off (event -> false); empty = every email on.
    emailPrefs: json('email_prefs').$type<Partial<Record<string, boolean>>>(),
    lastLoginAt: datetime('last_login_at', { mode: 'date', fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_org_email_uq').on(t.organizationId, t.email),
    index('users_org_status_idx').on(t.organizationId, t.status),
    uniqueIndex('users_invite_token_uq').on(t.inviteTokenHash),
  ],
)

/** Refresh tokens for both realms. Only a SHA-256 hash of each token is stored. */
export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: id(),
    realm: mysqlEnum('realm', ['tenant', 'platform']).notNull(),
    subjectId: varchar('subject_id', { length: 36 }).notNull(),
    organizationId: varchar('organization_id', { length: 36 }).references(() => organizations.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    // Set only when the token was swapped for a new one by a normal refresh.
    // Only those tokens get the short grace window for two tabs refreshing at once;
    // tokens ended by sign-out, suspension or theft detection never work again.
    rotatedAt: datetime('rotated_at', { mode: 'date', fsp: 3 }),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: varchar('ip', { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_subject_idx').on(t.realm, t.subjectId)],
)

/** Who did what. organization_id is empty for platform-only events. */
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: id(),
    organizationId: varchar('organization_id', { length: 36 }).references(() => organizations.id),
    actorType: mysqlEnum('actor_type', ['user', 'platform', 'system']).notNull(),
    actorId: varchar('actor_id', { length: 36 }),
    action: varchar('action', { length: 100 }).notNull(),
    entity: varchar('entity', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }),
    details: json('details').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_org_created_idx').on(t.organizationId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Workflow and tenders (client-owned)
// ---------------------------------------------------------------------------

/** A client's own stages. Behaviour depends on `type`; clients can rename and hide. */
export const workflowStages = mysqlTable(
  'workflow_stages',
  {
    id: id(),
    organizationId: organizationId(),
    // Never changes after creation, so history and reports survive renames.
    key: varchar('key', { length: 50 }).notNull(),
    label: varchar('label', { length: 60 }).notNull(),
    defaultLabel: varchar('default_label', { length: 60 }).notNull(),
    type: mysqlEnum('type', STAGE_TYPES).notNull(),
    color: mysqlEnum('color', STAGE_COLORS).notNull().default('gray'),
    commentMode: mysqlEnum('comment_mode', COMMENT_MODES).notNull().default('optional'),
    isVisible: boolean('is_visible').notNull().default(true),
    systemRole: mysqlEnum('system_role', STAGE_SYSTEM_ROLES),
    /** Stage keys an Agent may move a tender to from here; null = any stage. */
    agentNext: json('agent_next').$type<string[] | null>(),
    /** Extra stage keys an admin may move to; null = any stage. */
    managerNext: json('manager_next').$type<string[] | null>(),
    /** Role keys that see the stage in their sidebar menu; null = everyone. */
    menuRoles: json('menu_roles').$type<string[] | null>(),
    sortOrder: int('sort_order').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workflow_stages_org_key_uq').on(t.organizationId, t.key),
    index('workflow_stages_org_order_idx').on(t.organizationId, t.sortOrder),
  ],
)

export const tenders = mysqlTable(
  'tenders',
  {
    id: id(),
    organizationId: organizationId(),
    source: varchar('source', { length: 30 }).notNull().default('tender247'),
    // e.g. the T247 ID. Can change between uploads; tenders are matched by reference number.
    sourceTenderId: varchar('source_tender_id', { length: 100 }),
    referenceNo: varchar('reference_no', { length: 191 }).notNull(),
    title: text('title').notNull(),
    briefUrl: text('brief_url'),
    buyerOrganization: varchar('buyer_organization', { length: 255 }),
    location: varchar('location', { length: 255 }),
    estimatedCost: decimal('estimated_cost', { precision: 15, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    emd: decimal('emd', { precision: 15, scale: 2, mode: 'number' }).notNull().default(0),
    documentFee: decimal('document_fee', { precision: 15, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    // Calendar date in the client's time zone; a tender is open for bids all day.
    deadline: date('deadline', { mode: 'string' }).notNull(),
    sheetType: mysqlEnum('sheet_type', ['gem', 'non_gem']).notNull().default('non_gem'),
    msmeExemption: varchar('msme_exemption', { length: 255 }),
    startupExemption: varchar('startup_exemption', { length: 255 }),
    quantity: varchar('quantity', { length: 255 }),
    eligibilityCriteria: text('eligibility_criteria'),
    checklist: text('checklist'),
    documentsRequired: text('documents_required'),
    sourceFile: varchar('source_file', { length: 255 }),

    stageId: varchar('stage_id', { length: 36 })
      .notNull()
      .references(() => workflowStages.id),
    // Stage before the tender missed its deadline; restored if the deadline is extended.
    previousStageId: varchar('previous_stage_id', { length: 36 }).references(
      () => workflowStages.id,
    ),
    stageChangedAt: datetime('stage_changed_at', { mode: 'date', fsp: 3 }).notNull(),
    assignedAgentId: varchar('assigned_agent_id', { length: 36 }).references(() => users.id),
    assignedAt: datetime('assigned_at', { mode: 'date', fsp: 3 }),
    // The company this tender is bid under (letterhead for compliance documents).
    biddingCompanyId: varchar('bidding_company_id', { length: 36 }).references(
      () => biddingCompanies.id,
    ),

    awardAmount: decimal('award_amount', { precision: 15, scale: 2, mode: 'number' }),
    awardNumber: varchar('award_number', { length: 100 }),

    excelUpdate: json('excel_update').$type<ExcelUpdateInfo>(),
    excelUpdatedAt: datetime('excel_updated_at', { mode: 'date', fsp: 3 }),
    /**
     * When the tender went to the missed-deadline stage. Kept after an admin
     * reopens it, so the deadline rule doesn't send it back again.
     */
    deadlineMissedAt: datetime('deadline_missed_at', { mode: 'date', fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tenders_org_reference_uq').on(t.organizationId, t.referenceNo),
    index('tenders_org_stage_deadline_idx').on(t.organizationId, t.stageId, t.deadline),
    index('tenders_org_agent_idx').on(t.organizationId, t.assignedAgentId),
    index('tenders_org_deadline_idx').on(t.organizationId, t.deadline),
    index('tenders_org_created_idx').on(t.organizationId, t.createdAt),
  ],
)

export const tenderStageHistory = mysqlTable(
  'tender_stage_history',
  {
    id: id(),
    organizationId: organizationId(),
    tenderId: varchar('tender_id', { length: 36 })
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    fromStageId: varchar('from_stage_id', { length: 36 }).references(() => workflowStages.id),
    toStageId: varchar('to_stage_id', { length: 36 })
      .notNull()
      .references(() => workflowStages.id),
    comment: text('comment'),
    // Empty when the system made the change (deadline passed, Excel upload).
    changedBy: varchar('changed_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('tender_stage_history_tender_idx').on(t.organizationId, t.tenderId, t.createdAt)],
)

export const importRuns = mysqlTable(
  'import_runs',
  {
    id: id(),
    organizationId: organizationId(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    source: varchar('source', { length: 30 }).notNull(),
    uploadedBy: varchar('uploaded_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    status: mysqlEnum('status', ['completed', 'failed']).notNull(),
    created: int('created').notNull().default(0),
    updated: int('updated').notNull().default(0),
    unchanged: int('unchanged').notNull().default(0),
    restored: int('restored').notNull().default(0),
    skipped: int('skipped').notNull().default(0),
    issues: json('issues').$type<ImportRowIssue[]>(),
    createdAt: createdAt(),
  },
  (t) => [index('import_runs_org_created_idx').on(t.organizationId, t.createdAt)],
)

/** A client's saved Excel layout: which column heading holds each tender detail. */
export const importProfiles = mysqlTable(
  'import_profiles',
  {
    id: id(),
    organizationId: organizationId(),
    name: varchar('name', { length: 100 }).notNull(),
    columns: json('columns').$type<ImportColumns>().notNull(),
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('import_profiles_org_name_uq').on(t.organizationId, t.name)],
)

export type ImportProfile = typeof importProfiles.$inferSelect

// ---------------------------------------------------------------------------
// Files, companies, compliance, notifications (client-owned)
// ---------------------------------------------------------------------------

/** Every stored file. The bytes live in file storage under org/<organization_id>/. */
export const files = mysqlTable(
  'files',
  {
    id: id(),
    organizationId: organizationId(),
    kind: mysqlEnum('kind', FILE_KINDS).notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull().unique(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    // Shown in the document library; defaults to the file name.
    title: varchar('title', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    // What the file belongs to: a tender, a bidding company or nothing (library).
    tenderId: varchar('tender_id', { length: 36 }).references(() => tenders.id, {
      onDelete: 'set null',
    }),
    companyId: varchar('company_id', { length: 36 }),
    // Consignee documents (installation certificates, site photos) also name their consignee.
    consigneeId: varchar('consignee_id', { length: 36 }),
    uploadedBy: varchar('uploaded_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
    // Deleted files stay 30 days so mistakes can be undone, then are purged.
    deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [
    index('files_org_kind_idx').on(t.organizationId, t.kind, t.deletedAt),
    index('files_org_tender_idx').on(t.organizationId, t.tenderId),
    index('files_org_consignee_idx').on(t.organizationId, t.consigneeId),
    index('files_deleted_idx').on(t.deletedAt),
  ],
)

/** The companies a client bids under (replaces the old hardcoded three). */
export const biddingCompanies = mysqlTable(
  'bidding_companies',
  {
    id: id(),
    organizationId: organizationId(),
    name: varchar('name', { length: 200 }).notNull(),
    address: text('address').notNull(),
    gstin: varchar('gstin', { length: 20 }),
    pan: varchar('pan', { length: 15 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 30 }),
    signatoryName: varchar('signatory_name', { length: 120 }).notNull(),
    designation: varchar('designation', { length: 120 }).notNull(),
    // Person named in the Power of Attorney letter, and their position.
    authorizedPerson: varchar('authorized_person', { length: 120 }),
    authorizedPersonPosition: varchar('authorized_person_position', { length: 120 }),
    // Make in India self-certification.
    localContentPercent: varchar('local_content_percent', { length: 10 }),
    localValueLocation: varchar('local_value_location', { length: 200 }),
    logoFileId: varchar('logo_file_id', { length: 36 }),
    signatureFileId: varchar('signature_file_id', { length: 36 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('bidding_companies_org_name_uq').on(t.organizationId, t.name)],
)

/**
 * A declaration letter of the client's own, with {{field}} fill-ins. Shared by
 * all their bidding companies unless limited to one.
 */
export const letterTemplates = mysqlTable(
  'letter_templates',
  {
    id: id(),
    organizationId: organizationId(),
    title: varchar('title', { length: 200 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    addressed: boolean('addressed').notNull().default(true),
    dateAtTop: boolean('date_at_top').notNull().default(false),
    body: json('body').$type<LetterBlock[]>().notNull(),
    companyId: varchar('company_id', { length: 36 }).references(() => biddingCompanies.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    basedOn: varchar('based_on', { length: 40 }),
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('letter_templates_org_title_idx').on(t.organizationId, t.title)],
)

export type LetterTemplate = typeof letterTemplates.$inferSelect

/** A generated compliance PDF for a tender. Built in the background. */
export const compliancePacks = mysqlTable(
  'compliance_packs',
  {
    id: id(),
    organizationId: organizationId(),
    tenderId: varchar('tender_id', { length: 36 })
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => biddingCompanies.id),
    status: mysqlEnum('status', ['queued', 'ready', 'failed']).notNull().default('queued'),
    request: json('request').$type<CompliancePackRequest>().notNull(),
    fileId: varchar('file_id', { length: 36 }).references(() => files.id),
    pageCount: int('page_count'),
    warnings: json('warnings').$type<string[]>(),
    error: varchar('error', { length: 500 }),
    requestedBy: varchar('requested_by', { length: 36 })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [index('compliance_packs_tender_idx').on(t.organizationId, t.tenderId, t.createdAt)],
)

export const notifications = mysqlTable(
  'notifications',
  {
    id: id(),
    organizationId: organizationId(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 500 }),
    link: varchar('link', { length: 255 }),
    readAt: datetime('read_at', { mode: 'date', fsp: 3 }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.organizationId, t.userId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// After the win: installation reports, installed assets, service tickets
// ---------------------------------------------------------------------------

/** One installation report per won tender (the old "Hardware Installation Report"). */
export const installationReports = mysqlTable(
  'installation_reports',
  {
    id: id(),
    organizationId: organizationId(),
    tenderId: varchar('tender_id', { length: 36 })
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    biddingCompanyId: varchar('bidding_company_id', { length: 36 }).references(
      () => biddingCompanies.id,
    ),
    poNumber: varchar('po_number', { length: 100 }),
    poDate: date('po_date', { mode: 'string' }),
    reportDate: date('report_date', { mode: 'string' }),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: text('customer_address'),
    stateOffice: varchar('state_office', { length: 200 }),
    contactPersonName: varchar('contact_person_name', { length: 120 }),
    contactPersonDesignation: varchar('contact_person_designation', { length: 120 }),
    contactPersonPhone: varchar('contact_person_phone', { length: 30 }),
    department: varchar('department', { length: 200 }),
    updatedBy: varchar('updated_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('installation_reports_tender_uq').on(t.organizationId, t.tenderId)],
)

/** A delivery location / receiving officer on an installation report. */
export const installationConsignees = mysqlTable(
  'installation_consignees',
  {
    id: id(),
    organizationId: organizationId(),
    reportId: varchar('report_id', { length: 36 })
      .notNull()
      .references(() => installationReports.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    designation: varchar('designation', { length: 120 }),
    phone: varchar('phone', { length: 30 }),
    email: varchar('email', { length: 254 }),
    fax: varchar('fax', { length: 30 }),
    engineerId: varchar('engineer_id', { length: 36 }).references(() => users.id),
    status: mysqlEnum('status', ENGINEER_STATUSES).notNull().default('assigned'),
    callAlignedDate: date('call_aligned_date', { mode: 'string' }),
    sortOrder: int('sort_order').notNull().default(0),
  },
  (t) => [
    index('installation_consignees_report_idx').on(t.organizationId, t.reportId),
    index('installation_consignees_engineer_idx').on(t.organizationId, t.engineerId),
  ],
)

/**
 * A report template inside a consignee (the old TMS "Report Template 1, 2…"):
 * one item with its configuration, how its serial numbers are recorded,
 * the warranty, and how many rows it has.
 */
export const installationItems = mysqlTable(
  'installation_items',
  {
    id: id(),
    organizationId: organizationId(),
    consigneeId: varchar('consignee_id', { length: 36 })
      .notNull()
      .references(() => installationConsignees.id, { onDelete: 'cascade' }),
    itemName: varchar('item_name', { length: 500 }).notNull(),
    serialType: mysqlEnum('serial_type', SERIAL_TYPES).notNull().default('common'),
    warrantyMonths: int('warranty_months').notNull().default(0),
    quantity: int('quantity').notNull().default(1),
    sortOrder: int('sort_order').notNull().default(0),
  },
  (t) => [index('installation_items_consignee_idx').on(t.organizationId, t.consigneeId)],
)

/** One installed physical unit, with its serial numbers and warranty. */
export const installedAssets = mysqlTable(
  'installed_assets',
  {
    id: id(),
    organizationId: organizationId(),
    consigneeId: varchar('consignee_id', { length: 36 })
      .notNull()
      .references(() => installationConsignees.id, { onDelete: 'cascade' }),
    // The report template the unit is a row of. Item name and warranty are copied from it.
    itemId: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => installationItems.id, { onDelete: 'cascade' }),
    // Copied from the consignee's report so asset lists need no extra joins.
    tenderId: varchar('tender_id', { length: 36 })
      .notNull()
      .references(() => tenders.id, { onDelete: 'cascade' }),
    itemName: varchar('item_name', { length: 500 }).notNull(),
    makeModel: varchar('make_model', { length: 200 }),
    serialNumber: varchar('serial_number', { length: 100 }),
    monitorSerial: varchar('monitor_serial', { length: 100 }),
    cpuSerial: varchar('cpu_serial', { length: 100 }),
    installStatus: mysqlEnum('install_status', INSTALL_STATUSES).notNull().default('pending'),
    installedOn: date('installed_on', { mode: 'string' }),
    // Warranty runs from the installation date (or the report date) for this many months.
    warrantyMonths: int('warranty_months').notNull().default(0),
    remarks: varchar('remarks', { length: 500 }),
    sortOrder: int('sort_order').notNull().default(0),
  },
  (t) => [
    index('installed_assets_tender_idx').on(t.organizationId, t.tenderId),
    index('installed_assets_consignee_idx').on(t.organizationId, t.consigneeId),
    index('installed_assets_serial_idx').on(t.organizationId, t.serialNumber),
  ],
)

/** Client feedback and service requests, often about an installed unit. */
export const serviceTickets = mysqlTable(
  'service_tickets',
  {
    id: id(),
    organizationId: organizationId(),
    // Shown as TKT-0001; counts per client.
    number: int('number').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    type: mysqlEnum('type', TICKET_TYPES).notNull().default('complaint'),
    priority: mysqlEnum('priority', TICKET_PRIORITIES).notNull().default('medium'),
    status: mysqlEnum('status', TICKET_STATUSES).notNull().default('new'),
    // Raised by staff in the app, or by a customer on the public support page.
    source: mysqlEnum('source', TICKET_SOURCES).notNull().default('staff'),
    tenderId: varchar('tender_id', { length: 36 }).references(() => tenders.id, {
      onDelete: 'set null',
    }),
    assetId: varchar('asset_id', { length: 36 }).references(() => installedAssets.id, {
      onDelete: 'set null',
    }),
    customerName: varchar('customer_name', { length: 200 }),
    contactName: varchar('contact_name', { length: 120 }),
    contactPhone: varchar('contact_phone', { length: 30 }),
    contactEmail: varchar('contact_email', { length: 254 }),
    assignedTo: varchar('assigned_to', { length: 36 }).references(() => users.id),
    oemReference: varchar('oem_reference', { length: 100 }),
    resolutionNotes: text('resolution_notes'),
    resolvedAt: datetime('resolved_at', { mode: 'date', fsp: 3 }),
    satisfaction: int('satisfaction'),
    // Empty for tickets a customer raised on the public support page.
    createdBy: varchar('created_by', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('service_tickets_org_number_uq').on(t.organizationId, t.number),
    index('service_tickets_org_status_idx').on(t.organizationId, t.status),
    index('service_tickets_org_asset_idx').on(t.organizationId, t.assetId),
  ],
)

export const ticketUpdates = mysqlTable(
  'ticket_updates',
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: varchar('ticket_id', { length: 36 })
      .notNull()
      .references(() => serviceTickets.id, { onDelete: 'cascade' }),
    status: mysqlEnum('status', TICKET_STATUSES),
    note: text('note'),
    // Empty for the entry made when a customer raises a ticket on the support page.
    userId: varchar('user_id', { length: 36 }).references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_updates_ticket_idx').on(t.organizationId, t.ticketId, t.createdAt)],
)

// ---------------------------------------------------------------------------
// Platform plumbing
// ---------------------------------------------------------------------------

/** Password reset links for both client users and our own team. Only hashes are stored. */
export const passwordResets = mysqlTable(
  'password_resets',
  {
    id: id(),
    realm: mysqlEnum('realm', ['tenant', 'platform']).notNull(),
    subjectId: varchar('subject_id', { length: 36 }).notNull(),
    organizationId: varchar('organization_id', { length: 36 }).references(() => organizations.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    usedAt: datetime('used_at', { mode: 'date', fsp: 3 }),
    createdAt: createdAt(),
  },
  (t) => [index('password_resets_subject_idx').on(t.realm, t.subjectId)],
)

/**
 * Background job queue in MySQL. Workers claim jobs with
 * SELECT … FOR UPDATE SKIP LOCKED, so several API processes never run the
 * same job twice. `dedupeKey` stops scheduled jobs being queued twice.
 */
export const jobs = mysqlTable(
  'jobs',
  {
    id: id(),
    organizationId: varchar('organization_id', { length: 36 }),
    type: varchar('type', { length: 50 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'done', 'failed'])
      .notNull()
      .default('queued'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    runAt: datetime('run_at', { mode: 'date', fsp: 3 }).notNull(),
    lockedAt: datetime('locked_at', { mode: 'date', fsp: 3 }),
    lastError: varchar('last_error', { length: 1000 }),
    dedupeKey: varchar('dedupe_key', { length: 191 }).unique(),
    createdAt: createdAt(),
    finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
  },
  (t) => [index('jobs_pick_idx').on(t.status, t.runAt)],
)

export type Organization = typeof organizations.$inferSelect
export type User = typeof users.$inferSelect
export type Role = typeof roles.$inferSelect
export type PlatformUser = typeof platformUsers.$inferSelect
export type Plan = typeof plans.$inferSelect
export type WorkflowStage = typeof workflowStages.$inferSelect
export type Tender = typeof tenders.$inferSelect
export type StoredFile = typeof files.$inferSelect
export type BiddingCompany = typeof biddingCompanies.$inferSelect
export type CompliancePack = typeof compliancePacks.$inferSelect
export type Job = typeof jobs.$inferSelect
