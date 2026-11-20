import { Router } from 'express'
import { z } from 'zod'
import { parse } from '../../lib/validate'
import { authenticateTenant, tenantAuth } from '../../middleware/auth'
import { listNotifications, markRead } from './service'

const markReadSchema = z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(100)]) })

export const notificationsRouter = Router()
notificationsRouter.use(authenticateTenant)

notificationsRouter.get('/', async (req, res) => {
  res.json(await listNotifications(tenantAuth(req)))
})

notificationsRouter.post('/read', async (req, res) => {
  const { ids } = parse(markReadSchema, req.body)
  await markRead(tenantAuth(req), ids)
  res.status(204).end()
})
