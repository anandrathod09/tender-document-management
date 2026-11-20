import { asc, count, eq, ne } from 'drizzle-orm'
import type { CompanyLimit, CompanySummary } from '@tdm/shared'
import { companySchema } from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { biddingCompanies, files, organizations, plans, type BiddingCompany } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { storeFile } from '../files/service'

type Input = z.output<typeof companySchema>

export function toCompanySummary(c: BiddingCompany): CompanySummary {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    gstin: c.gstin,
    pan: c.pan,
    email: c.email,
    phone: c.phone,
    signatoryName: c.signatoryName,
    designation: c.designation,
    authorizedPerson: c.authorizedPerson,
    authorizedPersonPosition: c.authorizedPersonPosition,
    localContentPercent: c.localContentPercent,
    localValueLocation: c.localValueLocation,
    logoFileId: c.logoFileId,
    signatureFileId: c.signatureFileId,
    isActive: c.isActive,
  }
}

export async function listCompanies(orgId: string): Promise<CompanySummary[]> {
  const rows = await db
    .select()
    .from(biddingCompanies)
    .where(orgWhere(biddingCompanies, orgId))
    .orderBy(asc(biddingCompanies.name))
  return rows.map(toCompanySummary)
}

export async function getCompany(conn: DbOrTx, orgId: string, id: string): Promise<BiddingCompany> {
  const [c] = await conn
    .select()
    .from(biddingCompanies)
    .where(orgWhere(biddingCompanies, orgId, eq(biddingCompanies.id, id)))
    .limit(1)
  if (!c) throw notFound('COMPANY_NOT_FOUND', 'Company not found')
  return c
}

/** Active companies against the plan's limit. */
export async function companyLimit(
  conn: DbOrTx,
  orgId: string,
  exceptId?: string,
): Promise<CompanyLimit> {
  const [plan] = await conn
    .select({ max: plans.maxCompanies })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(eq(organizations.id, orgId))
    .limit(1)
  const [row] = await conn
    .select({ n: count() })
    .from(biddingCompanies)
    .where(
      orgWhere(
        biddingCompanies,
        orgId,
        eq(biddingCompanies.isActive, true),
        exceptId ? ne(biddingCompanies.id, exceptId) : undefined,
      ),
    )
  return { used: row?.n ?? 0, max: plan?.max ?? 0 }
}

/** Refuses one more active company when the plan's limit is reached. */
async function assertCompanySlot(conn: DbOrTx, orgId: string, exceptId?: string) {
  const { used, max } = await companyLimit(conn, orgId, exceptId)
  if (used >= max) {
    throw conflict(
      'PLAN_COMPANY_LIMIT',
      `Your plan allows ${max} active bidding ${max === 1 ? 'company' : 'companies'}. Mark one inactive or upgrade the plan.`,
    )
  }
}

const nameTaken = () => conflict('COMPANY_NAME_TAKEN', 'A company with this name already exists')

function columns(input: Input) {
  return {
    name: input.name,
    address: input.address,
    gstin: input.gstin ?? null,
    pan: input.pan ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    signatoryName: input.signatoryName,
    designation: input.designation,
    authorizedPerson: input.authorizedPerson ?? null,
    authorizedPersonPosition: input.authorizedPersonPosition ?? null,
    localContentPercent: input.localContentPercent ?? null,
    localValueLocation: input.localValueLocation ?? null,
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  }
}

export async function createCompany(auth: TenantAuth, input: Input): Promise<CompanySummary> {
  return db.transaction(async (tx) => {
    if (input.isActive !== false) await assertCompanySlot(tx, auth.org.id)
    const id = crypto.randomUUID()
    try {
      await tx
        .insert(biddingCompanies)
        .values({ id, organizationId: auth.org.id, ...columns(input) })
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken()
      throw err
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'company.created',
      entity: 'bidding_company',
      entityId: id,
      details: { name: input.name },
    })
    return toCompanySummary(await getCompany(tx, auth.org.id, id))
  })
}

export async function updateCompany(
  auth: TenantAuth,
  id: string,
  input: Input,
): Promise<CompanySummary> {
  return db.transaction(async (tx) => {
    const current = await getCompany(tx, auth.org.id, id)
    // Turning an inactive company back on takes a slot.
    if (input.isActive === true && !current.isActive) await assertCompanySlot(tx, auth.org.id, id)
    try {
      await tx
        .update(biddingCompanies)
        .set(columns(input))
        .where(orgWhere(biddingCompanies, auth.org.id, eq(biddingCompanies.id, id)))
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken()
      throw err
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'company.updated',
      entity: 'bidding_company',
      entityId: id,
      details: { name: input.name },
    })
    return toCompanySummary(await getCompany(tx, auth.org.id, id))
  })
}

/** Replaces the company's logo or signature image. The old image goes to the bin. */
export async function setCompanyImage(
  auth: TenantAuth,
  id: string,
  which: 'logo' | 'signature',
  upload: { buffer: Buffer; originalname: string },
): Promise<CompanySummary> {
  return db.transaction(async (tx) => {
    const company = await getCompany(tx, auth.org.id, id)
    const file = await storeFile(tx, {
      organizationId: auth.org.id,
      kind: which === 'logo' ? 'company_logo' : 'company_signature',
      bytes: upload.buffer,
      originalName: upload.originalname,
      title: `${company.name} ${which}`,
      companyId: company.id,
      uploadedBy: auth.user.id,
    })
    const previous = which === 'logo' ? company.logoFileId : company.signatureFileId
    await tx
      .update(biddingCompanies)
      .set(which === 'logo' ? { logoFileId: file.id } : { signatureFileId: file.id })
      .where(orgWhere(biddingCompanies, auth.org.id, eq(biddingCompanies.id, id)))
    if (previous) {
      await tx
        .update(files)
        .set({ deletedAt: new Date() })
        .where(orgWhere(files, auth.org.id, eq(files.id, previous)))
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: `company.${which}_changed`,
      entity: 'bidding_company',
      entityId: id,
    })
    return toCompanySummary(await getCompany(tx, auth.org.id, id))
  })
}
