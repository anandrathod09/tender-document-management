import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { tenders } from '../src/db/schema'
import { parseDeadline } from '../src/modules/tenders/excel'
import {
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  resetDb,
  setupClient,
} from './helpers'
import { importFile, inDays, indian, listAll, stagesOf, t247Row, workbook } from './tender-helpers'

const ACME = hostOf('acme')

describe('parseDeadline', () => {
  const cell = (value: unknown) => ({ value, text: String(value) }) as never
  it('reads the formats Tender247 and Excel use', () => {
    expect(parseDeadline(cell('09-03-2027'))).toBe('2027-03-09')
    expect(parseDeadline(cell('9/3/2027 17:00'))).toBe('2027-03-09')
    expect(parseDeadline(cell('2027-03-09'))).toBe('2027-03-09')
    expect(parseDeadline(cell('09-Mar-2027'))).toBe('2027-03-09')
    expect(parseDeadline(cell(new Date(Date.UTC(2027, 2, 9))))).toBe('2027-03-09')
    expect(parseDeadline(cell(46455))).toBe('2027-03-09') // Excel serial number
  })
  it('refuses impossible or unreadable dates', () => {
    expect(parseDeadline(cell('31-02-2027'))).toBeNull()
    expect(parseDeadline(cell('next week'))).toBeNull()
    expect(parseDeadline(cell(''))).toBeNull()
  })
})

describe('Excel import', () => {
  let adminToken: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
  })

  it('imports GeM and Non-GeM sheets and skips expired or incomplete rows', async () => {
    const file = await workbook({
      'GeM Tenders': [
        { ...t247Row('GEM/2027/B/1'), Value: '₹ 2,50,000', 'ESTIMATED COST': null },
        t247Row('GEM/2027/B/2', { Deadline: indian(inDays(-1)) }), // expired yesterday
      ],
      'Non-GeM Tenders': [
        t247Row('PWD/101'),
        t247Row('PWD/102', { Deadline: indian(inDays(0)) }), // closes today: still open
        t247Row('', { 'T247 ID': null }), // no reference number and no T247 ID
        t247Row('PWD/103', { Deadline: 'soon' }), // unreadable deadline
        t247Row('PWD/101'), // twice in the file
        t247Row('', { 'T247 ID': '88001' }), // no reference: the T247 ID stands in
      ],
    })
    const res = await importFile(ACME, adminToken, file)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      layout: 'Tender247 export',
      created: 4,
      updated: 0,
      skipped: { expired: 1, noReference: 1, duplicateInFile: 1, invalid: 1 },
    })
    expect(res.body.issues.map((i: { row: number }) => i.row).sort()).toEqual([5, 6])

    const page = await listAll(ACME, adminToken)
    expect(page.total).toBe(4)
    expect(page.items.find((t) => t.referenceNo === 'T247-88001')).toMatchObject({
      sourceTenderId: '88001',
    })
    const gem = page.items.find((t) => t.referenceNo === 'GEM/2027/B/1')!
    expect(gem).toMatchObject({
      sheetType: 'gem',
      estimatedCost: 250000,
      emd: 30000,
      stage: { label: 'New' },
    })
    const pwd = page.items.find((t) => t.referenceNo === 'PWD/101')!
    expect(pwd).toMatchObject({
      sheetType: 'non_gem',
      estimatedCost: 1500000,
      deadline: inDays(10),
    })
  })

  it('re-uploading refreshes the data, records what changed and keeps the stage', async () => {
    await importFile(
      ACME,
      adminToken,
      await workbook({ Sheet1: [t247Row('PWD/101'), t247Row('PWD/102')] }),
    )
    const stages = await stagesOf(ACME, adminToken)
    const first = (await listAll(ACME, adminToken)).items.find((t) => t.referenceNo === 'PWD/101')!
    await request(app)
      .post(`/api/tenders/${first.id}/move`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ stageId: stages.watchlist!.id })

    const res = await importFile(
      ACME,
      adminToken,
      await workbook({
        Sheet1: [
          t247Row('PWD/101', { EMD: 45000, Deadline: indian(inDays(20)) }),
          t247Row('PWD/102'),
        ],
      }),
    )
    expect(res.body).toMatchObject({ created: 0, updated: 1, unchanged: 1 })

    const detail = await request(app)
      .get(`/api/tenders/${first.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(detail.body.stage.label).toBe('Watchlist')
    expect(detail.body.emd).toBe(45000)
    expect(detail.body.excelUpdate.changes).toEqual(
      expect.arrayContaining([
        { field: 'emd', label: 'EMD', from: 30000, to: 45000 },
        { field: 'deadline', label: 'Deadline', from: inDays(10), to: inDays(20) },
      ]),
    )
  })

  it('a missed-deadline tender returns to its earlier stage when the deadline is extended', async () => {
    await importFile(ACME, adminToken, await workbook({ Sheet1: [t247Row('PWD/101')] }))
    const stages = await stagesOf(ACME, adminToken)
    const [t] = (await listAll(ACME, adminToken)).items
    // Simulate: it was in "Price review" when its deadline passed.
    await db
      .update(tenders)
      .set({ stageId: stages['not-bidded']!.id, previousStageId: stages['price-review']!.id })
      .where(eq(tenders.id, t!.id))

    const res = await importFile(
      ACME,
      adminToken,
      await workbook({ Sheet1: [t247Row('PWD/101', { Deadline: indian(inDays(30)) })] }),
    )
    expect(res.body.restored).toBe(1)
    const detail = await request(app)
      .get(`/api/tenders/${t!.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(detail.body.stage.label).toBe('Price review')
    expect(detail.body.excelUpdate.restoredTo).toBe('Price review')
    expect(detail.body.history[0].comment).toMatch(/Deadline extended/)
  })

  it("enforces the plan's monthly tender limit before writing anything", async () => {
    await resetDb()
    await createOwner()
    const small = await setupClient(await loginOwner(), await createPlan(25), 'small')
    const { plans } = await import('../src/db/schema')
    await db.update(plans).set({ maxTendersPerMonth: 2 })

    const res = await importFile(
      hostOf('small'),
      small.adminToken,
      await workbook({ Sheet1: [t247Row('A/1'), t247Row('A/2'), t247Row('A/3')] }),
    )
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PLAN_TENDER_LIMIT')
    expect((await listAll(hostOf('small'), small.adminToken)).total).toBe(0)
  })

  it('refuses files that are not Excel workbooks', async () => {
    const wrongType = await importFile(ACME, adminToken, Buffer.from('a,b'), 'tenders.csv')
    expect(wrongType.body.error.code).toBe('UNSUPPORTED_FILE')
    const broken = await importFile(ACME, adminToken, Buffer.from('not a zip'), 'tenders.xlsx')
    expect(broken.body.error.code).toBe('UNREADABLE_FILE')
  })

  it('only users with the import permission can import', async () => {
    const { addUser } = await import('./tender-helpers')
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    const res = await importFile(ACME, agent.token, await workbook({ Sheet1: [t247Row('X/1')] }))
    expect(res.status).toBe(403)
  })
})

describe('Excel layouts (import profiles)', () => {
  let adminToken: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
  })

  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, token = adminToken) =>
    request(app)[method](`/api${path}`).set('Host', ACME).set(bearer(token))

  const importWith = (profileId: string, file: Buffer) =>
    call('post', '/tenders/import').field('profileId', profileId).attach('file', file, 'x.xlsx')

  /** A sheet from another tender portal, with its own column names. */
  const otherPortal = (rows: { bid: string; item: string; ends: string }[]) =>
    workbook({
      Bids: rows.map((r) => ({
        'Bid Number': r.bid,
        'Item Description': r.item,
        'Bid End Date': r.ends,
        Department: 'Indian Railways',
        'Est. Value (INR)': '4,20,000',
      })),
    })

  const LAYOUT = {
    name: 'Railways portal',
    columns: {
      referenceNo: 'Bid Number',
      title: 'Item Description',
      deadline: 'Bid End Date',
      buyerOrganization: 'Department',
      estimatedCost: 'Est. Value (INR)',
    },
  }

  it('lists the headings of an uploaded file and suggests the columns it recognises', async () => {
    const file = await workbook({
      Sheet1: [{ ...t247Row('A/1'), 'Our notes': 'x' }],
      Summary: [{ Total: 1 }],
    })
    const res = await call('post', '/tenders/import/inspect').attach('file', file, 'x.xlsx')
    expect(res.status).toBe(200)
    expect(res.body.sheets).toEqual([
      expect.objectContaining({ name: 'Sheet1', rows: 1 }),
      { name: 'Summary', headings: ['Total'], rows: 1 },
    ])
    expect(res.body.sheets[0].headings).toContain('Our notes')
    expect(res.body.suggested).toMatchObject({
      referenceNo: 'REFERENCE NO',
      sourceTenderId: 'T247 ID',
      title: 'TENDER BRIEF',
      deadline: 'Deadline',
      emd: 'EMD',
    })
    const broken = await call('post', '/tenders/import/inspect').attach(
      'file',
      Buffer.from('not a zip'),
      'x.xlsx',
    )
    expect(broken.body.error.code).toBe('UNREADABLE_FILE')
  })

  it('saves a layout and imports a file from another portal with it', async () => {
    const file = await otherPortal([
      { bid: 'RLY/2027/1', item: 'Signal cables', ends: indian(inDays(12)) },
      { bid: 'RLY/2027/2', item: 'Relay racks', ends: indian(inDays(-2)) },
    ])

    // Without a layout the file is not recognised, and nothing is written.
    const plain = await importFile(ACME, adminToken, file)
    expect(plain.status).toBe(400)
    expect(plain.body.error.code).toBe('COLUMNS_NOT_FOUND')

    const saved = await call('post', '/import-profiles').send(LAYOUT)
    expect(saved.status).toBe(201)
    expect(saved.body).toMatchObject({ name: 'Railways portal', columns: LAYOUT.columns })
    const list = await call('get', '/import-profiles')
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Railways portal'])

    const res = await importWith(saved.body.id, file)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      layout: 'Railways portal',
      created: 1,
      skipped: { expired: 1, invalid: 0 },
    })
    const [tender] = await db.select().from(tenders).where(eq(tenders.referenceNo, 'RLY/2027/1'))
    expect(tender).toMatchObject({
      source: 'custom',
      title: 'Signal cables',
      buyerOrganization: 'Indian Railways',
      estimatedCost: 420000,
      deadline: inDays(12),
    })

    // A Tender247 file with this layout chosen is refused, not half-read.
    const wrong = await importWith(saved.body.id, await workbook({ S: [t247Row('A/1')] }))
    expect(wrong.body.error.code).toBe('COLUMNS_NOT_FOUND')

    const missing = await importWith(crypto.randomUUID(), file)
    expect(missing.body.error.code).toBe('PROFILE_NOT_FOUND')
    const notAnId = await importWith('abc', file)
    expect(notAnId.status).toBe(400)
  })

  it('checks a layout before saving it, and can rename, change and delete it', async () => {
    const bad = (columns: Record<string, string>) =>
      call('post', '/import-profiles').send({ name: 'Bad', columns })
    expect((await bad({ referenceNo: 'Bid', title: 'Item' })).status).toBe(400) // no deadline
    expect((await bad({ title: 'Item', deadline: 'Ends' })).status).toBe(400) // no reference or ID
    expect((await bad({ ...LAYOUT.columns, password: 'x' })).status).toBe(400) // unknown field

    const first = await call('post', '/import-profiles').send(LAYOUT)
    const again = await call('post', '/import-profiles').send(LAYOUT)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('PROFILE_NAME_TAKEN')

    // A tender ID column alone is enough to recognise tenders.
    const changed = await call('put', `/import-profiles/${first.body.id}`).send({
      name: 'Railways (new export)',
      columns: {
        sourceTenderId: 'Bid Number',
        title: 'Item Description',
        deadline: 'Bid End Date',
      },
    })
    expect(changed.status).toBe(200)
    expect(changed.body.columns).toEqual({
      sourceTenderId: 'Bid Number',
      title: 'Item Description',
      deadline: 'Bid End Date',
    })

    expect((await call('delete', `/import-profiles/${first.body.id}`)).status).toBe(204)
    expect((await call('get', '/import-profiles')).body).toEqual([])
    expect((await call('delete', `/import-profiles/${first.body.id}`)).status).toBe(404)
  })

  it('reports a sheet that lacks a needed column without counting it as bad rows', async () => {
    const res = await importFile(
      ACME,
      adminToken,
      await workbook({
        Tenders: [t247Row('A/1')],
        Archive: [{ 'REFERENCE NO': 'OLD/1', 'TENDER BRIEF': 'Old tender' }],
      }),
    )
    expect(res.body).toMatchObject({ created: 1, skipped: { invalid: 0 } })
    expect(res.body.issues).toEqual([
      { sheet: 'Archive', row: 1, message: 'No deadline column found, so this sheet was skipped' },
    ])
  })

  it('only users who can import can see or change layouts', async () => {
    const { addUser } = await import('./tender-helpers')
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect((await call('get', '/import-profiles', agent.token)).status).toBe(403)
    expect((await call('post', '/import-profiles', agent.token).send(LAYOUT)).status).toBe(403)
    const inspect = await call('post', '/tenders/import/inspect', agent.token).attach(
      'file',
      await workbook({ S: [t247Row('A/1')] }),
      'x.xlsx',
    )
    expect(inspect.status).toBe(403)
  })
})
