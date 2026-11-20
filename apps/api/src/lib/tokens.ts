import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

export type Realm = 'tenant' | 'platform'

export interface AccessTokenPayload {
  sub: string
  realm: Realm
  /** Organization ID; only on tenant tokens. */
  org?: string
  /** Must match the user's token_version, so tokens can be cancelled. */
  tv: number
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    audience: payload.realm,
  })
}

/** Returns the payload, or null when the token is invalid, expired or for another realm. */
export function verifyAccessToken(token: string, realm: Realm): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: realm,
    })
    if (typeof decoded !== 'object' || decoded === null) return null
    const p = decoded as Partial<AccessTokenPayload>
    if (typeof p.sub !== 'string' || p.realm !== realm || typeof p.tv !== 'number') return null
    if (realm === 'tenant' && typeof p.org !== 'string') return null
    return { sub: p.sub, realm, org: p.org, tv: p.tv }
  } catch {
    return null
  }
}

export interface ChallengePayload {
  sub: string
  realm: Realm
  org?: string
  tv: number
}

/**
 * Short-lived proof that the password was right, exchanged for a session
 * once the two-step code is entered. Signed for its own audience, so it can
 * never be used as an access token.
 */
export function signChallengeToken(payload: ChallengePayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: 5 * 60,
    audience: `${payload.realm}:2fa`,
  })
}

export function verifyChallengeToken(token: string, realm: Realm): ChallengePayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: `${realm}:2fa`,
    })
    if (typeof decoded !== 'object' || decoded === null) return null
    const p = decoded as Partial<ChallengePayload>
    if (typeof p.sub !== 'string' || p.realm !== realm || typeof p.tv !== 'number') return null
    return { sub: p.sub, realm, org: p.org, tv: p.tv }
  } catch {
    return null
  }
}

/** A random, URL-safe secret for refresh tokens and invitation links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Tokens are stored only as SHA-256 hashes, so a database leak does not expose them. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
