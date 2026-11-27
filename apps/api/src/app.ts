import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env'
import { logger } from './lib/logger'
import { errorHandler, notFoundHandler } from './middleware/errors'
import { workspaceContext } from './middleware/workspace'
import { accountRouter } from './modules/account/routes'
import { authRouter } from './modules/auth/routes'
import { billingRouter, ownerBillingRouter, razorpayWebhookHandler } from './modules/billing/routes'
import { companiesRouter } from './modules/companies/routes'
import { lettersRouter } from './modules/letters/routes'
import { mailOutboxRouter } from './modules/dev/mail-outbox'
import { filesRouter, libraryRouter } from './modules/files/routes'
import { notificationsRouter } from './modules/notifications/routes'
import { assetsRouter, installationRouter } from './modules/installation/routes'
import { ownerRouter } from './modules/owner/routes'
import { reportsRouter } from './modules/reports/routes'
import { supportRouter } from './modules/support/routes'
import { ticketsRouter } from './modules/tickets/routes'
import { importProfilesRouter, tendersRouter } from './modules/tenders/routes'
import { rolesRouter, usersRouter } from './modules/users/routes'
import { workflowRouter } from './modules/workflow/routes'
import { workspaceRouter } from './modules/workspace/routes'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  // nginx runs on the same server; trust it for the client IP and original host.
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(helmet())
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }))
  // Before the JSON parser: the webhook signature covers the raw body.
  app.post('/api/billing/webhook', ...razorpayWebhookHandler)
  // Files never come through JSON bodies (uploads use multipart), so keep this small.
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  const api = express.Router()
  api.use(workspaceContext)
  // Local development only: the emails the app would have sent.
  if (env.NODE_ENV === 'development') api.use('/dev/mail', mailOutboxRouter)
  api.use('/workspace', workspaceRouter)
  api.use('/auth', authRouter)
  api.use('/account', accountRouter)
  api.use('/users', usersRouter)
  api.use('/roles', rolesRouter)
  // Plans and payments first; the rest of the owner panel after.
  api.use('/owner', ownerBillingRouter)
  api.use('/owner', ownerRouter)
  api.use('/billing', billingRouter)
  api.use('/workflow', workflowRouter)
  // More specific path first, so it is not handled by the general tender routes.
  api.use('/tenders/:id/installation-report', installationRouter)
  api.use('/tenders', tendersRouter)
  api.use('/import-profiles', importProfilesRouter)
  api.use('/companies', companiesRouter)
  api.use('/letter-templates', lettersRouter)
  api.use('/library', libraryRouter)
  api.use('/files', filesRouter)
  api.use('/notifications', notificationsRouter)
  api.use('/assets', assetsRouter)
  api.use('/tickets', ticketsRouter)
  // Public: customers raise service requests without signing in.
  api.use('/support', supportRouter)
  api.use('/reports', reportsRouter)
  app.use('/api', api)

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
