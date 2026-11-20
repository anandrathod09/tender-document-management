import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, like, max, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import {
  OPEN_TICKET_STATUSES,
  createTicketSchema,
  ticketListQuerySchema,
  updateTicketSchema,
  type TicketDetail,
  type TicketPage,
  type TicketSummary,
} from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  installationConsignees,
  installationReports,
  installedAssets,
  serviceTickets,
  tenders,
  ticketUpdates,
  users,
} from '../../db/schema'
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { notify } from '../notifications/service'

type CreateInput = z.output<typeof createTicketSchema>
type UpdateInput = z.output<typeof updateTicketSchema>
type ListQuery = z.output<typeof ticketListQuerySchema>

const assignees = alias(users, 'assignee')
const creators = alias(users, 'creator')

const summaryColumns = {
  t: serviceTickets,
  tenderRef: tenders.referenceNo,
  assetItem: installedAssets.itemName,
  assetSerial: installedAssets.serialNumber,
  assigneeName: assignees.name,
}

function selectTickets(conn: DbOrTx) {
  return conn
    .select(summaryColumns)
    .from(serviceTickets)
    .leftJoin(tenders, eq(tenders.id, serviceTickets.tenderId))
    .leftJoin(installedAssets, eq(installedAssets.id, serviceTickets.assetId))
    .leftJoin(assignees, eq(assignees.id, serviceTickets.assignedTo))
}

type Row = Awaited<ReturnType<typeof selectTickets>>[number]

function toSummary(r: Row): TicketSummary {
  const t = r.t
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    type: t.type,
    priority: t.priority,
    status: t.status,
    customerName: t.customerName,
    tender: t.tenderId ? { id: t.tenderId, referenceNo: r.tenderRef ?? '' } : null,
    asset: t.assetId
      ? { id: t.assetId, itemName: r.assetItem ?? '', serialNumber: r.assetSerial }
      : null,
    assignedTo: t.assignedTo ? { id: t.assignedTo, name: r.assigneeName ?? '' } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

export async function listTickets(auth: TenantAuth, q: ListQuery): Promise<TicketPage> {
  const term = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const asNumber = q.q && /^(tkt-?)?\d+$/i.test(q.q) ? Number(q.q.replace(/\D/g, '')) : null
  const where = orgWhere(
    serviceTickets,
    auth.org.id,
    q.status === 'open'
      ? inArray(serviceTickets.status, [...OPEN_TICKET_STATUSES])
      : q.status
        ? eq(serviceTickets.status, q.status)
        : undefined,
    q.priority ? eq(serviceTickets.priority, q.priority) : undefined,
    q.assignedTo === 'me'
      ? eq(serviceTickets.assignedTo, auth.user.id)
      : q.assignedTo
        ? eq(serviceTickets.assignedTo, q.assignedTo)
        : undefined,
    term
      ? (or(
          like(serviceTickets.title, term),
          like(serviceTickets.customerName, term),
          like(installedAssets.serialNumber, term),
          like(tenders.referenceNo, term),
          asNumber !== null ? eq(serviceTickets.number, asNumber) : undefined,
        ) as SQL)
      : undefined,
  )
  const [total] = await db
    .select({ n: count() })
    .from(serviceTickets)
    .leftJoin(tenders, eq(tenders.id, serviceTickets.tenderId))
    .leftJoin(installedAssets, eq(installedAssets.id, serviceTickets.assetId))
    .where(where)
  const rows = await selectTickets(db)
    .where(where)
    .orderBy(desc(serviceTickets.updatedAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
  return { items: rows.map(toSummary), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize }
}

export async function getTicket(conn: DbOrTx, auth: TenantAuth, id: string): Promise<TicketDetail> {
  const [row] = await selectTickets(conn)
    .where(orgWhere(serviceTickets, auth.org.id, eq(serviceTickets.id, id)))
    .limit(1)
  if (!row) throw notFound('TICKET_NOT_FOUND', 'Ticket not found')
  const [creator] = await conn
    .select({ name: creators.name })
    .from(creators)
    .where(eq(creators.id, row.t.createdBy))
  const updates = await conn
    .select({ u: ticketUpdates, name: users.name })
    .from(ticketUpdates)
    .innerJoin(users, eq(users.id, ticketUpdates.userId))
    .where(orgWhere(ticketUpdates, auth.org.id, eq(ticketUpdates.ticketId, id)))
    .orderBy(asc(ticketUpdates.createdAt))
  const t = row.t
  return {
    ...toSummary(row),
    description: t.description,
    contactName: t.contactName,
    contactPhone: t.contactPhone,
    contactEmail: t.contactEmail,
    oemReference: t.oemReference,
    resolutionNotes: t.resolutionNotes,
    resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
    satisfaction: t.satisfaction,
    createdBy: { id: t.createdBy, name: creator?.name ?? '' },
    updates: updates.map(({ u, name }) => ({
      id: u.id,
      status: u.status,
      note: u.note,
      by: { id: u.userId, name },
      at: u.createdAt.toISOString(),
    })),
  }
}

async function assertActiveUser(conn: DbOrTx, orgId: string, userId: string) {
  const [u] = await conn
    .select({ id: users.id })
    .from(users)
    .where(orgWhere(users, orgId, eq(users.id, userId), eq(users.status, 'active')))
  if (!u) throw badRequest('USER_NOT_FOUND', 'That user is not an active member of this workspace')
}

const ticketLink = (id: string) => `/tickets/${id}`

/**
 * Records feedback or a service request. Picking an installed unit fills in
 * the tender and customer automatically.
 */
export async function createTicket(auth: TenantAuth, input: CreateInput): Promise<TicketDetail> {
  const orgId = auth.org.id
  // Two people creating tickets at the same moment can get the same number; try again once.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        let tenderId = input.tenderId ?? null
        let customerName = input.customerName ?? null
        if (input.assetId) {
          const [asset] = await tx
            .select({
              tenderId: installedAssets.tenderId,
              customer: installationReports.customerName,
            })
            .from(installedAssets)
            .innerJoin(
              installationConsignees,
              eq(installationConsignees.id, installedAssets.consigneeId),
            )
            .innerJoin(
              installationReports,
              eq(installationReports.id, installationConsignees.reportId),
            )
            .where(orgWhere(installedAssets, orgId, eq(installedAssets.id, input.assetId)))
          if (!asset)
            throw badRequest(
              'ASSET_NOT_FOUND',
              'That installed unit does not exist in this workspace',
            )
          if (tenderId && tenderId !== asset.tenderId) {
            throw badRequest('ASSET_NOT_FOUND', 'That unit belongs to a different tender')
          }
          tenderId = asset.tenderId
          customerName ??= asset.customer
        } else if (tenderId) {
          const [t] = await tx
            .select({ id: tenders.id })
            .from(tenders)
            .where(orgWhere(tenders, orgId, eq(tenders.id, tenderId)))
          if (!t)
            throw badRequest('TENDER_NOT_FOUND', 'That tender does not exist in this workspace')
        }
        if (input.assignedTo) await assertActiveUser(tx, orgId, input.assignedTo)

        const [last] = await tx
          .select({ n: max(serviceTickets.number) })
          .from(serviceTickets)
          .where(orgWhere(serviceTickets, orgId))
        const id = randomUUID()
        const number = (last?.n ?? 0) + 1
        await tx.insert(serviceTickets).values({
          id,
          organizationId: orgId,
          number,
          title: input.title,
          description: input.description,
          type: input.type,
          priority: input.priority,
          tenderId,
          assetId: input.assetId ?? null,
          customerName,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          contactEmail: input.contactEmail ?? null,
          assignedTo: input.assignedTo ?? null,
          createdBy: auth.user.id,
        })
        await tx.insert(ticketUpdates).values({
          organizationId: orgId,
          ticketId: id,
          status: 'new',
          note: 'Ticket created',
          userId: auth.user.id,
        })
        if (input.assignedTo && input.assignedTo !== auth.user.id) {
          await notify(tx, {
            organizationId: orgId,
            userId: input.assignedTo,
            type: 'ticket.assigned',
            title: `Ticket TKT-${String(number).padStart(4, '0')} assigned to you`,
            body: input.title,
            link: ticketLink(id),
          })
        }
        return getTicket(tx, auth, id)
      })
    } catch (err) {
      if (attempt === 0 && isDuplicateKeyError(err)) continue
      throw err
    }
  }
}

/**
 * Updates a ticket. A closed ticket can only be reopened, and resolving
 * needs resolution notes. Every change is added to the ticket's history.
 */
export async function updateTicket(
  auth: TenantAuth,
  id: string,
  input: UpdateInput,
): Promise<TicketDetail> {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(serviceTickets)
      .where(orgWhere(serviceTickets, orgId, eq(serviceTickets.id, id)))
      .limit(1)
    if (!t) throw notFound('TICKET_NOT_FOUND', 'Ticket not found')

    const statusChanged = input.status !== undefined && input.status !== t.status
    if (t.status === 'closed' && statusChanged && input.status !== 'reopened') {
      throw conflict('TICKET_CLOSED', 'A closed ticket can only be reopened')
    }
    const notes = input.resolutionNotes !== undefined ? input.resolutionNotes : t.resolutionNotes
    if (statusChanged && input.status === 'resolved' && !notes) {
      throw badRequest('VALIDATION_ERROR', 'Add resolution notes to resolve the ticket', [
        { field: 'resolutionNotes', message: 'Describe how it was resolved' },
      ])
    }
    if (input.assignedTo) await assertActiveUser(tx, orgId, input.assignedTo)

    await tx
      .update(serviceTickets)
      .set({
        ...(statusChanged && { status: input.status }),
        ...(statusChanged && input.status === 'resolved' && { resolvedAt: new Date() }),
        ...(statusChanged &&
          input.status === 'reopened' && { resolvedAt: null, satisfaction: null }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.assignedTo !== undefined && { assignedTo: input.assignedTo }),
        ...(input.oemReference !== undefined && { oemReference: input.oemReference }),
        ...(input.resolutionNotes !== undefined && { resolutionNotes: input.resolutionNotes }),
        ...(input.satisfaction !== undefined && { satisfaction: input.satisfaction }),
        // Touch the row even when only a note is added, so it moves to the top of the list.
        updatedAt: new Date(),
      })
      .where(orgWhere(serviceTickets, orgId, eq(serviceTickets.id, id)))

    const note = input.note?.trim() || null
    if (statusChanged || note || input.assignedTo !== undefined) {
      await tx.insert(ticketUpdates).values({
        organizationId: orgId,
        ticketId: id,
        status: statusChanged ? input.status! : null,
        note: note ?? (input.assignedTo !== undefined && !statusChanged ? 'Reassigned' : null),
        userId: auth.user.id,
      })
    }
    if (
      input.assignedTo &&
      input.assignedTo !== t.assignedTo &&
      input.assignedTo !== auth.user.id
    ) {
      await notify(tx, {
        organizationId: orgId,
        userId: input.assignedTo,
        type: 'ticket.assigned',
        title: `Ticket TKT-${String(t.number).padStart(4, '0')} assigned to you`,
        body: t.title,
        link: ticketLink(id),
      })
    }
    return getTicket(tx, auth, id)
  })
}

export async function countOpenTickets(orgId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(serviceTickets)
    .where(
      and(
        orgWhere(serviceTickets, orgId),
        inArray(serviceTickets.status, [...OPEN_TICKET_STATUSES]),
      ),
    )
  return r?.n ?? 0
}
