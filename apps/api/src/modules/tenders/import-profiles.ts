import { asc, count, eq } from 'drizzle-orm'
import type { ImportProfileInput, ImportProfileSummary } from '@tdm/shared'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { importProfiles, type ImportProfile } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'

/** Plenty for real use; stops a runaway script filling the table. */
export const MAX_IMPORT_PROFILES = 30

const toSummary = (p: ImportProfile): ImportProfileSummary => ({
  id: p.id,
  name: p.name,
  columns: p.columns,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

const nameTaken = () => conflict('PROFILE_NAME_TAKEN', 'A layout with this name already exists')

export async function listImportProfiles(orgId: string): Promise<ImportProfileSummary[]> {
  const rows = await db
    .select()
    .from(importProfiles)
    .where(orgWhere(importProfiles, orgId))
    .orderBy(asc(importProfiles.name))
  return rows.map(toSummary)
}

export async function getImportProfile(
  conn: DbOrTx,
  orgId: string,
  id: string,
): Promise<ImportProfile> {
  const [p] = await conn
    .select()
    .from(importProfiles)
    .where(orgWhere(importProfiles, orgId, eq(importProfiles.id, id)))
    .limit(1)
  if (!p) throw notFound('PROFILE_NOT_FOUND', 'This Excel layout no longer exists')
  return p
}

export async function createImportProfile(
  auth: TenantAuth,
  input: ImportProfileInput,
): Promise<ImportProfileSummary> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(importProfiles)
      .where(orgWhere(importProfiles, auth.org.id))
    if ((row?.n ?? 0) >= MAX_IMPORT_PROFILES) {
      throw conflict(
        'PROFILE_LIMIT',
        `You can save up to ${MAX_IMPORT_PROFILES} layouts. Delete one you no longer use.`,
      )
    }
    const id = crypto.randomUUID()
    try {
      await tx.insert(importProfiles).values({
        id,
        organizationId: auth.org.id,
        name: input.name,
        columns: input.columns,
        createdBy: auth.user.id,
      })
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken()
      throw err
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'import_profile.created',
      entity: 'import_profile',
      entityId: id,
      details: { name: input.name },
    })
    return toSummary(await getImportProfile(tx, auth.org.id, id))
  })
}

export async function updateImportProfile(
  auth: TenantAuth,
  id: string,
  input: ImportProfileInput,
): Promise<ImportProfileSummary> {
  return db.transaction(async (tx) => {
    await getImportProfile(tx, auth.org.id, id)
    try {
      await tx
        .update(importProfiles)
        .set({ name: input.name, columns: input.columns })
        .where(orgWhere(importProfiles, auth.org.id, eq(importProfiles.id, id)))
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken()
      throw err
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'import_profile.updated',
      entity: 'import_profile',
      entityId: id,
      details: { name: input.name },
    })
    return toSummary(await getImportProfile(tx, auth.org.id, id))
  })
}

export async function deleteImportProfile(auth: TenantAuth, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const p = await getImportProfile(tx, auth.org.id, id)
    await tx
      .delete(importProfiles)
      .where(orgWhere(importProfiles, auth.org.id, eq(importProfiles.id, id)))
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'import_profile.deleted',
      entity: 'import_profile',
      entityId: id,
      details: { name: p.name },
    })
  })
}
