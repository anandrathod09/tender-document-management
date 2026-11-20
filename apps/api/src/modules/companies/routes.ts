import { Router } from 'express'
import { companySchema, PERMISSIONS } from '@tdm/shared'
import { badRequest } from '../../lib/errors'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { upload } from '../../lib/upload'
import {
  companyLimit,
  createCompany,
  listCompanies,
  setCompanyImage,
  updateCompany,
} from './service'
import { db } from '../../db/client'

export const companiesRouter = Router()
companiesRouter.use(authenticateTenant)

companiesRouter.get('/', async (req, res) => {
  res.json(await listCompanies(tenantAuth(req).org.id))
})

/** How many active companies the plan allows, for the companies page. */
companiesRouter.get('/limit', async (req, res) => {
  res.json(await companyLimit(db, tenantAuth(req).org.id))
})

companiesRouter.post('/', requirePermission(PERMISSIONS.COMPANY_MANAGE), async (req, res) => {
  res.status(201).json(await createCompany(tenantAuth(req), parse(companySchema, req.body)))
})

companiesRouter.put('/:id', requirePermission(PERMISSIONS.COMPANY_MANAGE), async (req, res) => {
  res.json(
    await updateCompany(tenantAuth(req), req.params.id as string, parse(companySchema, req.body)),
  )
})

for (const which of ['logo', 'signature'] as const) {
  companiesRouter.post(
    `/:id/${which}`,
    requirePermission(PERMISSIONS.COMPANY_MANAGE),
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw badRequest('FILE_REQUIRED', 'Choose an image to upload')
      res.json(await setCompanyImage(tenantAuth(req), req.params.id as string, which, req.file))
    },
  )
}
