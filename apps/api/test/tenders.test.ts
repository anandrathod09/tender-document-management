import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StageSummary } from '@tdm/shared'
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
import {
  addUser,
  importFile,
  inDays,
  indian,
  listAll,
  stagesOf,
  t247Row,
  workbook,
} from './tender-helpers'

const ACME = hostOf('acme')

describe('tenders and stages', () => {
  let adminToken: string
  let stages: Record<string, StageSummary>
  let ids: Record<string, string>

  const move = (id: string, body: object, token = adminToken) =>
    request(app).post(`/api/tenders/${id}/move`).set('Host', ACME).set(bearer(token)).send(body)

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
    await importFile(
      ACME,
      adminToken,
      await workbook({
        Sheet1: [
          t247Row('PWD/1', { Deadline: indian(inDays(2)) }),
          t247Row('PWD/2', {
            Deadline: indian(inDays(5)),
            'TENDER BRIEF': 'Road resurfacing 50% works',
          }),
          t247Row('PWD/3', { Deadline: indian(inDays(40)) }),
        ],
      }),
    )
    stages = await stagesOf(ACME, adminToken)
    ids = Object.fromEntries(
      (await listAll(ACME, adminToken)).items.map((t) => [t.referenceNo, t.id]),
    )
  })

  it('every new client gets the 16 default stages', () => {
    expect(Object.keys(stages)).toHaveLength(16)
    expect(stages.new).toMatchObject({
      type: 'open',
      systemRole: 'intake',
      commentMode: 'optional',
    })
    expect(stages['not-bidded']).toMatchObject({ type: 'dropped', systemRole: 'missed_deadline' })
  })

  it('lists, filters, searches and sorts tenders', async () => {
    const all = await listAll(ACME, adminToken)
    expect(all.items.map((t) => t.referenceNo)).toEqual(['PWD/1', 'PWD/2', 'PWD/3']) // by deadline
    expect((await listAll(ACME, adminToken, { q: '50%' })).items.map((t) => t.referenceNo)).toEqual(
      ['PWD/2'],
    )
    expect((await listAll(ACME, adminToken, { stageId: stages.watchlist!.id })).total).toBe(0)
    expect(
      (await listAll(ACME, adminToken, { sort: '-deadline', pageSize: '1' })).items[0]!.referenceNo,
    ).toBe('PWD/3')
    const byRef = await listAll(ACME, adminToken, { sort: '-referenceNo' })
    expect(byRef.items.map((t) => t.referenceNo)).toEqual(['PWD/3', 'PWD/2', 'PWD/1'])
    // Equal values fall back to the deadline.
    const byCost = await listAll(ACME, adminToken, { sort: '-estimatedCost' })
    expect(byCost.items.map((t) => t.referenceNo)).toEqual(['PWD/1', 'PWD/2', 'PWD/3'])
    expect(byRef.items[0]!.briefUrl).toBeNull()
    const badSort = await request(app)
      .get('/api/tenders?sort=password')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(badSort.status).toBe(400)

    await move(ids['PWD/2']!, { stageId: stages['price-review']!.id })
    await move(ids['PWD/3']!, { stageId: stages['in-progress']!.id })
    const preparing = await listAll(ACME, adminToken, { stageType: 'preparing,review' })
    expect(preparing.items.map((t) => t.referenceNo)).toEqual(['PWD/2', 'PWD/3'])
    const bad = await request(app)
      .get('/api/tenders?stageType=nonsense')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(bad.status).toBe(400)
    await move(ids['PWD/2']!, { stageId: stages.new!.id })
    await move(ids['PWD/3']!, { stageId: stages.new!.id })

    const counts = await request(app)
      .get('/api/tenders/counts')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(counts.body).toEqual([{ stageId: stages.new!.id, count: 3 }])
  })

  it('moving follows the stage comment setting and records history', async () => {
    const noComment = await move(ids['PWD/1']!, { stageId: stages['not-fit']!.id })
    expect(noComment.status).toBe(400)
    expect(noComment.body.error.details[0].field).toBe('comment')

    const ok = await move(ids['PWD/1']!, {
      stageId: stages['not-fit']!.id,
      comment: 'Needs ISO 9001',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.stage.label).toBe('Not fit')
    expect(ok.body.history[0]).toMatchObject({
      from: { label: 'New' },
      to: { label: 'Not fit' },
      comment: 'Needs ISO 9001',
    })

    await request(app)
      .patch(`/api/workflow/stages/${stages.watchlist!.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ commentMode: 'off' })
    const off = await move(ids['PWD/2']!, { stageId: stages.watchlist!.id, comment: 'ignored' })
    expect(off.body.history[0].comment).toBeNull()

    expect((await move(ids['PWD/2']!, { stageId: stages.watchlist!.id })).body.error.code).toBe(
      'SAME_STAGE',
    )
  })

  it('a won stage needs the award amount', async () => {
    const missing = await move(ids['PWD/3']!, { stageId: stages.won!.id })
    expect(missing.body.error.details[0].field).toBe('awardAmount')
    const won = await move(ids['PWD/3']!, {
      stageId: stages.won!.id,
      awardAmount: 1425000,
      awardNumber: 'PO-77',
    })
    expect(won.body).toMatchObject({ awardAmount: 1425000, awardNumber: 'PO-77' })

    const dash = await request(app)
      .get('/api/tenders/dashboard')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(dash.body).toMatchObject({ wonValue: 1425000, winRate: 1 })
    expect(dash.body.counts).toMatchObject({ open: 2, won: 1 })
    expect(dash.body.upcoming.map((t: { referenceNo: string }) => t.referenceNo)).toEqual([
      'PWD/1',
      'PWD/2',
    ])
  })

  it('assigning moves an open tender to "Assigned"; agents see and move only their tenders', async () => {
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')

    const assigned = await request(app)
      .post(`/api/tenders/${ids['PWD/1']}/assign`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentId: agent.id, note: 'Check the BOQ first' })
    expect(assigned.status).toBe(200)
    expect(assigned.body).toMatchObject({
      stage: { label: 'Assigned' },
      assignedAgent: { id: agent.id, email: 'agent@acme.test', phone: null },
    })
    expect(assigned.body.assignedAt).toEqual(expect.any(String))
    // The note reaches the person and is kept in the history.
    const inbox = await request(app)
      .get('/api/notifications')
      .set('Host', ACME)
      .set(bearer(agent.token))
    expect(inbox.body.items[0].body).toContain('Note from')
    expect(inbox.body.items[0].body).toContain('Check the BOQ first')
    expect(assigned.body.history[0].comment).toBe('Assigned to agent: Check the BOQ first')

    // The assign popup lists people with their role and contact details.
    const people = await request(app)
      .get('/api/tenders/assignees')
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(people.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: agent.id,
          email: 'agent@acme.test',
          role: 'Agent',
          memberSince: expect.any(String),
        }),
      ]),
    )

    const mine = await listAll(ACME, agent.token)
    expect(mine.items.map((t) => t.referenceNo)).toEqual(['PWD/1'])
    expect(
      (
        await request(app)
          .get(`/api/tenders/${ids['PWD/2']}`)
          .set('Host', ACME)
          .set(bearer(agent.token))
      ).status,
    ).toBe(404)
    expect((await move(ids['PWD/2']!, { stageId: stages.watchlist!.id }, agent.token)).status).toBe(
      404,
    )
    expect(
      (await move(ids['PWD/1']!, { stageId: stages['in-progress']!.id }, agent.token)).status,
    ).toBe(200)

    const agentAssigns = await request(app)
      .post(`/api/tenders/${ids['PWD/1']}/assign`)
      .set('Host', ACME)
      .set(bearer(agent.token))
      .send({ agentId: null })
    expect(agentAssigns.status).toBe(403)
  })

  it('bulk actions move or assign several tenders at once', async () => {
    const bulk = (body: object, token = adminToken) =>
      request(app).post('/api/tenders/bulk').set('Host', ACME).set(bearer(token)).send(body)
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    const all = [ids['PWD/1']!, ids['PWD/2']!, ids['PWD/3']!]

    // Assign two: both move from "New" to "Assigned", and the agent gets one notification.
    const assigned = await bulk({ action: 'assign', ids: all.slice(0, 2), agentId: agent.id })
    expect(assigned.body).toEqual({ updated: 2, unchanged: 0 })
    expect((await listAll(ACME, agent.token)).items.map((t) => t.stage.label)).toEqual([
      'Assigned',
      'Assigned',
    ])
    const notes = await request(app)
      .get('/api/notifications')
      .set('Host', ACME)
      .set(bearer(agent.token))
    expect(notes.body.items).toHaveLength(1)
    expect(notes.body.items[0].title).toBe('2 tenders assigned to you')

    // Move all three; the comment setting applies to the batch.
    await request(app)
      .patch(`/api/workflow/stages/${stages.rejected!.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ commentMode: 'required' })
    const noComment = await bulk({ action: 'move', ids: all, stageId: stages.rejected!.id })
    expect(noComment.status).toBe(400)
    const moved = await bulk({
      action: 'move',
      ids: all,
      stageId: stages.rejected!.id,
      comment: 'Outside our region',
    })
    expect(moved.body).toEqual({ updated: 3, unchanged: 0 })
    const again = await bulk({
      action: 'move',
      ids: all,
      stageId: stages.rejected!.id,
      comment: 'x',
    })
    expect(again.body).toEqual({ updated: 0, unchanged: 3 })
    const detail = await request(app)
      .get(`/api/tenders/${ids['PWD/1']}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(detail.body.history[0]).toMatchObject({
      to: { label: 'Rejected' },
      comment: 'Outside our region',
    })

    // Won needs an award amount per tender, so it is refused in bulk.
    expect(
      (await bulk({ action: 'move', ids: all, stageId: stages.won!.id })).body.error.code,
    ).toBe('BULK_WON')
    // An agent may move their own tenders in bulk, but not one they cannot see, and may not assign.
    const notTheirs = await bulk(
      { action: 'move', ids: all, stageId: stages['in-progress']!.id },
      agent.token,
    )
    expect(notTheirs.status).toBe(404)
    expect(
      (
        await bulk(
          { action: 'move', ids: all.slice(0, 2), stageId: stages['in-progress']!.id },
          agent.token,
        )
      ).body,
    ).toEqual({ updated: 2, unchanged: 0 })
    expect((await bulk({ action: 'assign', ids: all, agentId: null }, agent.token)).status).toBe(
      403,
    )
    // Nothing was half-done by the refused request.
    expect((await listAll(ACME, adminToken, { stageId: stages.rejected!.id })).total).toBe(1)
    expect(
      (await bulk({ action: 'move', ids: [all[0], all[0]], stageId: stages.new!.id })).status,
    ).toBe(400)
  })

  it('stage settings: rename, reset, hide rules and permission', async () => {
    const patch = (id: string, body: object, token = adminToken) =>
      request(app)
        .patch(`/api/workflow/stages/${id}`)
        .set('Host', ACME)
        .set(bearer(token))
        .send(body)

    const renamed = await patch(stages['price-review']!.id, { label: 'Costing' })
    expect(renamed.body).toMatchObject({ label: 'Costing', defaultLabel: 'Price review' })
    expect((await patch(stages['criteria-review']!.id, { label: 'costing' })).body.error.code).toBe(
      'STAGE_LABEL_TAKEN',
    )
    expect((await patch(stages['price-review']!.id, { label: null })).body.label).toBe(
      'Price review',
    )

    expect((await patch(stages.new!.id, { isVisible: false })).body.error.code).toBe(
      'STAGE_REQUIRED',
    )
    expect((await patch(stages.won!.id, { isVisible: false })).body.error.code).toBe(
      'STAGE_REQUIRED',
    )
    await move(ids['PWD/1']!, { stageId: stages['under-query']!.id })
    expect((await patch(stages['under-query']!.id, { isVisible: false })).body.error.code).toBe(
      'STAGE_NOT_EMPTY',
    )
    const hidden = await patch(stages['criteria-review']!.id, { isVisible: false })
    expect(hidden.body.isVisible).toBe(false)
    expect(
      (await move(ids['PWD/2']!, { stageId: stages['criteria-review']!.id })).body.error.code,
    ).toBe('STAGE_HIDDEN')

    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect((await patch(stages.won!.id, { label: 'Awarded' }, agent.token)).status).toBe(403)
  })

  it('stage editor: add a stage, colour it, reorder, and delete it while unused', async () => {
    const call = (method: 'post' | 'put' | 'patch' | 'delete', path: string, token = adminToken) =>
      request(app)[method](`/api/workflow${path}`).set('Host', ACME).set(bearer(token))
    const current = async () =>
      (await request(app).get('/api/workflow/stages').set('Host', ACME).set(bearer(adminToken)))
        .body as StageSummary[]

    // A new "Technical review" stage right after "Price review".
    const added = await call('post', '/stages').send({
      label: 'Technical review',
      type: 'review',
      color: 'purple',
      commentMode: 'required',
      afterStageId: stages['price-review']!.id,
    })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({
      label: 'Technical review',
      type: 'review',
      color: 'purple',
      commentMode: 'required',
      isCustom: true,
      isVisible: true,
    })
    const labels = (await current()).map((s) => s.label)
    expect(labels.indexOf('Technical review')).toBe(labels.indexOf('Price review') + 1)

    // Names stay unique; types must be real ones.
    const taken = await call('post', '/stages').send({ label: 'won', type: 'won' })
    expect(taken.body.error.code).toBe('STAGE_LABEL_TAKEN')
    expect((await call('post', '/stages').send({ label: 'X', type: 'magic' })).status).toBe(400)

    // Any stage's colour can be changed.
    const recoloured = await call('patch', `/stages/${stages.won!.id}`).send({ color: 'teal' })
    expect(recoloured.body.color).toBe('teal')

    // Reorder: the new stage goes to the end; every stage must be listed once.
    const others = (await current()).map((s) => s.id).filter((id) => id !== added.body.id)
    const reordered = await call('put', '/stages/order').send({ ids: [...others, added.body.id] })
    expect(reordered.status).toBe(200)
    expect(reordered.body.at(-1).label).toBe('Technical review')
    expect((await call('put', '/stages/order').send({ ids: others })).status).toBe(400)

    // Default stages can't be deleted, nor can a custom stage that tenders have used.
    const defaultDelete = await call('delete', `/stages/${stages.won!.id}`)
    expect(defaultDelete.body.error.code).toBe('STAGE_REQUIRED')
    const used = await call('post', '/stages').send({ label: 'Legal check', type: 'review' })
    const moved = await move(ids['PWD/1']!, { stageId: used.body.id, comment: 'Legal review' })
    expect(moved.status).toBe(200)
    expect((await call('delete', `/stages/${used.body.id}`)).body.error.code).toBe('STAGE_IN_USE')

    // Agents can't change the workflow; an unused custom stage can be deleted.
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect((await call('delete', `/stages/${added.body.id}`, agent.token)).status).toBe(403)
    const agentAdd = await call('post', '/stages', agent.token).send({
      label: 'Mine',
      type: 'review',
    })
    expect(agentAdd.status).toBe(403)
    expect((await call('delete', `/stages/${added.body.id}`)).status).toBe(204)
    expect((await current()).map((s) => s.label)).not.toContain('Technical review')
  })
})
