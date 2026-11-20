import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { assetListQuerySchema, installationReportSchema, PERMISSIONS } from '@tdm/shared'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { biddingCompanies, files } from '../../db/schema'
import { todayIn } from '../../lib/dates'
import { notFound } from '../../lib/errors'
import { storage } from '../../lib/storage'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { getVisibleTender } from '../tenders/service'
import { listAssets } from './assets'
import { buildInstallationPdf } from './pdf'
import { getReport, listEngineers, saveReport } from './service'

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

/** People who can be named as the engineer on a consignee. */
assetsRouter.get('/engineers', async (req, res) => {
  res.json(await listEngineers(tenantAuth(req).org.id))
})
