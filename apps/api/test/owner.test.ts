import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { testOutbox } from '../src/lib/mailer'
import {
  ADMIN_PASSWORD,
  app,
  bearer,
  createOwner,
  createPlan,
  drainJobs,
  hostOf,
  loginOwner,
  OWNER_HOST,
  resetDb,
  setupClient,
} from './helpers'

describe('owner panel', () => {
  let ownerToken: string
  let planId: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    ownerToken = await loginOwner()
    planId = await createPlan()
  })

  it('creates a client with default roles and emails the admin an invitation', async () => {
    const res = await request(app)
      .post('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({
        name: 'Acme Infra',
        slug: 'Acme',
        planId,
        adminName: 'Asha',
        adminEmail: 'Asha@Acme.test',
      })
    expect(res.status).toBe(201)
    expect(res.body.organization).toMatchObject({
      slug: 'acme',
      name: 'Acme Infra',
      status: 'trial',
      userCount: 1,
      admins: [{ name: 'Asha', email: 'asha@acme.test', status: 'invited' }],
    })
    expect(res.body.inviteUrl).toMatch(/^http:\/\/acme\.localhost:5173\/accept-invite\?token=/)
    // Emails go through the job queue.
    expect(testOutbox).toHaveLength(0)
    await drainJobs()
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]!.to).toBe('asha@acme.test')
    expect(testOutbox[0]!.text).toContain(res.body.inviteUrl)
    // The designed version has the same link behind the button.
    expect(testOutbox[0]!.html).toContain(`href="${res.body.inviteUrl}"`)
    expect(testOutbox[0]!.html).toContain('Set Up Your Account')

    const list = await request(app)
      .get('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
    expect(list.body).toHaveLength(1)
  })

  it('refuses reserved and duplicate subdomains', async () => {
    const base = { name: 'X Co', planId, adminName: 'X', adminEmail: 'x@x.test' }
    const reserved = await request(app)
      .post('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ ...base, slug: 'admin' })
    expect(reserved.status).toBe(400)
    expect(reserved.body.error.code).toBe('VALIDATION_ERROR')

    await setupClient(ownerToken, planId, 'acme')
    const dup = await request(app)
      .post('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ ...base, slug: 'acme' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('SLUG_TAKEN')
  })

  it('suspending a client blocks its users until it is reactivated', async () => {
    const { org, adminToken } = await setupClient(ownerToken, planId, 'acme')

    const suspend = await request(app)
      .patch(`/api/owner/organizations/${org.id}`)
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ status: 'suspended' })
    expect(suspend.status).toBe(200)
    expect(suspend.body.status).toBe('suspended')

    const me = await request(app)
      .get('/api/auth/me')
      .set('Host', hostOf('acme'))
      .set(bearer(adminToken))
    expect(me.status).toBe(403)
    expect(me.body.error.code).toBe('WORKSPACE_SUSPENDED')

    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', hostOf('acme'))
      .send({ email: 'admin@acme.test', password: ADMIN_PASSWORD })
    expect(login.status).toBe(403)

    await request(app)
      .patch(`/api/owner/organizations/${org.id}`)
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ status: 'active' })
    const meAgain = await request(app)
      .get('/api/auth/me')
      .set('Host', hostOf('acme'))
      .set(bearer(adminToken))
    expect(meAgain.status).toBe(200)
  })

  it('owner endpoints only work on the owner subdomain with an owner token', async () => {
    const { adminToken } = await setupClient(ownerToken, planId, 'acme')

    const wrongHost = await request(app)
      .get('/api/owner/organizations')
      .set('Host', hostOf('acme'))
      .set(bearer(ownerToken))
    expect(wrongHost.status).toBe(404)

    const clientToken = await request(app)
      .get('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(adminToken))
    expect(clientToken.status).toBe(401)

    const noToken = await request(app).get('/api/owner/organizations').set('Host', OWNER_HOST)
    expect(noToken.status).toBe(401)
  })

  it('an owner token does not work on a client subdomain', async () => {
    await setupClient(ownerToken, planId, 'acme')
    const res = await request(app)
      .get('/api/users')
      .set('Host', hostOf('acme'))
      .set(bearer(ownerToken))
    expect(res.status).toBe(401)
  })
})
