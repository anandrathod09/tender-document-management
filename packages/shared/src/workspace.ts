/** Subdomains a client can never use, because the platform needs them. */
export const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'admin',
  'owner',
  'mail',
  'smtp',
  'static',
  'assets',
  'cdn',
  'status',
  'help',
  'support',
  'docs',
  'blog',
  'billing',
  'staging',
  'test',
  'dev',
] as const

/** 3–63 characters, lowercase letters, digits and hyphens, not starting or ending with a hyphen. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/

export const ORGANIZATION_STATUSES = ['trial', 'active', 'suspended', 'closed'] as const
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number]

export const USER_STATUSES = ['invited', 'active', 'suspended'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** What the API says about the host the browser is on. */
export type WorkspaceInfo =
  | { kind: 'tenant'; slug: string; name: string; status: OrganizationStatus }
  | { kind: 'owner' }
  | { kind: 'root' }

/** How often a client pays. */
export const BILLING_CYCLES = ['monthly', 'yearly'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

export const PAYMENT_METHODS = ['razorpay', 'manual'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['created', 'paid', 'failed'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
