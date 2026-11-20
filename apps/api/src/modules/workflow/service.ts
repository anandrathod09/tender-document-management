import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, ne, or } from 'drizzle-orm'
import {
  DEFAULT_STAGES,
  type CreateStageInput,
  type StageSummary,
  type StageSystemRole,
  type StageType,
  type UpdateStageInput,
} from '@tdm/shared'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  tenders,
  tenderStageHistory,
  workflowStages,
  type Organization,
  type WorkflowStage,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, notFound } from '../../lib/errors'
import type { Actor } from '../users/service'

/** Copies the default stages into a new client. */
export async function createDefaultStages(conn: DbOrTx, organizationId: string) {
  await conn.insert(workflowStages).values(
    DEFAULT_STAGES.map((s, i) => ({
      id: randomUUID(),
      organizationId,
      key: s.key,
      label: s.label,
      defaultLabel: s.label,
      type: s.type,
      color: s.color,
      commentMode: s.commentMode,
      systemRole: s.systemRole ?? null,
      agentNext: s.agentNext,
      managerNext: s.managerNext,
      sortOrder: (i + 1) * 10,
    })),
  )
}

export function toStageSummary(s: WorkflowStage): StageSummary {
  return {
    id: s.id,
    key: s.key,
    label: s.label,
    defaultLabel: s.defaultLabel,
    type: s.type,
    color: s.color,
    commentMode: s.commentMode,
    isVisible: s.isVisible,
    systemRole: s.systemRole,
    sortOrder: s.sortOrder,
    isCustom: s.key.startsWith(CUSTOM_PREFIX),
    agentNext: s.agentNext ?? null,
    managerNext: s.managerNext ?? null,
  }
}

/** Keys of stages a client adds start with this; default stage keys never do. */
const CUSTOM_PREFIX = 'custom-'

export async function listStages(conn: DbOrTx, orgId: string): Promise<WorkflowStage[]> {
  return conn
    .select()
    .from(workflowStages)
    .where(orgWhere(workflowStages, orgId))
    .orderBy(asc(workflowStages.sortOrder))
}

export async function getStage(
  conn: DbOrTx,
  orgId: string,
  stageId: string,
): Promise<WorkflowStage> {
  const [stage] = await conn
    .select()
    .from(workflowStages)
    .where(orgWhere(workflowStages, orgId, eq(workflowStages.id, stageId)))
    .limit(1)
  if (!stage) throw notFound('STAGE_NOT_FOUND', 'Stage not found')
  return stage
}

/** The stage the system uses for a job (intake, missed deadline). Every client has both. */
export async function getStageByRole(
  conn: DbOrTx,
  orgId: string,
  role: StageSystemRole,
): Promise<WorkflowStage> {
  const [stage] = await conn
    .select()
    .from(workflowStages)
    .where(orgWhere(workflowStages, orgId, eq(workflowStages.systemRole, role)))
    .limit(1)
  if (!stage) throw new Error(`Organization ${orgId} has no ${role} stage`)
  return stage
}

/** First visible stage of a type, in workflow order. */
export async function firstStageOfType(
  conn: DbOrTx,
  orgId: string,
  type: StageType,
): Promise<WorkflowStage | null> {
  const [stage] = await conn
    .select()
    .from(workflowStages)
    .where(
      orgWhere(
        workflowStages,
        orgId,
        eq(workflowStages.type, type),
        eq(workflowStages.isVisible, true),
      ),
    )
    .orderBy(asc(workflowStages.sortOrder))
    .limit(1)
  return stage ?? null
}

/** Types that must always keep at least one visible stage, or the workflow cannot finish. */
const REQUIRED_TYPES: readonly StageType[] = ['open', 'won', 'lost', 'dropped']

/**
 * Lets a client admin rename a stage, choose its comment box setting, or
 * show/hide it. The stage's type and key never change.
 */
export async function updateStage(
  org: Organization,
  actor: Actor,
  stageId: string,
  input: UpdateStageInput,
): Promise<StageSummary> {
  return db.transaction(async (tx) => {
    const stage = await getStage(tx, org.id, stageId)
    const label = input.label === null ? stage.defaultLabel : input.label

    if (label !== undefined && label.toLowerCase() !== stage.label.toLowerCase()) {
      const all = await listStages(tx, org.id)
      if (all.some((s) => s.id !== stage.id && s.label.toLowerCase() === label.toLowerCase())) {
        throw conflict('STAGE_LABEL_TAKEN', `Another stage is already called "${label}"`)
      }
    }

    if (input.isVisible === false && stage.isVisible) {
      if (stage.systemRole) {
        throw conflict('STAGE_REQUIRED', 'The system uses this stage, so it cannot be hidden')
      }
      const [inStage] = await tx
        .select({ n: count() })
        .from(tenders)
        .where(orgWhere(tenders, org.id, eq(tenders.stageId, stage.id)))
      if ((inStage?.n ?? 0) > 0) {
        throw conflict(
          'STAGE_NOT_EMPTY',
          `${inStage!.n} tender(s) are in this stage. Move them before hiding it.`,
        )
      }
      if (REQUIRED_TYPES.includes(stage.type)) {
        const [others] = await tx
          .select({ n: count() })
          .from(workflowStages)
          .where(
            orgWhere(
              workflowStages,
              org.id,
              eq(workflowStages.type, stage.type),
              eq(workflowStages.isVisible, true),
              ne(workflowStages.id, stage.id),
            ),
          )
        if ((others?.n ?? 0) === 0) {
          throw conflict(
            'STAGE_REQUIRED',
            'This is the last stage of its kind, so it cannot be hidden',
          )
        }
      }
    }

    // Move rules may only name other stages of this workspace.
    if (input.agentNext || input.managerNext) {
      const keys = new Set((await listStages(tx, org.id)).map((s) => s.key))
      keys.delete(stage.key)
      for (const k of [...(input.agentNext ?? []), ...(input.managerNext ?? [])]) {
        if (!keys.has(k))
          throw badRequest('STAGE_NOT_FOUND', 'One of the chosen stages does not exist')
      }
    }

    await tx
      .update(workflowStages)
      .set({
        ...(label !== undefined && { label }),
        ...(input.agentNext !== undefined && {
          agentNext: input.agentNext ? [...new Set(input.agentNext)] : null,
        }),
        ...(input.managerNext !== undefined && {
          managerNext: input.managerNext ? [...new Set(input.managerNext)] : null,
        }),
        ...(input.commentMode !== undefined && { commentMode: input.commentMode }),
        ...(input.isVisible !== undefined && { isVisible: input.isVisible }),
        ...(input.color !== undefined && { color: input.color }),
      })
      .where(and(orgWhere(workflowStages, org.id, eq(workflowStages.id, stage.id))))

    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'workflow.stage_updated',
      entity: 'workflow_stage',
      entityId: stage.id,
      details: { key: stage.key, ...input },
      ip: actor.ip,
    })
    return toStageSummary(await getStage(tx, org.id, stage.id))
  })
}

async function assertLabelFree(conn: DbOrTx, orgId: string, label: string, exceptId?: string) {
  const all = await listStages(conn, orgId)
  if (all.some((s) => s.id !== exceptId && s.label.toLowerCase() === label.toLowerCase())) {
    throw conflict('STAGE_LABEL_TAKEN', `Another stage is already called "${label}"`)
  }
}

/** Gives every stage a fresh sort order (10, 20, 30 …) in the given order. */
async function renumber(conn: DbOrTx, orgId: string, ordered: string[]) {
  for (const [i, id] of ordered.entries()) {
    await conn
      .update(workflowStages)
      .set({ sortOrder: (i + 1) * 10 })
      .where(orgWhere(workflowStages, orgId, eq(workflowStages.id, id)))
  }
}

const MAX_STAGES = 40

/**
 * Adds a stage of the client's own. Its type decides how the system treats
 * it (reports, deadline rules), exactly like the default stages.
 */
export async function createStage(
  org: Organization,
  actor: Actor,
  input: CreateStageInput,
): Promise<StageSummary> {
  return db.transaction(async (tx) => {
    const all = await listStages(tx, org.id)
    if (all.length >= MAX_STAGES)
      throw conflict('TOO_MANY_STAGES', `A workflow can have at most ${MAX_STAGES} stages`)
    await assertLabelFree(tx, org.id, input.label)
    if (input.afterStageId && !all.some((s) => s.id === input.afterStageId)) {
      throw notFound('STAGE_NOT_FOUND', 'Stage not found')
    }

    const id = randomUUID()
    await tx.insert(workflowStages).values({
      id,
      organizationId: org.id,
      key: `${CUSTOM_PREFIX}${id.slice(0, 8)}`,
      label: input.label,
      defaultLabel: input.label,
      type: input.type,
      color: input.color,
      commentMode: input.commentMode,
      // A new stage: admins can move tenders on from it to any stage until they set its rules.
      agentNext: [],
      managerNext: null,
      sortOrder: 0,
    })
    const order = all.map((s) => s.id)
    const at = input.afterStageId ? order.indexOf(input.afterStageId) + 1 : order.length
    order.splice(at, 0, id)
    await renumber(tx, org.id, order)

    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'workflow.stage_created',
      entity: 'workflow_stage',
      entityId: id,
      details: { label: input.label, type: input.type },
      ip: actor.ip,
    })
    return toStageSummary(await getStage(tx, org.id, id))
  })
}

/** Puts the stages in a new order. The list must contain every stage exactly once. */
export async function reorderStages(
  org: Organization,
  actor: Actor,
  ids: string[],
): Promise<StageSummary[]> {
  return db.transaction(async (tx) => {
    const all = await listStages(tx, org.id)
    const known = new Set(all.map((s) => s.id))
    if (
      ids.length !== all.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id))
    ) {
      throw badRequest('VALIDATION_ERROR', 'Send every stage exactly once, in the new order')
    }
    await renumber(tx, org.id, ids)
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'workflow.stages_reordered',
      entity: 'organization',
      entityId: org.id,
      ip: actor.ip,
    })
    return (await listStages(tx, org.id)).map(toStageSummary)
  })
}

/**
 * Deletes a stage the client added, if it was never used. A stage that holds
 * tenders or appears in any tender's history can only be hidden, so history
 * and reports stay complete.
 */
export async function deleteStage(org: Organization, actor: Actor, stageId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const stage = await getStage(tx, org.id, stageId)
    if (!stage.key.startsWith(CUSTOM_PREFIX)) {
      throw conflict('STAGE_REQUIRED', 'Default stages cannot be deleted; hide it instead')
    }
    const [inUse] = await tx
      .select({ n: count() })
      .from(tenders)
      .where(
        orgWhere(
          tenders,
          org.id,
          or(eq(tenders.stageId, stage.id), eq(tenders.previousStageId, stage.id)),
        ),
      )
    const [inHistory] = await tx
      .select({ n: count() })
      .from(tenderStageHistory)
      .where(
        orgWhere(
          tenderStageHistory,
          org.id,
          or(
            eq(tenderStageHistory.toStageId, stage.id),
            eq(tenderStageHistory.fromStageId, stage.id),
          ),
        ),
      )
    if ((inUse?.n ?? 0) + (inHistory?.n ?? 0) > 0) {
      throw conflict('STAGE_IN_USE', 'Tenders have been in this stage, so it can only be hidden')
    }
    await tx
      .delete(workflowStages)
      .where(orgWhere(workflowStages, org.id, eq(workflowStages.id, stage.id)))
    await writeAudit(tx, {
      organizationId: org.id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'workflow.stage_deleted',
      entity: 'workflow_stage',
      entityId: stage.id,
      details: { label: stage.label },
      ip: actor.ip,
    })
  })
}
