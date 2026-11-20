import { and, eq, isNull } from 'drizzle-orm'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { passwordResets, platformUsers, users } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest } from '../../lib/errors'
import { queueMail } from '../../lib/mailer'
import { hashPassword } from '../../lib/password'
import { randomToken, sha256 } from '../../lib/tokens'
import type { RequestContext } from '../../types/express'
import { workspaceUrl } from '../users/invites'
import { revokeAllRefreshTokens } from './service'

const RESET_TTL_MINUTES = 60

/**
 * Emails a password reset link if the email belongs to an active account in
 * this workspace. The caller always gets the same answer, so the form cannot
 * be used to find out which emails have accounts.
 */
export async function requestPasswordReset(ctx: RequestContext, email: string): Promise<void> {
  let subject: { id: string; name: string } | undefined
  let base: string
  let orgId: string | null = null
  let fromName: string | undefined

  if (ctx.kind === 'tenant') {
    ;[subject] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(orgWhere(users, ctx.org.id, eq(users.email, email), eq(users.status, 'active')))
      .limit(1)
    base = workspaceUrl(ctx.org.slug)
    orgId = ctx.org.id
    fromName = ctx.org.name
  } else if (ctx.kind === 'owner') {
    ;[subject] = await db
      .select({ id: platformUsers.id, name: platformUsers.name })
      .from(platformUsers)
      .where(and(eq(platformUsers.email, email), eq(platformUsers.status, 'active')))
      .limit(1)
    base = workspaceUrl(env.OWNER_SUBDOMAIN)
  } else {
    return
  }
  if (!subject) return

  const token = randomToken(32)
  const url = `${base}/reset-password?token=${encodeURIComponent(token)}`
  await db.transaction(async (tx) => {
    await tx.insert(passwordResets).values({
      realm: ctx.kind === 'tenant' ? 'tenant' : 'platform',
      subjectId: subject.id,
      organizationId: orgId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    })
    await queueMail(
      tx,
      {
        to: email,
        fromName,
        subject: `Reset your ${env.PRODUCT_NAME} password`,
        text: [
          `Hello ${subject.name},`,
          '',
          'We received a request to reset your password. Open this link to choose a new one:',
          '',
          url,
          '',
          `The link works for ${RESET_TTL_MINUTES} minutes and only once.`,
          'If you did not ask for this, ignore this email: your password stays the same.',
        ].join('\n'),
      },
      orgId,
    )
  })
}

/**
 * Sets a new password from a reset link. Every existing session of the user
 * ends, and any other unused reset links stop working.
 */
export async function resetPassword(
  ctx: RequestContext,
  token: string,
  password: string,
  ip: string | null,
) {
  const invalid = () =>
    badRequest('RESET_INVALID', 'This reset link is not valid or has expired. Ask for a new one.')
  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, sha256(token)))
    .limit(1)
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) throw invalid()
  const sameWorkspace =
    (ctx.kind === 'tenant' && reset.realm === 'tenant' && reset.organizationId === ctx.org.id) ||
    (ctx.kind === 'owner' && reset.realm === 'platform')
  if (!sameWorkspace) throw invalid()

  const passwordHash = await hashPassword(password)
  await db.transaction(async (tx) => {
    const now = new Date()
    const [marked] = await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)))
    if (marked.affectedRows !== 1) throw invalid()

    if (reset.realm === 'tenant') {
      const orgId = reset.organizationId!
      const [user] = await tx
        .select({ tv: users.tokenVersion, status: users.status })
        .from(users)
        .where(orgWhere(users, orgId, eq(users.id, reset.subjectId)))
        .limit(1)
      if (!user || user.status !== 'active') throw invalid()
      await tx
        .update(users)
        .set({ passwordHash, tokenVersion: user.tv + 1 })
        .where(orgWhere(users, orgId, eq(users.id, reset.subjectId)))
    } else {
      const [user] = await tx
        .select({ tv: platformUsers.tokenVersion, status: platformUsers.status })
        .from(platformUsers)
        .where(eq(platformUsers.id, reset.subjectId))
        .limit(1)
      if (!user || user.status !== 'active') throw invalid()
      await tx
        .update(platformUsers)
        .set({ passwordHash, tokenVersion: user.tv + 1 })
        .where(eq(platformUsers.id, reset.subjectId))
    }

    // Other unused links for the same person stop working.
    await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.realm, reset.realm),
          eq(passwordResets.subjectId, reset.subjectId),
          isNull(passwordResets.usedAt),
        ),
      )
    await revokeAllRefreshTokens(tx, reset.realm, reset.subjectId)
    await writeAudit(tx, {
      organizationId: reset.organizationId,
      actorType: reset.realm === 'tenant' ? 'user' : 'platform',
      actorId: reset.subjectId,
      action: 'auth.password_reset',
      entity: reset.realm === 'tenant' ? 'user' : 'platform_user',
      entityId: reset.subjectId,
      ip,
    })
  })
}
