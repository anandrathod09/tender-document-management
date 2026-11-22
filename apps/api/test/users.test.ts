import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RoleSummary } from '@tdm/shared'
import {
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  resetDb,
  setupClient,
  tokenFromInviteUrl,
} from './helpers'

const ACME = hostOf('acme')

async function rolesOf(token: string): Promise<Record<string, RoleSummary>> {
  const res = await request(app).get('/api/roles').set('Host', ACME).set(bearer(token))
  return Object.fromEntries((res.body as RoleSummary[]).map((r) => [r.key, r]))
}

async function inviteAndAccept(adminToken: string, roleId: string, email: string) {
  const invited = await request(app)
    .post('/api/users')
    .set('Host', ACME)
    .set(bearer(adminToken))
    .send({ name: email.split('@')[0], email, roleId })
  const accepted = await request(app)
    .post('/api/auth/accept-invite')
    .set('Host', ACME)
    .send({ token: tokenFromInviteUrl(invited.body.inviteUrl), password: 'user-password-123' })
  return { userId: invited.body.user.id as string, token: accepted.body.accessToken as string }
}

describe('user management', () => {
  let adminToken: string
  let adminId: string
  let roles: Record<string, RoleSummary>

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    const client = await setupClient(await loginOwner(), await createPlan(3), 'acme')
    adminToken = client.adminToken
    adminId = client.adminId
    roles = await rolesOf(adminToken)
  })

  it('has the four default roles', () => {
    expect(Object.keys(roles).sort()).toEqual(['admin', 'agent', 'engineer', 'viewer'])
  })

  it('invites a user, who appears as invited', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({
        name: 'Ravi',
        email: 'ravi@acme.test',
        phone: '+91 98220 12345',
        roleId: roles.agent!.id,
      })
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({
      email: 'ravi@acme.test',
      phone: '+91 98220 12345',
      status: 'invited',
      role: { key: 'agent' },
    })

    // The phone number can be changed or cleared, and must look like one.
    const edit = (phone: unknown) =>
      request(app)
        .patch(`/api/users/${res.body.user.id}`)
        .set('Host', ACME)
        .set(bearer(adminToken))
        .send({ phone })
    expect((await edit('9822012345')).body.phone).toBe('9822012345')
    expect((await edit('')).body.phone).toBeNull()
    expect((await edit('call me')).status).toBe(400)

    const list = await request(app).get('/api/users').set('Host', ACME).set(bearer(adminToken))
    expect(list.body.map((u: { email: string }) => u.email)).toContain('ravi@acme.test')

    // Engineers need a phone number, when invited or when someone becomes one.
    const noPhone = await request(app)
      .post('/api/users')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ name: 'Esha', email: 'esha@acme.test', roleId: roles.engineer!.id })
    expect(noPhone.body.error).toMatchObject({
      code: 'PHONE_REQUIRED',
      details: [expect.objectContaining({ field: 'phone' })],
    })
    const toEngineer = await request(app)
      .patch(`/api/users/${res.body.user.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ roleId: roles.engineer!.id })
    expect(toEngineer.body.error.code).toBe('PHONE_REQUIRED')
    const withPhone = await request(app)
      .patch(`/api/users/${res.body.user.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ roleId: roles.engineer!.id, phone: '9822012345' })
    expect(withPhone.body.role.key).toBe('engineer')
    expect((await edit('')).body.error.code).toBe('PHONE_REQUIRED')
  })

  it('refuses a duplicate email and enforces the plan user limit', async () => {
    const send = (email: string) =>
      request(app)
        .post('/api/users')
        .set('Host', ACME)
        .set(bearer(adminToken))
        .send({ name: 'X', email, roleId: roles.viewer!.id })

    expect((await send('admin@acme.test')).body.error.code).toBe('EMAIL_TAKEN')
    expect((await send('one@acme.test')).status).toBe(201)
    expect((await send('two@acme.test')).status).toBe(201)
    const over = await send('three@acme.test') // plan allows 3 users
    expect(over.status).toBe(409)
    expect(over.body.error.code).toBe('PLAN_USER_LIMIT')
  })

  it('only users with the user.manage permission can manage users', async () => {
    const agent = await inviteAndAccept(adminToken, roles.agent!.id, 'agent@acme.test')
    const res = await request(app).get('/api/users').set('Host', ACME).set(bearer(agent.token))
    expect(res.status).toBe(403)
  })

  it('keeps at least one active admin and stops admins suspending themselves', async () => {
    const self = await request(app)
      .patch(`/api/users/${adminId}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'suspended' })
    expect(self.body.error.code).toBe('CANNOT_SUSPEND_SELF')

    const demote = await request(app)
      .patch(`/api/users/${adminId}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ roleId: roles.agent!.id })
    expect(demote.status).toBe(409)
    expect(demote.body.error.code).toBe('LAST_ADMIN')
  })

  it('suspending a user or changing their role ends their current session', async () => {
    const agent = await inviteAndAccept(adminToken, roles.agent!.id, 'agent@acme.test')
    expect(
      (await request(app).get('/api/auth/me').set('Host', ACME).set(bearer(agent.token))).status,
    ).toBe(200)

    await request(app)
      .patch(`/api/users/${agent.userId}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ roleId: roles.viewer!.id })
    expect(
      (await request(app).get('/api/auth/me').set('Host', ACME).set(bearer(agent.token))).status,
    ).toBe(401)

    const viewer = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'agent@acme.test', password: 'user-password-123' })
    expect(viewer.body.session.role.key).toBe('viewer')

    await request(app)
      .patch(`/api/users/${agent.userId}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'suspended' })
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Host', ACME)
          .set(bearer(viewer.body.accessToken))
      ).status,
    ).toBe(401)
    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'agent@acme.test', password: 'user-password-123' })
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED')
  })

  it('a cancelled invitation comes back as "invited" and respects the user limit', async () => {
    const invite = (email: string) =>
      request(app)
        .post('/api/users')
        .set('Host', ACME)
        .set(bearer(adminToken))
        .send({ name: 'X', email, roleId: roles.viewer!.id })
    const first = await invite('one@acme.test')
    await request(app)
      .patch(`/api/users/${first.body.user.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'suspended' })

    // Plan allows 3: admin + two more, with "one" suspended.
    expect((await invite('two@acme.test')).status).toBe(201)
    expect((await invite('three@acme.test')).status).toBe(201)
    const blocked = await request(app)
      .patch(`/api/users/${first.body.user.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'active' })
    expect(blocked.body.error.code).toBe('PLAN_USER_LIMIT')

    const third = await request(app).get('/api/users').set('Host', ACME).set(bearer(adminToken))
    const threeId = third.body.find((u: { email: string }) => u.email === 'three@acme.test').id
    await request(app)
      .patch(`/api/users/${threeId}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'suspended' })
    const back = await request(app)
      .patch(`/api/users/${first.body.user.id}`)
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ status: 'active' })
    expect(back.status).toBe(200)
    expect(back.body.status).toBe('invited')
  })

  it('resends an invitation, and the old link stops working', async () => {
    const invited = await request(app)
      .post('/api/users')
      .set('Host', ACME)
      .set(bearer(adminToken))
      .send({ name: 'Ravi', email: 'ravi@acme.test', roleId: roles.agent!.id })
    const resent = await request(app)
      .post(`/api/users/${invited.body.user.id}/resend-invite`)
      .set('Host', ACME)
      .set(bearer(adminToken))
    expect(resent.status).toBe(200)

    const old = await request(app)
      .post('/api/auth/accept-invite')
      .set('Host', ACME)
      .send({ token: tokenFromInviteUrl(invited.body.inviteUrl), password: 'user-password-123' })
    expect(old.status).toBe(400)
    const fresh = await request(app)
      .post('/api/auth/accept-invite')
      .set('Host', ACME)
      .send({ token: tokenFromInviteUrl(resent.body.inviteUrl), password: 'user-password-123' })
    expect(fresh.status).toBe(200)
  })
})
