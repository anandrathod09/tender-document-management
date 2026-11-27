import { eq } from 'drizzle-orm'
import { emailPreferencesFrom, type EmailEvent } from '@tdm/shared'
import type { DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { users, type Organization } from '../../db/schema'
import { button, COLORS, details, esc, fallbackLink, layout, p } from '../../lib/email-templates'
import { queueMail } from '../../lib/mailer'
import { workspaceUrl } from '../users/invites'

/**
 * Emails for tender events, sent next to the in-app notification. Each email
 * goes only to an active user who has not switched that event off (My Email
 * Notifications). Callers already skip the person's own actions.
 */

interface EventEmail {
  subject: string
  heading: string
  preheader: string
  /** Lines before the details box. */
  intro: string[]
  details: { title: string; rows: [string, string][] }
  /** Extra lines after the details, e.g. a note from the assigner. */
  after?: string[]
  /** Path in the app, e.g. /tenders/123 */
  link: string
  linkLabel: string
}

const WHY: Record<EmailEvent, string> = {
  tender_assigned: 'a tender is assigned to you',
  engineer_assigned: 'you are made the engineer on an installation',
  ticket_assigned: 'a service ticket is assigned to you',
}

export async function emailUser(
  conn: DbOrTx,
  org: Organization,
  userId: string,
  event: EmailEvent,
  email: EventEmail,
): Promise<void> {
  const [user] = await conn
    .select({ name: users.name, email: users.email, status: users.status, prefs: users.emailPrefs })
    .from(users)
    .where(orgWhere(users, org.id, eq(users.id, userId)))
  if (!user || user.status !== 'active' || !emailPreferencesFrom(user.prefs)[event]) return

  const base = workspaceUrl(org.slug)
  const url = `${base}${email.link}`
  const settingsUrl = `${base}/account/notifications`
  await queueMail(
    conn,
    {
      to: user.email,
      fromName: org.name,
      subject: email.subject,
      text: [
        `Hello ${user.name},`,
        '',
        ...email.intro,
        '',
        ...email.details.rows.map(([k, v]) => `${k}: ${v}`),
        ...(email.after?.length ? ['', ...email.after] : []),
        '',
        `${email.linkLabel}: ${url}`,
        '',
        `You get this email because ${WHY[event]}. Turn it off in My Email Notifications: ${settingsUrl}`,
      ].join('\n'),
      html: layout({
        heading: email.heading,
        subheading: org.name,
        color: COLORS.blue,
        preheader: email.preheader,
        body: [
          `<h2 style="margin:0 0 14px 0;font-size:18px;color:${COLORS.blue};">Hello, ${esc(user.name)}</h2>`,
          ...email.intro.map(p),
          details(email.details.title, email.details.rows, COLORS.blue),
          ...(email.after ?? []).map(p),
          button(url, email.linkLabel, COLORS.blue),
          fallbackLink(url),
          `<p style="margin:0;font-size:12px;line-height:1.5;color:#666666;">You get this email because ${esc(WHY[event])}. <a href="${esc(settingsUrl)}" style="color:#4F46E5;">Turn these emails off</a>.</p>`,
        ].join(''),
      }),
    },
    org.id,
  )
}

const dateText = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not given'

interface TenderBrief {
  id: string
  referenceNo: string
  title: string
  buyerOrganization: string | null
  deadline: string
}

/** At most this many tenders are listed in one email; the rest are counted. */
const LIST_MAX = 10

export function tenderAssignedEmail(
  list: TenderBrief[],
  by: string,
  note: string | undefined,
): EventEmail {
  const one = list.length === 1 ? list[0]! : null
  const after = note ? [`Note from ${by}: ${note}`] : []
  if (one) {
    return {
      subject: `Tender assigned to you: ${one.referenceNo}`,
      heading: 'Tender assigned to you',
      preheader: `${one.referenceNo} · ${one.title.slice(0, 80)}`,
      intro: [`${by} assigned this tender to you.`],
      details: {
        title: 'Tender',
        rows: [
          ['Reference No', one.referenceNo],
          ['Title', one.title],
          ['Buyer', one.buyerOrganization ?? 'Not given'],
          ['Deadline', dateText(one.deadline)],
        ],
      },
      after,
      link: `/tenders/${one.id}`,
      linkLabel: 'Open the Tender',
    }
  }
  const shown = [...list].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, LIST_MAX)
  const more = list.length - shown.length
  return {
    subject: `${list.length} tenders assigned to you`,
    heading: `${list.length} tenders assigned to you`,
    preheader: shown.map((t) => t.referenceNo).join(', '),
    intro: [`${by} assigned ${list.length} tenders to you. Soonest deadline first:`],
    details: {
      title: 'Tenders',
      rows: shown.map(
        (t): [string, string] => [t.referenceNo, `${t.title.slice(0, 90)} (deadline ${dateText(t.deadline)})`],
      ),
    },
    after: [...(more > 0 ? [`And ${more} more.`] : []), ...after],
    link: '/tenders?assigned=me',
    linkLabel: 'Open My Tenders',
  }
}

export function engineerAssignedEmail(
  tender: { id: string; referenceNo: string; title: string },
  consignees: string[],
  customerName: string | null,
  by: string,
): EventEmail {
  return {
    subject: `Installation assigned to you: ${tender.referenceNo}`,
    heading: 'Installation assigned to you',
    preheader: `${tender.referenceNo} · ${consignees.join(', ')}`,
    intro: [
      `${by} made you the engineer on ${consignees.length === 1 ? 'a consignee' : `${consignees.length} consignees`} of this tender.`,
    ],
    details: {
      title: 'Installation',
      rows: [
        ['Tender', `${tender.referenceNo} · ${tender.title}`],
        ['Customer', customerName ?? 'Not given'],
        [consignees.length === 1 ? 'Consignee' : 'Consignees', consignees.join(', ')],
      ],
    },
    link: `/tenders/${tender.id}/installation`,
    linkLabel: 'Open the Installation Report',
  }
}

export function ticketAssignedEmail(
  ticket: {
    id: string
    no: string
    title: string
    description: string
    priority: string
    customerName: string | null
  },
  by: string,
): EventEmail {
  return {
    subject: `Ticket ${ticket.no} assigned to you: ${ticket.title}`,
    heading: `Ticket ${ticket.no} assigned to you`,
    preheader: ticket.description.slice(0, 100),
    intro: [`${by} assigned this service ticket to you.`],
    details: {
      title: 'Ticket',
      rows: [
        ['Ticket', `${ticket.no} · ${ticket.title}`],
        ['Priority', ticket.priority[0]!.toUpperCase() + ticket.priority.slice(1)],
        ['Customer', ticket.customerName ?? 'Not given'],
        ['Problem', ticket.description.slice(0, 500)],
      ],
    },
    link: `/tickets/${ticket.id}`,
    linkLabel: 'Open the Ticket',
  }
}
