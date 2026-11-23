import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { tenders } from '../src/db/schema'
import { remindDeadlines, sweepOrganization } from '../src/modules/tenders/deadlines'
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

describe('daily deadline rules', () => {
  let adminToken: string
  let orgId: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    const client = await setupClient(await loginOwner(), await createPlan(), 'acme')
    adminToken = client.adminToken
    orgId = client.org.id
    await importFile(
      ACME,
      adminToken,
      await workbook({ S: [t247Row('A/1'), t247Row('A/2'), t247Row('A/3'), t247Row('A/4')] }),
    )
  })

  async function setup() {
    const stages = await stagesOf(ACME, adminToken)
    const ids = Object.fromEntries(
      (await listAll(ACME, adminToken)).items.map((t) => [t.referenceNo, t.id]),
    )
    const set = (ref: string, values: Partial<typeof tenders.$inferInsert>) =>
      db.update(tenders).set(values).where(eq(tenders.id, ids[ref]!))
    return { stages, ids, set }
  }

  it('moves overdue tenders being prepared to "Not bidded" and remembers their stage', async () => {
    const { stages, ids, set } = await setup()
    await set('A/1', { stageId: stages['price-review']!.id, deadline: inDays(-1) }) // overdue, in review
    await set('A/2', { stageId: stages.submitted!.id, deadline: inDays(-1) }) // submitted: left alone
    await set('A/3', { stageId: stages['in-progress']!.id, deadline: inDays(0) }) // due today: still open

    const result = await sweepOrganization(orgId, 'Asia/Kolkata', 3)
    expect(result.missedDeadline).toBe(1)

    const a1 = await request(app)
      .get(`/api/tenders/${ids['A/1']}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(a1.body.stage.label).toBe('Not bidded')
    expect(a1.body.history[0]).toMatchObject({ changedBy: null, from: { label: 'Price review' } })
    const [row] = await db.select().from(tenders).where(eq(tenders.id, ids['A/1']!))
    expect(row!.previousStageId).toBe(stages['price-review']!.id)
  })

  it('deletes New, unassigned tenders a few days after the deadline, but keeps the Watchlist', async () => {
    const { stages, set } = await setup()
    await set('A/1', { deadline: inDays(-4) }) // past the 3-day grace: deleted
    await set('A/2', { deadline: inDays(-2) }) // within grace: kept
    // Watchlist tenders are kept: someone chose to watch them.
    await set('A/3', { stageId: stages.watchlist!.id, deadline: inDays(-30) })

    const result = await sweepOrganization(orgId, 'Asia/Kolkata', 3)
    expect(result.deleted).toBe(1)
    expect((await listAll(ACME, adminToken)).items.map((t) => t.referenceNo).sort()).toEqual([
      'A/2',
      'A/3',
      'A/4',
    ])
  })

  it("uses the client's own date: late evening in India is already the next day", async () => {
    const { set } = await setup()
    await set('A/1', {
      stageId: (await stagesOf(ACME, adminToken))['in-progress']!.id,
      deadline: '2027-03-09',
    })
    // 19:00 UTC on 9 March is 00:30 on 10 March in India: the 9 March deadline has passed there.
    const at = new Date('2027-03-09T19:00:00Z')
    expect((await sweepOrganization(orgId, 'Asia/Kolkata', 3, at)).missedDeadline).toBe(1)
  })

  it('reminds the assigned person two days before the deadline and on the day, once each', async () => {
    const { stages, set } = await setup()
    const agent = await addUser(ACME, adminToken, 'agent', 'bids@acme.test')
    await set('A/1', {
      stageId: stages['in-progress']!.id,
      assignedAgentId: agent.id,
      deadline: inDays(2),
    })
    await set('A/2', {
      stageId: stages['price-review']!.id,
      assignedAgentId: agent.id,
      deadline: inDays(0),
    })
    // Already submitted, or nobody to remind: no reminder.
    await set('A/3', {
      stageId: stages.submitted!.id,
      assignedAgentId: agent.id,
      deadline: inDays(1),
    })
    await set('A/4', { stageId: stages['in-progress']!.id, deadline: inDays(1) })

    expect(await remindDeadlines(orgId, 'Asia/Kolkata')).toBe(2)
    // The job runs every hour: nothing is sent twice.
    expect(await remindDeadlines(orgId, 'Asia/Kolkata')).toBe(0)

    const list = await request(app)
      .get('/api/notifications')
      .set('Host', ACME)
      .set(bearer(agent.token))
    const titles = (list.body.items as { title: string }[]).map((n) => n.title).sort()
    expect(titles).toHaveLength(2)
    expect(titles[0]).toMatch(/^Bid due on .+: A\/1$/)
    expect(titles[1]).toMatch(/^Bid due today \(.+\): A\/2$/)

    // An extended deadline is reminded about again when it comes close.
    await set('A/1', { deadline: inDays(1) })
    expect(await remindDeadlines(orgId, 'Asia/Kolkata')).toBe(1)
  })
})
