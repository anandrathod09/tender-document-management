import { Router, type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import {
  acceptInviteSchema,
  disableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  twoFactorCodeSchema,
  twoFactorLoginSchema,
  type LoginResponse,
} from '@tdm/shared'
import { requestPasswordReset, resetPassword } from './password-reset'
import { env } from '../../config/env'
import { badRequest, notFound, unauthorized } from '../../lib/errors'
import { parse } from '../../lib/validate'
import {
  authenticatePlatform,
  authenticateTenant,
  platformAuth,
  tenantAuth,
} from '../../middleware/auth'
import { assertOwnerHost, assertTenant } from '../../middleware/workspace'
import {
  acceptInvite,
  buildPlatformSession,
  buildTenantSession,
  getInvite,
  loginPlatform,
  loginPlatformTwoFactor,
  loginTenant,
  loginTenantTwoFactor,
  logout,
  type LoginResult,
  refreshSession,
  type ClientMeta,
  type IssuedTokens,
} from './service'
import {
  disableTwoFactor,
  enableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  twoFactorStatus,
  type AccountRef,
} from './two-factor'

const REFRESH_COOKIE = 'tdm_rt'

// No domain attribute: the cookie belongs to this exact subdomain only, so a
// session on acme.<domain> is never sent to another client's subdomain.
const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/api/auth',
}

function sendSession(
  res: Response,
  result: { tokens: IssuedTokens; session: LoginResponse['session'] },
) {
  res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, {
    ...cookieOptions,
    expires: result.tokens.refreshExpiresAt,
  })
  const body: LoginResponse = { accessToken: result.tokens.accessToken, session: result.session }
  res.json(body)
}

/** A session, or (when two-step login is on) the challenge for the second step. */
function sendLoginResult(res: Response, result: LoginResult) {
  if ('challenge' in result) res.json(result.challenge)
  else sendSession(res, result)
}

const meta = (req: Request): ClientMeta => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
})

const skipInTests = () => env.NODE_ENV === 'test'
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again in 15 minutes.' },
  },
})
const refreshLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
})

export const authRouter = Router()

authRouter.post('/login', loginLimiter, async (req, res) => {
  // Check the workspace before the form, so an unknown address always says so.
  if (req.ctx.kind === 'owner') {
    const input = parse(loginSchema, req.body)
    sendLoginResult(res, await loginPlatform(input, meta(req)))
    return
  }
  const org = assertTenant(req)
  const input = parse(loginSchema, req.body)
  sendLoginResult(res, await loginTenant(org, input, meta(req)))
})

authRouter.post('/login/2fa', loginLimiter, async (req, res) => {
  if (req.ctx.kind === 'owner') {
    assertOwnerHost(req)
    sendSession(res, await loginPlatformTwoFactor(parse(twoFactorLoginSchema, req.body), meta(req)))
    return
  }
  const org = assertTenant(req)
  const input = parse(twoFactorLoginSchema, req.body)
  sendSession(res, await loginTenantTwoFactor(org, input, meta(req)))
})

authRouter.post('/refresh', refreshLimiter, async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined
  if (!raw) throw unauthorized('REFRESH_INVALID', 'Please sign in again')
  if (req.ctx.kind === 'owner') assertOwnerHost(req)
  else assertTenant(req)
  try {
    sendSession(res, await refreshSession(req.ctx, raw, meta(req)))
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions)
    throw err
  }
})

authRouter.post('/logout', async (req, res) => {
  await logout(req.cookies?.[REFRESH_COOKIE] as string | undefined)
  res.clearCookie(REFRESH_COOKIE, cookieOptions)
  res.status(204).end()
})

authRouter.get(
  '/me',
  async (req, res, next) => {
    if (req.ctx.kind === 'owner') return authenticatePlatform(req, res, next)
    if (req.ctx.kind === 'tenant') return authenticateTenant(req, res, next)
    throw notFound()
  },
  (req, res) => {
    if (req.ctx.kind === 'owner') {
      res.json(buildPlatformSession(platformAuth(req).user))
      return
    }
    const { org, user, role } = tenantAuth(req)
    res.json(buildTenantSession(org, user, role))
  },
)

authRouter.get('/invite', loginLimiter, async (req, res) => {
  const org = assertTenant(req)
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!token) throw badRequest('INVITE_INVALID', 'Invitation link is missing its token')
  res.json(await getInvite(org, token))
})

authRouter.post('/accept-invite', loginLimiter, async (req, res) => {
  const org = assertTenant(req)
  const input = parse(acceptInviteSchema, req.body)
  sendSession(res, await acceptInvite(org, input, meta(req)))
})

/** Always answers the same way, whether or not the email has an account. */
authRouter.post('/forgot-password', loginLimiter, async (req, res) => {
  if (req.ctx.kind !== 'owner') assertTenant(req)
  const { email } = parse(forgotPasswordSchema, req.body)
  await requestPasswordReset(req.ctx, email)
  res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' })
})

authRouter.post('/reset-password', loginLimiter, async (req, res) => {
  if (req.ctx.kind !== 'owner') assertTenant(req)
  const { token, password } = parse(resetPasswordSchema, req.body)
  await resetPassword(req.ctx, token, password, req.ip ?? null)
  res.clearCookie(REFRESH_COOKIE, cookieOptions)
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Two-step login for the signed-in user (client users and owner panel alike)
// ---------------------------------------------------------------------------

function authenticateAny(req: Request, res: Response, next: NextFunction) {
  if (req.ctx.kind === 'owner') return authenticatePlatform(req, res, next)
  if (req.ctx.kind === 'tenant') return authenticateTenant(req, res, next)
  throw notFound()
}

function accountOf(req: Request): { ref: AccountRef; label: string; required: boolean } {
  if (req.ctx.kind === 'owner') {
    const { user } = platformAuth(req)
    return {
      ref: { realm: 'platform', id: user.id, orgId: null },
      label: `${user.email} (owner panel)`,
      required: false,
    }
  }
  const { org, user } = tenantAuth(req)
  return {
    ref: { realm: 'tenant', id: user.id, orgId: org.id },
    label: `${user.email} (${org.slug})`,
    required: org.requireTwoFactor,
  }
}

authRouter.get('/2fa', authenticateAny, async (req, res) => {
  const { ref, required } = accountOf(req)
  res.json(await twoFactorStatus(ref, required))
})

authRouter.post('/2fa/setup', authenticateAny, async (req, res) => {
  const { ref, label } = accountOf(req)
  res.json(await startTwoFactorSetup(ref, label))
})

authRouter.post('/2fa/enable', loginLimiter, authenticateAny, async (req, res) => {
  const { code } = parse(twoFactorCodeSchema, req.body)
  const recoveryCodes = await enableTwoFactor(accountOf(req).ref, code, req.ip ?? null)
  res.json({ recoveryCodes })
})

authRouter.post('/2fa/recovery-codes', loginLimiter, authenticateAny, async (req, res) => {
  const { code } = parse(twoFactorCodeSchema, req.body)
  const recoveryCodes = await regenerateRecoveryCodes(accountOf(req).ref, code, req.ip ?? null)
  res.json({ recoveryCodes })
})

authRouter.post('/2fa/disable', loginLimiter, authenticateAny, async (req, res) => {
  const { password } = parse(disableTwoFactorSchema, req.body)
  const { ref, required } = accountOf(req)
  await disableTwoFactor(ref, password, required, req.ip ?? null)
  res.status(204).end()
})
