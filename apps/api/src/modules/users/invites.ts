import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import type { DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { users, type Organization } from '../../db/schema'
import {
  button,
  COLORS,
  details,
  esc,
  fallbackLink,
  layout,
  note,
  p,
} from '../../lib/email-templates'
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
      html: layout({
        heading: env.PRODUCT_NAME,
        subheading: `${org.name} · Account setup`,
        color: COLORS.blue,
        preheader: `Set up your account for ${org.name}`,
        body: [
          `<h2 style="margin:0 0 14px 0;font-size:20px;color:${COLORS.blue};">Welcome, ${esc(to.name)}!</h2>`,
          p(`An account has been created for you at ${org.name} by an administrator.`),
          details(
            'Your sign-in details',
            [
              ['Email', to.email],
              ['Sign-in address', workspaceUrl(org.slug)],
            ],
            COLORS.blue,
          ),
          p('To finish setting up your account and choose your password, click the button below:'),
          button(inviteUrl, 'Set Up Your Account', COLORS.blue),
          note(
            'Important:',
            `Please complete your account setup within ${INVITE_TTL_HOURS} hours.`,
          ),
          p(`If you did not expect this, or need help, contact the administrator at ${org.name}.`),
          fallbackLink(inviteUrl),
          '<p style="margin:0;font-size:13px;color:#666666;"><em>This link is unique to you. Do not share it with others.</em></p>',
        ].join(''),
      }),
    },
    org.id,
  )
}
