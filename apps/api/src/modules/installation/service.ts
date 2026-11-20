import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  installationReportSchema,
  PERMISSIONS,
  type ConsigneeRow,
  type InstallationReport,
} from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  installationConsignees,
  installationReports,
  installedAssets,
  roles,
  users,
  workflowStages,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { notify } from '../notifications/service'
import { getVisibleTender } from '../tenders/service'

type Input = z.output<typeof installationReportSchema>

/** Installation reports exist once the tender is won (or later). */
const AFTER_WIN = ['won', 'execution', 'closed'] as const

export async function getReport(
  conn: DbOrTx,
  auth: TenantAuth,
  tenderId: string,
): Promise<InstallationReport | null> {
  const tender = await getVisibleTender(conn, auth, tenderId)
  const orgId = auth.org.id
  const [report] = await conn
    .select()
    .from(installationReports)
    .where(orgWhere(installationReports, orgId, eq(installationReports.tenderId, tender.id)))
    .limit(1)
  if (!report) return null

  const consignees = await conn
    .select({ c: installationConsignees, engineerName: users.name })
    .from(installationConsignees)
    .leftJoin(users, eq(users.id, installationConsignees.engineerId))
    .where(orgWhere(installationConsignees, orgId, eq(installationConsignees.reportId, report.id)))
    .orderBy(asc(installationConsignees.sortOrder))
  const assets = consignees.length
    ? await conn
        .select()
        .from(installedAssets)
        .where(
          orgWhere(
            installedAssets,
            orgId,
            inArray(
              installedAssets.consigneeId,
              consignees.map((c) => c.c.id),
            ),
          ),
        )
        .orderBy(asc(installedAssets.sortOrder))
    : []

  const rows: ConsigneeRow[] = consignees.map(({ c, engineerName }) => ({
    id: c.id,
    name: c.name,
    designation: c.designation,
    phone: c.phone,
    email: c.email,
    fax: c.fax,
    engineer: c.engineerId ? { id: c.engineerId, name: engineerName ?? '' } : null,
    status: c.status,
    callAlignedDate: c.callAlignedDate,
    assets: assets
      .filter((a) => a.consigneeId === c.id)
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
  }))

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
    updatedAt: report.updatedAt.toISOString(),
  }
}

/** Active users whose role lets them fill in installation reports. */
export async function listEngineers(orgId: string) {
  const rows = await db
    .select({ id: users.id, name: users.name, permissions: roles.permissions })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, orgId, eq(users.status, 'active')))
    .orderBy(asc(users.name))
  return rows
    .filter((r) => r.permissions.includes(PERMISSIONS.INSTALLATION_MANAGE))
    .map((r) => ({ id: r.id, name: r.name }))
}

/**
 * Saves the whole report: header, consignees and their installed units.
 * Units and consignees sent with an id are updated; new ones are added;
 * ones left out are removed. Unit ids stay the same, so service tickets
 * keep pointing at the right unit.
 */
export async function saveReport(
  auth: TenantAuth,
  tenderId: string,
  input: Input,
): Promise<InstallationReport> {
  const orgId = auth.org.id
  const saved = await db.transaction(async (tx) => {
    const tender = await getVisibleTender(tx, auth, tenderId)
    const [stage] = await tx
      .select({ type: workflowStages.type })
      .from(workflowStages)
      .where(eq(workflowStages.id, tender.stageId))
    if (!stage || !(AFTER_WIN as readonly string[]).includes(stage.type)) {
      throw conflict('NOT_WON', 'Installation reports can be added once the tender is won')
    }

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
    const existingAssets = existingConsignees.length
      ? await tx
          .select({ id: installedAssets.id })
          .from(installedAssets)
          .where(
            orgWhere(
              installedAssets,
              orgId,
              inArray(
                installedAssets.consigneeId,
                existingConsignees.map((c) => c.id),
              ),
            ),
          )
      : []
    const assetIds = new Set(existingAssets.map((a) => a.id))

    const keptConsignees = new Set<string>()
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

      for (const [ai, a] of c.assets.entries()) {
        if (a.id && !assetIds.has(a.id)) {
          throw badRequest(
            'ASSET_NOT_FOUND',
            'An installed unit in the request does not belong to this report',
          )
        }
        const assetValues = {
          consigneeId,
          tenderId: tender.id,
          itemName: a.itemName,
          makeModel: a.makeModel ?? null,
          serialNumber: a.serialNumber ?? null,
          monitorSerial: a.monitorSerial ?? null,
          cpuSerial: a.cpuSerial ?? null,
          installStatus: a.installStatus,
          installedOn: a.installedOn ?? null,
          warrantyMonths: a.warrantyMonths,
          remarks: a.remarks ?? null,
          sortOrder: ai,
        }
        if (a.id) {
          await tx
            .update(installedAssets)
            .set(assetValues)
            .where(orgWhere(installedAssets, orgId, eq(installedAssets.id, a.id)))
          keptAssets.add(a.id)
        } else {
          await tx
            .insert(installedAssets)
            .values({ id: randomUUID(), organizationId: orgId, ...assetValues })
        }
      }
    }

    // Remove units and consignees that were left out (tickets keep their history; the link is cleared).
    const goneAssets = [...assetIds].filter((id) => !keptAssets.has(id))
    if (goneAssets.length) {
      await tx
        .delete(installedAssets)
        .where(orgWhere(installedAssets, orgId, inArray(installedAssets.id, goneAssets)))
    }
    const goneConsignees = existingConsignees
      .map((c) => c.id)
      .filter((id) => !keptConsignees.has(id))
    if (goneConsignees.length) {
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
        units: input.consignees.reduce((n, c) => n + c.assets.length, 0),
      },
    })
    return tender.id
  })
  return (await getReport(db, auth, saved))!
}
