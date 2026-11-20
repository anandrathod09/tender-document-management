import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AssetPage,
  InstallationReport,
  ReportSummary,
  StageSummary,
  TicketDetail,
} from '@tdm/shared'
import { addDays } from '../src/lib/dates'
import {
  allowAnyMove,
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  resetDb,
  setupClient,
} from './helpers'
import { addUser, importFile, listAll, stagesOf, t247Row, today, workbook } from './tender-helpers'

const ACME = hostOf('acme')

/** Reads a binary response body (PDF, Excel). */
const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c))
    r.on('end', () => cb(null, Buffer.concat(chunks)))
  })

describe('installation reports, assets, tickets and reports', () => {
  let adminToken: string
  let tenderId: string
  let stages: Record<string, StageSummary>
  let engineer: { id: string; token: string }

  const put = (body: object, token = adminToken) =>
    request(app)
      .put(`/api/tenders/${tenderId}/installation-report`)
      .set('Host', ACME)
      .set(bearer(token))
      .send(body)

  async function win(id = tenderId) {
    await request(app)
      .post(`/api/tenders/${id}/move`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ stageId: stages.won!.id, awardAmount: 980000, awardNumber: 'PO-55' })
  }

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
    await allowAnyMove('acme')
    await importFile(ACME, adminToken, await workbook({ S: [t247Row('PWD/1'), t247Row('PWD/2')] }))
    tenderId = (await listAll(ACME, adminToken)).items.find((t) => t.referenceNo === 'PWD/1')!.id
    stages = await stagesOf(ACME, adminToken)
    engineer = await addUser(ACME, adminToken, 'engineer', 'eng@acme.test')
  })

  const report = (units: object[], extra: object = {}) => ({
    poNumber: 'PO-55',
    poDate: '2026-11-01',
    reportDate: '2026-11-10',
    customerName: 'District Hospital, Nashik',
    consignees: [
      {
        name: 'Stores Officer',
        designation: 'Storekeeper',
        engineerId: engineer.id,
        status: 'execution',
        assets: units,
      },
    ],
    ...extra,
  })

  it('only takes an installation report once the tender is won', async () => {
    const early = await put(report([]))
    expect(early.body.error.code).toBe('NOT_WON')
  })

  it('saves consignees and units, keeps unit ids on later saves, and gives the engineer access', async () => {
    await win()
    const first = await put(
      report([
        {
          itemName: 'Desktop computer',
          serialNumber: 'SN-1',
          installStatus: 'installed',
          installedOn: '2026-11-12',
          warrantyMonths: 36,
        },
        {
          itemName: 'Desktop computer',
          serialNumber: 'SN-2',
          installStatus: 'pending',
          warrantyMonths: 36,
        },
      ]),
    )
    expect(first.status).toBe(200)
    const saved = first.body as InstallationReport
    expect(saved.consignees[0]!.assets.map((a) => a.serialNumber)).toEqual(['SN-1', 'SN-2'])
    expect(saved.consignees[0]!.engineer).toEqual({ id: engineer.id, name: 'eng' })

    // The engineer now sees the tender and was notified.
    expect(
      (
        await request(app)
          .get(`/api/tenders/${tenderId}`)
          .set('Host', ACME)
          .set(bearer(engineer.token))
      ).status,
    ).toBe(200)
    const notes = await request(app)
      .get('/api/notifications')
      .set('Host', ACME)
      .set(bearer(engineer.token))
    expect(notes.body.items[0].type).toBe('installation.assigned')
    // …but not other tenders.
    const other = (await listAll(ACME, adminToken)).items.find((t) => t.referenceNo === 'PWD/2')!.id
    expect(
      (
        await request(app)
          .get(`/api/tenders/${other}`)
          .set('Host', ACME)
          .set(bearer(engineer.token))
      ).status,
    ).toBe(404)

    // Engineer updates unit 2 on site; unit ids stay the same; the removed unit is gone.
    const c = saved.consignees[0]!
    const second = await put(
      {
        ...report([]),
        consignees: [
          {
            ...c,
            engineerId: engineer.id,
            assets: [{ ...c.assets[1]!, installStatus: 'installed', installedOn: '2026-11-15' }],
          },
        ],
      },
      engineer.token,
    )
    expect(second.status).toBe(200)
    const after = (second.body as InstallationReport).consignees[0]!
    expect(after.id).toBe(c.id)
    expect(after.assets).toHaveLength(1)
    expect(after.assets[0]).toMatchObject({ id: c.assets[1]!.id, installStatus: 'installed' })
  })

  it('refuses units or consignees that belong to another report', async () => {
    await win()
    const res = await put(report([{ id: crypto.randomUUID(), itemName: 'Printer' }]))
    expect(res.body.error.code).toBe('ASSET_NOT_FOUND')
  })

  it('prints the installation report as a PDF', async () => {
    await win()
    await put(
      report([{ itemName: 'Laser printer', serialNumber: 'PR-9', installStatus: 'installed' }]),
    )
    const res = await binary(
      request(app)
        .get(`/api/tenders/${tenderId}/installation-report/pdf`)
        .set('Host', ACME)
        .set(bearer(adminToken)),
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    const pdf = await PDFDocument.load(res.body as Buffer)
    expect(pdf.getPageCount()).toBe(1)
  })

  it('lists installed units with warranty status from the installation date', async () => {
    await win()
    const t = today()
    await put(
      report([
        {
          itemName: 'Old UPS',
          serialNumber: 'U-1',
          installStatus: 'installed',
          installedOn: addDays(t, -400),
          warrantyMonths: 12,
        },
        {
          itemName: 'Monitor',
          serialNumber: 'M-1',
          installStatus: 'installed',
          installedOn: addDays(t, -350),
          warrantyMonths: 12,
        },
        {
          itemName: 'Server',
          serialNumber: 'S-1',
          installStatus: 'installed',
          installedOn: t,
          warrantyMonths: 36,
        },
        // No installation date: the warranty runs from the report date.
        { itemName: 'Switch', serialNumber: 'W-1', warrantyMonths: 0 },
      ]),
    )
    const list = await request(app).get('/api/assets').set('Host', ACME).set(bearer(adminToken))
    const byItem = Object.fromEntries((list.body as AssetPage).items.map((a) => [a.itemName, a]))
    expect(byItem['Old UPS']!.warrantyStatus).toBe('expired')
    expect(byItem['Monitor']!.warrantyStatus).toBe('expiring_30')
    expect(byItem['Server']!).toMatchObject({
      warrantyStatus: 'active',
      warrantyEnd: addDays(t, 0).replace(/^(\d{4})/, (y) => String(+y + 3)),
    })
    expect(byItem['Switch']!.warrantyStatus).toBe('not_set')

    const expired = await request(app)
      .get('/api/assets?warranty=expired')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect((expired.body as AssetPage).items.map((a) => a.serialNumber)).toEqual(['U-1'])
    const search = await request(app)
      .get('/api/assets?q=S-1')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect((search.body as AssetPage).total).toBe(1)
  })

  it('tracks a service ticket from complaint to resolution', async () => {
    await win()
    const saved = (
      await put(report([{ itemName: 'Laptop', serialNumber: 'L-77', installStatus: 'installed' }]))
    ).body as InstallationReport
    const assetId = saved.consignees[0]!.assets[0]!.id

    const created = await request(app)
      .post('/api/tickets')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({
        title: 'Battery drains fast',
        description: 'Lasts 2 hours',
        priority: 'high',
        assetId,
        assignedTo: engineer.id,
      })
    expect(created.status).toBe(201)
    const ticket = created.body as TicketDetail
    // Picking the unit fills in the tender and the customer.
    expect(ticket).toMatchObject({
      number: 1,
      status: 'new',
      customerName: 'District Hospital, Nashik',
      tender: { id: tenderId },
    })

    const second = await request(app)
      .post('/api/tickets')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ title: 'Another one', description: 'x' })
    expect(second.body.number).toBe(2)

    const noNotes = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(engineer.token))
      .send({ status: 'resolved' })
    expect(noNotes.body.error.details[0].field).toBe('resolutionNotes')
    const resolved = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(engineer.token))
      .send({
        status: 'resolved',
        resolutionNotes: 'Battery replaced under warranty',
        note: 'Visited site',
      })
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      resolutionNotes: 'Battery replaced under warranty',
    })
    expect(resolved.body.resolvedAt).toBeTruthy()

    await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'closed', satisfaction: 5 })
    const reopenBlocked = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'in_progress' })
    expect(reopenBlocked.body.error.code).toBe('TICKET_CLOSED')
    const reopened = await request(app)
      .patch(`/api/tickets/${ticket.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'reopened' })
    expect(reopened.body).toMatchObject({
      status: 'reopened',
      resolvedAt: null,
      satisfaction: null,
    })
    expect((reopened.body as TicketDetail).updates.map((u) => u.status)).toEqual([
      'new',
      'resolved',
      'closed',
      'reopened',
    ])

    const open = await request(app)
      .get('/api/tickets?status=open')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(open.body.total).toBe(2)
    const byNumber = await request(app)
      .get('/api/tickets?q=TKT-0002')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(byNumber.body.items.map((t: { number: number }) => t.number)).toEqual([2])

    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect(
      (await request(app).get('/api/tickets').set('Host', ACME).set(bearer(agent.token))).status,
    ).toBe(403)
  })

  it('reports monthly results and per-agent performance, and exports Excel files', async () => {
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    await request(app)
      .post(`/api/tenders/${tenderId}/assign`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentId: agent.id })
    await request(app)
      .post(`/api/tenders/${tenderId}/move`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ stageId: stages.submitted!.id })
    await win()

    const t = today()
    const summary = await request(app)
      .get('/api/reports/summary')
      .query({ from: addDays(t, -60), to: t })
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(summary.status).toBe(200)
    const s = summary.body as ReportSummary
    expect(s.totals).toMatchObject({
      added: 2,
      submitted: 1,
      won: 1,
      lost: 0,
      wonValue: 980000,
      winRate: 1,
    })
    expect(s.monthly.at(-1)).toMatchObject({ month: t.slice(0, 7), won: 1 })
    expect(s.agents).toEqual([
      expect.objectContaining({ agent: { id: agent.id, name: 'agent' }, assigned: 1, won: 1 }),
    ])

    const xlsx = await binary(
      request(app)
        .get('/api/reports/export/tenders.xlsx?stageType=won')
        .set('Host', ACME)
        .set(bearer(adminToken)),
    )
    expect(xlsx.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer)
    const sheet = wb.worksheets[0]!
    expect(sheet.rowCount).toBe(2) // header + the one won tender
    expect(sheet.getRow(2).getCell(1).value).toBe('PWD/1')

    // Agents can view reports (their own tenders) but not export.
    expect(
      (
        await request(app)
          .get('/api/reports/export/tenders.xlsx')
          .set('Host', ACME)
          .set(bearer(agent.token))
      ).status,
    ).toBe(403)
    const agentView = await request(app)
      .get('/api/reports/summary')
      .query({ from: addDays(t, -60), to: t })
      .set('Host', ACME)
      .set(bearer(agent.token))
    expect(agentView.body.totals.added).toBe(1)
  })

  it('keeps installation data, assets and tickets inside each client', async () => {
    await win()
    const saved = (await put(report([{ itemName: 'Laptop', serialNumber: 'L-1' }])))
      .body as InstallationReport
    const other = await setupClient(await loginOwner(), await createPlan(), 'other')
    const B = hostOf('other')

    expect(
      (
        await request(app)
          .get(`/api/tenders/${tenderId}/installation-report`)
          .set('Host', B)
          .set(bearer(other.adminToken))
      ).status,
    ).toBe(404)
    expect(
      (await request(app).get('/api/assets').set('Host', B).set(bearer(other.adminToken))).body
        .total,
    ).toBe(0)
    const ticket = await request(app)
      .post('/api/tickets')
      .set('Host', B)
      .set(bearer(other.adminToken))
      .send({ title: 'Their unit?', description: 'x', assetId: saved.consignees[0]!.assets[0]!.id })
    expect(ticket.body.error.code).toBe('ASSET_NOT_FOUND')
  })
})
