import request from 'supertest'
import type { LoginResponse, OrganizationDetail } from '@tdm/shared'
import { createApp } from '../src/app'
import { db, pool } from '../src/db/client'
import { plans, platformUsers } from '../src/db/schema'
import { testOutbox } from '../src/lib/mailer'
import { hashPassword } from '../src/lib/password'
import { clearOrganizationCache } from '../src/modules/workspace/service'

export const app = createApp()

/** Runs every queued background job (emails, compliance PDFs) right away. */
export { runDueJobs as drainJobs } from '../src/modules/jobs/queue'

export const OWNER_HOST = 'owner.localhost'
export const hostOf = (slug: string) => `${slug}.localhost`

/** Empties every table (keeps the migration record) before each test. */
export async function resetDb() {
  // One connection for the whole reset: the foreign-key setting applies per connection.
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<import('mysql2').RowDataPacket[]>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '__drizzle_migrations'",
    )
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    // DELETE is much faster than TRUNCATE for small tables (TRUNCATE rebuilds the table).
    for (const row of rows) await conn.query(`DELETE FROM \`${row.name as string}\``)
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  } finally {
    conn.release()
  }
  clearOrganizationCache()
  testOutbox.length = 0
}

export async function createPlan(maxUsers = 25) {
  const id = crypto.randomUUID()
  await db.insert(plans).values({
    id,
    code: `plan-${id.slice(0, 8)}`,
    name: 'Test plan',
    maxUsers,
    maxStorageGb: 10,
    maxTendersPerMonth: 1000,
  })
  return id
}

export const OWNER_EMAIL = 'owner@platform.test'
export const OWNER_PASSWORD = 'owner-password-123'

export async function createOwner() {
  await db.insert(platformUsers).values({
    email: OWNER_EMAIL,
    name: 'Platform Owner',
    passwordHash: await hashPassword(OWNER_PASSWORD),
  })
}

export async function loginOwner(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Host', OWNER_HOST)
    .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
  if (res.status !== 200)
    throw new Error(`Owner login failed: ${res.status} ${JSON.stringify(res.body)}`)
  return (res.body as LoginResponse).accessToken
}

export function tokenFromInviteUrl(url: string): string {
  return new URL(url).searchParams.get('token')!
}

export const ADMIN_PASSWORD = 'admin-password-123'

/**
 * Creates a client through the owner API and accepts the admin invitation.
 * Returns the organization and a signed-in admin.
 */
export async function setupClient(ownerToken: string, planId: string, slug: string) {
  const created = await request(app)
    .post('/api/owner/organizations')
    .set('Host', OWNER_HOST)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `${slug} Pvt Ltd`,
      slug,
      planId,
      adminName: `${slug} Admin`,
      adminEmail: `admin@${slug}.test`,
    })
  if (created.status !== 201) {
    throw new Error(`Provision failed: ${created.status} ${JSON.stringify(created.body)}`)
  }
  const { organization, inviteUrl } = created.body as {
    organization: OrganizationDetail
    inviteUrl: string
  }

  const accepted = await request(app)
    .post('/api/auth/accept-invite')
    .set('Host', hostOf(slug))
    .send({ token: tokenFromInviteUrl(inviteUrl), password: ADMIN_PASSWORD })
  if (accepted.status !== 200) {
    throw new Error(`Accept invite failed: ${accepted.status} ${JSON.stringify(accepted.body)}`)
  }
  const body = accepted.body as LoginResponse
  return {
    org: organization,
    adminToken: body.accessToken,
    adminId: body.session.user.id,
    refreshCookie: refreshCookieFrom(accepted.headers['set-cookie']),
  }
}

/** Returns "tdm_rt=<value>" from a response's Set-Cookie header. */
export function refreshCookieFrom(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const cookie = list.find((c) => c.startsWith('tdm_rt='))
  if (!cookie) throw new Error('No refresh cookie set')
  return cookie.split(';')[0]!
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
