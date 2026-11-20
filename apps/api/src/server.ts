import { createApp } from './app'
import { env } from './config/env'
import { pool } from './db/client'
import { logger } from './lib/logger'
import { startWorker } from './modules/jobs/queue'
import { startScheduler } from './modules/jobs/scheduler'

const app = createApp()
const server = app.listen(env.PORT, () => {
  logger.info(`API listening on port ${env.PORT} (${env.NODE_ENV}), base domain ${env.BASE_DOMAIN}`)
})

// Background jobs (emails, compliance PDFs, deadline rules) run in this
// process unless RUN_WORKER=false, e.g. when a separate worker is used.
const stops: (() => void)[] = []
if (env.RUN_WORKER) {
  stops.push(startScheduler(), startWorker())
  logger.info('Background job worker started')
}

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`)
  for (const stop of stops) stop()
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
