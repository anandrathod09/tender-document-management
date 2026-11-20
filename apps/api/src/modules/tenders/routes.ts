import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  assignTenderSchema,
  bulkTenderActionSchema,
  createCompliancePackSchema,
  importProfileSchema,
  moveTenderSchema,
  PERMISSIONS,
  tenderListQuerySchema,
  updateTenderSchema,
} from '@tdm/shared'
import type { ImportInspectResult } from '@tdm/shared'
import { db } from '../../db/client'
import { badRequest, forbidden } from '../../lib/errors'
import { upload as fileUpload } from '../../lib/upload'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { listPacks, requestPack } from '../compliance/service'
import { listFiles, storeFile, toFileSummary } from '../files/service'
import { suggestColumns, readHeadings } from './excel'
import { importTenders } from './import'
import {
  createImportProfile,
  deleteImportProfile,
  listImportProfiles,
  updateImportProfile,
} from './import-profiles'
import {
  assignTender,
  bulkTenderAction,
  getDashboard,
  getTenderDetail,
  getVisibleTender,
  listAssignees,
  listTenders,
  moveTender,
  stageCounts,
  updateTender,
} from './service'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

// Sent as a form field next to the file. Empty means the Tender247 layout.
const importOptionsSchema = z.object({
  profileId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
})

// Kept in memory only for the length of the request; the file itself is not stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) cb(null, true)
    else cb(badRequest('UNSUPPORTED_FILE', 'Upload an Excel file (.xlsx)'))
  },
})

export const tendersRouter = Router()
tendersRouter.use(authenticateTenant)

tendersRouter.get('/', async (req, res) => {
  res.json(await listTenders(tenantAuth(req), parse(tenderListQuerySchema, req.query)))
})

tendersRouter.get('/counts', async (req, res) => {
  res.json(await stageCounts(tenantAuth(req)))
})

tendersRouter.get('/dashboard', async (req, res) => {
  res.json(await getDashboard(tenantAuth(req)))
})

tendersRouter.get('/assignees', requirePermission(PERMISSIONS.TENDER_ASSIGN), async (req, res) => {
  res.json(await listAssignees(tenantAuth(req).org.id))
})

tendersRouter.post(
  '/import',
  requirePermission(PERMISSIONS.TENDER_IMPORT),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose an Excel file to upload')
    const { profileId } = parse(importOptionsSchema, req.body ?? {})
    res.json(await importTenders(tenantAuth(req), req.file, profileId))
  },
)

// Lists each sheet's column headings, so a client can map a new layout before importing.
tendersRouter.post(
  '/import/inspect',
  requirePermission(PERMISSIONS.TENDER_IMPORT),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose an Excel file to upload')
    let sheets
    try {
      sheets = await readHeadings(req.file.buffer)
    } catch {
      throw badRequest(
        'UNREADABLE_FILE',
        'This file could not be read. Upload an Excel (.xlsx) file.',
      )
    }
    const result: ImportInspectResult = {
      sheets,
      suggested: suggestColumns([...new Set(sheets.flatMap((s) => s.headings))]),
    }
    res.json(result)
  },
)

// The same move or assignment for several tenders, from the tender list.
tendersRouter.post('/bulk', async (req, res) => {
  const auth = tenantAuth(req)
  const input = parse(bulkTenderActionSchema, req.body)
  const needed = input.action === 'move' ? PERMISSIONS.TENDER_MOVE_STAGE : PERMISSIONS.TENDER_ASSIGN
  if (!auth.permissions.has(needed)) throw forbidden()
  res.json(await bulkTenderAction(auth, input))
})

tendersRouter.get('/:id', async (req, res) => {
  res.json(await getTenderDetail(db, tenantAuth(req), req.params.id as string))
})

tendersRouter.post(
  '/:id/move',
  requirePermission(PERMISSIONS.TENDER_MOVE_STAGE),
  async (req, res) => {
    const input = parse(moveTenderSchema, req.body)
    res.json(await moveTender(tenantAuth(req), req.params.id as string, input))
  },
)

tendersRouter.post(
  '/:id/assign',
  requirePermission(PERMISSIONS.TENDER_ASSIGN),
  async (req, res) => {
    const input = parse(assignTenderSchema, req.body)
    res.json(await assignTender(tenantAuth(req), req.params.id as string, input))
  },
)

tendersRouter.patch('/:id', requirePermission(PERMISSIONS.TENDER_MOVE_STAGE), async (req, res) => {
  const input = parse(updateTenderSchema, req.body)
  res.json(await updateTender(tenantAuth(req), req.params.id as string, input))
})

// Documents attached to a tender: everyone who can see it can read them; adding needs the permission.
tendersRouter.get('/:id/documents', async (req, res) => {
  const auth = tenantAuth(req)
  const tender = await getVisibleTender(db, auth, req.params.id as string)
  res.json(await listFiles(auth.org.id, { kind: 'tender_document', tenderId: tender.id }))
})

tendersRouter.post(
  '/:id/documents',
  requirePermission(PERMISSIONS.TENDER_DOCUMENTS),
  fileUpload.single('file'),
  async (req, res) => {
    const auth = tenantAuth(req)
    const tender = await getVisibleTender(db, auth, req.params.id as string)
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose a file to upload')
    const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : undefined
    const file = await storeFile(db, {
      organizationId: auth.org.id,
      kind: 'tender_document',
      bytes: req.file.buffer,
      originalName: req.file.originalname,
      title,
      tenderId: tender.id,
      uploadedBy: auth.user.id,
    })
    res.status(201).json(toFileSummary(file, auth.user.name))
  },
)

// Compliance PDFs: declaration letters on the company letterhead plus chosen documents.
tendersRouter.get('/:id/compliance-packs', async (req, res) => {
  res.json(await listPacks(tenantAuth(req), req.params.id as string))
})

tendersRouter.post(
  '/:id/compliance-packs',
  requirePermission(PERMISSIONS.TENDER_DOCUMENTS),
  async (req, res) => {
    const input = parse(createCompliancePackSchema, req.body)
    res.status(202).json(await requestPack(tenantAuth(req), req.params.id as string, input))
  },
)

/** Saved Excel layouts (import profiles) for files that are not Tender247 exports. */
export const importProfilesRouter = Router()
importProfilesRouter.use(authenticateTenant, requirePermission(PERMISSIONS.TENDER_IMPORT))

importProfilesRouter.get('/', async (req, res) => {
  res.json(await listImportProfiles(tenantAuth(req).org.id))
})

importProfilesRouter.post('/', async (req, res) => {
  res
    .status(201)
    .json(await createImportProfile(tenantAuth(req), parse(importProfileSchema, req.body)))
})

importProfilesRouter.put('/:id', async (req, res) => {
  const input = parse(importProfileSchema, req.body)
  res.json(await updateImportProfile(tenantAuth(req), req.params.id as string, input))
})

importProfilesRouter.delete('/:id', async (req, res) => {
  await deleteImportProfile(tenantAuth(req), req.params.id as string)
  res.status(204).end()
})
