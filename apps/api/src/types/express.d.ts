import type { Permission } from '@tdm/shared'
import type { Organization, PlatformUser, Role, User } from '../db/schema'

/** Which workspace the request's host points to. */
export type RequestContext =
  { kind: 'root' } | { kind: 'owner' } | { kind: 'tenant'; org: Organization } | { kind: 'unknown' }

export interface TenantAuth {
  org: Organization
  user: User
  role: Role
  permissions: Set<Permission>
}

export interface PlatformAuth {
  user: PlatformUser
}

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext
      tenantAuth?: TenantAuth
      platformAuth?: PlatformAuth
    }
  }
}
