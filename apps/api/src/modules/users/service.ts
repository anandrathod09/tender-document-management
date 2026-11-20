import { randomUUID } from 'node:crypto'
import { asc, count, eq, ne } from 'drizzle-orm'
import type {
  InviteUserInput,
  RoleSummary,
  UpdateUserInput,
  UserStatus,
  UserSummary,
} from '@tdm/shared'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { organizations, plans, roles, users, type Organization, type User } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import { revokeAllRefreshTokens } from '../auth/service'
import { clearedTwoFactor } from '../auth/two-factor'
import { issueInvite, sendInviteEmail } from './invites'

export interface Actor {
  type: 'user' | 'platform'
  id: string
  ip?: string | null
}

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  totpEnabledAt: users.totpEnabledAt,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  roleId: roles.id,
  roleKey: roles.key,
  roleName: roles.name,
}

interface UserRow {
  id: string
  name: string
  email: string
  phone: string | null
  totpEnabledAt: Date | null
  status: UserStatus
  lastLoginAt: Date | null
  createdAt: Date
  roleId: string
  roleKey: string
  roleName: string
}

function toSummary(r: UserRow): UserSummary {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    twoFactorEnabled: !!r.totpEnabledAt,
    status: r.status,
    role: { id: r.roleId, key: r.roleKey, name: r.roleName },
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listUsers(orgId: string): Promise<UserSummary[]> {
  const rows = await db
    .select(userColumns)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId))
    .orderBy(asc(users.name))
  return rows.map(toSummary)
}

export async function getUserSummary(
  conn: DbOrTx,
  orgId: string,
  userId: string,
): Promise<UserSummary> {
  const [row] = await conn
    .select(userColumns)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId, eq(users.id, userId)))
    .limit(1)
  if (!row) throw notFound('USER_NOT_FOUND', 'User not found')
  return toSummary(row)
}

export async function listRoles(orgId: string): Promise<RoleSummary[]> {
  const rows = await db.select().from(roles).where(orgWhere(roles, orgId)).orderBy(asc(roles.name))
  return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, permissions: r.permissions }))
}

async function getRoleInOrg(conn: DbOrTx, orgId: string, roleId: string) {
  const [role] = await conn
    .select()
    .from(roles)
    .where(orgWhere(roles, orgId, eq(roles.id, roleId)))
    .limit(1)
  if (!role) throw badRequest('ROLE_NOT_FOUND', 'That role does not exist in this workspace')
  return role
}

async function getUserInOrg(conn: DbOrTx, orgId: string, userId: string): Promise<User> {
  const [user] = await conn
    .select()
    .from(users)
    .where(orgWhere(users, orgId, eq(users.id, userId)))
    .limit(1)
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found')
  return user
}

/** Users that count toward the plan's user limit: everyone except suspended users. */
async function countSeats(conn: DbOrTx, orgId: string): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(users)
    .where(orgWhere(users, orgId, ne(users.status, 'suspended')))
  return row?.n ?? 0
}

async function countActiveAdmins(conn: DbOrTx, orgId: string, excludeUserId: string) {
  const [row] = await conn
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      orgWhere(
        users,
        orgId,
        eq(roles.key, 'admin'),
        eq(users.status, 'active'),
        ne(users.id, excludeUserId),
      ),
    )
  return row?.n ?? 0
}

/** Throws if adding one more non-suspended user would go over the plan's limit. */
async function assertSeatAvailable(conn: DbOrTx, orgId: string) {
  const [plan] = await conn
    .select({ maxUsers: plans.maxUsers })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (plan && (await countSeats(conn, orgId)) >= plan.maxUsers) {
    throw conflict(
      'PLAN_USER_LIMIT',
      `Your plan allows ${plan.maxUsers} users. Suspend a user or upgrade the plan.`,
    )
  }
}

/** Creates an invited user and emails them a link to set their password. */
export async function inviteUser(org: Organization, actor: Actor, input: InviteUserInput) {
  const result = await db.transaction(async (tx) => {
    await getRoleInOrg(tx, org.id, input.roleId)
    await assertSeatAvailable(tx, org.id)

    const userId = randomUUID()
    try {
      await tx.insert(users).values({
        id: userId,
        organizationId: org.id,
        email: input.email,
        name: input.name,
        phone: input.phone ?? null,
        roleId: input.roleId,
        status: 'invited',
      })
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw conflict('EMAIL_TAKEN', 'A user with this email already exists in this workspace')
      }
      throw err
    }

    const inviteUrl = await issueInvite(tx, org, userId)
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'user.invited',
      entity: 'user',
      entityId: userId,
      details: { email: input.email, roleId: input.roleId },
      ip: actor.ip,
    })
    await sendInviteEmail(tx, org, { name: input.name, email: input.email }, inviteUrl)
    return { user: await getUserSummary(tx, org.id, userId), inviteUrl }
  })
  return result
}

export async function resendInvite(org: Organization, actor: Actor, userId: string) {
  const result = await db.transaction(async (tx) => {
    const user = await getUserInOrg(tx, org.id, userId)
    if (user.status !== 'invited') {
      throw conflict('NOT_INVITED', 'This user has already accepted their invitation')
    }
    const inviteUrl = await issueInvite(tx, org, user.id)
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'user.invite_resent',
      entity: 'user',
      entityId: user.id,
      ip: actor.ip,
    })
    await sendInviteEmail(tx, org, user, inviteUrl)
    return { inviteUrl }
  })
  return { inviteUrl: result.inviteUrl }
}

/**
 * Changes a user's name, role or status. A workspace always keeps at least
 * one active admin, and an admin cannot suspend themselves.
 */
export async function updateUser(
  org: Organization,
  actor: Actor,
  userId: string,
  input: UpdateUserInput,
): Promise<UserSummary> {
  return db.transaction(async (tx) => {
    const user = await getUserInOrg(tx, org.id, userId)
    const currentRole = await getRoleInOrg(tx, org.id, user.roleId)
    const newRole = input.roleId ? await getRoleInOrg(tx, org.id, input.roleId) : currentRole

    if (input.status === 'suspended' && actor.type === 'user' && actor.id === user.id) {
      throw conflict('CANNOT_SUSPEND_SELF', 'You cannot suspend your own account')
    }
    if (input.status === 'active' && user.status === 'invited') {
      throw conflict('INVITE_PENDING', 'This user must accept their invitation first')
    }

    const losesAdmin =
      currentRole.key === 'admin' &&
      user.status === 'active' &&
      (newRole.key !== 'admin' || input.status === 'suspended')
    if (losesAdmin && (await countActiveAdmins(tx, org.id, user.id)) === 0) {
      throw conflict('LAST_ADMIN', 'The workspace needs at least one active admin')
    }

    // Someone who never set a password goes back to "invited" when reactivated,
    // so the admin can send them a fresh invitation link.
    const targetStatus: UserStatus | undefined =
      input.status === 'active' && !user.passwordHash ? 'invited' : input.status
    const roleChanged = newRole.id !== user.roleId
    const statusChanged = targetStatus !== undefined && targetStatus !== user.status
    const suspending = statusChanged && targetStatus === 'suspended'

    if (statusChanged && user.status === 'suspended') await assertSeatAvailable(tx, org.id)

    await tx
      .update(users)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(roleChanged && { roleId: newRole.id }),
        ...(statusChanged && { status: targetStatus }),
        // Cancel an unused invitation when an invited user is suspended.
        ...(suspending && { inviteTokenHash: null, inviteExpiresAt: null }),
        // Existing sessions pick up a new role or end when suspended.
        ...((roleChanged || statusChanged) && { tokenVersion: user.tokenVersion + 1 }),
      })
      .where(orgWhere(users, org.id, eq(users.id, user.id)))

    if (suspending) await revokeAllRefreshTokens(tx, 'tenant', user.id)

    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'user.updated',
      entity: 'user',
      entityId: user.id,
      details: {
        ...(input.name !== undefined && { name: input.name }),
        ...(roleChanged && { fromRole: currentRole.key, toRole: newRole.key }),
        ...(statusChanged && { fromStatus: user.status, toStatus: targetStatus }),
      },
      ip: actor.ip,
    })
    return getUserSummary(tx, org.id, user.id)
  })
}

/**
 * For a user who lost their phone and their backup codes: turns two-step
 * login off and signs them out everywhere. They set it up again at their
 * next sign-in (or when the workspace requires it).
 */
export async function resetUserTwoFactor(
  org: Organization,
  actor: Actor,
  userId: string,
): Promise<UserSummary> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(orgWhere(users, org.id, eq(users.id, userId)))
      .limit(1)
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found')
    if (actor.type === 'user' && actor.id === user.id) {
      throw badRequest(
        'USE_SECURITY_PAGE',
        'Change your own two-step login on the My Security page',
      )
    }
    if (!user.totpEnabledAt) {
      throw badRequest('TWO_FACTOR_OFF', 'Two-step login is not on for this user')
    }
    await tx
      .update(users)
      .set({ ...clearedTwoFactor, tokenVersion: user.tokenVersion + 1 })
      .where(orgWhere(users, org.id, eq(users.id, user.id)))
    await revokeAllRefreshTokens(tx, 'tenant', user.id)
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'user.two_factor_reset',
      entity: 'user',
      entityId: user.id,
      ip: actor.ip,
    })
    return getUserSummary(tx, org.id, user.id)
  })
}
