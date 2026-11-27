import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { EmailPreferences, StageSummary } from '@tdm/shared'
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
import { addUser, importFile, listAll, stagesOf, t247Row, workbook } from './tender-helpers'

const ACME = hostOf('acme')

describe('emails for tender events', () => {
  let adminToken: string
  let adminId: string
  let agent: { id: string; token: string }
  let engineer: { id: string; token: string }
  let ids: Record<string, string>

  /** The emails sent since the last call (setup emails are cleared in beforeEach). */
  async function sent() {
    await drainJobs()
    const mails = [...testOutbox]
    testOutbox.length = 0
    return mails
  }
  const assign = (id: string, agentId: string, token = adminToken, note?: string) =>
    request(app)
      .post(`/api/tenders/${id}/assign`)
      .set('Host', ACME)
      .set(bearer(token))
      .send({ agentId, note })

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    const client = await setupClient(await loginOwner(), await createPlan(), 'acme')
    adminToken = client.adminToken
    adminId = client.adminId
    await allowAnyMove('acme')
    await importFile(
      ACME,
      adminToken,
      await workbook({ S: [t247Row('PWD/1'), t247Row('PWD/2'), t247Row('PWD/3')] }),
    )
    ids = Object.fromEntries(
      (await listAll(ACME, adminToken)).items.map((t) => [t.referenceNo, t.id]),
    )
    agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    engineer = await addUser(ACME, adminToken, 'engineer', 'eng@acme.test')
    await sent() // the invitations
  })

  it('emails the agent when a tender is assigned, but not for your own action', async () => {
    expect((await assign(ids['PWD/1']!, agent.id, adminToken, 'Check the EMD')).status).toBe(200)
    const [mail, ...rest] = await sent()
    expect(rest).toEqual([])
    expect(mail).toMatchObject({
      to: 'agent@acme.test',
      fromName: 'acme Pvt Ltd',
      subject: 'Tender assigned to you: PWD/1',
    })
    expect(mail!.text).toContain('Note from acme Admin: Check the EMD')
    expect(mail!.text).toContain(`/tenders/${ids['PWD/1']}`)
    expect(mail!.text).toContain('/account/notifications')

    // Assigning to yourself sends nothing; so does re-assigning to the same person.
    await assign(ids['PWD/2']!, adminId)
    await assign(ids['PWD/1']!, agent.id)
    expect(await sent()).toEqual([])
  })

  it('sends one email for a bulk assign, listing every tender', async () => {
    const res = await request(app)
      .post('/api/tenders/bulk')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ action: 'assign', ids: [ids['PWD/1'], ids['PWD/2'], ids['PWD/3']], agentId: agent.id })
    expect(res.status).toBe(200)
    const mails = await sent()
    expect(mails).toHaveLength(1)
    expect(mails[0]!.subject).toBe('3 tenders assigned to you')
    for (const ref of ['PWD/1', 'PWD/2', 'PWD/3']) expect(mails[0]!.text).toContain(ref)
  })

  it('lets each person switch an email off for themselves', async () => {
    const prefs = (agentToken = agent.token) =>
      request(app).get('/api/account/email-preferences').set('Host', ACME).set(bearer(agentToken))
    expect((await prefs()).body).toEqual({
      tender_assigned: true,
      engineer_assigned: true,
      ticket_assigned: true,
    } satisfies EmailPreferences)

    const off = await request(app)
      .patch('/api/account/email-preferences')
      .set('Host', ACME)
      .set(bearer(agent.token))
      .send({ tender_assigned: false })
    expect(off.body).toMatchObject({ tender_assigned: false, ticket_assigned: true })
    expect((await prefs()).body.tender_assigned).toBe(false)

    await assign(ids['PWD/1']!, agent.id)
    expect(await sent()).toEqual([])
    // The in-app notification still arrives.
    const bell = await request(app).get('/api/notifications').set('Host', ACME).set(bearer(agent.token))
    expect(bell.body.items[0].title).toBe('Tender assigned to you')

    const bad = await request(app)
      .patch('/api/account/email-preferences')
      .set('Host', ACME)
      .set(bearer(agent.token))
      .send({})
    expect(bad.status).toBe(400)
  })

  it('emails the engineer once per save, listing their new consignees', async () => {
    const stages: Record<string, StageSummary> = await stagesOf(ACME, adminToken)
    const tenderId = ids['PWD/1']!
    await request(app)
      .post(`/api/tenders/${tenderId}/move`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ stageId: stages.won!.id, awardAmount: 1000, awardNumber: 'PO-1' })
    await sent()
    const save = (engineerId: string | null, consigneeIds: (string | undefined)[] = []) =>
      request(app)
        .put(`/api/tenders/${tenderId}/installation-report`)
        .set('Host', ACME)
        .set(bearer(adminToken))
        .send({
          customerName: 'District Hospital',
          consignees: [
            { id: consigneeIds[0], name: 'Stores Officer', engineerId, items: [] },
            { id: consigneeIds[1], name: 'Ward 4', engineerId, items: [] },
          ],
        })
    const first = await save(engineer.id)
    expect(first.status).toBe(200)
    const kept = (first.body.consignees as { id: string }[]).map((c) => c.id)
    const mails = await sent()
    expect(mails.map((m) => m.to)).toEqual(['eng@acme.test'])
    expect(mails[0]!.subject).toBe('Installation assigned to you: PWD/1')
    expect(mails[0]!.text).toContain('Consignees: Stores Officer, Ward 4')
    expect(mails[0]!.text).toContain('Customer: District Hospital')

    // Saving again without changing the engineer sends nothing.
    await save(engineer.id, kept)
    expect(await sent()).toEqual([])
  })

  it('emails the person a service ticket is assigned to, and on reassignment', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({
        title: 'Printer jams',
        description: 'Paper jams on every page',
        priority: 'high',
        assignedTo: engineer.id,
      })
    expect(created.status).toBe(201)
    const [mail] = await sent()
    expect(mail).toMatchObject({
      to: 'eng@acme.test',
      subject: 'Ticket TKT-0001 assigned to you: Printer jams',
    })
    expect(mail!.text).toContain('Priority: High')

    const second = await addUser(ACME, adminToken, 'engineer', 'eng2@acme.test')
    await sent()
    await request(app)
      .patch(`/api/tickets/${created.body.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ assignedTo: second.id })
    expect((await sent()).map((m) => m.to)).toEqual(['eng2@acme.test'])
  })
})
