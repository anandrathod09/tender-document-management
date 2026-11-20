import { Router, type Request } from 'express'
import { inviteUserSchema, PERMISSIONS, updateUserSchema } from '@tdm/shared'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import {
  inviteUser,
  listRoles,
  listUsers,
  resendInvite,
  resetUserTwoFactor,
  updateUser,
  type Actor,
} from './service'

const actorOf = (req: Request): Actor => ({
  type: 'user',
  id: tenantAuth(req).user.id,
  ip: req.ip ?? null,
})

export const usersRouter = Router()
usersRouter.use(authenticateTenant, requirePermission(PERMISSIONS.USER_MANAGE))

usersRouter.get('/', async (req, res) => {
  res.json(await listUsers(tenantAuth(req).org.id))
})

usersRouter.post('/', async (req, res) => {
  const input = parse(inviteUserSchema, req.body)
  res.status(201).json(await inviteUser(tenantAuth(req).org, actorOf(req), input))
})

usersRouter.patch('/:id', async (req, res) => {
  const input = parse(updateUserSchema, req.body)
  res.json(await updateUser(tenantAuth(req).org, actorOf(req), req.params.id as string, input))
})

usersRouter.post('/:id/resend-invite', async (req, res) => {
  res.json(await resendInvite(tenantAuth(req).org, actorOf(req), req.params.id as string))
})

usersRouter.post('/:id/reset-two-factor', async (req, res) => {
  res.json(await resetUserTwoFactor(tenantAuth(req).org, actorOf(req), req.params.id as string))
})

export const rolesRouter = Router()
rolesRouter.use(authenticateTenant)

rolesRouter.get('/', async (req, res) => {
  res.json(await listRoles(tenantAuth(req).org.id))
})
