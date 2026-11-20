import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/*
 * Time-based one-time codes (RFC 6238), the 6-digit codes shown by
 * authenticator apps such as Google Authenticator or Microsoft Authenticator.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = BASE32.indexOf(ch)
    if (i < 0) throw new Error('Invalid base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new secret for an authenticator app (160 bits, base32). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS)

/** The code for one 30-second time step. */
export function totpAt(secret: string, step: number, digits = DIGITS): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(step))
  const hash = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = hash[hash.length - 1]! & 0x0f
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    (hash[offset + 1]! << 16) |
    (hash[offset + 2]! << 8) |
    hash[offset + 3]!
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/**
 * Checks a code, allowing one step either side for clock drift. Returns the
 * step it matched so the caller can store it: a code is accepted only once
 * (steps at or before `lastStep` are refused).
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const step = currentStep(now)
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue
    if (timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(clean))) return s
  }
  return null
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Backup (recovery) codes: one-time codes for when the phone is lost.
// ---------------------------------------------------------------------------

// No 0/O, 1/l/i, so the codes are easy to read and type.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const RECOVERY_CODE_COUNT = 10

const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '')
export const hashRecoveryCode = (code: string) =>
  createHash('sha256').update(normaliseRecovery(code)).digest('hex')

/** Ten codes like "k7m2-x9qp". Only their hashes are stored. */
export function generateRecoveryCodes(): string[] {
  const one = () =>
    Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const c = one()
    return `${c.slice(0, 4)}-${c.slice(4)}`
  })
}

export const looksLikeRecoveryCode = (code: string) => normaliseRecovery(code).length === 8
