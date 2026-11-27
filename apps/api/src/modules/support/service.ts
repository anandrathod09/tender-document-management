import { randomUUID } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'
import {
  PERMISSIONS,
  publicTicketSchema,
  type PublicAsset,
  type PublicTicketResult,
} from '@tdm/shared'
import type { z } from 'zod'
import { env } from '../../config/env'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  installationConsignees,
  installationReports,
  installedAssets,
  roles,
  serviceTickets,
  ticketUpdates,
  users,
  type Organization,
} from '../../db/schema'
import { todayIn } from '../../lib/dates'
import { COLORS, button, details, esc, fallbackLink, layout, note, p } from '../../lib/email-templates'
import { isDuplicateKeyError, notFound } from '../../lib/errors'
import { queueMail } from '../../lib/mailer'
import { warrantyEnd, warrantyStart, warrantyStatusOf } from '../installation/assets'
import { notify } from '../notifications/service'
import { nextTicketNumber, ticketLink, ticketNo } from '../tickets/service'
import { workspaceUrl } from '../users/invites'
import { supportSettingsOf } from './settings'

type TicketInput = z.output<typeof publicTicketSchema>

/** At most this many units are shown for one serial number. */
const MAX_MATCHES = 5

/** The page is off: answer as if it does not exist. */
function assertEnabled(org: Organization) {
  if (!supportSettingsOf(org).enabled) {
    throw notFound('SUPPORT_PAGE_OFF', 'This company does not take service requests online')
  }
}

/** Units with this serial number (main, monitor or CPU), in this client only. */
async function findBySerial(conn: DbOrTx, org: Organization, serial: string) {
  const term = serial.trim()
  const rows = await conn
    .select({
      a: installedAssets,
      customerName: installationReports.customerName,
      warrantyStart,
      warrantyEnd,
    })
    .from(installedAssets)
    .innerJoin(installationConsignees, eq(installationConsignees.id, installedAssets.consigneeId))
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .where(
      orgWhere(
        installedAssets,
        org.id,
        or(
          eq(installedAssets.serialNumber, term),
          eq(installedAssets.monitorSerial, term),
          eq(installedAssets.cpuSerial, term),
        ),
      ),
    )
    .orderBy(installedAssets.itemName)
    .limit(MAX_MATCHES)

  const today = todayIn(org.timezone)
  const lower = term.toLowerCase()
  return rows.map((r) => {
    const end = r.warrantyEnd ? String(r.warrantyEnd).slice(0, 10) : null
    const w = warrantyStatusOf(end, today)
    const matched =
      [r.a.serialNumber, r.a.monitorSerial, r.a.cpuSerial].find(
        (s) => s?.trim().toLowerCase() === lower,
      ) ?? term
    const asset: PublicAsset = {
      id: r.a.id,
      itemName: r.a.itemName,
      serialNumber: matched,
      customerName: r.customerName,
      installedOn: r.warrantyStart ? String(r.warrantyStart).slice(0, 10) : null,
      warrantyEnd: end,
      daysLeft: w.daysLeft,
      warranty: w.daysLeft === null ? 'unknown' : w.daysLeft >= 0 ? 'in' : 'out',
    }
    return { asset, tenderId: r.a.tenderId }
  })
}

export async function lookupAssets(org: Organization, serial: string): Promise<PublicAsset[]> {
  assertEnabled(org)
  return (await findBySerial(db, org, serial)).map((m) => m.asset)
}

/** Everyone active whose role can handle service tickets. */
async function ticketHandlers(conn: DbOrTx, orgId: string) {
  const rows = await conn
    .select({
      id: users.id,
      email: users.email,
      roleKey: roles.key,
      permissions: roles.permissions,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(orgWhere(users, orgId), eq(users.status, 'active')))
  return rows.filter((r) => r.permissions.includes(PERMISSIONS.TICKET_MANAGE))
}

const formatDate = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not recorded'

const warrantyText = (a: PublicAsset) =>
  a.warranty === 'in'
    ? `In warranty until ${formatDate(a.warrantyEnd)}`
    : a.warranty === 'out'
      ? `Out of warranty (ended ${formatDate(a.warrantyEnd)}), service may be chargeable`
      : 'No warranty recorded'

/**
 * A customer raises a service request from the public support page. It
 * becomes an ordinary service ticket, everyone who handles tickets gets a
 * notification, and an email goes to the addresses chosen in Settings (or,
 * when none are chosen, to the admins, as in the old TMS).
 */
export async function raiseTicket(
  org: Organization,
  input: TicketInput,
): Promise<PublicTicketResult> {
  assertEnabled(org)
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const match = (await findBySerial(tx, org, input.serial)).find(
          (m) => m.asset.id === input.assetId,
        )
        if (!match) {
          throw notFound('ASSET_NOT_FOUND', 'No product with this serial number was found')
        }
        const { asset } = match
        const id = randomUUID()
        const number = await nextTicketNumber(tx, org.id)
        const title = `${asset.itemName} (${asset.serialNumber})`.slice(0, 200)
        await tx.insert(serviceTickets).values({
          id,
          organizationId: org.id,
          number,
          title,
          description: input.description,
          type: 'complaint',
          priority: 'medium',
          source: 'support_page',
          tenderId: match.tenderId,
          assetId: asset.id,
          customerName: asset.customerName,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          createdBy: null,
        })
        await tx.insert(ticketUpdates).values({
          organizationId: org.id,
          ticketId: id,
          status: 'new',
          note: `Raised by the customer on the support page. ${warrantyText(asset)}.`,
          userId: null,
        })

        const handlers = await ticketHandlers(tx, org.id)
        for (const h of handlers) {
          await notify(tx, {
            organizationId: org.id,
            userId: h.id,
            type: 'ticket.support_request',
            title: `New support request ${ticketNo(number)}`,
            body: `${title}: ${input.description}`,
            link: ticketLink(id),
          })
        }
        const chosen = supportSettingsOf(org).emails
        const recipients = chosen.length
          ? chosen
          : handlers.filter((h) => h.roleKey === 'admin').map((h) => h.email)
        for (const to of new Set(recipients)) {
          await queueMail(tx, supportRequestEmail(org, to, id, number, asset, input), org.id)
        }
        return { ticketNo: ticketNo(number), warranty: asset.warranty }
      })
    } catch (err) {
      // Two requests at the same moment can get the same number; try again once.
      if (attempt === 0 && isDuplicateKeyError(err)) continue
      throw err
    }
  }
}

function supportRequestEmail(
  org: Organization,
  to: string,
  ticketId: string,
  number: number,
  asset: PublicAsset,
  input: TicketInput,
) {
  const no = ticketNo(number)
  const color = asset.warranty === 'out' ? COLORS.amber : COLORS.blue
  const url = `${workspaceUrl(org.slug)}${ticketLink(ticketId)}`
  const contact = [input.contactName, input.contactPhone, input.contactEmail]
    .filter(Boolean)
    .join(', ')
  const rows: [string, string][] = [
    ['Product', asset.itemName],
    ['Serial number', asset.serialNumber],
    ['Customer', asset.customerName ?? 'Not recorded'],
    ['Warranty', warrantyText(asset)],
    ['Contact', contact],
  ]
  return {
    to,
    fromName: org.name,
    ...(input.contactEmail && { replyTo: input.contactEmail }),
    subject: `New support request ${no}: ${asset.itemName}`,
    text: [
      `A customer raised a service request on the ${org.name} support page.`,
      '',
      `Ticket: ${no}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      'Problem:',
      input.description,
      '',
      `Open the ticket: ${url}`,
    ].join('\n'),
    html: layout({
      heading: `New support request ${no}`,
      subheading: `${org.name} · Support page`,
      color,
      preheader: `${asset.itemName}: ${input.description.slice(0, 80)}`,
      body: [
        p(`A customer raised a service request on the ${org.name} support page.`),
        details('Request details', rows, color),
        '<p style="margin:0 0 6px 0;font-size:14px;font-weight:bold;color:#333333;">Problem</p>',
        p(input.description),
        asset.warranty === 'out'
          ? note('Out of warranty:', 'The service may be chargeable.', 'red')
          : '',
        button(url, 'Open the Ticket', COLORS.blue),
        fallbackLink(url),
        `<p style="margin:0;font-size:13px;color:#666666;"><em>Sent by ${esc(env.PRODUCT_NAME)} because you handle service requests for ${esc(org.name)}.</em></p>`,
      ].join(''),
    }),
  }
}
