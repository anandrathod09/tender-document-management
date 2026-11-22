import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNotNull, isNull, lt, sum } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { MAX_UPLOAD_MB, PERMISSIONS, type FileKind, type FileSummary } from '@tdm/shared'
import { env } from '../../config/env'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  files,
  installationConsignees,
  organizations,
  plans,
  users,
  type StoredFile,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors'
import { detectFileType, IMAGE_MIMES } from '../../lib/file-types'
import { logger } from '../../lib/logger'
import { storage } from '../../lib/storage'
import type { TenantAuth } from '../../types/express'
import { ownConsigneesOnly } from '../installation/service'
import { getVisibleTender } from '../tenders/service'

export interface NewFile {
  organizationId: string
  kind: FileKind
  bytes: Buffer
  originalName: string
  title?: string
  tenderId?: string | null
  companyId?: string | null
  consigneeId?: string | null
  uploadedBy?: string | null
}

const GB = 1024 ** 3

async function assertStorageAvailable(conn: DbOrTx, orgId: string, adding: number) {
  const [plan] = await conn
    .select({ maxGb: plans.maxStorageGb })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (!plan) return
  // Files in the 30-day bin still use space until they are purged.
  const [row] = await conn
    .select({ used: sum(files.sizeBytes) })
    .from(files)
    .where(orgWhere(files, orgId))
  const used = Number(row?.used ?? 0)
  if (used + adding > plan.maxGb * GB) {
    throw conflict(
      'PLAN_STORAGE_LIMIT',
      `Your plan includes ${plan.maxGb} GB of storage and ${(used / GB).toFixed(1)} GB is used. Delete files or upgrade the plan.`,
    )
  }
}

/**
 * Checks and stores a file. The real type is read from the bytes; logos and
 * signatures must be PNG or JPEG. Returns the saved row.
 */
export async function storeFile(conn: DbOrTx, f: NewFile): Promise<StoredFile> {
  if (f.bytes.length === 0) throw badRequest('EMPTY_FILE', 'The file is empty')
  // Generated compliance PDFs combine many documents, so they may be larger than an upload.
  const maxMb = f.kind === 'compliance_pdf' ? MAX_UPLOAD_MB * 2 : MAX_UPLOAD_MB
  if (f.bytes.length > maxMb * 1024 * 1024) {
    throw badRequest('FILE_TOO_LARGE', `Files can be up to ${maxMb} MB`)
  }
  const type = detectFileType(f.bytes, f.originalName)
  const imageOnly = f.kind === 'company_logo' || f.kind === 'company_signature'
  if (!type || (imageOnly && !IMAGE_MIMES.includes(type.mime))) {
    throw badRequest(
      'UNSUPPORTED_FILE',
      imageOnly
        ? 'Upload a PNG or JPEG image'
        : 'Upload a PDF, image (PNG/JPEG), Word, Excel or zip file',
    )
  }
  await assertStorageAvailable(conn, f.organizationId, f.bytes.length)

  const id = randomUUID()
  const storageKey = `org/${f.organizationId}/${f.kind}/${id}.${type.ext}`
  await storage.put(storageKey, f.bytes, type.mime)

  const originalName =
    f.originalName.replace(/[\\/\r\n"]/g, '_').slice(0, 255) || `file.${type.ext}`
  const row = {
    id,
    organizationId: f.organizationId,
    kind: f.kind,
    storageKey,
    originalName,
    title: (f.title?.trim() || originalName).slice(0, 200),
    mimeType: type.mime,
    sizeBytes: f.bytes.length,
    tenderId: f.tenderId ?? null,
    companyId: f.companyId ?? null,
    consigneeId: f.consigneeId ?? null,
    uploadedBy: f.uploadedBy ?? null,
  }
  try {
    await conn.insert(files).values(row)
  } catch (err) {
    await storage.remove(storageKey).catch(() => undefined)
    throw err
  }
  return { ...row, createdAt: new Date(), deletedAt: null }
}

export async function getFile(conn: DbOrTx, orgId: string, id: string): Promise<StoredFile> {
  const [file] = await conn
    .select()
    .from(files)
    .where(orgWhere(files, orgId, eq(files.id, id), isNull(files.deletedAt)))
    .limit(1)
  if (!file) throw notFound('FILE_NOT_FOUND', 'File not found')
  return file
}

/**
 * Whether the user may see a file. Tender files follow the tender's
 * visibility (agents and engineers see only their tenders); consignee
 * documents also need the consignee to be the engineer's own; library files
 * and company logos are visible to everyone in the client.
 */
export async function assertCanAccess(auth: TenantAuth, file: StoredFile): Promise<void> {
  const tenderFile =
    file.kind === 'tender_document' ||
    file.kind === 'compliance_pdf' ||
    file.kind === 'consignee_document'
  if (!tenderFile || auth.permissions.has(PERMISSIONS.TENDER_VIEW_ALL)) return
  const hidden = () => notFound('FILE_NOT_FOUND', 'File not found')
  if (!file.tenderId) throw hidden()
  await getVisibleTender(db, auth, file.tenderId).catch(() => {
    throw hidden()
  })
  if (file.kind === 'consignee_document' && ownConsigneesOnly(auth)) {
    const [c] = file.consigneeId
      ? await db
          .select({ engineerId: installationConsignees.engineerId })
          .from(installationConsignees)
          .where(
            orgWhere(
              installationConsignees,
              auth.org.id,
              eq(installationConsignees.id, file.consigneeId),
            ),
          )
      : []
    if (c?.engineerId !== auth.user.id) throw hidden()
  }
}

export async function listFiles(
  orgId: string,
  where: { kind: FileKind; tenderId?: string; companyId?: string },
): Promise<FileSummary[]> {
  const rows = await db
    .select({ file: files, uploaderName: users.name })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedBy))
    .where(
      orgWhere(
        files,
        orgId,
        eq(files.kind, where.kind),
        isNull(files.deletedAt),
        where.tenderId ? eq(files.tenderId, where.tenderId) : undefined,
        where.companyId ? eq(files.companyId, where.companyId) : undefined,
      ),
    )
    .orderBy(desc(files.createdAt))
  return rows.map((r) => toFileSummary(r.file, r.uploaderName))
}

export function toFileSummary(f: StoredFile, uploaderName: string | null): FileSummary {
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    companyId: f.companyId,
    uploadedBy: f.uploadedBy ? { id: f.uploadedBy, name: uploaderName ?? '' } : null,
    createdAt: f.createdAt.toISOString(),
  }
}

/**
 * Moves a file to the 30-day bin. Tender documents can be deleted by the
 * person who uploaded them or by someone who can assign tenders; library
 * files need the company-management permission.
 */
export async function deleteFile(auth: TenantAuth, id: string, ip: string | null) {
  const file = await getFile(db, auth.org.id, id)
  await assertCanAccess(auth, file)
  const allowed =
    file.kind === 'tender_document'
      ? file.uploadedBy === auth.user.id || auth.permissions.has(PERMISSIONS.TENDER_ASSIGN)
      : file.kind === 'consignee_document'
        ? file.uploadedBy === auth.user.id || auth.permissions.has(PERMISSIONS.INSTALLATION_MANAGE)
        : file.kind === 'library'
          ? auth.permissions.has(PERMISSIONS.COMPANY_MANAGE)
          : false
  if (!allowed) throw forbidden()
  await db.transaction(async (tx) => {
    await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(orgWhere(files, auth.org.id, eq(files.id, file.id)))
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'file.deleted',
      entity: 'file',
      entityId: file.id,
      details: { kind: file.kind, title: file.title },
      ip,
    })
  })
}

// ---------------------------------------------------------------------------
// Download links
// ---------------------------------------------------------------------------

const LINK_TTL_SECONDS = 300

interface LinkClaims {
  fid: string
  org: string
  inline: boolean
}

/**
 * A download link that works for 5 minutes without a sign-in header, so the
 * browser can open it directly. It only works on the client's own subdomain.
 */
export function createDownloadLink(
  file: StoredFile,
  inline = false,
): { url: string; expiresIn: number } {
  const token = jwt.sign(
    { fid: file.id, org: file.organizationId, inline } satisfies LinkClaims,
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      audience: 'file',
      expiresIn: LINK_TTL_SECONDS,
    },
  )
  return { url: `/api/files/download/${token}`, expiresIn: LINK_TTL_SECONDS }
}

export function verifyDownloadToken(token: string): LinkClaims | null {
  try {
    const c = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: 'file',
    }) as Partial<LinkClaims>
    if (typeof c.fid !== 'string' || typeof c.org !== 'string') return null
    return { fid: c.fid, org: c.org, inline: c.inline === true }
  } catch {
    return null
  }
}

/** Only these types may open in the browser tab; everything else downloads. */
export const INLINE_SAFE = ['application/pdf', 'image/png', 'image/jpeg']

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

const PURGE_AFTER_DAYS = 30

/** Removes files that have been in the bin for 30 days, from storage and the database. */
export async function purgeDeletedFiles(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000)
  const old = await db
    .select({ id: files.id, key: files.storageKey })
    .from(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)))
    .limit(500)
  for (const f of old) {
    try {
      await storage.remove(f.key)
      await db.delete(files).where(eq(files.id, f.id))
    } catch (err) {
      // Still referenced (e.g. by an old compliance pack): leave it and log.
      logger.warn({ err, fileId: f.id }, 'Could not purge file')
    }
  }
  return old.length
}
