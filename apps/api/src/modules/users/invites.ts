import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import type { DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { users, type Organization } from '../../db/schema'
import { queueMail } from '../../lib/mailer'
import { randomToken, sha256 } from '../../lib/tokens'

export const INVITE_TTL_HOURS = 72

/** The client's web address, e.g. https://acme.ourdomain.com */
export function workspaceUrl(orgSlug: string): string {
  return env.PUBLIC_URL_TEMPLATE.replace('{slug}', orgSlug).replace(/\/$/, '')
}

export function buildInviteUrl(orgSlug: string, token: string): string {
  return `${workspaceUrl(orgSlug)}/accept-invite?token=${encodeURIComponent(token)}`
}

/** Gives the user a fresh invitation link (any older link stops working). */
export async function issueInvite(
  conn: DbOrTx,
  org: Organization,
  userId: string,
): Promise<string> {
  const token = randomToken(32)
  await conn
    .update(users)
    .set({
      inviteTokenHash: sha256(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
    })
    .where(orgWhere(users, org.id, eq(users.id, userId)))
  return buildInviteUrl(org.slug, token)
}

/** Queues the invitation email in the same transaction that created the invitation. */
export async function sendInviteEmail(
  conn: DbOrTx,
  org: Organization,
  to: { name: string; email: string },
  inviteUrl: string,
): Promise<void> {
  await queueMail(
    conn,
    {
      to: to.email,
      fromName: org.name,
      subject: `You're invited to ${org.name} on ${env.PRODUCT_NAME}`,
      text: [
        `Hello ${to.name},`,
        '',
        `You have been invited to join ${org.name} on ${env.PRODUCT_NAME}.`,
        'Open this link to set your password and sign in:',
        '',
        inviteUrl,
        '',
        `The link works for ${INVITE_TTL_HOURS} hours.`,
      ].join('\n'),
    },
    org.id,
  )
}
