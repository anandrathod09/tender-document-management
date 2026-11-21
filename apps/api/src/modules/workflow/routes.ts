import { Router, type Request } from 'express'
import {
  createStageSchema,
  PERMISSIONS,
  reorderStagesSchema,
  resetWorkflowSchema,
  updateStageSchema,
} from '@tdm/shared'
import { db } from '../../db/client'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import {
  createStage,
  deleteStage,
  listStages,
  reorderStages,
  resetWorkflow,
  toStageSummary,
  updateStage,
} from './service'

export const workflowRouter = Router()
workflowRouter.use(authenticateTenant)

workflowRouter.get('/stages', async (req, res) => {
  res.json((await listStages(db, tenantAuth(req).org.id)).map(toStageSummary))
})

workflowRouter.patch(
  '/stages/:id',
  requirePermission(PERMISSIONS.WORKFLOW_MANAGE),
  async (req, res) => {
    const input = parse(updateStageSchema, req.body)
    const { org, user } = tenantAuth(req)
    res.json(
      await updateStage(
        org,
        { type: 'user', id: user.id, ip: req.ip ?? null },
        req.params.id as string,
        input,
      ),
    )
  },
)

const actorOf = (req: Request) => ({
  type: 'user' as const,
  id: tenantAuth(req).user.id,
  ip: req.ip ?? null,
})

workflowRouter.post('/stages', requirePermission(PERMISSIONS.WORKFLOW_MANAGE), async (req, res) => {
  res
    .status(201)
    .json(await createStage(tenantAuth(req).org, actorOf(req), parse(createStageSchema, req.body)))
})

workflowRouter.put(
  '/stages/order',
  requirePermission(PERMISSIONS.WORKFLOW_MANAGE),
  async (req, res) => {
    const { ids } = parse(reorderStagesSchema, req.body)
    res.json(await reorderStages(tenantAuth(req).org, actorOf(req), ids))
  },
)

// Back to the starting settings (names, order, settings, moves, menus), for all stages or one.
workflowRouter.post(
  '/stages/reset',
  requirePermission(PERMISSIONS.WORKFLOW_MANAGE),
  async (req, res) => {
    const input = parse(resetWorkflowSchema, req.body)
    res.json(await resetWorkflow(tenantAuth(req).org, actorOf(req), input))
  },
)

workflowRouter.delete(
  '/stages/:id',
  requirePermission(PERMISSIONS.WORKFLOW_MANAGE),
  async (req, res) => {
    await deleteStage(tenantAuth(req).org, actorOf(req), req.params.id as string)
    res.status(204).end()
  },
)
