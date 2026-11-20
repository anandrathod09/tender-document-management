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
    expect(on.body).toEqual({ requireTwoFactor: false, agentsSeeAssets: true })
    expect((await assets(agent.token)).status).toBe(200)

    await request(app)
      .patch('/api/workspace/settings')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ agentsSeeAssets: false })
    expect((await assets(agent.token)).status).toBe(403)
  })
})
