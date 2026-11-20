import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { refreshTokens } from '../src/db/schema'
import {
  ADMIN_PASSWORD,
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  OWNER_HOST,
  refreshCookieFrom,
  resetDb,
  setupClient,
  tokenFromInviteUrl,
} from './helpers'

const ACME = hostOf('acme')

describe('client sign-in', () => {
  let ownerToken: string
  let planId: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    ownerToken = await loginOwner()
    planId = await createPlan()
  })

  it('accepting an invitation signs the user in, and the link works only once', async () => {
    const created = await request(app)
      .post('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ name: 'Acme', slug: 'acme', planId, adminName: 'Asha', adminEmail: 'asha@acme.test' })
    const token = tokenFromInviteUrl(created.body.inviteUrl)

    const preview = await request(app).get('/api/auth/invite').query({ token }).set('Host', ACME)
    expect(preview.body).toEqual({
      name: 'Asha',
      email: 'asha@acme.test',
      organizationName: 'Acme',
    })

    const accepted = await request(app)
      .post('/api/auth/accept-invite')
      .set('Host', ACME)
      .send({ token, password: ADMIN_PASSWORD })
    expect(accepted.status).toBe(200)
    expect(accepted.body.session).toMatchObject({
      realm: 'tenant',
      user: { email: 'asha@acme.test' },
      role: { key: 'admin' },
      organization: { slug: 'acme' },
    })
    expect(accepted.body.session.permissions).toContain('user.manage')

    const again = await request(app)
      .post('/api/auth/accept-invite')
      .set('Host', ACME)
      .send({ token, password: ADMIN_PASSWORD })
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('INVITE_INVALID')
  })

  it('an invitation link only works on its own client subdomain', async () => {
    await setupClient(ownerToken, planId, 'other')
    const created = await request(app)
      .post('/api/owner/organizations')
      .set('Host', OWNER_HOST)
      .set(bearer(ownerToken))
      .send({ name: 'Acme', slug: 'acme', planId, adminName: 'Asha', adminEmail: 'asha@acme.test' })
    const token = tokenFromInviteUrl(created.body.inviteUrl)
    const res = await request(app)
      .post('/api/auth/accept-invite')
      .set('Host', hostOf('other'))
      .send({ token, password: ADMIN_PASSWORD })
    expect(res.status).toBe(400)
  })

  it('logs in with the right password only, with the same error for unknown emails', async () => {
    await setupClient(ownerToken, planId, 'acme')
    const ok = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'ADMIN@acme.test', password: ADMIN_PASSWORD })
    expect(ok.status).toBe(200)
    expect(ok.headers['set-cookie']?.[0]).toMatch(/tdm_rt=.*HttpOnly/)

    const wrong = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'admin@acme.test', password: 'nope-nope' })
    const unknown = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'ghost@acme.test', password: 'nope-nope' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body).toEqual(unknown.body)
  })

  it('refresh gives a new session and retires the old refresh token', async () => {
    const { refreshCookie } = await setupClient(ownerToken, planId, 'acme')

    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    expect(first.status).toBe(200)
    expect(first.body.accessToken).toBeTruthy()
    const newCookie = refreshCookieFrom(first.headers['set-cookie'])
    expect(newCookie).not.toBe(refreshCookie)

    const me = await request(app)
      .get('/api/auth/me')
      .set('Host', ACME)
      .set(bearer(first.body.accessToken))
    expect(me.status).toBe(200)
  })

  it('reusing an old refresh token after the grace period ends every session of that user', async () => {
    const { refreshCookie } = await setupClient(ownerToken, planId, 'acme')
    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    const newCookie = refreshCookieFrom(first.headers['set-cookie'])

    // Pretend the old token was retired by a refresh a minute ago.
    const minuteAgo = new Date(Date.now() - 60_000)
    await db
      .update(refreshTokens)
      .set({ revokedAt: minuteAgo, rotatedAt: minuteAgo })
      .where(
        eq(
          refreshTokens.tokenHash,
          (await import('../src/lib/tokens')).sha256(refreshCookie.slice(7)),
        ),
      )

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    expect(reuse.status).toBe(401)

    const legit = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', newCookie)
    expect(legit.status).toBe(401)
  })

  it('two tabs refreshing with the same token at the same moment both succeed', async () => {
    const { refreshCookie } = await setupClient(ownerToken, planId, 'acme')
    const tabA = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    const tabB = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    expect(tabA.status).toBe(200)
    expect(tabB.status).toBe(200)
  })

  it('logout retires the refresh token', async () => {
    const { refreshCookie } = await setupClient(ownerToken, planId, 'acme')
    const out = await request(app)
      .post('/api/auth/logout')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    expect(out.status).toBe(204)
    const after = await request(app)
      .post('/api/auth/refresh')
      .set('Host', ACME)
      .set('Cookie', refreshCookie)
    expect(after.status).toBe(401)
  })

  it('rejects missing, malformed and tampered access tokens', async () => {
    const { adminToken } = await setupClient(ownerToken, planId, 'acme')
    expect((await request(app).get('/api/auth/me').set('Host', ACME)).status).toBe(401)
    expect(
      (await request(app).get('/api/auth/me').set('Host', ACME).set(bearer('junk'))).status,
    ).toBe(401)
    const tampered = adminToken.slice(0, -4) + (adminToken.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(
      (await request(app).get('/api/auth/me').set('Host', ACME).set(bearer(tampered))).status,
    ).toBe(401)
  })

  it('validates input and refuses bad JSON', async () => {
    const bad = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'not-an-email' })
    expect(bad.status).toBe(404) // no client "acme" yet
    await setupClient(ownerToken, planId, 'acme')
    const invalid = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'not-an-email' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR')
    const json = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .set('Content-Type', 'application/json')
      .send('{"email":')
    expect(json.status).toBe(400)
    expect(json.body.error.code).toBe('INVALID_JSON')
  })
})
