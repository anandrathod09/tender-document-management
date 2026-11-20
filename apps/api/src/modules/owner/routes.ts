import { Router, type Request } from 'express'
import { createOrganizationSchema, updateOrganizationSchema } from '@tdm/shared'
import { db } from '../../db/client'
import { parse } from '../../lib/validate'
import { authenticatePlatform, platformAuth } from '../../middleware/auth'
import type { Actor } from '../users/service'
import {
  getOrganizationDetail,
  listOrganizations,
  provisionOrganization,
  resendClientInvite,
  updateOrganization,
} from './service'

const actorOf = (req: Request): Actor => ({
  type: 'platform',
  id: platformAuth(req).user.id,
  ip: req.ip ?? null,
})

export const ownerRouter = Router()
ownerRouter.use(authenticatePlatform)

ownerRouter.get('/organizations', async (_req, res) => {
  res.json(await listOrganizations())
})

ownerRouter.post('/organizations', async (req, res) => {
  const input = parse(createOrganizationSchema, req.body)
  res.status(201).json(await provisionOrganization(actorOf(req), input))
})

ownerRouter.get('/organizations/:id', async (req, res) => {
  res.json(await getOrganizationDetail(db, req.params.id as string))
})

ownerRouter.patch('/organizations/:id', async (req, res) => {
  const input = parse(updateOrganizationSchema, req.body)
  res.json(await updateOrganization(actorOf(req), req.params.id as string, input))
})

ownerRouter.post('/organizations/:id/users/:userId/resend-invite', async (req, res) => {
  res.json(
    await resendClientInvite(actorOf(req), req.params.id as string, req.params.userId as string),
  )
})
