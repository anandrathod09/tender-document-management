import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { DEADLINE_BOUND_TYPES } from '@tdm/shared'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { organizations, tenders, tenderStageHistory, workflowStages } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { addDays, todayIn } from '../../lib/dates'
import { logger } from '../../lib/logger'
import { registerJob } from '../jobs/queue'
import { getStageByRole } from '../workflow/service'

/** Days after the deadline before an unassigned open tender is deleted (client setting). */
const DEFAULT_CLEANUP_DAYS = 3

export interface SweepResult {
  missedDeadline: number
  deleted: number
}

/**
 * Daily deadline rules for one client, using the client's own "today":
 *  1. Tenders still being prepared or reviewed after their deadline move to
 *     the missed-deadline stage ("Not bidded"); their stage is remembered.
 *  2. Open, unassigned tenders are deleted a few days after their deadline.
 */
export async function sweepOrganization(
  orgId: string,
  timezone: string,
  cleanupDays: number,
  now = new Date(),
): Promise<SweepResult> {
  const today = todayIn(timezone, now)
  return db.transaction(async (tx) => {
    const missed = await getStageByRole(tx, orgId, 'missed_deadline')

    const overdue = await tx
      .select({ id: tenders.id, stageId: tenders.stageId })
      .from(tenders)
      .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
      .where(
        orgWhere(
          tenders,
          orgId,
          inArray(workflowStages.type, [...DEADLINE_BOUND_TYPES]),
          lt(tenders.deadline, today),
        ),
      )

    for (const t of overdue) {
      await tx
        .update(tenders)
        .set({ stageId: missed.id, previousStageId: t.stageId, stageChangedAt: now })
        .where(orgWhere(tenders, orgId, eq(tenders.id, t.id)))
    }
    if (overdue.length) {
      await tx.insert(tenderStageHistory).values(
        overdue.map((t) => ({
          organizationId: orgId,
          tenderId: t.id,
          fromStageId: t.stageId,
          toStageId: missed.id,
          comment: 'Deadline passed before the bid was submitted',
          changedBy: null,
        })),
      )
    }

    const stale = await tx
      .select({ id: tenders.id })
      .from(tenders)
      .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
      .where(
        orgWhere(
          tenders,
          orgId,
          eq(workflowStages.type, 'open'),
          isNull(tenders.assignedAgentId),
          lt(tenders.deadline, addDays(today, -cleanupDays)),
        ),
      )
    if (stale.length) {
      await tx.delete(tenders).where(
        orgWhere(
          tenders,
          orgId,
          inArray(
            tenders.id,
            stale.map((s) => s.id),
          ),
        ),
      )
    }

    if (overdue.length || stale.length) {
      await writeAudit(tx, {
        organizationId: orgId,
        actorType: 'system',
        actorId: null,
        action: 'tenders.deadline_sweep',
        entity: 'organization',
        entityId: orgId,
        details: { today, missedDeadline: overdue.length, deleted: stale.length },
      })
    }
    return { missedDeadline: overdue.length, deleted: stale.length }
  })
}

/** Runs the deadline rules for every active client. */
export async function sweepAllOrganizations(now = new Date()): Promise<void> {
  const orgs = await db
    .select({
      id: organizations.id,
      timezone: organizations.timezone,
      settings: organizations.settings,
    })
    .from(organizations)
    .where(and(inArray(organizations.status, ['trial', 'active'])))
  for (const org of orgs) {
    const days = Number(org.settings?.expiredCleanupDays ?? DEFAULT_CLEANUP_DAYS)
    try {
      const r = await sweepOrganization(
        org.id,
        org.timezone,
        Number.isFinite(days) ? days : DEFAULT_CLEANUP_DAYS,
        now,
      )
      if (r.missedDeadline || r.deleted) logger.info({ orgId: org.id, ...r }, 'Deadline sweep')
    } catch (err) {
      logger.error({ err, orgId: org.id }, 'Deadline sweep failed')
    }
  }
}

// Queued every hour by the scheduler, so each client is handled soon after its own midnight.
registerJob('deadlines.sweep', async () => {
  await sweepAllOrganizations()
})
