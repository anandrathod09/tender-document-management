import { eq } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import type { Permission } from '@tdm/shared'
import { db } from '../db/client'
import { orgWhere } from '../db/scope'
import { platformUsers, roles, users } from '../db/schema'
import { forbidden, unauthorized } from '../lib/errors'
import { verifyAccessToken } from '../lib/tokens'
import { assertOwnerHost, assertTenant } from './workspace'

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

const expired = () => unauthorized('TOKEN_INVALID', 'Your session has expired')

/**
 * Signs in a client user. Checks, in order: the subdomain is a usable client,
 * the token is valid and was issued for this client, and the user still
 * exists, is active, and has not had their tokens cancelled.
 */
export async function authenticateTenant(req: Request, _res: Response, next: NextFunction) {
  const org = assertTenant(req)

  const token = bearerToken(req)
  if (!token) throw unauthorized()
  const payload = verifyAccessToken(token, 'tenant')
  if (!payload || payload.org !== org.id) throw expired()

  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, org.id, eq(users.id, payload.sub)))
    .limit(1)
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) throw expired()

  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, org.id, eq(roles.id, user.roleId)))
    .limit(1)
  if (!role) throw forbidden()

  // A workspace can require two-step login. Until it is set up, only the
  // sign-in and setup endpoints (under /api/auth) work.
  if (org.requireTwoFactor && !user.totpEnabledAt && !req.originalUrl.startsWith('/api/auth/')) {
    throw forbidden(
      'TWO_FACTOR_SETUP_REQUIRED',
      'Your workspace requires two-step login. Set it up to continue.',
    )
  }

  req.tenantAuth = { org, user, role, permissions: new Set(role.permissions) }
  next()
}

/** Signs in one of our own team on the owner-panel subdomain. */
export async function authenticatePlatform(req: Request, _res: Response, next: NextFunction) {
  assertOwnerHost(req)

  const token = bearerToken(req)
  if (!token) throw unauthorized()
  const payload = verifyAccessToken(token, 'platform')
  if (!payload) throw expired()

  const [user] = await db
    .select()
    .from(platformUsers)
    .where(eq(platformUsers.id, payload.sub))
    .limit(1)
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) throw expired()

  req.platformAuth = { user }
  next()
}

/** Use after authenticateTenant. */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenantAuth?.permissions.has(permission)) throw forbidden()
    next()
  }
}

/** Returns the signed-in client user; only call after authenticateTenant. */
export function tenantAuth(req: Request) {
  if (!req.tenantAuth) throw unauthorized()
  return req.tenantAuth
}

/** Returns the signed-in platform user; only call after authenticatePlatform. */
export function platformAuth(req: Request) {
  if (!req.platformAuth) throw unauthorized()
  return req.platformAuth
}
