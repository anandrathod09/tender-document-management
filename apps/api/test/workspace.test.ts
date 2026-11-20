import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveHost } from '../src/modules/workspace/service'
import {
  app,
  createOwner,
  createPlan,
  hostOf,
  loginOwner,
  OWNER_HOST,
  resetDb,
  setupClient,
} from './helpers'

describe('resolveHost', () => {
  it('maps hostnames to workspaces', () => {
    expect(resolveHost('localhost')).toEqual({ kind: 'root' })
    expect(resolveHost('www.localhost')).toEqual({ kind: 'root' })
    expect(resolveHost('owner.localhost')).toEqual({ kind: 'owner' })
    expect(resolveHost('acme.localhost')).toEqual({ kind: 'tenant', slug: 'acme' })
    expect(resolveHost('ACME.localhost.')).toEqual({ kind: 'tenant', slug: 'acme' })
  })

  it('rejects other domains, nested subdomains and reserved names', () => {
    expect(resolveHost('acme.evil.com')).toEqual({ kind: 'unknown' })
    expect(resolveHost('a.b.localhost')).toEqual({ kind: 'unknown' })
    expect(resolveHost('api.localhost')).toEqual({ kind: 'unknown' })
    expect(resolveHost('localhost.evil.com')).toEqual({ kind: 'unknown' })
  })
})

describe('GET /api/workspace', () => {
  beforeEach(resetDb)

  it('describes a client subdomain', async () => {
    await createOwner()
    const { org } = await setupClient(await loginOwner(), await createPlan(), 'acme')
    const res = await request(app).get('/api/workspace').set('Host', hostOf('acme'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ kind: 'tenant', slug: 'acme', name: org.name, status: 'trial' })
  })

  it('returns 404 for a subdomain that is not a client', async () => {
    const res = await request(app).get('/api/workspace').set('Host', hostOf('nobody'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND')
  })

  it('recognises the owner panel and the root domain', async () => {
    expect((await request(app).get('/api/workspace').set('Host', OWNER_HOST)).body).toEqual({
      kind: 'owner',
    })
    expect((await request(app).get('/api/workspace').set('Host', 'localhost')).body).toEqual({
      kind: 'root',
    })
  })
})
