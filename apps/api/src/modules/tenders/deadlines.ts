import { and, between, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { DEADLINE_BOUND_TYPES, DEFAULT_CLEANUP_DAYS } from '@tdm/shared'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  notifications,
  organizations,
  tenders,
  tenderStageHistory,
  workflowStages,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { addDays, todayIn } from '../../lib/dates'
import { logger } from '../../lib/logger'
import { registerJob } from '../jobs/queue'
import { notify } from '../notifications/service'
import { getStageByRole } from '../workflow/service'

export interface SweepResult {
  missedDeadline: number
  deleted: number
}

/**
 * Daily deadline rules for one client, using the client's own "today":
 *  1. Tenders still being prepared or reviewed after their deadline move to
 *     the missed-deadline stage ("Not bidded"); their stage is remembered.
 *  2. Tenders still in New with nobody assigned are deleted a few days after
 *     their deadline. Watchlist tenders are kept: someone chose to watch them.
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
          // Reopened by an admin after missing the deadline: leave it be.
          isNull(tenders.deadlineMissedAt),
        ),
      )

    for (const t of overdue) {
      await tx
        .update(tenders)
        .set({
          stageId: missed.id,
          previousStageId: t.stageId,
          stageChangedAt: now,
          deadlineMissedAt: now,
        })
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
          eq(workflowStages.systemRole, 'intake'),
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

/** Reminders start this many days before the deadline. */
export const REMIND_DAYS = 2

const shortDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/**
 * Reminds the assigned person about bids still being prepared or reviewed:
 * once when the deadline is two days (or less) away, and again on the day.
 * Each reminder goes out once per deadline, so an extended deadline is
 * reminded about afresh.
 */
export async function remindDeadlines(
  orgId: string,
  timezone: string,
  now = new Date(),
): Promise<number> {
  const today = todayIn(timezone, now)
  const due = await db
    .select({
      id: tenders.id,
      referenceNo: tenders.referenceNo,
      title: tenders.title,
      deadline: tenders.deadline,
      agentId: tenders.assignedAgentId,
    })
    .from(tenders)
    .innerJoin(workflowStages, eq(workflowStages.id, tenders.stageId))
    .where(
      orgWhere(
        tenders,
        orgId,
        inArray(workflowStages.type, [...DEADLINE_BOUND_TYPES]),
        isNotNull(tenders.assignedAgentId),
        between(tenders.deadline, today, addDays(today, REMIND_DAYS)),
      ),
    )
  if (!due.length) return 0

  // What was already sent recently, so a reminder is not repeated every hour.
  const sent = await db
    .select({ userId: notifications.userId, link: notifications.link, title: notifications.title })
    .from(notifications)
    .where(
      orgWhere(
        notifications,
        orgId,
        inArray(notifications.type, ['tender.deadline_soon', 'tender.deadline_today']),
        gte(notifications.createdAt, new Date(now.getTime() - 14 * 86_400_000)),
      ),
    )
  const seen = new Set(sent.map((n) => `${n.userId}|${n.link}|${n.title}`))

  let reminded = 0
  for (const t of due) {
    const isToday = t.deadline === today
    const date = shortDate(t.deadline)
    const days = Math.round((Date.parse(t.deadline) - Date.parse(today)) / 86_400_000)
    // The title names the deadline, so it is unique per reminder and deadline.
    const title = isToday
      ? `Bid due today (${date}): ${t.referenceNo}`
      : `Bid due on ${date}: ${t.referenceNo}`
    const link = `/tenders/${t.id}`
    const key = `${t.agentId}|${link}|${title}`
    if (seen.has(key)) continue
    await notify(db, {
      organizationId: orgId,
      userId: t.agentId!,
      type: isToday ? 'tender.deadline_today' : 'tender.deadline_soon',
      title,
      body: `${isToday ? 'Closes today' : days === 1 ? 'Closes tomorrow' : `Closes in ${days} days`} · ${t.title}`,
      link,
    })
    seen.add(key)
    reminded++
  }
  return reminded
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
      const reminded = await remindDeadlines(org.id, org.timezone, now)
      if (r.missedDeadline || r.deleted || reminded) {
        logger.info({ orgId: org.id, ...r, reminded }, 'Deadline sweep')
      }
    } catch (err) {
      logger.error({ err, orgId: org.id }, 'Deadline sweep failed')
    }
  }
}

// Queued every hour by the scheduler, so each client is handled soon after its own midnight.
registerJob('deadlines.sweep', async () => {
  await sweepAllOrganizations()
})
