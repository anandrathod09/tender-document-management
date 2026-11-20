import { eq } from 'drizzle-orm'
import type { TwoFactorSetup, TwoFactorStatus } from '@tdm/shared'
import { env } from '../../config/env'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { platformUsers, users } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors'
import { verifyPassword } from '../../lib/password'
import { decryptSecret, encryptSecret } from '../../lib/secrets'
import type { Realm } from '../../lib/tokens'
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '../../lib/totp'

/**
 * Two-step login: after the password, a 6-digit code from an authenticator
 * app (or a one-time backup code). Works the same for client users and our
 * own owner-panel team.
 */

/** Which account: a client user (with their organization) or a platform user. */
export interface AccountRef {
  realm: Realm
  id: string
  orgId: string | null
}

interface Account {
  id: string
  email: string
  passwordHash: string | null
  totpSecret: string | null
  totpEnabledAt: Date | null
  totpLastStep: number | null
  totpRecoveryCodes: string[] | null
}

type TwoFactorColumns = Partial<
  Pick<Account, 'totpSecret' | 'totpEnabledAt' | 'totpLastStep' | 'totpRecoveryCodes'>
>

async function loadAccount(conn: DbOrTx, ref: AccountRef): Promise<Account> {
  const [row] =
    ref.realm === 'tenant'
      ? await conn
          .select()
          .from(users)
          .where(orgWhere(users, ref.orgId!, eq(users.id, ref.id)))
          .limit(1)
      : await conn.select().from(platformUsers).where(eq(platformUsers.id, ref.id)).limit(1)
  if (!row) throw notFound()
  return row
}

async function saveAccount(conn: DbOrTx, ref: AccountRef, values: TwoFactorColumns) {
  if (ref.realm === 'tenant') {
    await conn
      .update(users)
      .set(values)
      .where(orgWhere(users, ref.orgId!, eq(users.id, ref.id)))
  } else {
    await conn.update(platformUsers).set(values).where(eq(platformUsers.id, ref.id))
  }
}

function audit(conn: DbOrTx, ref: AccountRef, action: string, ip: string | null, actorId?: string) {
  return writeAudit(conn, {
    organizationId: ref.orgId,
    actorType: ref.realm === 'tenant' ? 'user' : 'platform',
    actorId: actorId ?? ref.id,
    action,
    entity: ref.realm === 'tenant' ? 'user' : 'platform_user',
    entityId: ref.id,
    ip,
  })
}

const wrongCode = () =>
  unauthorized('TWO_FACTOR_INVALID', 'That code is not right. Enter the latest code from your app.')

export async function twoFactorStatus(
  ref: AccountRef,
  required: boolean,
): Promise<TwoFactorStatus> {
  const a = await loadAccount(db, ref)
  return {
    enabled: !!a.totpEnabledAt,
    required,
    recoveryCodesLeft: a.totpEnabledAt ? (a.totpRecoveryCodes?.length ?? 0) : 0,
  }
}

/** Creates a new key for the app. Nothing changes for signing in until it is confirmed. */
export async function startTwoFactorSetup(
  ref: AccountRef,
  accountLabel: string,
): Promise<TwoFactorSetup> {
  return db.transaction(async (tx) => {
    const a = await loadAccount(tx, ref)
    if (a.totpEnabledAt) {
      throw conflict('TWO_FACTOR_ALREADY_ON', 'Two-step login is already on for this account')
    }
    const secret = generateTotpSecret()
    await saveAccount(tx, ref, { totpSecret: encryptSecret(secret), totpLastStep: null })
    return { secret, otpauthUrl: otpauthUrl(env.PRODUCT_NAME, accountLabel, secret) }
  })
}

/** Confirms the setup with a code from the app and returns the backup codes (shown once). */
export async function enableTwoFactor(
  ref: AccountRef,
  code: string,
  ip: string | null,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const a = await loadAccount(tx, ref)
    if (a.totpEnabledAt) {
      throw conflict('TWO_FACTOR_ALREADY_ON', 'Two-step login is already on for this account')
    }
    if (!a.totpSecret) {
      throw badRequest('TWO_FACTOR_NOT_STARTED', 'Start the setup again to get a new QR code')
    }
    const step = verifyTotp(decryptSecret(a.totpSecret), code, null)
    if (step === null) throw wrongCode()
    const codes = generateRecoveryCodes()
    await saveAccount(tx, ref, {
      totpEnabledAt: new Date(),
      totpLastStep: step,
      totpRecoveryCodes: codes.map(hashRecoveryCode),
    })
    await audit(tx, ref, 'auth.two_factor_enabled', ip)
    return codes
  })
}

export async function disableTwoFactor(
  ref: AccountRef,
  password: string,
  required: boolean,
  ip: string | null,
): Promise<void> {
  if (required) {
    throw conflict(
      'TWO_FACTOR_REQUIRED',
      'Your workspace requires two-step login, so it cannot be turned off',
    )
  }
  await db.transaction(async (tx) => {
    const a = await loadAccount(tx, ref)
    if (!(await verifyPassword(password, a.passwordHash))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Password is incorrect')
    }
    await saveAccount(tx, ref, clearedTwoFactor)
    await audit(tx, ref, 'auth.two_factor_disabled', ip)
  })
}

/** Replaces the backup codes; needs a current code from the app. */
export async function regenerateRecoveryCodes(
  ref: AccountRef,
  code: string,
  ip: string | null,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const a = await loadAccount(tx, ref)
    if (!a.totpEnabledAt || !a.totpSecret) {
      throw badRequest('TWO_FACTOR_OFF', 'Two-step login is not on for this account')
    }
    const step = verifyTotp(decryptSecret(a.totpSecret), code, a.totpLastStep)
    if (step === null) throw wrongCode()
    const codes = generateRecoveryCodes()
    await saveAccount(tx, ref, {
      totpLastStep: step,
      totpRecoveryCodes: codes.map(hashRecoveryCode),
    })
    await audit(tx, ref, 'auth.two_factor_codes_renewed', ip)
    return codes
  })
}

/**
 * The second step of signing in. Accepts a code from the app (each only once)
 * or an unused backup code (which is then used up).
 */
export async function checkSecondFactor(
  conn: DbOrTx,
  ref: AccountRef,
  code: string,
): Promise<'app' | 'backup_code'> {
  const a = await loadAccount(conn, ref)
  if (!a.totpEnabledAt || !a.totpSecret) throw wrongCode()
  const step = verifyTotp(decryptSecret(a.totpSecret), code, a.totpLastStep)
  if (step !== null) {
    await saveAccount(conn, ref, { totpLastStep: step })
    return 'app'
  }
  if (looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code)
    const left = a.totpRecoveryCodes ?? []
    if (left.includes(hash)) {
      await saveAccount(conn, ref, { totpRecoveryCodes: left.filter((h) => h !== hash) })
      return 'backup_code'
    }
  }
  throw wrongCode()
}

export const clearedTwoFactor: TwoFactorColumns = {
  totpSecret: null,
  totpEnabledAt: null,
  totpLastStep: null,
  totpRecoveryCodes: null,
}
