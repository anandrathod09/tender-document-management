import type { NextFunction, Request, Response } from 'express'
import type { Organization } from '../db/schema'
import { forbidden, notFound } from '../lib/errors'
import {
  getOrganizationBySlug,
  isOrganizationUsable,
  resolveHost,
} from '../modules/workspace/service'

/** Sets req.ctx from the Host header: which client (or the owner panel) this request is for. */
export async function workspaceContext(req: Request, _res: Response, next: NextFunction) {
  const host = resolveHost(req.hostname ?? '')
  if (host.kind === 'tenant') {
    const org = await getOrganizationBySlug(host.slug)
    req.ctx = org ? { kind: 'tenant', org } : { kind: 'unknown' }
  } else {
    req.ctx = host
  }
  next()
}

/** Returns the client for this subdomain, or throws if there is none or it is suspended. */
export function assertTenant(req: Request): Organization {
  if (req.ctx.kind !== 'tenant') {
    throw notFound('WORKSPACE_NOT_FOUND', 'This workspace does not exist')
  }
  if (!isOrganizationUsable(req.ctx.org)) {
    throw forbidden('WORKSPACE_SUSPENDED', 'This workspace is suspended')
  }
  return req.ctx.org
}

/** Throws unless the request came to the owner-panel subdomain. */
export function assertOwnerHost(req: Request): void {
  if (req.ctx.kind !== 'owner') throw notFound()
}

export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  assertTenant(req)
  next()
}

export function requireOwnerHost(req: Request, _res: Response, next: NextFunction) {
  assertOwnerHost(req)
  next()
}
