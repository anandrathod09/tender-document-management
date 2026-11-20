import { randomUUID } from 'node:crypto'
import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import { db, type DbOrTx } from '../../db/client'
import { jobs, type Job } from '../../db/schema'
import { isDuplicateKeyError } from '../../lib/errors'
import { logger } from '../../lib/logger'

/**
 * Background jobs stored in MySQL. Enqueue inside the same transaction as
 * the change that causes them, so an email is only sent if the change was
 * saved. Workers in any number of processes claim jobs with
 * FOR UPDATE SKIP LOCKED, so each job runs once.
 */

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>
const handlers = new Map<string, Handler>()

export function registerJob(type: string, handler: Handler) {
  handlers.set(type, handler)
}

export interface EnqueueOptions {
  organizationId?: string | null
  runAt?: Date
  /** A second job with the same key is ignored (for scheduled jobs). */
  dedupeKey?: string
  maxAttempts?: number
}

export async function enqueue(
  conn: DbOrTx,
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<void> {
  try {
    await conn.insert(jobs).values({
      id: randomUUID(),
      organizationId: opts.organizationId ?? null,
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
  } catch (err) {
    if (opts.dedupeKey && isDuplicateKeyError(err)) return
    throw err
  }
}

/** A job left "running" this long belongs to a worker that died; it is picked up again. */
const STALE_AFTER_MS = 15 * 60_000

/** Claims the next due job, or returns null when there is none. */
async function claimNext(): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const now = new Date()
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)),
          and(
            eq(jobs.status, 'running'),
            lte(jobs.lockedAt, new Date(now.getTime() - STALE_AFTER_MS)),
          ),
        ),
      )
      .orderBy(asc(jobs.runAt))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!job) return null
    await tx
      .update(jobs)
      .set({ status: 'running', lockedAt: now, attempts: sql`${jobs.attempts} + 1` })
      .where(eq(jobs.id, job.id))
    return { ...job, status: 'running' as const, lockedAt: now, attempts: job.attempts + 1 }
  })
}

/** Waits 30 s, 1 min, 2 min … up to an hour between attempts. */
const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000)

async function runJob(job: Job): Promise<void> {
  const handler = handlers.get(job.type)
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`)
    await handler(job.payload, job)
    await db
      .update(jobs)
      .set({ status: 'done', finishedAt: new Date(), lastError: null })
      .where(eq(jobs.id, job.id))
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000)
    const final = job.attempts >= job.maxAttempts
    logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, final, err }, 'Job failed')
    await db
      .update(jobs)
      .set(
        final
          ? { status: 'failed', finishedAt: new Date(), lastError: message }
          : {
              status: 'queued',
              runAt: new Date(Date.now() + backoffMs(job.attempts)),
              lastError: message,
            },
      )
      .where(eq(jobs.id, job.id))
  }
}

/**
 * Runs every job that is due now, one after another. Used by the worker
 * loop and by tests. Returns how many jobs ran.
 */
export async function runDueJobs(limit = 50): Promise<number> {
  let ran = 0
  while (ran < limit) {
    const job = await claimNext()
    if (!job) break
    await runJob(job)
    ran++
  }
  return ran
}

/** Polls for jobs every couple of seconds. Returns a stop function. */
export function startWorker(intervalMs = 2_000): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    try {
      await runDueJobs()
    } catch (err) {
      logger.error({ err }, 'Job worker error')
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs)
  }
  timer = setTimeout(() => void tick(), intervalMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
