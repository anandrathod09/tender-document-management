import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  COMPLIANCE_LETTERS,
  LETTER_FIELDS,
  letterTemplateSchema,
  type ComplianceLetterKey,
  type LetterContent,
  type LetterLibrary,
  type LetterTemplateInput,
  type LetterTemplateSummary,
} from '@tdm/shared'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  biddingCompanies,
  files,
  letterTemplates,
  organizations,
  type BiddingCompany,
  type LetterTemplate,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, notFound } from '../../lib/errors'
import { storage } from '../../lib/storage'
import type { TenantAuth } from '../../types/express'
import { invalidateOrganization } from '../workspace/service'
import { builtinLetterContent } from '../compliance/letters'
import { buildCompliancePdf } from '../compliance/pdf'

/**
 * Declaration letters of the client's own (letter templates), next to the
 * built-in ones from the original TMS. Shared by all bidding companies, or
 * limited to one.
 */

const BUILTIN_KEYS = new Set<string>(COMPLIANCE_LETTERS.map((l) => l.key))

function toSummary(t: LetterTemplate, companyName: string | null): LetterTemplateSummary {
  return {
    id: t.id,
    title: t.title,
    subtitle: t.subtitle,
    addressed: t.addressed,
    dateAtTop: t.dateAtTop,
    body: t.body,
    company: t.companyId && companyName ? { id: t.companyId, name: companyName } : null,
    isActive: t.isActive,
    basedOn: t.basedOn,
    updatedAt: t.updatedAt.toISOString(),
  }
}

export async function listLetterLibrary(orgId: string): Promise<LetterLibrary> {
  const [org] = await db
    .select({ hidden: organizations.hiddenLetters })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  const hidden = new Set(org?.hidden ?? [])
  const rows = await db
    .select({ t: letterTemplates, companyName: biddingCompanies.name })
    .from(letterTemplates)
    .leftJoin(biddingCompanies, eq(biddingCompanies.id, letterTemplates.companyId))
    .where(orgWhere(letterTemplates, orgId))
    .orderBy(asc(letterTemplates.title))
  return {
    builtins: COMPLIANCE_LETTERS.map((l) => ({
      key: l.key,
      title: l.title,
      hidden: hidden.has(l.key),
    })),
    templates: rows.map((r) => toSummary(r.t, r.companyName)),
  }
}

async function getTemplate(conn: DbOrTx, orgId: string, id: string): Promise<LetterTemplate> {
  const [t] = await conn
    .select()
    .from(letterTemplates)
    .where(orgWhere(letterTemplates, orgId, eq(letterTemplates.id, id)))
    .limit(1)
  if (!t) throw notFound('LETTER_NOT_FOUND', 'Letter not found')
  return t
}

async function companyOf(conn: DbOrTx, orgId: string, id: string): Promise<BiddingCompany> {
  const [c] = await conn
    .select()
    .from(biddingCompanies)
    .where(orgWhere(biddingCompanies, orgId, eq(biddingCompanies.id, id)))
    .limit(1)
  if (!c) throw badRequest('COMPANY_NOT_FOUND', 'That company does not exist in this workspace')
  return c
}

const columns = (input: ReturnType<typeof letterTemplateSchema.parse>) => ({
  title: input.title,
  subtitle: input.subtitle ?? null,
  addressed: input.addressed,
  dateAtTop: input.dateAtTop,
  body: input.body,
  companyId: input.companyId,
  isActive: input.isActive,
  basedOn: input.basedOn && BUILTIN_KEYS.has(input.basedOn) ? input.basedOn : null,
})

async function summaryOf(conn: DbOrTx, orgId: string, id: string) {
  const t = await getTemplate(conn, orgId, id)
  const company = t.companyId ? await companyOf(conn, orgId, t.companyId).catch(() => null) : null
  return toSummary(t, company?.name ?? null)
}

export async function createLetter(
  auth: TenantAuth,
  raw: LetterTemplateInput,
): Promise<LetterTemplateSummary> {
  const input = letterTemplateSchema.parse(raw)
  return db.transaction(async (tx) => {
    if (input.companyId) await companyOf(tx, auth.org.id, input.companyId)
    const id = randomUUID()
    await tx
      .insert(letterTemplates)
      .values({ id, organizationId: auth.org.id, createdBy: auth.user.id, ...columns(input) })
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'letter.created',
      entity: 'letter_template',
      entityId: id,
      details: { title: input.title },
    })
    return summaryOf(tx, auth.org.id, id)
  })
}

export async function updateLetter(
  auth: TenantAuth,
  id: string,
  raw: LetterTemplateInput,
): Promise<LetterTemplateSummary> {
  const input = letterTemplateSchema.parse(raw)
  return db.transaction(async (tx) => {
    await getTemplate(tx, auth.org.id, id)
    if (input.companyId) await companyOf(tx, auth.org.id, input.companyId)
    await tx
      .update(letterTemplates)
      .set(columns(input))
      .where(orgWhere(letterTemplates, auth.org.id, eq(letterTemplates.id, id)))
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'letter.updated',
      entity: 'letter_template',
      entityId: id,
      details: { title: input.title },
    })
    return summaryOf(tx, auth.org.id, id)
  })
}

/** PDFs already made keep their copy of the letter, so deleting is always safe. */
export async function deleteLetter(auth: TenantAuth, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await getTemplate(tx, auth.org.id, id)
    await tx
      .delete(letterTemplates)
      .where(orgWhere(letterTemplates, auth.org.id, eq(letterTemplates.id, id)))
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'letter.deleted',
      entity: 'letter_template',
      entityId: id,
      details: { title: t.title },
    })
  })
}

/** Hides built-in letters the client does not use from the compliance list. */
export async function setHiddenLetters(auth: TenantAuth, keys: string[]): Promise<LetterLibrary> {
  const unknown = keys.filter((k) => !BUILTIN_KEYS.has(k))
  if (unknown.length) throw badRequest('VALIDATION_ERROR', `Unknown letter: ${unknown.join(', ')}`)
  await db
    .update(organizations)
    .set({ hiddenLetters: [...new Set(keys)] })
    .where(eq(organizations.id, auth.org.id))
  invalidateOrganization(auth.org.slug)
  return listLetterLibrary(auth.org.id)
}

/** A built-in letter as editable text with {{fields}}, for "copy and edit". */
export function builtinContent(key: string): LetterContent {
  if (!BUILTIN_KEYS.has(key)) throw notFound('LETTER_NOT_FOUND', 'Letter not found')
  return builtinLetterContent(key as ComplianceLetterKey)
}

/**
 * The client's chosen letters, copied into a compliance request. Each must
 * exist, be switched on and belong to all companies or to the chosen one.
 */
export async function snapshotLetters(
  conn: DbOrTx,
  orgId: string,
  ids: string[],
  companyId: string,
): Promise<LetterContent[]> {
  if (!ids.length) return []
  const rows = await conn
    .select()
    .from(letterTemplates)
    .where(orgWhere(letterTemplates, orgId, inArray(letterTemplates.id, ids)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => {
    const t = byId.get(id)
    if (!t || !t.isActive) {
      throw badRequest(
        'LETTER_NOT_FOUND',
        'One of the chosen letters no longer exists. Refresh and try again.',
      )
    }
    if (t.companyId && t.companyId !== companyId) {
      throw badRequest('LETTER_NOT_FOR_COMPANY', `“${t.title}” is only for another bidding company`)
    }
    return {
      title: t.title,
      subtitle: t.subtitle,
      addressed: t.addressed,
      dateAtTop: t.dateAtTop,
      body: t.body,
    }
  })
}

/** A one-letter PDF on the company letterhead, filled with sample tender details. */
export async function previewLetter(
  auth: TenantAuth,
  raw: LetterTemplateInput,
  companyId: string | null | undefined,
): Promise<Uint8Array> {
  const letter = letterTemplateSchema.parse(raw)
  const orgId = auth.org.id
  let company: BiddingCompany | undefined
  if (companyId) company = await companyOf(db, orgId, companyId)
  else {
    ;[company] = await db
      .select()
      .from(biddingCompanies)
      .where(and(orgWhere(biddingCompanies, orgId), eq(biddingCompanies.isActive, true)))
      .orderBy(asc(biddingCompanies.name))
      .limit(1)
  }
  const sample = Object.fromEntries(LETTER_FIELDS.map((f) => [f.key, f.sample])) as Record<
    (typeof LETTER_FIELDS)[number]['key'],
    string
  >
  const image = async (id: string | null | undefined) => {
    if (!id) return null
    const [f] = await db
      .select()
      .from(files)
      .where(orgWhere(files, orgId, eq(files.id, id)))
      .limit(1)
    return f ? { mime: f.mimeType, bytes: await storage.read(f.storageKey) } : null
  }
  const result = await buildCompliancePdf({
    letters: [],
    customLetters: [
      {
        title: letter.title,
        subtitle: letter.subtitle ?? null,
        addressed: letter.addressed,
        dateAtTop: letter.dateAtTop,
        body: letter.body,
      },
    ],
    data: {
      companyName: company?.name ?? sample.company_name,
      companyAddress: company?.address ?? sample.company_address,
      companyGstin: company ? (company.gstin ?? '') : sample.company_gstin,
      companyPan: company ? (company.pan ?? '') : sample.company_pan,
      companyEmail: company ? (company.email ?? '') : sample.company_email,
      companyPhone: company ? (company.phone ?? '') : sample.company_phone,
      signatoryName: company?.signatoryName ?? sample.signatory_name,
      designation: company?.designation ?? sample.designation,
      authorizedPerson: company ? (company.authorizedPerson ?? '') : sample.authorized_person,
      authorizedPosition: company
        ? (company.authorizedPersonPosition ?? '')
        : sample.authorized_position,
      localContentPercent: company
        ? (company.localContentPercent ?? '')
        : sample.local_content_percent,
      localValueLocation: company
        ? (company.localValueLocation ?? '')
        : sample.local_value_location,
      buyerOrganization: sample.buyer_organization,
      departmentAddress: sample.department_address,
      tenderRef: sample.tender_ref,
      tenderBrief: sample.tender_brief,
      date: sample.date,
    },
    logo: await image(company?.logoFileId),
    signature: await image(company?.signatureFileId),
    attachments: [],
  })
  return result.bytes
}
