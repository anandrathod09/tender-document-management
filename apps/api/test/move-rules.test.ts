import request from 'supertest'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StageSummary, TenderSummary } from '@tdm/shared'
import { db } from '../src/db/client'
import { organizations, tenders } from '../src/db/schema'
import { sweepOrganization } from '../src/modules/tenders/deadlines'
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
import { addUser, importFile, inDays, listAll, stagesOf, t247Row, workbook } from './tender-helpers'

const ACME = hostOf('acme')

/** The move rules of the original TMS: who may move a tender from which stage to which. */
describe('stage move rules', () => {
  let adminToken: string
  let agent: { id: string; token: string }
  let stages: Record<string, StageSummary>
  let tender: TenderSummary

  const move = (token: string, stageKey: string, extra: object = {}) =>
    request(app)
      .post(`/api/tenders/${tender.id}/move`)
      .set('Host', ACME)
      .set(bearer(token))
      .send({ stageId: stages[stageKey]!.id, comment: 'Moving on with this tender', ...extra })

  const stageOf = async () =>
    (await listAll(ACME, adminToken)).items.find((t) => t.id === tender.id)!.stage.id

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
    await importFile(ACME, adminToken, await workbook({ S: [t247Row('PWD/1'), t247Row('PWD/2')] }))
    stages = await stagesOf(ACME, adminToken)
    tender = (await listAll(ACME, adminToken)).items.find((t) => t.referenceNo === 'PWD/1')!
    agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    const assigned = await request(app)
      .post(`/api/tenders/${tender.id}/assign`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentId: agent.id })
    expect(assigned.body.stage.id).toBe(stages.assigned!.id)
  })

  it('follows the original TMS path: agent works, admin reviews, agent submits', async () => {
    // The agent can't skip ahead.
    const skip = await move(agent.token, 'submitted')
    expect(skip.body.error.code).toBe('MOVE_NOT_ALLOWED')

    expect((await move(agent.token, 'in-progress')).status).toBe(200)
    expect((await move(agent.token, 'price-review')).status).toBe(200)
    // The review decision is the admin's.
    expect((await move(agent.token, 'ready-to-bid')).body.error.code).toBe('MOVE_NOT_ALLOWED')
    expect((await move(adminToken, 'ready-to-bid')).status).toBe(200)
    expect((await move(agent.token, 'submitted')).status).toBe(200)
    expect((await move(agent.token, 'under-query')).status).toBe(200)
    expect((await move(agent.token, 'won', { awardAmount: 900000 })).status).toBe(200)
    // After the win, handing over to an engineer is the admin's.
    expect((await move(agent.token, 'assigned-to-engineer')).status).toBe(400)
    expect((await move(adminToken, 'assigned-to-engineer')).status).toBe(200)
    expect((await move(adminToken, 'completed')).status).toBe(200)
  })

  it('admins can also make the agent moves, but not jump stages', async () => {
    expect((await move(adminToken, 'won', { awardAmount: 1 })).body.error.code).toBe(
      'MOVE_NOT_ALLOWED',
    )
    expect((await move(adminToken, 'in-progress')).status).toBe(200)
  })

  it('a new tender can only be watchlisted or rejected; assigning a rejected one brings it back', async () => {
    const other = (await listAll(ACME, adminToken)).items.find((t) => t.referenceNo === 'PWD/2')!
    const bulk = (stageKey: string) =>
      request(app)
        .post('/api/tenders/bulk')
        .set('Host', ACME)
        .set(bearer(adminToken))
        .send({
          action: 'move',
          ids: [other.id],
          stageId: stages[stageKey]!.id,
          comment: 'Not for us, sorry',
        })
    expect((await bulk('submitted')).body.error.code).toBe('MOVE_NOT_ALLOWED')
    expect((await bulk('watchlist')).body.updated).toBe(1)
    expect((await bulk('rejected')).body.updated).toBe(1)

    const assigned = await request(app)
      .post(`/api/tenders/${other.id}/assign`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentId: agent.id })
    expect(assigned.body.stage.id).toBe(stages.assigned!.id)
  })

  it('after the deadline only "Not bidded" is left, until an admin reopens the tender', async () => {
    await move(agent.token, 'in-progress')
    await db
      .update(tenders)
      .set({ deadline: inDays(-1) })
      .where(eq(tenders.id, tender.id))

    expect((await move(agent.token, 'price-review')).body.error.code).toBe('DEADLINE_PASSED')
    expect((await move(adminToken, 'price-review')).body.error.code).toBe('DEADLINE_PASSED')
    expect((await move(agent.token, 'not-bidded')).status).toBe(200)

    // The admin reopens it; from then on the deadline rule no longer applies.
    expect((await move(agent.token, 'in-progress')).status).toBe(400)
    const reopened = await move(adminToken, 'in-progress')
    expect(reopened.status).toBe(200)
    expect(reopened.body.reopenedAfterDeadline).toBe(true)
    expect((await move(agent.token, 'price-review')).status).toBe(200)

    // The daily deadline job leaves it alone too.
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'acme'))
    await sweepOrganization(org!.id, 'Asia/Kolkata', 3)
    expect(await stageOf()).toBe(stages['price-review']!.id)
  })

  it('the admin can change the rules of a stage', async () => {
    const edit = (body: object, token = adminToken) =>
      request(app)
        .patch(`/api/workflow/stages/${stages['price-review']!.id}`)
        .set('Host', ACME)
        .set(bearer(token))
        .send(body)
    await move(agent.token, 'in-progress')
    await move(agent.token, 'price-review')

    expect((await edit({ agentNext: ['nope'] })).body.error.code).toBe('STAGE_NOT_FOUND')
    expect((await edit({ agentNext: ['ready-to-bid'] }, agent.token)).status).toBe(403)
    const saved = await edit({ agentNext: ['ready-to-bid'], managerNext: null })
    expect(saved.body).toMatchObject({ agentNext: ['ready-to-bid'], managerNext: null })
    expect((await move(agent.token, 'ready-to-bid')).status).toBe(200)
  })

  it('Installed assets is hidden from agents until the admin turns it on', async () => {
    const assets = (token: string) =>
      request(app).get('/api/assets').set('Host', ACME).set(bearer(token))
    expect((await assets(adminToken)).status).toBe(200)
    expect((await assets(agent.token)).status).toBe(403)

    const on = await request(app)
      .patch('/api/workspace/settings')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentsSeeAssets: true })
    expect(on.body).toEqual({ requireTwoFactor: false, agentsSeeAssets: true, cleanupDays: 3 })
    expect((await assets(agent.token)).status).toBe(200)

    await request(app)
      .patch('/api/workspace/settings')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentsSeeAssets: false })
    expect((await assets(agent.token)).status).toBe(403)
  })

  it('a viewer reads everything but cannot change anything', async () => {
    const viewer = await addUser(ACME, adminToken, 'viewer', 'viewer@acme.test')
    const as = (method: 'get' | 'post' | 'patch', path: string) =>
      request(app)[method](`/api${path}`).set('Host', ACME).set(bearer(viewer.token))

    // Reads: every tender, its documents and compliance PDFs, reports, assets.
    expect((await listAll(ACME, viewer.token)).items).toHaveLength(2)
    expect((await as('get', `/tenders/${tender.id}`)).status).toBe(200)
    expect((await as('get', `/tenders/${tender.id}/documents`)).status).toBe(200)
    expect((await as('get', `/tenders/${tender.id}/compliance-packs`)).status).toBe(200)
    expect(
      (await as('get', '/reports/summary').query({ from: inDays(-30), to: inDays(0) })).status,
    ).toBe(200)
    expect((await as('get', '/assets')).status).toBe(200)

    // Changes: all refused.
    const upload = await as('post', `/tenders/${tender.id}/documents`).attach(
      'file',
      Buffer.from('%PDF-1.4 test'),
      'boq.pdf',
    )
    expect(upload.status).toBe(403)
    expect((await as('post', `/tenders/${tender.id}/compliance-packs`).send({})).status).toBe(403)
    expect(
      (await as('post', `/tenders/${tender.id}/move`).send({ stageId: stages['in-progress']!.id }))
        .status,
    ).toBe(403)
    expect((await as('post', `/tenders/${tender.id}/assign`).send({ agentId: null })).status).toBe(
      403,
    )
    expect(
      (await as('patch', `/tenders/${tender.id}`).send({ biddingCompanyId: null })).status,
    ).toBe(403)
    expect((await as('post', '/tenders/import')).status).toBe(403)
  })

  it('admins choose who sees each stage in the menu, and can reset to the defaults', async () => {
    const api = (method: 'get' | 'post' | 'patch' | 'put', path: string, token = adminToken) =>
      request(app)[method](`/api/workflow${path}`).set('Host', ACME).set(bearer(token))
    const keysInOrder = async () =>
      ((await api('get', '/stages')).body as StageSummary[]).map((s) => s.key)

    // Defaults copy the old TMS menus.
    expect(stages.new!.menuRoles).toEqual(['admin', 'viewer'])
    expect(stages.assigned!.menuRoles).toEqual(['admin', 'agent', 'viewer'])
    expect(stages['assigned-to-engineer']!.menuRoles).toEqual(['admin', 'engineer', 'viewer'])
    const defaultOrder = await keysInOrder()

    // Changing things.
    expect(
      (await api('patch', `/stages/${stages.new!.id}`).send({ menuRoles: ['nope'] })).body.error
        .code,
    ).toBe('ROLE_NOT_FOUND')
    expect(
      (await api('patch', `/stages/${stages.new!.id}`, agent.token).send({ menuRoles: null }))
        .status,
    ).toBe(403)
    await api('patch', `/stages/${stages.new!.id}`).send({ menuRoles: null })
    await api('patch', `/stages/${stages.won!.id}`).send({ label: 'Order received' })
    await api('patch', `/stages/${stages['price-review']!.id}`).send({ agentNext: ['won'] })
    const own = await api('post', '/stages').send({ label: 'Tech evaluation', type: 'review' })
    const ids = ((await api('get', '/stages')).body as StageSummary[]).map((s) => s.id).reverse()
    await api('put', '/stages/order').send({ ids })

    // One stage, one part: only that changes.
    const one = await api('post', '/stages/reset').send({
      parts: ['menus'],
      stageId: stages.new!.id,
    })
    const after = Object.fromEntries((one.body as StageSummary[]).map((s) => [s.key, s]))
    expect(after.new!.menuRoles).toEqual(['admin', 'viewer'])
    expect(after.won!.label).toBe('Order received')

    // Everything: names, moves, order back; the own stage is kept after the last review stage.
    expect((await api('post', '/stages/reset').send({ parts: [] })).status).toBe(400)
    await api('post', '/stages/reset').send({
      parts: ['look', 'order', 'settings', 'moves', 'menus'],
    })
    const reset = Object.fromEntries(
      ((await api('get', '/stages')).body as StageSummary[]).map((s) => [s.key, s]),
    )
    expect(reset.won!.label).toBe('Won')
    expect(reset['price-review']!.agentNext).toEqual([])
    const order = await keysInOrder()
    const ownKey = (own.body as StageSummary).key
    expect(order.filter((k) => k !== ownKey)).toEqual(defaultOrder)
    expect(order.indexOf(ownKey)).toBe(order.indexOf('criteria-review') + 1)
    expect(reset[ownKey]!.label).toBe('Tech evaluation')
  })
})
