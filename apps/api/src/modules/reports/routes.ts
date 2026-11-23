import { Router, type Response } from 'express'
import {
  assetListQuerySchema,
  PERMISSIONS,
  reportQuerySchema,
  tenderListQuerySchema,
} from '@tdm/shared'
import { todayIn } from '../../lib/dates'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { exportAssets, exportTenders, getSummary } from './service'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function sendXlsx(res: Response, name: string, bytes: Buffer) {
  res.setHeader('Content-Type', XLSX)
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(bytes)
}

export const reportsRouter = Router()
reportsRouter.use(authenticateTenant)

reportsRouter.get('/summary', requirePermission(PERMISSIONS.REPORT_VIEW), async (req, res) => {
  res.json(await getSummary(tenantAuth(req), parse(reportQuerySchema, req.query)))
})

/** Takes the same filters as GET /tenders, so the file matches what is on screen. */
reportsRouter.get(
  '/export/tenders.xlsx',
  requirePermission(PERMISSIONS.REPORT_EXPORT),
  async (req, res) => {
    const auth = tenantAuth(req)
    const query = parse(tenderListQuerySchema, { ...req.query, page: 1, pageSize: 100 })
    sendXlsx(res, `Tenders_${todayIn(auth.org.timezone)}.xlsx`, await exportTenders(auth, query))
  },
)

/** Takes the same filters as GET /assets (search, warranty, installed, engineer). */
reportsRouter.get(
  '/export/assets.xlsx',
  requirePermission(PERMISSIONS.REPORT_EXPORT),
  async (req, res) => {
    const auth = tenantAuth(req)
    const query = parse(assetListQuerySchema, req.query)
    sendXlsx(
      res,
      `Installed_assets_${todayIn(auth.org.timezone)}.xlsx`,
      await exportAssets(auth, query),
    )
  },
)
