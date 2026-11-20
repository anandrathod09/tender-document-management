import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RoleSummary, StageSummary, UserSummary } from '@tdm/shared'
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
import { importFile, listAll, stagesOf, t247Row, workbook } from './tender-helpers'

/**
 * The most important guarantee of the platform: nothing one client does can
 * read or change another client's data. Every new client-facing endpoint
 * should get a case here.
 */
describe('client data isolation', () => {
  let a: Awaited<ReturnType<typeof setupClient>>
  let b: Awaited<ReturnType<typeof setupClient>>
  const A = hostOf('alpha')
  const B = hostOf('bravo')

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    const ownerToken = await loginOwner()
    const planId = await createPlan()
    a = await setupClient(ownerToken, planId, 'alpha')
    b = await setupClient(ownerToken, planId, 'bravo')
  })

  it("a client's token does not work on another client's subdomain", async () => {
    const res = await request(app).get('/api/users').set('Host', B).set(bearer(a.adminToken))
    expect(res.status).toBe(401)
    const me = await request(app).get('/api/auth/me').set('Host', B).set(bearer(a.adminToken))
    expect(me.status).toBe(401)
  })

  it("a client's refresh cookie does not work on another client's subdomain", async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Host', B)
      .set('Cookie', a.refreshCookie)
    expect(res.status).toBe(401)
  })

  it('lists only the users and roles of the current client', async () => {
    const users = await request(app).get('/api/users').set('Host', A).set(bearer(a.adminToken))
    expect((users.body as UserSummary[]).map((u) => u.email)).toEqual(['admin@alpha.test'])

    const roles = await request(app).get('/api/roles').set('Host', A).set(bearer(a.adminToken))
    const bRoles = await request(app).get('/api/roles').set('Host', B).set(bearer(b.adminToken))
    const aIds = (roles.body as RoleSummary[]).map((r) => r.id)
    const bIds = (bRoles.body as RoleSummary[]).map((r) => r.id)
    expect(aIds).toHaveLength(4)
    expect(aIds.some((id) => bIds.includes(id))).toBe(false)
  })

  it("cannot change, or resend invitations for, another client's users", async () => {
    const patch = await request(app)
      .patch(`/api/users/${b.adminId}`)
      .set('Host', A)
      .set(bearer(a.adminToken))
      .send({ name: 'Hacked' })
    expect(patch.status).toBe(404)

    const resend = await request(app)
      .post(`/api/users/${b.adminId}/resend-invite`)
      .set('Host', A)
      .set(bearer(a.adminToken))
    expect(resend.status).toBe(404)
  })

  it('cannot give a user a role that belongs to another client', async () => {
    const bRoles = await request(app).get('/api/roles').set('Host', B).set(bearer(b.adminToken))
    const bAgent = (bRoles.body as RoleSummary[]).find((r) => r.key === 'agent')!

    const invite = await request(app)
      .post('/api/users')
      .set('Host', A)
      .set(bearer(a.adminToken))
      .send({ name: 'X', email: 'x@alpha.test', roleId: bAgent.id })
    expect(invite.status).toBe(400)
    expect(invite.body.error.code).toBe('ROLE_NOT_FOUND')
  })

  it('the same email can exist separately in two clients', async () => {
    const aRoles = await request(app).get('/api/roles').set('Host', A).set(bearer(a.adminToken))
    const viewer = (aRoles.body as RoleSummary[]).find((r) => r.key === 'viewer')!
    const res = await request(app)
      .post('/api/users')
      .set('Host', A)
      .set(bearer(a.adminToken))
      .send({ name: 'Bravo admin', email: 'admin@bravo.test', roleId: viewer.id })
    expect(res.status).toBe(201)
  })

  describe('tenders and stages', () => {
    let aTender: string
    let aStages: Record<string, StageSummary>
    let bStages: Record<string, StageSummary>

    beforeEach(async () => {
      // Both clients import a tender with the same reference number.
      const file = await workbook({ S: [t247Row('PWD/1')] })
      expect((await importFile(A, a.adminToken, file)).body.created).toBe(1)
      expect((await importFile(B, b.adminToken, file)).body.created).toBe(1)
      aTender = (await listAll(A, a.adminToken)).items[0]!.id
      aStages = await stagesOf(A, a.adminToken)
      bStages = await stagesOf(B, b.adminToken)
    })

    it("lists, counts and reports only the current client's tenders", async () => {
      const bList = await listAll(B, b.adminToken)
      expect(bList.total).toBe(1)
      expect(bList.items[0]!.id).not.toBe(aTender)
      const counts = await request(app)
        .get('/api/tenders/counts')
        .set('Host', B)
        .set(bearer(b.adminToken))
      expect(counts.body).toEqual([{ stageId: bStages.new!.id, count: 1 }])
    })

    it("cannot read, move or assign another client's tender", async () => {
      const get = await request(app)
        .get(`/api/tenders/${aTender}`)
        .set('Host', B)
        .set(bearer(b.adminToken))
      expect(get.status).toBe(404)
      const move = await request(app)
        .post(`/api/tenders/${aTender}/move`)
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ stageId: bStages.watchlist!.id })
      expect(move.status).toBe(404)
      const assign = await request(app)
        .post(`/api/tenders/${aTender}/assign`)
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ agentId: b.adminId })
      expect(assign.status).toBe(404)
      const bulk = await request(app)
        .post('/api/tenders/bulk')
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ action: 'move', ids: [aTender], stageId: bStages.watchlist!.id })
      expect(bulk.status).toBe(404)
    })

    it("cannot use another client's stage or user on its own tender", async () => {
      const move = await request(app)
        .post(`/api/tenders/${aTender}/move`)
        .set('Host', A)
        .set(bearer(a.adminToken))
        .send({ stageId: bStages.watchlist!.id })
      expect(move.body.error.code).toBe('STAGE_NOT_FOUND')
      const assign = await request(app)
        .post(`/api/tenders/${aTender}/assign`)
        .set('Host', A)
        .set(bearer(a.adminToken))
        .send({ agentId: b.adminId })
      expect(assign.body.error.code).toBe('USER_NOT_FOUND')
      const bulk = await request(app)
        .post('/api/tenders/bulk')
        .set('Host', A)
        .set(bearer(a.adminToken))
        .send({ action: 'assign', ids: [aTender], agentId: b.adminId })
      expect(bulk.body.error.code).toBe('USER_NOT_FOUND')
    })

    it("cannot change another client's stage settings", async () => {
      const res = await request(app)
        .patch(`/api/workflow/stages/${aStages.won!.id}`)
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ label: 'Hacked' })
      expect(res.status).toBe(404)
      expect((await stagesOf(A, a.adminToken)).won!.label).toBe('Won')
    })

    it("cannot delete, reorder or place a stage next to another client's stage", async () => {
      const own = await request(app)
        .post('/api/workflow/stages')
        .set('Host', A)
        .set(bearer(a.adminToken))
        .send({ label: 'Alpha only', type: 'review' })
      expect(own.status).toBe(201)

      const del = await request(app)
        .delete(`/api/workflow/stages/${own.body.id}`)
        .set('Host', B)
        .set(bearer(b.adminToken))
      expect(del.status).toBe(404)
      const after = await request(app)
        .post('/api/workflow/stages')
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ label: 'Bravo', type: 'review', afterStageId: own.body.id })
      expect(after.status).toBe(404)
      const reorder = await request(app)
        .put('/api/workflow/stages/order')
        .set('Host', B)
        .set(bearer(b.adminToken))
        .send({ ids: [own.body.id, ...Object.values(bStages).map((s) => s.id)] })
      expect(reorder.status).toBe(400)
      expect(Object.values(await stagesOf(A, a.adminToken)).map((s) => s.label)).toContain(
        'Alpha only',
      )
    })
  })

  it("cannot see, edit or use another client's letter templates", async () => {
    const letter = {
      title: 'Alpha letter',
      body: [{ kind: 'para', text: 'We, {{company_name}}, declare.' }],
    }
    const saved = await request(app)
      .post('/api/letter-templates')
      .set('Host', A)
      .set(bearer(a.adminToken))
      .send(letter)
    expect(saved.status).toBe(201)
    const id = saved.body.id as string

    const bravoList = await request(app)
      .get('/api/letter-templates')
      .set('Host', B)
      .set(bearer(b.adminToken))
    expect(bravoList.body.templates).toEqual([])
    const edit = await request(app)
      .put(`/api/letter-templates/${id}`)
      .set('Host', B)
      .set(bearer(b.adminToken))
      .send({ ...letter, title: 'Hacked' })
    expect(edit.status).toBe(404)

    // Bravo cannot print Alpha's letter, nor tie a letter to Alpha's company.
    const bCompany = await request(app)
      .post('/api/companies')
      .set('Host', B)
      .set(bearer(b.adminToken))
      .send({ name: 'Bravo Co', address: 'Pune 411001', signatoryName: 'B', designation: 'Owner' })
    await importFile(B, b.adminToken, await workbook({ S: [t247Row('B/1')] }))
    const bTender = (await listAll(B, b.adminToken)).items[0]!.id
    const pack = await request(app)
      .post(`/api/tenders/${bTender}/compliance-packs`)
      .set('Host', B)
      .set(bearer(b.adminToken))
      .send({ companyId: bCompany.body.id, templateIds: [id] })
    expect(pack.body.error.code).toBe('LETTER_NOT_FOUND')
    const aCompany = await request(app)
      .post('/api/companies')
      .set('Host', A)
      .set(bearer(a.adminToken))
      .send({
        name: 'Alpha Co',
        address: 'Nashik 422001',
        signatoryName: 'A',
        designation: 'Owner',
      })
    const tied = await request(app)
      .post('/api/letter-templates')
      .set('Host', B)
      .set(bearer(b.adminToken))
      .send({ ...letter, companyId: aCompany.body.id })
    expect(tied.body.error.code).toBe('COMPANY_NOT_FOUND')
  })

  it("cannot see, use, change or delete another client's Excel layouts", async () => {
    const layout = {
      name: 'Portal',
      columns: { referenceNo: 'REFERENCE NO', title: 'TENDER BRIEF', deadline: 'Deadline' },
    }
    const as = (host: string, token: string) => ({
      get: (p: string) => request(app).get(`/api${p}`).set('Host', host).set(bearer(token)),
      post: (p: string) => request(app).post(`/api${p}`).set('Host', host).set(bearer(token)),
      put: (p: string) => request(app).put(`/api${p}`).set('Host', host).set(bearer(token)),
      del: (p: string) => request(app).delete(`/api${p}`).set('Host', host).set(bearer(token)),
    })
    const alpha = as(A, a.adminToken)
    const bravo = as(B, b.adminToken)

    const saved = await alpha.post('/import-profiles').send(layout)
    expect(saved.status).toBe(201)
    const id = saved.body.id as string

    expect((await bravo.get('/import-profiles')).body).toEqual([])
    const use = await bravo
      .post('/tenders/import')
      .field('profileId', id)
      .attach('file', await workbook({ S: [t247Row('PWD/9')] }), 'x.xlsx')
    expect(use.status).toBe(404)
    expect((await bravo.put(`/import-profiles/${id}`).send({ ...layout, name: 'X' })).status).toBe(
      404,
    )
    expect((await bravo.del(`/import-profiles/${id}`)).status).toBe(404)

    // The same name is free in the other client.
    expect((await bravo.post('/import-profiles').send(layout)).status).toBe(201)
    expect((await alpha.get('/import-profiles')).body).toMatchObject([{ id, name: 'Portal' }])
  })
})
