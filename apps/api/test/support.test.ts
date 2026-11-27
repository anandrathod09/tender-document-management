import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  InstallationReport,
  NotificationList,
  PublicAsset,
  StageSummary,
  TicketDetail,
  TicketPage,
} from '@tdm/shared'
import { addDays } from '../src/lib/dates'
import { testOutbox } from '../src/lib/mailer'
import {
  allowAnyMove,
  app,
  bearer,
  createOwner,
  createPlan,
  drainJobs,
  hostOf,
  loginOwner,
  resetDb,
  setupClient,
} from './helpers'
import { addUser, importFile, listAll, stagesOf, t247Row, today, workbook } from './tender-helpers'

const ACME = hostOf('acme')
const BRAVO = hostOf('bravo')

describe('public support page', () => {
  let adminToken: string
  let bravoToken: string
  let engineer: { id: string; token: string }
  let assets: Record<string, string>

  const settings = (body: object, token = adminToken, host = ACME) =>
    request(app).patch('/api/workspace/settings').set('Host', host).set(bearer(token)).send(body)
  const lookup = (serial: string, host = ACME) =>
    request(app).get('/api/support/assets').query({ serial }).set('Host', host)
  const raise = (body: object, host = ACME) =>
    request(app).post('/api/support/tickets').set('Host', host).send(body)

  const customer = {
    contactName: 'Ravi Patil',
    contactPhone: '+91 98220 12345',
    contactEmail: 'ravi@hospital.test',
    description: 'The screen stays black after switching on.',
  }

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    const ownerToken = await loginOwner()
    const plan = await createPlan()
    adminToken = (await setupClient(ownerToken, plan, 'acme')).adminToken
    bravoToken = (await setupClient(ownerToken, plan, 'bravo')).adminToken
    await allowAnyMove('acme')
    await importFile(ACME, adminToken, await workbook({ S: [t247Row('PWD/1')] }))
    const tenderId = (await listAll(ACME, adminToken)).items[0]!.id
    const stages: Record<string, StageSummary> = await stagesOf(ACME, adminToken)
    await request(app)
      .post(`/api/tenders/${tenderId}/move`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ stageId: stages.won!.id, awardAmount: 50000, awardNumber: 'PO-9' })
    engineer = await addUser(ACME, adminToken, 'engineer', 'eng@acme.test')

    const t = today()
    const saved = await request(app)
      .put(`/api/tenders/${tenderId}/installation-report`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({
        reportDate: t,
        customerName: 'District Hospital',
        consignees: [
          {
            name: 'Stores Officer',
            engineerId: engineer.id,
            items: [
              {
                itemName: 'Desktop',
                serialType: 'split',
                warrantyMonths: 36,
                units: [{ monitorSerial: 'MON-1', cpuSerial: 'CPU-1', installedOn: t }],
              },
              {
                itemName: 'Old printer',
                warrantyMonths: 12,
                units: [{ serialNumber: 'PRN-1', installedOn: addDays(t, -400) }],
              },
            ],
          },
        ],
      })
    expect(saved.status).toBe(200)
    const report = saved.body as InstallationReport
    assets = Object.fromEntries(
      report.consignees[0]!.items.map((i) => [i.itemName, i.units[0]!.id]),
    )
  })

  it('stays hidden until the admin turns it on', async () => {
    const info = await request(app).get('/api/support').set('Host', ACME)
    expect(info.body).toEqual({ enabled: false, name: 'acme Pvt Ltd' })
    expect((await lookup('PRN-1')).body.error.code).toBe('SUPPORT_PAGE_OFF')
    expect(
      (await raise({ ...customer, serial: 'PRN-1', assetId: assets['Old printer'] })).status,
    ).toBe(404)

    // Only the admin can turn it on.
    expect((await settings({ supportPage: true }, engineer.token)).status).toBe(403)
    const on = await settings({ supportPage: true, supportEmails: ['Service@Acme.test'] })
    expect(on.body).toMatchObject({ supportPage: true, supportEmails: ['service@acme.test'] })
    expect((await request(app).get('/api/support').set('Host', ACME)).body.enabled).toBe(true)
  })

  it('finds a product by any of its serial numbers and shows only the warranty', async () => {
    await settings({ supportPage: true })
    const found = (await lookup(' cpu-1 ')).body as PublicAsset[]
    expect(found).toHaveLength(1)
    expect(found[0]).toEqual({
      id: assets['Desktop'],
      itemName: 'Desktop',
      serialNumber: 'CPU-1',
      customerName: 'District Hospital',
      installedOn: today(),
      warrantyEnd: today().replace(/^(\d{4})/, (y) => String(+y + 3)),
      daysLeft: expect.any(Number),
      warranty: 'in',
    })
    const old = (await lookup('PRN-1')).body as PublicAsset[]
    expect(old[0]).toMatchObject({ warranty: 'out' })
    expect((await lookup('NOPE')).body).toEqual([])
    // Another client's page never finds this client's products.
    await settings({ supportPage: true }, bravoToken, BRAVO)
    expect((await lookup('CPU-1', BRAVO)).body).toEqual([])
  })

  it('turns a request into a ticket, tells the team and emails the admins', async () => {
    await settings({ supportPage: true })
    // Send the invitations from setup first, so only the new emails are left.
    await drainJobs()
    testOutbox.length = 0
    const res = await raise({ ...customer, serial: 'PRN-1', assetId: assets['Old printer'] })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ticketNo: 'TKT-0001', warranty: 'out' })

    const list = (await request(app).get('/api/tickets').set('Host', ACME).set(bearer(adminToken)))
      .body as TicketPage
    expect(list.items).toHaveLength(1)
    const ticket = (
      await request(app)
        .get(`/api/tickets/${list.items[0]!.id}`)
        .set('Host', ACME)
        .set(bearer(adminToken))
    ).body as TicketDetail
    expect(ticket).toMatchObject({
      source: 'support_page',
      title: 'Old printer (PRN-1)',
      customerName: 'District Hospital',
      contactName: 'Ravi Patil',
      contactEmail: 'ravi@hospital.test',
      asset: { id: assets['Old printer'] },
      createdBy: null,
      status: 'new',
    })
    expect(ticket.updates[0]!.by).toBeNull()
    expect(ticket.updates[0]!.note).toMatch(/support page.*Out of warranty/)

    // The engineer (who handles tickets) sees it in the bell; the email goes to the admin only.
    const bell = (
      await request(app).get('/api/notifications').set('Host', ACME).set(bearer(engineer.token))
    ).body as NotificationList
    expect(bell.items[0]!.title).toBe('New support request TKT-0001')
    await drainJobs()
    expect(testOutbox.map((m) => m.to)).toEqual(['admin@acme.test'])
    expect(testOutbox[0]!).toMatchObject({
      subject: 'New support request TKT-0001: Old printer',
      replyTo: 'ravi@hospital.test',
    })
    expect(testOutbox[0]!.text).toContain('The screen stays black')

    // Staff can work on it like any other ticket.
    const moved = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(engineer.token))
      .send({ status: 'in_progress', note: 'Called the customer' })
    expect(moved.status).toBe(200)
  })

  it('emails the chosen addresses instead of the admins', async () => {
    await settings({ supportPage: true, supportEmails: ['service@acme.test', 'boss@acme.test'] })
    // Send the invitations from setup first, so only the new emails are left.
    await drainJobs()
    testOutbox.length = 0
    await raise({ ...customer, contactEmail: '', serial: 'MON-1', assetId: assets['Desktop'] })
    await drainJobs()
    expect(testOutbox.map((m) => m.to).sort()).toEqual(['boss@acme.test', 'service@acme.test'])
    expect(testOutbox[0]!.replyTo).toBeUndefined()
  })

  it('checks the form, the product, and ignores bots', async () => {
    await settings({ supportPage: true })
    const bad = await raise({
      serial: 'PRN-1',
      assetId: assets['Old printer'],
      contactName: '',
      contactPhone: '12',
      description: 'short',
    })
    expect(bad.status).toBe(400)
    const fields = (bad.body.error.details as { field: string }[]).map((d) => d.field).sort()
    expect(fields).toEqual(['contactName', 'contactPhone', 'description'])

    // The serial must belong to the unit that was picked.
    const mismatch = await raise({ ...customer, serial: 'PRN-1', assetId: assets['Desktop'] })
    expect(mismatch.body.error.code).toBe('ASSET_NOT_FOUND')

    // A bot filling the hidden box gets a normal-looking answer and nothing is saved.
    const bot = await raise({
      ...customer,
      serial: 'PRN-1',
      assetId: assets['Old printer'],
      website: 'spam.example',
    })
    expect(bot.status).toBe(201)
    const list = (await request(app).get('/api/tickets').set('Host', ACME).set(bearer(adminToken)))
      .body as TicketPage
    expect(list.total).toBe(0)
  })
})
