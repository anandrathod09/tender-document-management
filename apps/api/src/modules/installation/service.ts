import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  consigneeWorkSchema,
  installationReportSchema,
  isBlankUnit,
  PERMISSIONS,
  type ConsigneeDocument,
  type ConsigneeRow,
  type InstallationReport,
  type InstallationSite,
  type UnitInput,
} from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  files,
  installationConsignees,
  installationItems,
  installationReports,
  installedAssets,
  roles,
  tenders,
  users,
  workflowStages,
  type Tender,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { notify } from '../notifications/service'
import { getVisibleTender, visibilityScope } from '../tenders/service'

type Input = z.output<typeof installationReportSchema>
type WorkInput = z.output<typeof consigneeWorkSchema>

/** Installation reports exist once the tender is won (or later). */
const AFTER_WIN = ['won', 'execution', 'closed'] as const

/**
 * Engineers (no full installation permission) see and change only the
 * consignees they are the engineer of.
 */
export function ownConsigneesOnly(auth: TenantAuth): boolean {
  return (
    !auth.permissions.has(PERMISSIONS.INSTALLATION_MANAGE) &&
    auth.permissions.has(PERMISSIONS.INSTALLATION_OWN)
  )
}

export async function getReport(
  conn: DbOrTx,
  auth: TenantAuth,
  tenderId: string,
): Promise<InstallationReport | null> {
  const tender = await getVisibleTender(conn, auth, tenderId)
  const orgId = auth.org.id
  const ownOnly = ownConsigneesOnly(auth)
  const [report] = await conn
    .select()
    .from(installationReports)
    .where(orgWhere(installationReports, orgId, eq(installationReports.tenderId, tender.id)))
    .limit(1)
  if (!report) return null

  const consignees = await conn
    .select({
      c: installationConsignees,
      engineerName: users.name,
      engineerEmail: users.email,
      engineerPhone: users.phone,
    })
    .from(installationConsignees)
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
    .where(
      orgWhere(
        installationConsignees,
        orgId,
        eq(installationConsignees.reportId, report.id),
        ownOnly ? eq(installationConsignees.engineerId, auth.user.id) : undefined,
      ),
    )
    .orderBy(asc(installationConsignees.sortOrder))
  const ids = consignees.map((c) => c.c.id)
  const [items, units, docs] = ids.length
    ? await Promise.all([
        conn
          .select()
          .from(installationItems)
          .where(orgWhere(installationItems, orgId, inArray(installationItems.consigneeId, ids)))
          .orderBy(asc(installationItems.sortOrder)),
        conn
          .select()
          .from(installedAssets)
          .where(orgWhere(installedAssets, orgId, inArray(installedAssets.consigneeId, ids)))
          .orderBy(asc(installedAssets.sortOrder)),
        conn
          .select({ f: files, uploaderName: users.name })
          .from(files)
          .leftJoin(users, eq(users.id, files.uploadedBy))
          .where(
            orgWhere(
              files,
              orgId,
              eq(files.kind, 'consignee_document'),
              inArray(files.consigneeId, ids),
              isNull(files.deletedAt),
            ),
          )
          .orderBy(desc(files.createdAt)),
      ])
    : [[], [], []]

  const rows: ConsigneeRow[] = consignees.map(
    ({ c, engineerName, engineerEmail, engineerPhone }) => ({
      id: c.id,
      name: c.name,
      designation: c.designation,
      phone: c.phone,
      email: c.email,
      fax: c.fax,
      engineer: c.engineerId
        ? {
            id: c.engineerId,
            name: engineerName ?? '',
            email: engineerEmail ?? '',
            phone: engineerPhone ?? null,
          }
        : null,
      status: c.status,
      callAlignedDate: c.callAlignedDate,
      items: items
        .filter((i) => i.consigneeId === c.id)
        .map((i) => ({
          id: i.id,
          itemName: i.itemName,
          serialType: i.serialType,
          warrantyMonths: i.warrantyMonths,
          quantity: i.quantity,
          units: units
            .filter((a) => a.itemId === i.id)
            .map((a) => ({
              id: a.id,
              itemName: a.itemName,
              makeModel: a.makeModel,
              serialNumber: a.serialNumber,
              monitorSerial: a.monitorSerial,
              cpuSerial: a.cpuSerial,
              installStatus: a.installStatus,
              installedOn: a.installedOn,
              warrantyMonths: a.warrantyMonths,
              remarks: a.remarks,
            })),
        })),
      documents: docs
        .filter((d) => d.f.consigneeId === c.id)
        .map((d): ConsigneeDocument => ({
          id: d.f.id,
          originalName: d.f.originalName,
          mimeType: d.f.mimeType,
          sizeBytes: d.f.sizeBytes,
          uploadedBy: d.f.uploadedBy ? { id: d.f.uploadedBy, name: d.uploaderName ?? '' } : null,
          createdAt: d.f.createdAt.toISOString(),
        })),
    }),
  )

  return {
    id: report.id,
    tenderId: report.tenderId,
    biddingCompanyId: report.biddingCompanyId,
    poNumber: report.poNumber,
    poDate: report.poDate,
    reportDate: report.reportDate,
    customerName: report.customerName,
    customerAddress: report.customerAddress,
    stateOffice: report.stateOffice,
    contactPersonName: report.contactPersonName,
    contactPersonDesignation: report.contactPersonDesignation,
    contactPersonPhone: report.contactPersonPhone,
    department: report.department,
    consignees: rows,
    ownOnly,
    updatedAt: report.updatedAt.toISOString(),
  }
}

/**
 * Consignees with their tender and installation progress: an engineer's own
 * ones, or every visible one for admins.
 */
export async function listSites(auth: TenantAuth): Promise<InstallationSite[]> {
  const orgId = auth.org.id
  const rows = await db
    .select({
      c: installationConsignees,
      engineerName: users.name,
      tenderId: tenders.id,
      referenceNo: tenders.referenceNo,
      title: tenders.title,
      buyerOrganization: tenders.buyerOrganization,
      location: tenders.location,
      awardAmount: tenders.awardAmount,
      estimatedCost: tenders.estimatedCost,
      stageLabel: workflowStages.label,
    })
    .from(installationConsignees)
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .innerJoin(tenders, eq(tenders.id, installationReports.tenderId))
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
    .where(
      and(
        orgWhere(installationConsignees, orgId),
        visibilityScope(auth),
        ownConsigneesOnly(auth) ? eq(installationConsignees.engineerId, auth.user.id) : undefined,
      ),
    )
    .orderBy(desc(installationReports.updatedAt), asc(installationConsignees.sortOrder))
    .limit(1000)
  const ids = rows.map((r) => r.c.id)
  const [items, units] = ids.length
    ? await Promise.all([
        db
          .select({
            id: installationItems.id,
            consigneeId: installationItems.consigneeId,
            quantity: installationItems.quantity,
          })
          .from(installationItems)
          .where(orgWhere(installationItems, orgId, inArray(installationItems.consigneeId, ids))),
        db
          .select({
            itemId: installedAssets.itemId,
            consigneeId: installedAssets.consigneeId,
            installStatus: installedAssets.installStatus,
          })
          .from(installedAssets)
          .where(orgWhere(installedAssets, orgId, inArray(installedAssets.consigneeId, ids))),
      ])
    : [[], []]
  return rows.map((r) => {
    const mine = units.filter((u) => u.consigneeId === r.c.id)
    const totalItems = items
      .filter((i) => i.consigneeId === r.c.id)
      .reduce((n, i) => n + Math.max(i.quantity, mine.filter((u) => u.itemId === i.id).length), 0)
    return {
      id: r.c.id,
      name: r.c.name,
      designation: r.c.designation,
      phone: r.c.phone,
      email: r.c.email,
      callAlignedDate: r.c.callAlignedDate,
      status: r.c.status,
      engineer: r.c.engineerId ? { id: r.c.engineerId, name: r.engineerName ?? '' } : null,
      tender: {
        id: r.tenderId,
        referenceNo: r.referenceNo,
        title: r.title,
        buyerOrganization: r.buyerOrganization,
        location: r.location,
        value: Number(r.awardAmount ?? r.estimatedCost ?? 0),
        stageLabel: r.stageLabel,
      },
      totalItems,
      installedItems: mine.filter((u) => u.installStatus === 'installed').length,
    }
  })
}

/** Active users who can be named as a consignee's engineer. */
export async function listEngineers(orgId: string) {
  const rows = await db
    .select({ id: users.id, name: users.name, permissions: roles.permissions })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId, eq(users.status, 'active')))
    .orderBy(asc(users.name))
  return rows
    .filter((r) => r.permissions.includes(PERMISSIONS.INSTALLATION_OWN))
    .map((r) => ({ id: r.id, name: r.name }))
}

async function wonTender(tx: DbOrTx, auth: TenantAuth, tenderId: string): Promise<Tender> {
  const tender = await getVisibleTender(tx, auth, tenderId)
  const [stage] = await tx
    .select({ type: workflowStages.type })
    .from(workflowStages)
    .where(eq(workflowStages.id, tender.stageId))
  if (!stage || !(AFTER_WIN as readonly string[]).includes(stage.type)) {
    throw conflict('NOT_WON', 'Installation reports can be added once the tender is won')
  }
  return tender
}

/**
 * Writes the rows of one report template. Rows with nothing filled in are
 * placeholders and are not stored (a saved row that is cleared is removed).
 * Unit ids stay the same, so service tickets keep pointing at the right unit.
 */
async function writeUnits(
  tx: DbOrTx,
  orgId: string,
  target: {
    tenderId: string
    consigneeId: string
    itemId: string
    itemName: string
    warrantyMonths: number
  },
  units: UnitInput[],
  allowedIds: Set<string>,
  kept: Set<string>,
) {
  let order = 0
  for (const u of units) {
    if (u.id && !allowedIds.has(u.id)) {
      throw badRequest(
        'ASSET_NOT_FOUND',
        'An installed unit in the request does not belong to this report',
      )
    }
    if (isBlankUnit(u)) continue
    const values = {
      consigneeId: target.consigneeId,
      itemId: target.itemId,
      tenderId: target.tenderId,
      itemName: target.itemName,
      warrantyMonths: target.warrantyMonths,
      serialNumber: u.serialNumber ?? null,
      monitorSerial: u.monitorSerial ?? null,
      cpuSerial: u.cpuSerial ?? null,
      installStatus: u.installStatus,
      installedOn: u.installedOn ?? null,
      remarks: u.remarks ?? null,
      sortOrder: order++,
    }
    if (u.id) {
      await tx
        .update(installedAssets)
        .set(values)
        .where(orgWhere(installedAssets, orgId, eq(installedAssets.id, u.id)))
      kept.add(u.id)
    } else {
      await tx
        .insert(installedAssets)
        .values({ id: randomUUID(), organizationId: orgId, ...values })
    }
  }
}

/**
 * Saves the whole report: header, consignees, their report templates and rows.
 * Anything sent with an id is updated; new ones are added; ones left out are removed.
 */
export async function saveReport(
  auth: TenantAuth,
  tenderId: string,
  input: Input,
): Promise<InstallationReport> {
  const orgId = auth.org.id
  const saved = await db.transaction(async (tx) => {
    const tender = await wonTender(tx, auth, tenderId)

    if (input.biddingCompanyId) {
      const [c] = await tx
        .select({ id: biddingCompanies.id })
        .from(biddingCompanies)
        .where(orgWhere(biddingCompanies, orgId, eq(biddingCompanies.id, input.biddingCompanyId)))
      if (!c) throw badRequest('COMPANY_NOT_FOUND', 'That company does not exist in this workspace')
    }
    const engineerIds = [
      ...new Set(input.consignees.map((c) => c.engineerId).filter((x): x is string => !!x)),
    ]
    if (engineerIds.length) {
      const allowed = new Set((await listEngineers(orgId)).map((e) => e.id))
      if (engineerIds.some((id) => !allowed.has(id))) {
        throw badRequest(
          'ENGINEER_NOT_FOUND',
          'One of the chosen engineers is not an active engineer here',
        )
      }
    }

    const header = {
      biddingCompanyId: input.biddingCompanyId ?? null,
      poNumber: input.poNumber ?? null,
      poDate: input.poDate ?? null,
      reportDate: input.reportDate ?? null,
      customerName: input.customerName ?? null,
      customerAddress: input.customerAddress ?? null,
      stateOffice: input.stateOffice ?? null,
      contactPersonName: input.contactPersonName ?? null,
      contactPersonDesignation: input.contactPersonDesignation ?? null,
      contactPersonPhone: input.contactPersonPhone ?? null,
      department: input.department ?? null,
      updatedBy: auth.user.id,
    }
    let [report] = await tx
      .select()
      .from(installationReports)
      .where(orgWhere(installationReports, orgId, eq(installationReports.tenderId, tender.id)))
      .limit(1)
    if (report) {
      await tx
        .update(installationReports)
        .set(header)
        .where(orgWhere(installationReports, orgId, eq(installationReports.id, report.id)))
    } else {
      const id = randomUUID()
      await tx
        .insert(installationReports)
        .values({ id, organizationId: orgId, tenderId: tender.id, ...header })
      ;[report] = await tx.select().from(installationReports).where(eq(installationReports.id, id))
    }
    const reportId = report!.id

    const existingConsignees = await tx
      .select()
      .from(installationConsignees)
      .where(orgWhere(installationConsignees, orgId, eq(installationConsignees.reportId, reportId)))
    const consigneeById = new Map(existingConsignees.map((c) => [c.id, c]))
    const existingIds = existingConsignees.map((c) => c.id)
    const [existingItems, existingAssets] = existingIds.length
      ? await Promise.all([
          tx
            .select({ id: installationItems.id })
            .from(installationItems)
            .where(
              orgWhere(
                installationItems,
                orgId,
                inArray(installationItems.consigneeId, existingIds),
              ),
            ),
          tx
            .select({ id: installedAssets.id })
            .from(installedAssets)
            .where(
              orgWhere(installedAssets, orgId, inArray(installedAssets.consigneeId, existingIds)),
            ),
        ])
      : [[], []]
    const itemIds = new Set(existingItems.map((i) => i.id))
    const assetIds = new Set(existingAssets.map((a) => a.id))

    const keptConsignees = new Set<string>()
    const keptItems = new Set<string>()
    const keptAssets = new Set<string>()
    const newlyAssigned: { engineerId: string; consignee: string }[] = []

    for (const [ci, c] of input.consignees.entries()) {
      if (c.id && !consigneeById.has(c.id)) {
        throw badRequest(
          'CONSIGNEE_NOT_FOUND',
          'A consignee in the request does not belong to this report',
        )
      }
      const consigneeId = c.id ?? randomUUID()
      const values = {
        name: c.name,
        designation: c.designation ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        fax: c.fax ?? null,
        engineerId: c.engineerId ?? null,
        status: c.status,
        callAlignedDate: c.callAlignedDate ?? null,
        sortOrder: ci,
      }
      const previous = c.id ? consigneeById.get(c.id) : undefined
      if (previous) {
        await tx
          .update(installationConsignees)
          .set(values)
          .where(
            orgWhere(installationConsignees, orgId, eq(installationConsignees.id, consigneeId)),
          )
      } else {
        await tx
          .insert(installationConsignees)
          .values({ id: consigneeId, organizationId: orgId, reportId, ...values })
      }
      keptConsignees.add(consigneeId)
      if (c.engineerId && c.engineerId !== previous?.engineerId && c.engineerId !== auth.user.id) {
        newlyAssigned.push({ engineerId: c.engineerId, consignee: c.name })
      }

      for (const [ii, item] of c.items.entries()) {
        if (item.id && !itemIds.has(item.id)) {
          throw badRequest(
            'ITEM_NOT_FOUND',
            'A report template in the request does not belong to this report',
          )
        }
        const itemId = item.id ?? randomUUID()
        const filled = item.units.filter((u) => !isBlankUnit(u)).length
        const itemValues = {
          consigneeId,
          itemName: item.itemName,
          serialType: item.serialType,
          warrantyMonths: item.warrantyMonths,
          quantity: Math.max(item.quantity, filled, 1),
          sortOrder: ii,
        }
        if (item.id) {
          await tx
            .update(installationItems)
            .set(itemValues)
            .where(orgWhere(installationItems, orgId, eq(installationItems.id, itemId)))
        } else {
          await tx
            .insert(installationItems)
            .values({ id: itemId, organizationId: orgId, ...itemValues })
        }
        keptItems.add(itemId)
        await writeUnits(
          tx,
          orgId,
          {
            tenderId: tender.id,
            consigneeId,
            itemId,
            itemName: item.itemName,
            warrantyMonths: item.warrantyMonths,
          },
          item.units,
          assetIds,
          keptAssets,
        )
      }
    }

    // Remove what was left out (tickets keep their history; their unit link is cleared).
    const goneAssets = [...assetIds].filter((id) => !keptAssets.has(id))
    if (goneAssets.length) {
      await tx
        .delete(installedAssets)
        .where(orgWhere(installedAssets, orgId, inArray(installedAssets.id, goneAssets)))
    }
    const goneItems = [...itemIds].filter((id) => !keptItems.has(id))
    if (goneItems.length) {
      await tx
        .delete(installationItems)
        .where(orgWhere(installationItems, orgId, inArray(installationItems.id, goneItems)))
    }
    const goneConsignees = existingIds.filter((id) => !keptConsignees.has(id))
    if (goneConsignees.length) {
      // Their documents go to the 30-day bin with the consignee.
      await tx
        .update(files)
        .set({ deletedAt: new Date() })
        .where(
          orgWhere(
            files,
            orgId,
            eq(files.kind, 'consignee_document'),
            inArray(files.consigneeId, goneConsignees),
            isNull(files.deletedAt),
          ),
        )
      await tx
        .delete(installationConsignees)
        .where(
          orgWhere(
            installationConsignees,
            orgId,
            inArray(installationConsignees.id, goneConsignees),
          ),
        )
    }

    for (const n of newlyAssigned) {
      await notify(tx, {
        organizationId: orgId,
        userId: n.engineerId,
        type: 'installation.assigned',
        title: 'Installation assigned to you',
        body: `${tender.referenceNo} · ${n.consignee}`,
        link: `/tenders/${tender.id}`,
      })
    }
    await writeAudit(tx, {
      organizationId: orgId,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'installation.saved',
      entity: 'installation_report',
      entityId: reportId,
      details: {
        consignees: input.consignees.length,
        units: input.consignees.reduce(
          (n, c) =>
            n + c.items.reduce((m, i) => m + i.units.filter((u) => !isBlankUnit(u)).length, 0),
          0,
        ),
      },
    })
    return tender.id
  })
  return (await getReport(db, auth, saved))!
}

/** The consignee, checked to be on this tender's report and (for engineers) their own. */
export async function getWorkableConsignee(
  conn: DbOrTx,
  auth: TenantAuth,
  tender: Tender,
  consigneeId: string,
) {
  const [row] = await conn
    .select({ c: installationConsignees })
    .from(installationConsignees)
    .innerJoin(installationReports, eq(installationReports.id, installationConsignees.reportId))
    .where(
      and(
        orgWhere(installationConsignees, auth.org.id, eq(installationConsignees.id, consigneeId)),
        eq(installationReports.tenderId, tender.id),
      ),
    )
    .limit(1)
  if (!row) throw notFound('CONSIGNEE_NOT_FOUND', 'Consignee not found')
  if (!auth.permissions.has(PERMISSIONS.INSTALLATION_MANAGE)) {
    if (!auth.permissions.has(PERMISSIONS.INSTALLATION_OWN)) throw forbidden()
    if (row.c.engineerId !== auth.user.id)
      throw notFound('CONSIGNEE_NOT_FOUND', 'Consignee not found')
  }
  return row.c
}

/**
 * The engineer's update on site: the consignee's status and the rows of its
 * report templates (serial numbers, installed, date, remarks). Templates,
 * contact details and the engineer stay as the admin set them; each template
 * keeps at most as many rows as the admin asked for.
 */
export async function saveConsigneeWork(
  auth: TenantAuth,
  tenderId: string,
  consigneeId: string,
  input: WorkInput,
): Promise<InstallationReport> {
  const orgId = auth.org.id
  const saved = await db.transaction(async (tx) => {
    const tender = await wonTender(tx, auth, tenderId)
    const consignee = await getWorkableConsignee(tx, auth, tender, consigneeId)

    const items = await tx
      .select()
      .from(installationItems)
      .where(orgWhere(installationItems, orgId, eq(installationItems.consigneeId, consignee.id)))
    const itemById = new Map(items.map((i) => [i.id, i]))
    const units = await tx
      .select({ id: installedAssets.id, itemId: installedAssets.itemId })
      .from(installedAssets)
      .where(orgWhere(installedAssets, orgId, eq(installedAssets.consigneeId, consignee.id)))

    await tx
      .update(installationConsignees)
      .set({ status: input.status })
      .where(orgWhere(installationConsignees, orgId, eq(installationConsignees.id, consignee.id)))

    let rowCount = 0
    for (const sent of input.items) {
      const item = itemById.get(sent.id)
      if (!item) {
        throw badRequest(
          'ITEM_NOT_FOUND',
          'A report template in the request does not belong to this consignee',
        )
      }
      const own = units.filter((u) => u.itemId === item.id)
      const filled = sent.units.filter((u) => !isBlankUnit(u)).length
      if (filled > Math.max(item.quantity, own.length)) {
        throw badRequest(
          'TOO_MANY_ROWS',
          `${item.itemName.split('\n')[0]} has ${item.quantity} row(s). Ask an admin to add more.`,
        )
      }
      const ownIds = new Set(own.map((u) => u.id))
      const kept = new Set<string>()
      await writeUnits(
        tx,
        orgId,
        {
          tenderId: tender.id,
          consigneeId: consignee.id,
          itemId: item.id,
          itemName: item.itemName,
          warrantyMonths: item.warrantyMonths,
        },
        sent.units,
        ownIds,
        kept,
      )
      const gone = [...ownIds].filter((id) => !kept.has(id))
      if (gone.length) {
        await tx
          .delete(installedAssets)
          .where(orgWhere(installedAssets, orgId, inArray(installedAssets.id, gone)))
      }
      rowCount += filled
    }

    await tx
      .update(installationReports)
      .set({ updatedBy: auth.user.id })
      .where(orgWhere(installationReports, orgId, eq(installationReports.id, consignee.reportId)))
    await writeAudit(tx, {
      organizationId: orgId,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'installation.consignee_updated',
      entity: 'installation_consignee',
      entityId: consignee.id,
      details: { consignee: consignee.name, status: input.status, units: rowCount },
    })
    return tender.id
  })
  return (await getReport(db, auth, saved))!
}
