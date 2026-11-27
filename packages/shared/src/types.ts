import type { Permission } from './permissions'
import type { OrganizationStatus, UserStatus } from './workspace'

/** Shapes returned by the API, shared with the web app. Dates are ISO strings. */

export interface ApiError {
  error: { code: string; message: string; details?: unknown }
}

export interface RoleSummary {
  id: string
  key: string
  name: string
  permissions: Permission[]
}

export interface UserSummary {
  id: string
  name: string
  email: string
  phone: string | null
  /** Has set up two-step login. */
  twoFactorEnabled: boolean
  status: UserStatus
  role: { id: string; key: string; name: string }
  lastLoginAt: string | null
  createdAt: string
}

export interface TenantSession {
  realm: 'tenant'
  user: { id: string; name: string; email: string }
  role: { id: string; key: string; name: string }
  permissions: Permission[]
  organization: { id: string; slug: string; name: string; status: OrganizationStatus }
  twoFactor: TwoFactorFlags
}

export interface TwoFactorFlags {
  enabled: boolean
  /** The workspace requires it; until it is set up only the setup page works. */
  required: boolean
}

export interface PlatformSession {
  realm: 'platform'
  user: { id: string; name: string; email: string; role: 'owner' | 'support' }
  twoFactor: TwoFactorFlags
}

export type Session = TenantSession | PlatformSession

export interface LoginResponse {
  accessToken: string
  session: Session
}

/** Returned by /auth/login instead of a session when a two-step code is needed. */
export interface LoginChallenge {
  twoFactorRequired: true
  /** Send back with the code to /auth/login/2fa. Valid for 5 minutes. */
  challengeToken: string
}

export interface TwoFactorStatus {
  enabled: boolean
  required: boolean
  recoveryCodesLeft: number
}

/** Shown while setting up: the key for the authenticator app, as text and as a QR link. */
export interface TwoFactorSetup {
  secret: string
  otpauthUrl: string
}

export interface WorkspaceSettings {
  requireTwoFactor: boolean
  /** Agents see the Installed assets page (off by default). */
  agentsSeeAssets: boolean
  /** Agents see the installation report of their tenders (on by default). */
  agentsSeeInstallation: boolean
  /** Days after the deadline before an unassigned New tender is deleted; null = never. */
  cleanupDays: number | null
  /** Customers can raise service requests on the public support page (off by default). */
  supportPage: boolean
  /** Emailed about new support requests; empty = the admins. */
  supportEmails: string[]
}

export interface PlanSummary {
  id: string
  code: string
  name: string
  maxUsers: number
  maxStorageGb: number
  maxTendersPerMonth: number
  priceMonthlyInr: number | null
}

export interface OrganizationSummary {
  id: string
  slug: string
  /** The client's web address, e.g. https://acme.ourdomain.com */
  url: string
  name: string
  status: OrganizationStatus
  timezone: string
  plan: { id: string; name: string }
  userCount: number
  trialEndsAt: string | null
  /** Paid up to this moment (null until the first payment). */
  paidUntil: string | null
  billingCycle: 'monthly' | 'yearly' | null
  createdAt: string
}

export interface OrganizationDetail extends OrganizationSummary {
  admins: { id: string; name: string; email: string; status: UserStatus }[]
}

export interface InviteResult {
  inviteUrl: string
}
