import { PDFDocument } from 'pdf-lib'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fillLetterFields, unknownLetterFields, type LetterValues } from '@tdm/shared'
import {
  app,
  bearer,
  createOwner,
  createPlan,
  drainJobs,
  hostOf,
  loginOwner,
  resetDb,
  setupClient,
} from './helpers'
import { addUser, importFile, listAll, t247Row, workbook } from './tender-helpers'

const ACME = hostOf('acme')

const companyBase = {
  address: 'Plot 12, Ambad MIDC, Nashik 422010',
  signatoryName: 'Rahul Patil',
  designation: 'Proprietor',
}

/** A short letter of the client's own, with fill-in fields. */
const myLetter = {
  title: 'Undertaking for Site Visit',
  subtitle: '(On letterhead)',
  addressed: true,
  dateAtTop: false,
  body: [
    {
      kind: 'para',
      text: 'We, {{company_name}}, confirm that we have visited the site for Tender No {{tender_ref}}.',
    },
    { kind: 'numbered', items: ['We understand the scope.', 'Signed on {{date}}.'] },
    { kind: 'fields', rows: [['GSTIN', '{{company_gstin}}']] },
  ],
}

describe('letter fields', () => {
  it('fills known fields, leaves a blank for empty ones and spots typos', () => {
    const values = { company_name: 'Acme', tender_ref: '' } as LetterValues
    expect(fillLetterFields('We, {{company_name}}, for {{ tender_ref }}', values)).toBe(
      'We, Acme, for ________',
    )
    expect(unknownLetterFields('{{company_name}} {{compnay_name}}')).toEqual(['compnay_name'])
  })
})

describe('letter templates', () => {
  let adminToken: string
  let tenderId: string
  let companyA: string
  let companyB: string

  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, token = adminToken) =>
    request(app)[method](`/api${path}`).set('Host', ACME).set(bearer(token))

  beforeEach(async () => {
    await resetDb()
    await createOwner()
    adminToken = (await setupClient(await loginOwner(), await createPlan(), 'acme')).adminToken
    await importFile(ACME, adminToken, await workbook({ S: [t247Row('PWD/7')] }))
    tenderId = (await listAll(ACME, adminToken)).items[0]!.id
    companyA = (await call('post', '/companies').send({ ...companyBase, name: 'Alpha Infra' })).body
      .id
    companyB = (await call('post', '/companies').send({ ...companyBase, name: 'Beta Traders' }))
      .body.id
  })

  it('copies a built-in letter as editable text with fields', async () => {
    const res = await call('get', '/letter-templates/builtin/blacklisting')
    expect(res.status).toBe(200)
    expect(res.body.title).toMatch(/BLACKLISTING/)
    expect(JSON.stringify(res.body.body)).toContain('{{company_name}}')
    expect((await call('get', '/letter-templates/builtin/nope')).status).toBe(404)
  })

  it('saves letters, refuses unknown fields, hides built-ins and previews', async () => {
    const typo = await call('post', '/letter-templates').send({
      ...myLetter,
      body: [{ kind: 'para', text: 'We, {{compnay_name}}, declare.' }],
    })
    expect(typo.status).toBe(400)
    expect(JSON.stringify(typo.body)).toContain('compnay_name')

    const shared = await call('post', '/letter-templates').send(myLetter)
    expect(shared.status).toBe(201)
    expect(shared.body).toMatchObject({ title: myLetter.title, company: null, isActive: true })

    const onlyB = await call('post', '/letter-templates').send({
      ...myLetter,
      title: 'Beta only letter',
      companyId: companyB,
    })
    expect(onlyB.body.company).toEqual({ id: companyB, name: 'Beta Traders' })

    const edited = await call('put', `/letter-templates/${shared.body.id}`).send({
      ...myLetter,
      title: 'Site Visit Undertaking',
    })
    expect(edited.body.title).toBe('Site Visit Undertaking')

    const hide = await call('put', '/letter-templates/hidden').send({ keys: ['make_in_india'] })
    expect(hide.status).toBe(200)
    const list = await call('get', '/letter-templates')
    expect(list.body.templates.map((t: { title: string }) => t.title)).toEqual([
      'Beta only letter',
      'Site Visit Undertaking',
    ])
    expect(list.body.builtins.find((b: { key: string }) => b.key === 'make_in_india').hidden).toBe(
      true,
    )
    expect((await call('put', '/letter-templates/hidden').send({ keys: ['nope'] })).status).toBe(
      400,
    )

    const preview = await call('post', '/letter-templates/preview').send({
      letter: myLetter,
      companyId: companyA,
    })
    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('application/pdf')
    const doc = await PDFDocument.load(preview.body as Buffer)
    expect(doc.getPageCount()).toBe(1)
  })

  it('adds the client letters to a compliance PDF, only for the right company', async () => {
    const shared = (await call('post', '/letter-templates').send(myLetter)).body
    const onlyB = (
      await call('post', '/letter-templates').send({ ...myLetter, title: 'B', companyId: companyB })
    ).body
    const pack = (companyId: string, templateIds: string[], letters: string[] = []) =>
      call('post', `/tenders/${tenderId}/compliance-packs`).send({
        companyId,
        letters,
        templateIds,
      })

    expect((await pack(companyA, [onlyB.id])).body.error.code).toBe('LETTER_NOT_FOR_COMPANY')

    const ok = await pack(companyA, [shared.id], ['tender_acceptance'])
    expect(ok.status).toBe(202)
    // Editing or deleting the letter afterwards does not change the requested PDF.
    await call('delete', `/letter-templates/${shared.id}`)
    await drainJobs()
    const packs = await call('get', `/tenders/${tenderId}/compliance-packs`)
    expect(packs.body[0]).toMatchObject({ status: 'ready', pageCount: 2 })

    expect((await pack(companyA, [shared.id])).body.error.code).toBe('LETTER_NOT_FOUND')
    // A letter for company B with only custom letters is fine.
    expect((await pack(companyB, [onlyB.id])).status).toBe(202)
  })

  it('everyone can list letters; only company managers can change them', async () => {
    const agent = await addUser(ACME, adminToken, 'agent', 'agent@acme.test')
    expect((await call('get', '/letter-templates', agent.token)).status).toBe(200)
    expect((await call('post', '/letter-templates', agent.token).send(myLetter)).status).toBe(403)
    expect(
      (await call('put', '/letter-templates/hidden', agent.token).send({ keys: [] })).status,
    ).toBe(403)
  })
})
