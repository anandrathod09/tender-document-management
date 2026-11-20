import { Router } from 'express'
import { PERMISSIONS, libraryUploadSchema } from '@tdm/shared'
import { db } from '../../db/client'
import { badRequest, notFound } from '../../lib/errors'
import { storage } from '../../lib/storage'
import { upload } from '../../lib/upload'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { assertTenant } from '../../middleware/workspace'
import { getCompany } from '../companies/service'
import {
  assertCanAccess,
  createDownloadLink,
  deleteFile,
  getFile,
  INLINE_SAFE,
  listFiles,
  storeFile,
  toFileSummary,
  verifyDownloadToken,
} from './service'

export const filesRouter = Router()

/**
 * Opens or downloads a file with a link from POST /files/:id/link. No
 * sign-in header is needed (the link itself is the permission, for 5
 * minutes), but it only works on the subdomain of the client that owns it.
 */
filesRouter.get('/download/:token', async (req, res) => {
  const org = assertTenant(req)
  const claims = verifyDownloadToken(req.params.token)
  if (!claims || claims.org !== org.id)
    throw notFound('LINK_EXPIRED', 'This download link has expired')
  const file = await getFile(db, org.id, claims.fid)
  const { stream, size } = await storage.stream(file.storageKey)

  const inline = claims.inline && INLINE_SAFE.includes(file.mimeType)
  const name = encodeURIComponent(file.originalName)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', String(size))
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
  )
  res.setHeader('Cache-Control', 'private, max-age=300')
  if (inline && file.mimeType === 'application/pdf') {
    // The browser's built-in PDF viewer does not work under a sandbox policy.
    res.removeHeader('Content-Security-Policy')
  } else {
    // Nothing else stored may run scripts or load anything if opened directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
  }
  stream.on('error', () => res.destroy())
  stream.pipe(res)
})

filesRouter.use(authenticateTenant)

filesRouter.post('/:id/link', async (req, res) => {
  const auth = tenantAuth(req)
  const file = await getFile(db, auth.org.id, req.params.id as string)
  await assertCanAccess(auth, file)
  res.json(createDownloadLink(file, req.query.inline === '1'))
})

filesRouter.delete('/:id', async (req, res) => {
  await deleteFile(tenantAuth(req), req.params.id as string, req.ip ?? null)
  res.status(204).end()
})

/** Shared document library: GST, PAN, ISO certificates and other papers reused across tenders. */
export const libraryRouter = Router()
libraryRouter.use(authenticateTenant)

libraryRouter.get('/', async (req, res) => {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : undefined
  res.json(await listFiles(tenantAuth(req).org.id, { kind: 'library', companyId }))
})

libraryRouter.post(
  '/',
  requirePermission(PERMISSIONS.COMPANY_MANAGE),
  upload.single('file'),
  async (req, res) => {
    const auth = tenantAuth(req)
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose a file to upload')
    const input = parse(libraryUploadSchema, req.body)
    if (input.companyId) await getCompany(db, auth.org.id, input.companyId)
    const file = await storeFile(db, {
      organizationId: auth.org.id,
      kind: 'library',
      bytes: req.file.buffer,
      originalName: req.file.originalname,
      title: input.title,
      companyId: input.companyId ?? null,
      uploadedBy: auth.user.id,
    })
    res.status(201).json(toFileSummary(file, auth.user.name))
  },
)
