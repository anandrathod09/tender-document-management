import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { jobs } from '../src/db/schema'
import { enqueue, registerJob, runDueJobs } from '../src/modules/jobs/queue'
import { scheduleRecurringJobs } from '../src/modules/jobs/scheduler'
import { resetDb } from './helpers'

let calls = 0
registerJob('test.flaky', async () => {
  calls++
  throw new Error('temporary problem')
})
registerJob('test.ok', async () => {
  calls++
})

describe('background job queue', () => {
  beforeEach(async () => {
    await resetDb()
    calls = 0
  })

  it('runs due jobs once and marks them done', async () => {
    await enqueue(db, 'test.ok', {})
    expect(await runDueJobs()).toBe(1)
    expect(await runDueJobs()).toBe(0)
    const [job] = await db.select().from(jobs)
    expect(job).toMatchObject({ status: 'done', attempts: 1 })
    expect(calls).toBe(1)
  })

  it('retries a failing job later and gives up after the last attempt', async () => {
    await enqueue(db, 'test.flaky', {}, { maxAttempts: 2 })
    await runDueJobs()
    let [job] = await db.select().from(jobs)
    expect(job).toMatchObject({ status: 'queued', attempts: 1, lastError: 'temporary problem' })
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now())

    // Not due yet: nothing runs.
    expect(await runDueJobs()).toBe(0)
    await db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, job!.id))
    await runDueJobs()
    ;[job] = await db.select().from(jobs)
    expect(job).toMatchObject({ status: 'failed', attempts: 2 })
  })

  it('does not queue the same scheduled job twice', async () => {
    const at = new Date('2027-01-05T10:20:00Z')
    await scheduleRecurringJobs(at)
    await scheduleRecurringJobs(new Date('2027-01-05T10:50:00Z'))
    const rows = await db.select({ type: jobs.type }).from(jobs)
    expect(rows.map((r) => r.type).sort()).toEqual([
      'billing.daily',
      'deadlines.sweep',
      'files.purge',
    ])
    await scheduleRecurringJobs(new Date('2027-01-05T11:05:00Z'))
    expect(await db.select().from(jobs)).toHaveLength(4) // a new hour adds one more sweep
  })
})
