import { Router } from 'express'
import {
  createTicketSchema,
  PERMISSIONS,
  ticketListQuerySchema,
  updateTicketSchema,
} from '@tdm/shared'
import { db } from '../../db/client'
import { parse } from '../../lib/validate'
import { authenticateTenant, requirePermission, tenantAuth } from '../../middleware/auth'
import { createTicket, getTicket, listTickets, updateTicket } from './service'

export const ticketsRouter = Router()
ticketsRouter.use(authenticateTenant, requirePermission(PERMISSIONS.TICKET_MANAGE))

ticketsRouter.get('/', async (req, res) => {
  res.json(await listTickets(tenantAuth(req), parse(ticketListQuerySchema, req.query)))
})

ticketsRouter.post('/', async (req, res) => {
  res.status(201).json(await createTicket(tenantAuth(req), parse(createTicketSchema, req.body)))
})

ticketsRouter.get('/:id', async (req, res) => {
  res.json(await getTicket(db, tenantAuth(req), req.params.id as string))
})

ticketsRouter.patch('/:id', async (req, res) => {
  res.json(
    await updateTicket(
      tenantAuth(req),
      req.params.id as string,
      parse(updateTicketSchema, req.body),
    ),
  )
})
