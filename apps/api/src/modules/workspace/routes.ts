import { Router } from 'express'
import {
  PERMISSIONS,
  workspaceSettingsSchema,
  type WorkspaceInfo,
  type WorkspaceSettings,
} from '@tdm/shared'
import { notFound } from '../../lib/errors'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { getWorkspaceSettings, updateWorkspaceSettings } from './service'

export const workspaceRouter = Router()

/**
 * Public. Tells the web app what this host is (a client, the owner panel or
 * the root domain), so it can show the right screens. Shows only the
 * client's name and status, nothing private.
 */
workspaceRouter.get('/', (req, res) => {
  const ctx = req.ctx
  let info: WorkspaceInfo
  if (ctx.kind === 'tenant') {
    info = { kind: 'tenant', slug: ctx.org.slug, name: ctx.org.name, status: ctx.org.status }
  } else if (ctx.kind === 'owner' || ctx.kind === 'root') {
    info = { kind: ctx.kind }
  } else {
    throw notFound('WORKSPACE_NOT_FOUND', 'This workspace does not exist')
  }
  res.json(info)
})

/**
 * The client's own settings: two-step login required, what agents see
 * (Installed assets, installation reports), cleanup days.
 */
workspaceRouter.get('/settings', authenticateTenant, async (req, res) => {
  const settings: WorkspaceSettings = await getWorkspaceSettings(tenantAuth(req).org)
  res.json(settings)
})

workspaceRouter.patch(
  '/settings',
  authenticateTenant,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (req, res) => {
    const input = parse(workspaceSettingsSchema, req.body)
    res.json(await updateWorkspaceSettings(tenantAuth(req), input, req.ip ?? null))
  },
)
