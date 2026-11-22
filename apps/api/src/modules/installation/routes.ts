import { Router } from 'express'
import { eq } from 'drizzle-orm'
import {
  assetListQuerySchema,
  consigneeWorkSchema,
  installationReportSchema,
  PERMISSIONS,
} from '@tdm/shared'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { biddingCompanies, files } from '../../db/schema'
import { todayIn } from '../../lib/dates'
import { badRequest, notFound } from '../../lib/errors'
import { detectFileType, IMAGE_MIMES } from '../../lib/file-types'
import { storage } from '../../lib/storage'
import { upload } from '../../lib/upload'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { getVisibleTender } from '../tenders/service'
import { listAssets } from './assets'
import { buildInstallationPdf } from './pdf'
import { storeFile } from '../files/service'
import {
  getReport,
  getWorkableConsignee,
  listEngineers,
  listSites,
  saveConsigneeWork,
  saveReport,
} from './service'

/** Mounted under /api/tenders/:id/installation-report */
export const installationRouter = Router({ mergeParams: true })
installationRouter.use(authenticateTenant)

installationRouter.get('/', async (req, res) => {
  res.json(await getReport(db, tenantAuth(req), (req.params as { id: string }).id))
})

installationRouter.put(
  '/',
  requirePermission(PERMISSIONS.INSTALLATION_MANAGE),
  async (req, res) => {
    const input = parse(installationReportSchema, req.body)
    res.json(await saveReport(tenantAuth(req), (req.params as { id: string }).id, input))
  },
)

/** The engineer's update: status and the rows of their consignee's report templates. */
installationRouter.patch('/consignees/:consigneeId', async (req, res) => {
  const p = req.params as { id: string; consigneeId: string }
  const input = parse(consigneeWorkSchema, req.body)
  res.json(await saveConsigneeWork(tenantAuth(req), p.id, p.consigneeId, input))
})

/** Installation certificates and site photos for one consignee (PDF, PNG or JPEG). */
installationRouter.post(
  '/consignees/:consigneeId/documents',
  upload.single('file'),
  async (req, res) => {
    const auth = tenantAuth(req)
    const p = req.params as { id: string; consigneeId: string }
    const tender = await getVisibleTender(db, auth, p.id)
    const consignee = await getWorkableConsignee(db, auth, tender, p.consigneeId)
    if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose a file to upload')
    const type = detectFileType(req.file.buffer, req.file.originalname)
    if (!type || (type.mime !== 'application/pdf' && !IMAGE_MIMES.includes(type.mime))) {
      throw badRequest('UNSUPPORTED_FILE', 'Upload a PDF, JPG or PNG file')
    }
    const file = await storeFile(db, {
      organizationId: auth.org.id,
      kind: 'consignee_document',
      bytes: req.file.buffer,
      originalName: req.file.originalname,
      tenderId: tender.id,
      consigneeId: consignee.id,
      uploadedBy: auth.user.id,
    })
    res.status(201).json({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedBy: { id: auth.user.id, name: auth.user.name },
      createdAt: file.createdAt.toISOString(),
    })
  },
)

/** The printable Hardware Installation Report; ?consignee=<id> for one consignee only. */
installationRouter.get('/pdf', async (req, res) => {
  const auth = tenantAuth(req)
  const tenderId = (req.params as { id: string }).id
  const tender = await getVisibleTender(db, auth, tenderId)
  const report = await getReport(db, auth, tenderId)
  if (!report || !report.consignees.length) {
    throw notFound('REPORT_EMPTY', 'Add at least one consignee before printing the report')
  }
  const companyId = report.biddingCompanyId ?? tender.biddingCompanyId
  const [company] = companyId
    ? await db
        .select()
        .from(biddingCompanies)
        .where(orgWhere(biddingCompanies, auth.org.id, eq(biddingCompanies.id, companyId)))
    : []
  const [logoFile] = company?.logoFileId
    ? await db
        .select()
        .from(files)
        .where(orgWhere(files, auth.org.id, eq(files.id, company.logoFileId)))
    : []
  const consigneeId = typeof req.query.consignee === 'string' ? req.query.consignee : undefined
  if (consigneeId && !report.consignees.some((c) => c.id === consigneeId)) throw notFound()

  const pdf = await buildInstallationPdf({
    report,
    tenderRef: tender.referenceNo,
    company: company ? { name: company.name, address: company.address } : null,
    logo: logoFile
      ? { mime: logoFile.mimeType, bytes: await storage.read(logoFile.storageKey) }
      : null,
    date: todayIn(auth.org.timezone).split('-').reverse().join('-'),
    consigneeId,
  })
  const name = `Installation_Report_${tender.referenceNo.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(Buffer.from(pdf.bytes))
})

export const assetsRouter = Router()
assetsRouter.use(authenticateTenant)

assetsRouter.get('/', requirePermission(PERMISSIONS.ASSET_VIEW), async (req, res) => {
  res.json(await listAssets(tenantAuth(req), parse(assetListQuerySchema, req.query)))
})

/** Consignees with progress: the engineer's own (their dashboard), or all for admins. */
assetsRouter.get('/sites', async (req, res) => {
  res.json(await listSites(tenantAuth(req)))
})

/** People who can be named as the engineer on a consignee. */
assetsRouter.get('/engineers', async (req, res) => {
  res.json(await listEngineers(tenantAuth(req).org.id))
})
