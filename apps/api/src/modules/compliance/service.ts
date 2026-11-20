import { randomUUID } from 'node:crypto'
import { desc, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import type { CompliancePackSummary } from '@tdm/shared'
import { createCompliancePackSchema } from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  compliancePacks,
  files,
  organizations,
  tenders,
  users,
  type CompliancePack,
  type StoredFile,
} from '../../db/schema'
import { todayIn } from '../../lib/dates'
import { AppError, badRequest } from '../../lib/errors'
import { logger } from '../../lib/logger'
import { storage } from '../../lib/storage'
import type { TenantAuth } from '../../types/express'
import { getCompany } from '../companies/service'
import { snapshotLetters } from '../letters/service'
import { storeFile } from '../files/service'
import { enqueue, registerJob } from '../jobs/queue'
import { notify } from '../notifications/service'
import { getVisibleTender } from '../tenders/service'
import { buildCompliancePdf, type Attachment } from './pdf'

type Input = z.output<typeof createCompliancePackSchema>

const requesters = alias(users, 'requester')

export async function listPacks(
  auth: TenantAuth,
  tenderId: string,
): Promise<CompliancePackSummary[]> {
  const tender = await getVisibleTender(db, auth, tenderId)
  const rows = await db
    .select({
      pack: compliancePacks,
      companyName: biddingCompanies.name,
      requester: requesters.name,
      size: files.sizeBytes,
    })
    .from(compliancePacks)
    .innerJoin(biddingCompanies, eq(biddingCompanies.id, compliancePacks.companyId))
    .innerJoin(requesters, eq(requesters.id, compliancePacks.requestedBy))
    .leftJoin(files, eq(files.id, compliancePacks.fileId))
    .where(orgWhere(compliancePacks, auth.org.id, eq(compliancePacks.tenderId, tender.id)))
    .orderBy(desc(compliancePacks.createdAt))
  return rows.map((r) => toSummary(r.pack, r.companyName, r.requester, r.size))
}

function toSummary(
  p: CompliancePack,
  companyName: string,
  requester: string,
  size: number | null,
): CompliancePackSummary {
  return {
    id: p.id,
    status: p.status,
    company: { id: p.companyId, name: companyName },
    request: p.request,
    file: p.fileId ? { id: p.fileId, sizeBytes: size ?? 0 } : null,
    pageCount: p.pageCount,
    warnings: p.warnings ?? [],
    error: p.error,
    requestedBy: { id: p.requestedBy, name: requester },
    createdAt: p.createdAt.toISOString(),
    finishedAt: p.finishedAt ? p.finishedAt.toISOString() : null,
  }
}

/** Checks that every chosen document exists in this client, with the right kind and tender. */
async function assertFiles(
  conn: DbOrTx,
  orgId: string,
  ids: string[],
  kind: 'library' | 'tender_document',
  tenderId?: string,
) {
  if (!ids.length) return
  const found = await conn
    .select({ id: files.id, tenderId: files.tenderId })
    .from(files)
    .where(
      orgWhere(files, orgId, inArray(files.id, ids), eq(files.kind, kind), isNull(files.deletedAt)),
    )
  const ok = new Set(found.filter((f) => !tenderId || f.tenderId === tenderId).map((f) => f.id))
  if (ids.some((id) => !ok.has(id))) {
    throw badRequest(
      'DOCUMENT_NOT_FOUND',
      'One of the chosen documents no longer exists. Refresh and try again.',
    )
  }
}

/** Saves the request and queues the PDF to be built in the background. */
export async function requestPack(
  auth: TenantAuth,
  tenderId: string,
  input: Input,
): Promise<CompliancePackSummary> {
  const orgId = auth.org.id
  return db.transaction(async (tx) => {
    const tender = await getVisibleTender(tx, auth, tenderId)
    const company = await getCompany(tx, orgId, input.companyId).catch(() => {
      throw badRequest('COMPANY_NOT_FOUND', 'That company does not exist in this workspace')
    })
    if (!company.isActive) throw badRequest('COMPANY_INACTIVE', 'That company is marked inactive')
    await assertFiles(tx, orgId, input.libraryFileIds, 'library')
    await assertFiles(tx, orgId, input.tenderFileIds, 'tender_document', tender.id)

    // The client's own letters are copied now, so later edits never change this PDF.
    const customLetters = await snapshotLetters(tx, orgId, input.templateIds, company.id)

    const id = randomUUID()
    const { companyId: _c, ...request } = input
    await tx.insert(compliancePacks).values({
      id,
      organizationId: orgId,
      tenderId: tender.id,
      companyId: company.id,
      request: { ...request, customLetters },
      requestedBy: auth.user.id,
    })
    await enqueue(
      tx,
      'compliance.generate',
      { packId: id, organizationId: orgId },
      { organizationId: orgId, maxAttempts: 1 },
    )
    const [pack] = await tx.select().from(compliancePacks).where(eq(compliancePacks.id, id))
    return toSummary(pack!, company.name, auth.user.name, null)
  })
}

const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-')

async function readFile(f: StoredFile): Promise<Attachment> {
  return { title: f.title, mime: f.mimeType, bytes: await storage.read(f.storageKey) }
}

/** The background job: builds the PDF, stores it and tells the person who asked. */
export async function generatePack(packId: string, orgId: string): Promise<void> {
  const [pack] = await db
    .select()
    .from(compliancePacks)
    .where(orgWhere(compliancePacks, orgId, eq(compliancePacks.id, packId)))
    .limit(1)
  if (!pack || pack.status !== 'queued') return

  const link = `/tenders/${pack.tenderId}`
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1)
    const [tender] = await db
      .select()
      .from(tenders)
      .where(orgWhere(tenders, orgId, eq(tenders.id, pack.tenderId)))
      .limit(1)
    const company = await getCompany(db, orgId, pack.companyId)
    if (!org || !tender) throw new Error('Tender no longer exists')

    const fileIds = [
      company.logoFileId,
      company.signatureFileId,
      ...pack.request.libraryFileIds,
      ...pack.request.tenderFileIds,
    ].filter((x): x is string => !!x)
    const stored = fileIds.length
      ? await db
          .select()
          .from(files)
          .where(orgWhere(files, orgId, inArray(files.id, fileIds)))
      : []
    const byId = new Map(stored.map((f) => [f.id, f]))
    const image = async (id: string | null) => {
      const f = id ? byId.get(id) : undefined
      return f ? { mime: f.mimeType, bytes: await storage.read(f.storageKey) } : null
    }

    const warnings: string[] = []
    const attachments: Attachment[] = []
    // Library documents first, then the tender's own documents, in the order chosen.
    for (const id of [...pack.request.libraryFileIds, ...pack.request.tenderFileIds]) {
      const f = byId.get(id)
      if (!f || f.deletedAt) {
        warnings.push('A chosen document was deleted before the PDF was built, so it was skipped.')
        continue
      }
      attachments.push(await readFile(f))
    }

    const date = todayIn(org.timezone)
    const result = await buildCompliancePdf({
      letters: pack.request.letters,
      customLetters: pack.request.customLetters ?? [],
      data: {
        companyName: company.name,
        companyAddress: company.address,
        companyGstin: company.gstin ?? '',
        companyPan: company.pan ?? '',
        companyEmail: company.email ?? '',
        companyPhone: company.phone ?? '',
        signatoryName: company.signatoryName,
        designation: company.designation,
        authorizedPerson: company.authorizedPerson ?? '',
        authorizedPosition: company.authorizedPersonPosition ?? '',
        localContentPercent: company.localContentPercent ?? '',
        localValueLocation: company.localValueLocation ?? '',
        buyerOrganization: tender.buyerOrganization ?? '',
        departmentAddress: pack.request.departmentAddress,
        tenderRef: tender.referenceNo,
        tenderBrief: tender.title,
        date: ddmmyyyy(date),
      },
      logo: await image(company.logoFileId),
      signature: await image(company.signatureFileId),
      attachments,
    })
    warnings.push(...result.warnings)

    const safeRef = tender.referenceNo.replace(/[^A-Za-z0-9-]+/g, '_').slice(0, 80)
    await db.transaction(async (tx) => {
      const file = await storeFile(tx, {
        organizationId: orgId,
        kind: 'compliance_pdf',
        bytes: Buffer.from(result.bytes),
        originalName: `Compliance_${safeRef}_${date}.pdf`,
        title: `Compliance documents ${tender.referenceNo}`,
        tenderId: tender.id,
        uploadedBy: pack.requestedBy,
      })
      await tx
        .update(compliancePacks)
        .set({
          status: 'ready',
          fileId: file.id,
          pageCount: result.pageCount,
          warnings,
          finishedAt: new Date(),
        })
        .where(eq(compliancePacks.id, pack.id))
      await notify(tx, {
        organizationId: orgId,
        userId: pack.requestedBy,
        type: 'compliance.ready',
        title: 'Compliance PDF is ready',
        body: `${tender.referenceNo}: ${result.pageCount} pages${warnings.length ? `, ${warnings.length} note(s)` : ''}`,
        link,
      })
    })
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof Error && err.message === 'NOTHING_TO_INCLUDE'
          ? 'None of the chosen documents could be added.'
          : 'The PDF could not be built. Try again, or remove documents that may be damaged.'
    logger.error({ err, packId }, 'Compliance PDF failed')
    await db.transaction(async (tx) => {
      await tx
        .update(compliancePacks)
        .set({ status: 'failed', error: message, finishedAt: new Date() })
        .where(eq(compliancePacks.id, pack.id))
      await notify(tx, {
        organizationId: orgId,
        userId: pack.requestedBy,
        type: 'compliance.failed',
        title: 'Compliance PDF could not be built',
        body: message,
        link,
      })
    })
  }
}

registerJob('compliance.generate', async (payload) => {
  await generatePack(String(payload.packId), String(payload.organizationId))
})
