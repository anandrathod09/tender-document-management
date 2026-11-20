import { and, eq, isNull } from 'drizzle-orm'
import type {
  AcceptInviteInput,
  LoginChallenge,
  LoginInput,
  PlatformSession,
  TenantSession,
} from '@tdm/shared'
import { env } from '../../config/env'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  platformUsers,
  refreshTokens,
  roles,
  users,
  type Organization,
  type PlatformUser,
  type Role,
  type User,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, forbidden, unauthorized } from '../../lib/errors'
import { hashPassword, verifyPassword } from '../../lib/password'
import {
  randomToken,
  sha256,
  signAccessToken,
  signChallengeToken,
  verifyChallengeToken,
  type Realm,
} from '../../lib/tokens'
import type { RequestContext } from '../../types/express'
import { isOrganizationUsable } from '../workspace/service'
import { checkSecondFactor } from './two-factor'

export interface ClientMeta {
  ip?: string | null
  userAgent?: string | null
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
}

/**
 * Two browser tabs can refresh at the same moment with the same token. A
 * token reused within this window is treated as that race, not as theft.
 */
const REFRESH_REUSE_GRACE_MS = 20_000

const invalidCredentials = () =>
  unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect')
const refreshInvalid = () => unauthorized('REFRESH_INVALID', 'Please sign in again')

async function issueTokens(
  conn: DbOrTx,
  realm: Realm,
  subject: { id: string; tokenVersion: number },
  organizationId: string | null,
  meta: ClientMeta,
): Promise<IssuedTokens> {
  const refreshToken = randomToken(48)
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
  await conn.insert(refreshTokens).values({
    realm,
    subjectId: subject.id,
    organizationId,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
  })
  const accessToken = signAccessToken({
    sub: subject.id,
    realm,
    org: organizationId ?? undefined,
    tv: subject.tokenVersion,
  })
  return { accessToken, refreshToken, refreshExpiresAt }
}

/** Signs out a user everywhere by cancelling all of their refresh tokens. */
export async function revokeAllRefreshTokens(conn: DbOrTx, realm: Realm, subjectId: string) {
  await conn
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.realm, realm),
        eq(refreshTokens.subjectId, subjectId),
        isNull(refreshTokens.revokedAt),
      ),
    )
}

export function buildTenantSession(org: Organization, user: User, role: Role): TenantSession {
  return {
    realm: 'tenant',
    user: { id: user.id, name: user.name, email: user.email },
    role: { id: role.id, key: role.key, name: role.name },
    permissions: role.permissions,
    organization: { id: org.id, slug: org.slug, name: org.name, status: org.status },
    twoFactor: { enabled: !!user.totpEnabledAt, required: org.requireTwoFactor },
  }
}

export function buildPlatformSession(user: PlatformUser): PlatformSession {
  return {
    realm: 'platform',
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    twoFactor: { enabled: !!user.totpEnabledAt, required: false },
  }
}

async function getRole(org: Organization, roleId: string): Promise<Role> {
  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, org.id, eq(roles.id, roleId)))
    .limit(1)
  if (!role) throw forbidden()
  return role
}

// ---------------------------------------------------------------------------
// Client users
// ---------------------------------------------------------------------------

export type LoginResult =
  { tokens: IssuedTokens; session: TenantSession | PlatformSession } | { challenge: LoginChallenge }

const challengeInvalid = () =>
  unauthorized('CHALLENGE_INVALID', 'The sign-in took too long. Enter your password again.')

export async function loginTenant(
  org: Organization,
  input: LoginInput,
  meta: ClientMeta,
): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, org.id, eq(users.email, input.email)))
    .limit(1)

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? null)
  if (!user || !passwordOk) throw invalidCredentials()
  if (user.status !== 'active') {
    throw forbidden('ACCOUNT_SUSPENDED', 'Your account is suspended. Contact your admin.')
  }
  if (user.totpEnabledAt) {
    const challengeToken = signChallengeToken({
      sub: user.id,
      realm: 'tenant',
      org: org.id,
      tv: user.tokenVersion,
    })
    return { challenge: { twoFactorRequired: true, challengeToken } }
  }
  return finishTenantLogin(org, user, meta, 'password')
}

/** The second step: the code from the app (or a backup code), then the session. */
export async function loginTenantTwoFactor(
  org: Organization,
  input: { challengeToken: string; code: string },
  meta: ClientMeta,
) {
  const c = verifyChallengeToken(input.challengeToken, 'tenant')
  if (!c || c.org !== org.id) throw challengeInvalid()
  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, org.id, eq(users.id, c.sub)))
    .limit(1)
  if (!user || user.status !== 'active' || user.tokenVersion !== c.tv) throw challengeInvalid()
  const method = await db.transaction((tx) =>
    checkSecondFactor(tx, { realm: 'tenant', id: user.id, orgId: org.id }, input.code),
  )
  return finishTenantLogin(org, user, meta, method)
}

async function finishTenantLogin(
  org: Organization,
  user: User,
  meta: ClientMeta,
  method: 'password' | 'app' | 'backup_code',
) {
  const role = await getRole(org, user.roleId)
  const tokens = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(orgWhere(users, org.id, eq(users.id, user.id)))
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      details: method === 'password' ? undefined : { twoFactor: method },
      ip: meta.ip,
    })
    return issueTokens(tx, 'tenant', user, org.id, meta)
  })
  return { tokens, session: buildTenantSession(org, user, role) }
}

async function findValidInvite(org: Organization, token: string): Promise<User> {
  const [user] = await db
    .select()
    .from(users)
    .where(orgWhere(users, org.id, eq(users.inviteTokenHash, sha256(token))))
    .limit(1)
  if (
    !user ||
    user.status !== 'invited' ||
    !user.inviteExpiresAt ||
    user.inviteExpiresAt.getTime() < Date.now()
  ) {
    throw badRequest(
      'INVITE_INVALID',
      'This invitation link is not valid or has expired. Ask your admin for a new one.',
    )
  }
  return user
}

/** Shown on the "set your password" page before the user submits. */
export async function getInvite(org: Organization, token: string) {
  const user = await findValidInvite(org, token)
  return { name: user.name, email: user.email, organizationName: org.name }
}

export async function acceptInvite(org: Organization, input: AcceptInviteInput, meta: ClientMeta) {
  const user = await findValidInvite(org, input.token)
  const passwordHash = await hashPassword(input.password)
  const role = await getRole(org, user.roleId)

  const { tokens, activated } = await db.transaction(async (tx) => {
    // The status condition makes a double submit of the same link harmless.
    const [result] = await tx
      .update(users)
      .set({
        passwordHash,
        status: 'active',
        inviteTokenHash: null,
        inviteExpiresAt: null,
        lastLoginAt: new Date(),
      })
      .where(orgWhere(users, org.id, eq(users.id, user.id), eq(users.status, 'invited')))
    if (result.affectedRows !== 1)
      throw badRequest('INVITE_INVALID', 'This invitation was already used')

    await writeAudit(tx, {
      organizationId: org.id,
      actorType: 'user',
      actorId: user.id,
      action: 'user.invite_accepted',
      entity: 'user',
      entityId: user.id,
      ip: meta.ip,
    })
    const activated = { ...user, status: 'active' as const }
    return { tokens: await issueTokens(tx, 'tenant', activated, org.id, meta), activated }
  })
  return { tokens, session: buildTenantSession(org, activated, role) }
}

// ---------------------------------------------------------------------------
// Our own team (owner panel)
// ---------------------------------------------------------------------------

export async function loginPlatform(input: LoginInput, meta: ClientMeta): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(platformUsers)
    .where(eq(platformUsers.email, input.email))
    .limit(1)

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? null)
  if (!user || !passwordOk) throw invalidCredentials()
  if (user.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', 'This account is disabled')
  if (user.totpEnabledAt) {
    const challengeToken = signChallengeToken({
      sub: user.id,
      realm: 'platform',
      tv: user.tokenVersion,
    })
    return { challenge: { twoFactorRequired: true, challengeToken } }
  }
  return finishPlatformLogin(user, meta, 'password')
}

export async function loginPlatformTwoFactor(
  input: { challengeToken: string; code: string },
  meta: ClientMeta,
) {
  const c = verifyChallengeToken(input.challengeToken, 'platform')
  if (!c) throw challengeInvalid()
  const [user] = await db.select().from(platformUsers).where(eq(platformUsers.id, c.sub)).limit(1)
  if (!user || user.status !== 'active' || user.tokenVersion !== c.tv) throw challengeInvalid()
  const method = await db.transaction((tx) =>
    checkSecondFactor(tx, { realm: 'platform', id: user.id, orgId: null }, input.code),
  )
  return finishPlatformLogin(user, meta, method)
}

async function finishPlatformLogin(
  user: PlatformUser,
  meta: ClientMeta,
  method: 'password' | 'app' | 'backup_code',
) {
  const tokens = await db.transaction(async (tx) => {
    await tx
      .update(platformUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformUsers.id, user.id))
    await writeAudit(tx, {
      organizationId: null,
      actorType: 'platform',
      actorId: user.id,
      action: 'auth.login',
      entity: 'platform_user',
      entityId: user.id,
      details: method === 'password' ? undefined : { twoFactor: method },
      ip: meta.ip,
    })
    return issueTokens(tx, 'platform', user, null, meta)
  })
  return { tokens, session: buildPlatformSession(user) }
}

// ---------------------------------------------------------------------------
// Refresh and sign-out (both realms)
// ---------------------------------------------------------------------------

/**
 * Swaps a refresh token for a new access token and a new refresh token.
 * The old refresh token stops working. If an old token is used again later,
 * it may have been stolen, so every session of that user is ended.
 */
export async function refreshSession(ctx: RequestContext, rawToken: string, meta: ClientMeta) {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(rawToken)))
    .limit(1)
  if (!row) throw refreshInvalid()

  const sameWorkspace =
    (ctx.kind === 'tenant' && row.realm === 'tenant' && row.organizationId === ctx.org.id) ||
    (ctx.kind === 'owner' && row.realm === 'platform')
  if (!sameWorkspace) throw refreshInvalid()

  const now = Date.now()
  if (row.expiresAt.getTime() <= now) throw refreshInvalid()

  if (row.revokedAt) {
    // Only a token retired by a normal refresh gets the short grace window.
    // Sign-out, suspension and theft detection end a token for good.
    const inGrace =
      row.rotatedAt !== null && now - row.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS
    if (!inGrace) {
      if (row.rotatedAt) {
        // A retired token used again later may have been stolen: end every session.
        await revokeAllRefreshTokens(db, row.realm, row.subjectId)
        await writeAudit(db, {
          organizationId: row.organizationId,
          actorType: 'system',
          actorId: null,
          action: 'auth.refresh_reuse_detected',
          entity: row.realm === 'tenant' ? 'user' : 'platform_user',
          entityId: row.subjectId,
          ip: meta.ip,
        })
      }
      throw refreshInvalid()
    }
  } else {
    const at = new Date(now)
    await db
      .update(refreshTokens)
      .set({ revokedAt: at, rotatedAt: at })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
  }

  if (ctx.kind === 'tenant') {
    const org = ctx.org
    if (!isOrganizationUsable(org))
      throw forbidden('WORKSPACE_SUSPENDED', 'This workspace is suspended')
    const [user] = await db
      .select()
      .from(users)
      .where(orgWhere(users, org.id, eq(users.id, row.subjectId)))
      .limit(1)
    if (!user || user.status !== 'active') throw refreshInvalid()
    const role = await getRole(org, user.roleId)
    const tokens = await issueTokens(db, 'tenant', user, org.id, meta)
    return { tokens, session: buildTenantSession(org, user, role) }
  }

  const [user] = await db
    .select()
    .from(platformUsers)
    .where(eq(platformUsers.id, row.subjectId))
    .limit(1)
  if (!user || user.status !== 'active') throw refreshInvalid()
  const tokens = await issueTokens(db, 'platform', user, null, meta)
  return { tokens, session: buildPlatformSession(user) }
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(rawToken)), isNull(refreshTokens.revokedAt)))
}
