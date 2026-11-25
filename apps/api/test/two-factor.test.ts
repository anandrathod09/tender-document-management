import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/lib/secrets'
import {
  base32Decode,
  base32Encode,
  currentStep,
  generateRecoveryCodes,
  totpAt,
  verifyTotp,
} from '../src/lib/totp'
import {
  ADMIN_PASSWORD,
  app,
  bearer,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  OWNER_EMAIL,
  OWNER_HOST,
  OWNER_PASSWORD,
  resetDb,
  setupClient,
} from './helpers'
import { addUser } from './tender-helpers'

const ACME = hostOf('acme')

describe('one-time codes', () => {
  it('match the RFC 6238 test vector', () => {
    // Secret "12345678901234567890" at 59 seconds gives 94287082 (8 digits).
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    expect(totpAt(secret, 1, 8)).toBe('94287082')
    expect(totpAt(secret, 1)).toBe('287082')
    expect(base32Decode(secret).toString()).toBe('12345678901234567890')
  })

  it('accept one step of clock drift and each code only once', () => {
    const secret = base32Encode(Buffer.from('another-secret-for-tests'))
    const now = Date.now()
    const step = currentStep(now)
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1)
    expect(verifyTotp(secret, totpAt(secret, step + 1), null, now)).toBe(step + 1)
    expect(verifyTotp(secret, totpAt(secret, step + 2), null, now)).toBeNull()
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull()
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull()
  })

  it('backup codes are unique and readable; stored secrets round-trip', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/)
    const stored = encryptSecret('JBSWY3DPEHPK3PXP')
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP')
    expect(decryptSecret(stored)).toBe('JBSWY3DPEHPK3PXP')
  })
})

describe('two-step login', () => {
  let adminToken: string

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
  })

  const api = (host: string, token?: string) => ({
    get: (p: string) => {
      const r = request(app).get(`/api${p}`).set('Host', host)
      return token ? r.set(bearer(token)) : r
    },
    post: (p: string, body: object = {}) => {
      const r = request(app).post(`/api${p}`).set('Host', host)
      return (token ? r.set(bearer(token)) : r).send(body)
    },
    patch: (p: string, body: object) => {
      const r = request(app).patch(`/api${p}`).set('Host', host)
      return (token ? r.set(bearer(token)) : r).send(body)
    },
  })

  /** Turns on two-step login for the token's account; returns the secret and step used. */
  async function turnOn(host: string, token: string) {
    const setup = await api(host, token).post('/auth/2fa/setup')
    expect(setup.status).toBe(200)
    const secret = setup.body.secret as string
    expect(setup.body.otpauthUrl).toContain(`secret=${secret}`)
    const step = currentStep()
    const enabled = await api(host, token).post('/auth/2fa/enable', { code: totpAt(secret, step) })
    expect(enabled.status).toBe(200)
    return { secret, step, recoveryCodes: enabled.body.recoveryCodes as string[] }
  }

  it('set up, sign in with a code or a backup code, renew codes and turn off', async () => {
    const me = api(ACME, adminToken)
    expect((await me.get('/auth/2fa')).body).toEqual({
      enabled: false,
      required: false,
      recoveryCodesLeft: 0,
    })

    // A wrong code does not turn it on.
    await me.post('/auth/2fa/setup')
    expect((await me.post('/auth/2fa/enable', { code: '000000' })).body.error.code).toBe(
      'TWO_FACTOR_INVALID',
    )
    const { secret, step, recoveryCodes } = await turnOn(ACME, adminToken)
    expect(recoveryCodes).toHaveLength(10)
    expect((await me.get('/auth/2fa')).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 })
    expect((await me.post('/auth/2fa/setup')).body.error.code).toBe('TWO_FACTOR_ALREADY_ON')

    // New backup codes need a fresh code from the app.
    const renewed = await me.post('/auth/2fa/recovery-codes', { code: totpAt(secret, step + 1) })
    expect(renewed.status).toBe(200)
    const codes = renewed.body.recoveryCodes as string[]
    expect(codes).not.toEqual(recoveryCodes)

    // The password alone now only gives a challenge, not a session.
    const login = await api(ACME).post('/auth/login', {
      email: 'admin@acme.test',
      password: ADMIN_PASSWORD,
    })
    expect(login.body).toEqual({ twoFactorRequired: true, challengeToken: expect.any(String) })
    expect(login.headers['set-cookie']).toBeUndefined()
    const challengeToken = login.body.challengeToken as string
    // The challenge is not an access token.
    expect((await api(ACME, challengeToken).get('/tenders')).status).toBe(401)

    // Wrong code, a used code, an old backup code: all refused.
    const second = (code: string) => api(ACME).post('/auth/login/2fa', { challengeToken, code })
    expect((await second('123456')).body.error.code).toBe('TWO_FACTOR_INVALID')
    expect((await second(totpAt(secret, step + 1))).status).toBe(401)
    expect((await second(recoveryCodes[0]!)).status).toBe(401)

    // A current backup code works once (in any case, with or without the dash).
    const viaBackup = await second(codes[0]!.toUpperCase().replace('-', ''))
    expect(viaBackup.status).toBe(200)
    expect(viaBackup.body.session.twoFactor).toEqual({ enabled: true, required: false })
    expect((await second(codes[0]!)).status).toBe(401)
    expect((await me.get('/auth/2fa')).body.recoveryCodesLeft).toBe(9)

    // Turning off needs the password.
    expect((await me.post('/auth/2fa/disable', { password: 'wrong' })).status).toBe(401)
    expect((await me.post('/auth/2fa/disable', { password: ADMIN_PASSWORD })).status).toBe(204)
    const plain = await api(ACME).post('/auth/login', {
      email: 'admin@acme.test',
      password: ADMIN_PASSWORD,
    })
    expect(plain.body.accessToken).toEqual(expect.any(String))
  })

  it('a workspace can require it; admins can reset a user who lost their phone', async () => {
    const admin = api(ACME, adminToken)
    // The admin has to use it themselves first.
    const early = await admin.patch('/workspace/settings', { requireTwoFactor: true })
    expect(early.body.error.code).toBe('TWO_FACTOR_SETUP_FIRST')
    await turnOn(ACME, adminToken)
    expect((await admin.patch('/workspace/settings', { requireTwoFactor: true })).body).toEqual({
      requireTwoFactor: true,
      agentsSeeAssets: false,
      agentsSeeInstallation: true,
      cleanupDays: 3,
    })

    // Someone without it can sign in, but only reach the setup.
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    const asAgent = api(ACME, agent.token)
    expect((await asAgent.get('/tenders')).body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED')
    expect((await asAgent.get('/auth/me')).body.twoFactor).toEqual({
      enabled: false,
      required: true,
    })
    expect((await asAgent.get('/auth/2fa')).body.required).toBe(true)
    await turnOn(ACME, agent.token)
    expect((await asAgent.get('/tenders')).status).toBe(200)
    // While required it cannot be turned off.
    const off = await asAgent.post('/auth/2fa/disable', { password: 'user-password-123' })
    expect(off.body.error.code).toBe('TWO_FACTOR_REQUIRED')

    // Agents can't reset anyone; admins can, which also signs the person out.
    expect((await asAgent.post(`/users/${agent.id}/reset-two-factor`)).status).toBe(403)
    const users = await admin.get('/users')
    expect(users.body.find((u: { id: string }) => u.id === agent.id).twoFactorEnabled).toBe(true)
    const reset = await admin.post(`/users/${agent.id}/reset-two-factor`)
    expect(reset.body.twoFactorEnabled).toBe(false)
    expect((await asAgent.get('/auth/me')).status).toBe(401)
    expect((await admin.post(`/users/${agent.id}/reset-two-factor`)).body.error.code).toBe(
      'TWO_FACTOR_OFF',
    )
    const self = await admin.post(
      `/users/${(await admin.get('/auth/me')).body.user.id}/reset-two-factor`,
    )
    expect(self.body.error.code).toBe('USE_SECURITY_PAGE')
  })

  it('works for the owner panel too, and a challenge only works where it was issued', async () => {
    const ownerToken = await loginOwner()
    const { secret, step } = await turnOn(OWNER_HOST, ownerToken)
    const login = await api(OWNER_HOST).post('/auth/login', {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    })
    expect(login.body.twoFactorRequired).toBe(true)

    // The owner's challenge cannot be finished on a client's address.
    const elsewhere = await api(ACME).post('/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: totpAt(secret, step + 1),
    })
    expect(elsewhere.body.error.code).toBe('CHALLENGE_INVALID')

    const done = await api(OWNER_HOST).post('/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: totpAt(secret, step + 1),
    })
    expect(done.status).toBe(200)
    expect(done.body.session).toMatchObject({ realm: 'platform', twoFactor: { enabled: true } })
  })

  it("a challenge from one client cannot be used on another client's address", async () => {
    const other = await setupClient(await loginOwner(), await createPlan(), 'bravo')
    const { secret, step } = await turnOn(ACME, adminToken)
    const login = await api(ACME).post('/auth/login', {
      email: 'admin@acme.test',
      password: ADMIN_PASSWORD,
    })
    const res = await api(hostOf('bravo')).post('/auth/login/2fa', {
      challengeToken: login.body.challengeToken,
      code: totpAt(secret, step + 1),
    })
    expect(res.body.error.code).toBe('CHALLENGE_INVALID')
    expect(other.adminToken).toEqual(expect.any(String))
  })
})
