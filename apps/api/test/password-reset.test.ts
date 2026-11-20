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
  OWNER_EMAIL,
  OWNER_HOST,
  resetDb,
  setupClient,
} from './helpers'

const ACME = hostOf('acme')
const linkToken = (text: string) =>
  new URL(text.match(/https?:\/\/\S+reset-password\?token=\S+/)![0]).searchParams.get('token')!

describe('forgot password', () => {
  let client: Awaited<ReturnType<typeof setupClient>>

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    client = await setupClient(await loginOwner(), await createPlan(), 'acme')
    await drainJobs()
    testOutbox.length = 0
  })

  async function requestReset(host: string, email: string) {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('Host', host)
      .send({ email })
    expect(res.status).toBe(202)
    await drainJobs()
  }

  it('emails a one-time link that sets a new password and ends old sessions', async () => {
    await requestReset(ACME, 'admin@acme.test')
    expect(testOutbox).toHaveLength(1)
    expect(testOutbox[0]!.text).toContain('http://acme.localhost:5173/reset-password?token=')
    const token = linkToken(testOutbox[0]!.text)

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .set('Host', ACME)
      .send({ token, password: 'brand-new-pass-1' })
    expect(reset.status).toBe(204)

    const old = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'admin@acme.test', password: ADMIN_PASSWORD })
    expect(old.status).toBe(401)
    const fresh = await request(app)
      .post('/api/auth/login')
      .set('Host', ACME)
      .send({ email: 'admin@acme.test', password: 'brand-new-pass-1' })
    expect(fresh.status).toBe(200)

    expect(
      (await request(app).get('/api/auth/me').set('Host', ACME).set(bearer(client.adminToken)))
        .status,
    ).toBe(401)
    expect(
      (
        await request(app)
          .post('/api/auth/refresh')
          .set('Host', ACME)
          .set('Cookie', client.refreshCookie)
      ).status,
    ).toBe(401)

    const again = await request(app)
      .post('/api/auth/reset-password')
      .set('Host', ACME)
      .send({ token, password: 'another-pass-22' })
    expect(again.body.error.code).toBe('RESET_INVALID')
  })

  it('gives the same answer for unknown emails and sends nothing', async () => {
    await requestReset(ACME, 'nobody@acme.test')
    expect(testOutbox).toHaveLength(0)
  })

  it('a reset link only works on its own subdomain', async () => {
    await setupClient(await loginOwner(), await createPlan(), 'other')
    await drainJobs()
    testOutbox.length = 0
    await requestReset(ACME, 'admin@acme.test')
    const token = linkToken(testOutbox[0]!.text)
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Host', hostOf('other'))
      .send({ token, password: 'brand-new-pass-1' })
    expect(res.body.error.code).toBe('RESET_INVALID')
  })

  it('works for the owner panel too', async () => {
    await requestReset(OWNER_HOST, OWNER_EMAIL)
    expect(testOutbox[0]!.text).toContain('http://owner.localhost:5173/reset-password?token=')
    const res = await request(app)
      .post('/api/auth/reset-password')
      .set('Host', OWNER_HOST)
      .send({ token: linkToken(testOutbox[0]!.text), password: 'owner-new-pass-1' })
    expect(res.status).toBe(204)
    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', OWNER_HOST)
      .send({ email: OWNER_EMAIL, password: 'owner-new-pass-1' })
    expect(login.status).toBe(200)
  })
})
