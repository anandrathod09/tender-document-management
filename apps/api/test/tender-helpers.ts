import ExcelJS from 'exceljs'
import request from 'supertest'
import type { LoginResponse, RoleSummary, StageSummary, TenderPage } from '@tdm/shared'
import { addDays, todayIn } from '../src/lib/dates'
import { app, bearer, tokenFromInviteUrl } from './helpers'

export const today = () => todayIn('Asia/Kolkata')
export const inDays = (n: number) => addDays(today(), n)
/** DD-MM-YYYY, as Tender247 writes dates. */
export const indian = (iso: string) => iso.split('-').reverse().join('-')

export type SheetRow = Record<string, string | number | Date | null>

/** Builds an .xlsx file in memory with the given sheets. */
export async function workbook(sheets: Record<string, SheetRow[]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name)
    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    ws.addRow(headers)
    for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? null))
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** A Tender247-style row; override any column. */
export function t247Row(ref: string, overrides: SheetRow = {}): SheetRow {
  return {
    'T247 ID': `T${ref}`,
    'REFERENCE NO': ref,
    'TENDER BRIEF': `Supply of item ${ref}`,
    Deadline: indian(inDays(10)),
    LOCATION: 'Nashik',
    Organization: 'Public Works Department',
    'ESTIMATED COST': '15,00,000',
    EMD: 30000,
    'Document fees': 'Rs. 1,180',
    ...overrides,
  }
}

export function importFile(host: string, token: string, file: Buffer, name = 'tenders.xlsx') {
  return request(app)
    .post('/api/tenders/import')
    .set('Host', host)
    .set(bearer(token))
    .attach('file', file, name)
}

export async function stagesOf(host: string, token: string): Promise<Record<string, StageSummary>> {
  const res = await request(app).get('/api/workflow/stages').set('Host', host).set(bearer(token))
  return Object.fromEntries((res.body as StageSummary[]).map((s) => [s.key, s]))
}

export async function listAll(
  host: string,
  token: string,
  query: Record<string, string> = {},
): Promise<TenderPage> {
  const res = await request(app)
    .get('/api/tenders')
    .query({ pageSize: '100', ...query })
    .set('Host', host)
    .set(bearer(token))
  if (res.status !== 200) throw new Error(`List failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

/** Invites a user with the given role and signs them in. */
export async function addUser(host: string, adminToken: string, roleKey: string, email: string) {
  const roles = await request(app).get('/api/roles').set('Host', host).set(bearer(adminToken))
  const role = (roles.body as RoleSummary[]).find((r) => r.key === roleKey)!
  const invited = await request(app)
    .post('/api/users')
    .set('Host', host)
    .set(bearer(adminToken))
    .send({ name: email.split('@')[0], email, roleId: role.id })
  const accepted = await request(app)
    .post('/api/auth/accept-invite')
    .set('Host', host)
    .send({ token: tokenFromInviteUrl(invited.body.inviteUrl), password: 'user-password-123' })
  const body = accepted.body as LoginResponse
  return { id: body.session.user.id, token: body.accessToken }
}
