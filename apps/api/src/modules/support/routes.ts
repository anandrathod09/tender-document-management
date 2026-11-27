import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  publicTicketSchema,
  supportLookupSchema,
  type PublicTicketResult,
  type SupportPageInfo,
} from '@tdm/shared'
import { env } from '../../config/env'
import { parse } from '../../lib/validate'
import { assertTenant, requireTenant } from '../../middleware/workspace'
import { lookupAssets, raiseTicket } from './service'
import { supportSettingsOf } from './settings'

/**
 * The public support page (no sign-in). Customers look up a product by its
 * serial number, see the warranty, and raise a service request. Only works
 * when the client has turned the page on in Settings.
 */
export const supportRouter = Router()
supportRouter.use(requireTenant)

const skipInTests = () => env.NODE_ENV === 'test'
const lookupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many searches. Try again in a few minutes.' },
  },
})
const ticketLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many requests raised. Try again later.' },
  },
})

supportRouter.get('/', (req, res) => {
  const org = assertTenant(req)
  const info: SupportPageInfo = { enabled: supportSettingsOf(org).enabled, name: org.name }
  res.json(info)
})

supportRouter.get('/assets', lookupLimiter, async (req, res) => {
  const { serial } = parse(supportLookupSchema, req.query)
  res.json(await lookupAssets(assertTenant(req), serial))
})

supportRouter.post('/tickets', ticketLimiter, async (req, res) => {
  const input = parse(publicTicketSchema, req.body)
  // The hidden "website" box is only filled in by bots: look successful, save nothing.
  if (input.website) {
    const fake: PublicTicketResult = { ticketNo: 'TKT-0000', warranty: 'in' }
    res.status(201).json(fake)
    return
  }
  res.status(201).json(await raiseTicket(assertTenant(req), input))
})
