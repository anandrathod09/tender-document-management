import { PDFDocument } from 'pdf-lib'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CompanySummary, CompliancePackSummary, FileSummary } from '@tdm/shared'
import {
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
import { BROKEN_PDF, EXE_AS_PDF, makePdf, PNG } from './fixtures'
import { addUser, importFile, listAll, t247Row, workbook } from './tender-helpers'

const ACME = hostOf('acme')

const company = {
  name: 'OST Nashik',
  address: 'Plot 12, Ambad MIDC, Nashik 422010',
  gstin: '27abcde1234f1z5',
  signatoryName: 'Rahul Patil',
  designation: 'Proprietor',
  authorizedPerson: 'Sneha Kulkarni',
  authorizedPersonPosition: 'Bid Manager',
  localContentPercent: '60',
  localValueLocation: 'Nashik',
}

describe('companies, documents and compliance PDFs', () => {
  let adminToken: string
  let tenderId: string

  const as = (token: string) => ({ ...bearer(token) })
  const uploadTo = (
    path: string,
    bytes: Buffer,
    name: string,
    token = adminToken,
    fields: Record<string, string> = {},
  ) => {
    let req = request(app).post(path).set('Host', ACME).set(as(token))
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v)
    return req.attach('file', bytes, name)
  }
  const download = async (fileId: string, token = adminToken, host = ACME) => {
    const link = await request(app)
      .post(`/api/files/${fileId}/link`)
      .set('Host', host)
      .set(as(token))
    if (link.status !== 200) return { status: link.status, body: link.body as unknown }
    const res = await request(app)
      .get(link.body.url)
      .set('Host', host)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    return {
      status: res.status,
      body: res.body as Buffer,
      headers: res.headers,
      url: link.body.url as string,
    }
  }

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
    await importFile(ACME, adminToken, await workbook({ S: [t247Row('PWD/7')] }))
    tenderId = (await listAll(ACME, adminToken)).items[0]!.id
  })

  async function createCompany(): Promise<CompanySummary> {
    const res = await request(app)
      .post('/api/companies')
      .set('Host', ACME)
      .set(as(adminToken))
      .send(company)
    expect(res.status).toBe(201)
    return res.body
  }

  it('manages bidding companies with validated details and images', async () => {
    const c = await createCompany()
    expect(c).toMatchObject({ name: 'OST Nashik', gstin: '27ABCDE1234F1Z5', isActive: true })

    const dup = await request(app)
      .post('/api/companies')
      .set('Host', ACME)
      .set(as(adminToken))
      .send(company)
    expect(dup.body.error.code).toBe('COMPANY_NAME_TAKEN')
    const badGst = await request(app)
      .post('/api/companies')
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ ...company, name: 'Other', gstin: '123' })
    expect(badGst.body.error.details[0].field).toBe('gstin')

    const logo = await uploadTo(`/api/companies/${c.id}/logo`, PNG, 'logo.png')
    expect(logo.status).toBe(200)
    expect(logo.body.logoFileId).toBeTruthy()
    const pdfAsLogo = await uploadTo(
      `/api/companies/${c.id}/signature`,
      await makePdf(),
      'sign.pdf',
    )
    expect(pdfAsLogo.body.error.code).toBe('UNSUPPORTED_FILE')

    const image = await download(logo.body.logoFileId)
    expect(image.status).toBe(200)
    expect(image.headers!['content-type']).toBe('image/png')

    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    const agentCreate = await request(app)
      .post('/api/companies')
      .set('Host', ACME)
      .set(as(agent.token))
      .send({ ...company, name: 'Agent Co' })
    expect(agentCreate.status).toBe(403)
    const agentList = await request(app)
      .get('/api/companies')
      .set('Host', ACME)
      .set(as(agent.token))
    expect(agentList.body).toHaveLength(1)
  })

  it("limits active bidding companies to the plan's allowance (3 by default)", async () => {
    const post = (name: string, extra: object = {}) =>
      request(app)
        .post('/api/companies')
        .set('Host', ACME)
        .set(as(adminToken))
        .send({ ...company, name, ...extra })
    const put = (id: string, body: object) =>
      request(app).put(`/api/companies/${id}`).set('Host', ACME).set(as(adminToken)).send(body)
    const limit = async () =>
      (await request(app).get('/api/companies/limit').set('Host', ACME).set(as(adminToken))).body

    expect(await limit()).toEqual({ used: 0, max: 3 })
    const first = (await post('One')).body as CompanySummary
    const second = (await post('Two')).body as CompanySummary
    await post('Three')
    expect(await limit()).toEqual({ used: 3, max: 3 })

    const fourth = await post('Four')
    expect(fourth.status).toBe(409)
    expect(fourth.body.error.code).toBe('PLAN_COMPANY_LIMIT')
    // An inactive company does not take a slot.
    expect((await post('Archive', { isActive: false })).status).toBe(201)

    // Marking one inactive frees a slot; turning it back on needs one.
    expect((await put(first.id, { ...company, name: 'One', isActive: false })).status).toBe(200)
    expect((await post('Four')).status).toBe(201)
    const back = await put(first.id, { ...company, name: 'One', isActive: true })
    expect(back.body.error.code).toBe('PLAN_COMPANY_LIMIT')
    // Editing a company that is already active is fine at the limit.
    const edit = await put(second.id, { ...company, name: 'Two renamed', isActive: true })
    expect(edit.status).toBe(200)
  })

  it('stores tender documents, checks real file types and serves expiring links', async () => {
    const pdf = await makePdf(2)
    const up = await uploadTo(`/api/tenders/${tenderId}/documents`, pdf, 'BOQ.pdf', adminToken, {
      title: 'Bill of quantities',
    })
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({
      title: 'Bill of quantities',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
    })

    const exe = await uploadTo(`/api/tenders/${tenderId}/documents`, EXE_AS_PDF, 'invoice.pdf')
    expect(exe.body.error.code).toBe('UNSUPPORTED_FILE')

    const list = await request(app)
      .get(`/api/tenders/${tenderId}/documents`)
      .set('Host', ACME)
      .set(as(adminToken))
    expect((list.body as FileSummary[]).map((f) => f.title)).toEqual(['Bill of quantities'])

    const got = await download(up.body.id)
    expect(got.status).toBe(200)
    expect(Buffer.compare(got.body as Buffer, pdf)).toBe(0)
    expect(got.headers!['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''BOQ\.pdf/)

    // The link only works on the subdomain of the client that owns the file.
    await setupClient(await loginOwner(), await createPlan(), 'other')
    const elsewhere = await request(app).get(got.url!).set('Host', hostOf('other'))
    expect(elsewhere.status).toBe(404)
    expect(
      (await request(app).get('/api/files/download/not-a-token').set('Host', ACME)).status,
    ).toBe(404)

    const del = await request(app)
      .delete(`/api/files/${up.body.id}`)
      .set('Host', ACME)
      .set(as(adminToken))
    expect(del.status).toBe(204)
    expect((await request(app).get(got.url!).set('Host', ACME)).status).toBe(404)
  })

  it('agents cannot see documents of tenders that are not theirs', async () => {
    const up = await uploadTo(`/api/tenders/${tenderId}/documents`, await makePdf(), 'a.pdf')
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect(
      (
        await request(app)
          .get(`/api/tenders/${tenderId}/documents`)
          .set('Host', ACME)
          .set(as(agent.token))
      ).status,
    ).toBe(404)
    expect((await download(up.body.id, agent.token)).status).toBe(404)

    await request(app)
      .post(`/api/tenders/${tenderId}/assign`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ agentId: agent.id })
    expect((await download(up.body.id, agent.token)).status).toBe(200)
    // Agents may delete only what they uploaded.
    expect(
      (await request(app).delete(`/api/files/${up.body.id}`).set('Host', ACME).set(as(agent.token)))
        .status,
    ).toBe(403)
  })

  it('sets the bidding company of a tender', async () => {
    const c = await createCompany()
    const res = await request(app)
      .patch(`/api/tenders/${tenderId}`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ biddingCompanyId: c.id })
    expect(res.body.biddingCompany).toEqual({ id: c.id, name: 'OST Nashik' })
  })

  it('builds a compliance PDF in the background from letters and documents', async () => {
    const c = await createCompany()
    await uploadTo(`/api/companies/${c.id}/logo`, PNG, 'logo.png')
    await uploadTo(`/api/companies/${c.id}/signature`, PNG, 'sign.png')
    const gst = await uploadTo(
      '/api/library',
      await makePdf(1, 'GST certificate'),
      'gst.pdf',
      adminToken,
      { title: 'GST certificate', companyId: c.id },
    )
    expect(gst.status).toBe(201)
    const broken = await uploadTo('/api/library', BROKEN_PDF, 'iso.pdf', adminToken, {
      title: 'ISO certificate',
    })
    const photo = await uploadTo(`/api/tenders/${tenderId}/documents`, PNG, 'site.png')

    const req = await request(app)
      .post(`/api/tenders/${tenderId}/compliance-packs`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({
        companyId: c.id,
        departmentAddress: 'Office of the Executive Engineer, PWD Nashik',
        letters: ['tender_acceptance', 'make_in_india', 'power_of_attorney'],
        libraryFileIds: [gst.body.id, broken.body.id],
        tenderFileIds: [photo.body.id],
      })
    expect(req.status).toBe(202)
    expect(req.body.status).toBe('queued')

    await drainJobs()

    const packs = await request(app)
      .get(`/api/tenders/${tenderId}/compliance-packs`)
      .set('Host', ACME)
      .set(as(adminToken))
    const pack = packs.body[0] as CompliancePackSummary
    expect(pack.status).toBe('ready')
    expect(pack.warnings).toHaveLength(1)
    expect(pack.warnings[0]).toMatch(/ISO certificate/)
    // 3 letters + 1-page GST certificate + 1 photo page.
    expect(pack.pageCount).toBe(5)

    const pdf = await download(pack.file!.id)
    expect(pdf.headers!['content-type']).toBe('application/pdf')
    const loaded = await PDFDocument.load(pdf.body as Buffer)
    expect(loaded.getPageCount()).toBe(5)

    const notes = await request(app).get('/api/notifications').set('Host', ACME).set(as(adminToken))
    expect(notes.body.unread).toBe(1)
    expect(notes.body.items[0]).toMatchObject({
      type: 'compliance.ready',
      link: `/tenders/${tenderId}`,
    })
    await request(app)
      .post('/api/notifications/read')
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ ids: 'all' })
    expect(
      (await request(app).get('/api/notifications').set('Host', ACME).set(as(adminToken))).body
        .unread,
    ).toBe(0)
  })

  it('refuses compliance requests with documents from elsewhere', async () => {
    const c = await createCompany()
    const other = await setupClient(await loginOwner(), await createPlan(), 'other')
    const theirs = await request(app)
      .post('/api/library')
      .set('Host', hostOf('other'))
      .set(as(other.adminToken))
      .field('title', 'Their GST')
      .attach('file', await makePdf(), 'gst.pdf')

    const res = await request(app)
      .post(`/api/tenders/${tenderId}/compliance-packs`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ companyId: c.id, libraryFileIds: [theirs.body.id] })
    expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND')

    const empty = await request(app)
      .post(`/api/tenders/${tenderId}/compliance-packs`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ companyId: c.id })
    expect(empty.status).toBe(400)

    const crossLink = await request(app)
      .post(`/api/files/${theirs.body.id}/link`)
      .set('Host', ACME)
      .set(as(adminToken))
    expect(crossLink.status).toBe(404)
  })

  it('notifies the assigned person when a tender is assigned or moved by someone else', async () => {
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    await request(app)
      .post(`/api/tenders/${tenderId}/assign`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ agentId: agent.id })
    const stages = (
      await request(app).get('/api/workflow/stages').set('Host', ACME).set(as(adminToken))
    ).body as { key: string; id: string }[]
    await request(app)
      .post(`/api/tenders/${tenderId}/move`)
      .set('Host', ACME)
      .set(as(adminToken))
      .send({ stageId: stages.find((s) => s.key === 'price-review')!.id, comment: 'Check rates' })

    const notes = await request(app)
      .get('/api/notifications')
      .set('Host', ACME)
      .set(as(agent.token))
    expect(notes.body.items.map((n: { type: string }) => n.type)).toEqual([
      'tender.moved',
      'tender.assigned',
    ])
    expect(notes.body.items[0].body).toContain('Check rates')
  })
})
