import { eq } from 'drizzle-orm'
import {
  cleanupDaysFrom,
  PERMISSIONS,
  RESERVED_SUBDOMAINS,
  type WorkspaceSettings,
  type WorkspaceSettingsInput,
} from '@tdm/shared'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { organizations, roles, type Organization } from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { conflict } from '../../lib/errors'
import type { TenantAuth } from '../../types/express'
import { supportSettingsOf } from '../support/settings'

export type HostKind =
  { kind: 'root' } | { kind: 'owner' } | { kind: 'tenant'; slug: string } | { kind: 'unknown' }

/**
 * Works out what a hostname points to:
 *   ourdomain.com / www.ourdomain.com  -> root (marketing site, later)
 *   owner.ourdomain.com                -> owner panel
 *   acme.ourdomain.com                 -> client "acme"
 * Anything else (other domains, nested subdomains, reserved names) is unknown.
 */
export function resolveHost(hostname: string): HostKind {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const base = env.BASE_DOMAIN
  if (host === base || host === `www.${base}`) return { kind: 'root' }
  if (!host.endsWith(`.${base}`)) return { kind: 'unknown' }

  const sub = host.slice(0, -(base.length + 1))
  if (sub.includes('.')) return { kind: 'unknown' }
  if (sub === env.OWNER_SUBDOMAIN) return { kind: 'owner' }
  if ((RESERVED_SUBDOMAINS as readonly string[]).includes(sub)) return { kind: 'unknown' }
  return { kind: 'tenant', slug: sub }
}

// Short in-memory cache of slug lookups, so every request does not hit the
// database for its organization. Owner-panel changes clear the entry.
// Moves to Redis when the API runs as several processes.
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { org: Organization | null; expiresAt: number }>()

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const hit = cache.get(slug)
  if (hit && hit.expiresAt > Date.now()) return hit.org

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1)
  cache.set(slug, { org: org ?? null, expiresAt: Date.now() + CACHE_TTL_MS })
  return org ?? null
}

export function invalidateOrganization(slug: string): void {
  cache.delete(slug)
}

export function clearOrganizationCache(): void {
  cache.clear()
}

/** Clients in these states can sign in and use the app. */
export function isOrganizationUsable(org: Organization): boolean {
  return org.status === 'active' || org.status === 'trial'
}

async function agentRole(orgId: string) {
  const [role] = await db
    .select()
    .from(roles)
    .where(orgWhere(roles, orgId, eq(roles.key, 'agent')))
    .limit(1)
  return role ?? null
}

export async function getWorkspaceSettings(org: Organization): Promise<WorkspaceSettings> {
  const agent = await agentRole(org.id)
  return {
    requireTwoFactor: org.requireTwoFactor,
    agentsSeeAssets: agent?.permissions.includes(PERMISSIONS.ASSET_VIEW) ?? false,
    agentsSeeInstallation: agent?.permissions.includes(PERMISSIONS.INSTALLATION_VIEW) ?? false,
    cleanupDays: cleanupDaysFrom(org.settings),
    supportPage: supportSettingsOf(org).enabled,
    supportEmails: supportSettingsOf(org).emails,
  }
}

/** Saves the client's settings. Turning on "require two-step login" needs it on for yourself first. */
export async function updateWorkspaceSettings(
  auth: TenantAuth,
  input: WorkspaceSettingsInput,
  ip: string | null,
): Promise<WorkspaceSettings> {
  if (input.requireTwoFactor && !auth.user.totpEnabledAt) {
    throw conflict(
      'TWO_FACTOR_SETUP_FIRST',
      'Turn on two-step login for your own account first (My Security), then require it for everyone.',
    )
  }
  await db.transaction(async (tx) => {
    if (input.requireTwoFactor !== undefined) {
      await tx
        .update(organizations)
        .set({ requireTwoFactor: input.requireTwoFactor })
        .where(eq(organizations.id, auth.org.id))
    }
    // The Agent role gains or loses "see Installed assets" and "see installation reports".
    const agentSwitches = [
      [input.agentsSeeAssets, PERMISSIONS.ASSET_VIEW],
      [input.agentsSeeInstallation, PERMISSIONS.INSTALLATION_VIEW],
    ] as const
    if (agentSwitches.some(([on]) => on !== undefined)) {
      const agent = await agentRole(auth.org.id)
      if (agent) {
        let permissions = agent.permissions
        for (const [on, permission] of agentSwitches) {
          if (on === undefined) continue
          permissions = permissions.filter((p) => p !== permission)
          if (on) permissions = [...permissions, permission]
        }
        await tx
          .update(roles)
          .set({ permissions })
          .where(orgWhere(roles, auth.org.id, eq(roles.id, agent.id)))
      }
    }
    // Kept with the client's other settings: days before unassigned New tenders
    // are deleted, and the public support page.
    const stored = {
      ...(input.cleanupDays !== undefined && { expiredCleanupDays: input.cleanupDays }),
      ...(input.supportPage !== undefined && { supportPage: input.supportPage }),
      ...(input.supportEmails !== undefined && { supportEmails: [...new Set(input.supportEmails)] }),
    }
    if (Object.keys(stored).length) {
      const [current] = await tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, auth.org.id))
      await tx
        .update(organizations)
        .set({ settings: { ...current?.settings, ...stored } })
        .where(eq(organizations.id, auth.org.id))
    }
    await writeAudit(tx, {
      organizationId: auth.org.id,
      actorType: 'user',
      actorId: auth.user.id,
      action: 'workspace.settings_updated',
      entity: 'organization',
      entityId: auth.org.id,
      details: { ...input },
      ip,
    })
  })
  invalidateOrganization(auth.org.slug)
  const [org] = await db.select().from(organizations).where(eq(organizations.id, auth.org.id))
  return getWorkspaceSettings(org!)
}
