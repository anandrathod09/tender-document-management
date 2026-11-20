import { randomUUID } from 'node:crypto'
import { asc, count, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  DEFAULT_ROLES,
  type OrganizationDetail,
  type OrganizationSummary,
  type PlanSummary,
  type UpdateOrganizationInput,
  createOrganizationSchema,
} from '@tdm/shared'
import type { z } from 'zod'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { organizations, plans, roles, users, type Organization } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../../lib/errors'
import { issueInvite, sendInviteEmail, workspaceUrl } from '../users/invites'
import { resendInvite, type Actor } from '../users/service'
import { createDefaultStages } from '../workflow/service'
import { invalidateOrganization } from '../workspace/service'

type ProvisionInput = z.output<typeof createOrganizationSchema>

const orgColumns = {
  id: organizations.id,
  slug: organizations.slug,
  name: organizations.name,
  status: organizations.status,
  timezone: organizations.timezone,
  trialEndsAt: organizations.trialEndsAt,
  paidUntil: organizations.paidUntil,
  billingCycle: organizations.billingCycle,
  createdAt: organizations.createdAt,
  planId: plans.id,
  planName: plans.name,
}

async function userCounts(conn: DbOrTx, orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map()
  const rows = await conn
    .select({ orgId: users.organizationId, n: count() })
    .from(users)
    .where(inArray(users.organizationId, orgIds))
    .groupBy(users.organizationId)
  return new Map(rows.map((r) => [r.orgId, r.n]))
}

type OrgRow = {
  id: string
  slug: string
  name: string
  status: Organization['status']
  timezone: string
  trialEndsAt: Date | null
  paidUntil: Date | null
  billingCycle: Organization['billingCycle']
  createdAt: Date
  planId: string
  planName: string
}

function toSummary(r: OrgRow, userCount: number): OrganizationSummary {
  return {
    id: r.id,
    slug: r.slug,
    url: workspaceUrl(r.slug),
    name: r.name,
    status: r.status,
    timezone: r.timezone,
    plan: { id: r.planId, name: r.planName },
    userCount,
    trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
    paidUntil: r.paidUntil ? r.paidUntil.toISOString() : null,
    billingCycle: r.billingCycle,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const rows = await db
    .select(orgColumns)
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .orderBy(desc(organizations.createdAt))
  const counts = await userCounts(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => toSummary(r, counts.get(r.id) ?? 0))
}

export async function getOrganizationDetail(conn: DbOrTx, id: string): Promise<OrganizationDetail> {
  const [row] = await conn
    .select(orgColumns)
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(eq(organizations.id, id))
    .limit(1)
  if (!row) throw notFound('ORGANIZATION_NOT_FOUND', 'Client not found')

  const counts = await userCounts(conn, [id])
  const admins = await conn
    .select({ id: users.id, name: users.name, email: users.email, status: users.status })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(orgWhere(users, id, eq(roles.key, 'admin'), ne(users.status, 'suspended')))
    .orderBy(asc(users.name))

  return { ...toSummary(row, counts.get(id) ?? 0), admins }
}

async function getOrganization(conn: DbOrTx, id: string): Promise<Organization> {
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  if (!org) throw notFound('ORGANIZATION_NOT_FOUND', 'Client not found')
  return org
}

async function assertPlanExists(conn: DbOrTx, planId: string) {
  const [plan] = await conn
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1)
  if (!plan) throw badRequest('PLAN_NOT_FOUND', 'That plan does not exist')
}

function assertValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Unknown time zone', [
      { field: 'timezone', message: 'Unknown time zone' },
    ])
  }
}

/**
 * Sets up a new client in one transaction: the organization, its default
 * roles and its first admin, who receives an invitation email.
 * Self-signup will call this same function later.
 */
export async function provisionOrganization(actor: Actor, input: ProvisionInput) {
  assertValidTimezone(input.timezone)

  const result = await db.transaction(async (tx) => {
    await assertPlanExists(tx, input.planId)

    const orgId = randomUUID()
    try {
      await tx.insert(organizations).values({
        id: orgId,
        slug: input.slug,
        name: input.name,
        status: input.trialDays > 0 ? 'trial' : 'active',
        planId: input.planId,
        timezone: input.timezone,
        trialEndsAt:
          input.trialDays > 0 ? new Date(Date.now() + input.trialDays * 86_400_000) : null,
      })
    } catch (err) {
      if (isDuplicateKeyError(err)) throw conflict('SLUG_TAKEN', 'This subdomain is already in use')
      throw err
    }

    const roleRows = DEFAULT_ROLES.map((r) => ({
      id: randomUUID(),
      organizationId: orgId,
      key: r.key,
      name: r.name,
      permissions: r.permissions,
      isSystem: true,
    }))
    await tx.insert(roles).values(roleRows)
    await createDefaultStages(tx, orgId)
    const adminRole = roleRows.find((r) => r.key === 'admin')!

    const adminId = randomUUID()
    await tx.insert(users).values({
      id: adminId,
      organizationId: orgId,
      email: input.adminEmail,
      name: input.adminName,
      roleId: adminRole.id,
      status: 'invited',
    })

    const org = await getOrganization(tx, orgId)
    const inviteUrl = await issueInvite(tx, org, adminId)

    await writeAudit(tx, {
      organizationId: orgId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'organization.created',
      entity: 'organization',
      entityId: orgId,
      details: { slug: input.slug, planId: input.planId, adminEmail: input.adminEmail },
      ip: actor.ip,
    })
    await sendInviteEmail(tx, org, { name: input.adminName, email: input.adminEmail }, inviteUrl)

    return { org, inviteUrl, detail: await getOrganizationDetail(tx, orgId) }
  })

  invalidateOrganization(result.org.slug)
  return { organization: result.detail, inviteUrl: result.inviteUrl }
}

export async function updateOrganization(actor: Actor, id: string, input: UpdateOrganizationInput) {
  const detail = await db.transaction(async (tx) => {
    const org = await getOrganization(tx, id)
    if (org.status === 'closed') throw conflict('ORGANIZATION_CLOSED', 'This client is closed')
    if (input.planId) await assertPlanExists(tx, input.planId)

    await tx
      .update(organizations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.status !== undefined && { status: input.status }),
      })
      .where(eq(organizations.id, id))

    await writeAudit(tx, {
      organizationId: id,
      actorType: actor.type,
      actorId: actor.id,
      action:
        input.status && input.status !== org.status
          ? `organization.${input.status === 'suspended' ? 'suspended' : 'reactivated'}`
          : 'organization.updated',
      entity: 'organization',
      entityId: id,
      details: { ...input },
      ip: actor.ip,
    })
    invalidateOrganization(org.slug)
    return getOrganizationDetail(tx, id)
  })
  return detail
}

/** Lets our team send a client's admin a new invitation link. */
export async function resendClientInvite(actor: Actor, orgId: string, userId: string) {
  const org = await getOrganization(db, orgId)
  return resendInvite(org, actor, userId)
}
