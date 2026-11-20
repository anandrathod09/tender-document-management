import { db } from '../../db/client'
import { logger } from '../../lib/logger'
import { runBillingChecks } from '../billing/service'
import { purgeDeletedFiles } from '../files/service'
import '../tenders/deadlines'
import { enqueue, registerJob } from './queue'

registerJob('files.purge', async () => {
  const n = await purgeDeletedFiles()
  if (n) logger.info({ purged: n }, 'Purged deleted files')
})

registerJob('billing.daily', async () => {
  const r = await runBillingChecks()
  if (r.reminded || r.suspended) logger.info(r, 'Billing checks')
})

/**
 * Queues the recurring jobs. Every API process runs this, but each job has
 * a key per hour (or day), so it is queued and run only once.
 */
export async function scheduleRecurringJobs(now = new Date()): Promise<void> {
  const hour = now.toISOString().slice(0, 13) // 2026-11-19T07
  const day = now.toISOString().slice(0, 10)
  await enqueue(db, 'deadlines.sweep', {}, { dedupeKey: `deadlines.sweep:${hour}`, maxAttempts: 3 })
  await enqueue(db, 'files.purge', {}, { dedupeKey: `files.purge:${day}`, maxAttempts: 3 })
  await enqueue(db, 'billing.daily', {}, { dedupeKey: `billing.daily:${day}`, maxAttempts: 3 })
}

export function startScheduler(): () => void {
  const tick = () =>
    scheduleRecurringJobs().catch((err) => logger.error({ err }, 'Scheduler error'))
  void tick()
  const timer = setInterval(() => void tick(), 5 * 60_000)
  return () => clearInterval(timer)
}
