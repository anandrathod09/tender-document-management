import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { InstallationReport, TenderDetail } from '@tdm/shared'
import { env } from '../src/config/env'
import { ensureDatabase } from '../src/db/create-databases'
import { db } from '../src/db/client'
import { plans } from '../src/db/schema'
import { migrateFromTms } from '../src/db/migrate-from-tms'
import { app, bearer, createPlan, hostOf, resetDb } from './helpers'
import { listAll } from './tender-helpers'

const SOURCE = 'tms_source_test'
const HOST = hostOf('migrated')
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  agent: '22222222-2222-4222-8222-222222222222',
  engineer: '33333333-3333-4333-8333-333333333333',
  client: '44444444-4444-4444-8444-444444444444',
  wonTender: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  missedTender: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  rejectedTender: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
}

/** A small database shaped like the original TMS (only the columns the migration reads). */
async function buildSourceDb() {
  await ensureDatabase(SOURCE)
  const c = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: SOURCE,
    multipleStatements: true,
  })
  const hash = bcrypt.hashSync('old-password-1', 4)
  await c.query(`
    DROP TABLE IF EXISTS users, tenders, tender_reports, tender_documents;
    CREATE TABLE users (id varchar(36), username varchar(100), userType varchar(20), company varchar(30), first_name varchar(100), last_name varchar(100),
      email varchar(255), password_hash varchar(255), status varchar(20), lastLogin datetime, createdAt datetime);
    CREATE TABLE tenders (id varchar(36), t247Id varchar(100), referenceNo varchar(100), tenderBrief text, tenderBriefLink text, estimatedCost decimal(15,2),
      deadline datetime, location varchar(255), organization varchar(255), documentFees decimal(10,2), emd decimal(10,2), msmeExemption varchar(255),
      quantity varchar(100), sheetType varchar(10), status varchar(30), workflowStatus varchar(30), previousWorkflowStatus varchar(50),
      assignedToAgent varchar(36), agentAssignedAt datetime, company varchar(30), winningAmount decimal(15,2), awardNumber varchar(100),
      priceReviewNotes text, priceReviewedAt datetime, priceReviewedBy char(36), wonNotes text, wonAt datetime, rejectionComment text, rejectedAt datetime,
      agentNotes text, assignedToEngineer varchar(36), engineerStatus varchar(20), compliance_file text, createdAt datetime, updatedAt datetime);
    CREATE TABLE tender_reports (id varchar(36), tenderId varchar(36), purchaseOrderNumber varchar(255), poDate datetime, reportDate datetime,
      customerName varchar(255), department varchar(255), selectedCompanyProfile varchar(255), consignees json, createdAt datetime);
    CREATE TABLE tender_documents (id varchar(36), title varchar(255), filePath varchar(500), uploadedBy varchar(36));
  `)
  await c.query(
    `INSERT INTO users VALUES
      (?, 'admin', 'admin', NULL, 'Asha', 'Patil', 'ADMIN@old.test', ?, 'active', NULL, '2026-01-02'),
      (?, 'agent', 'agent', 'ostnasik', 'Ravi', 'Kale', 'ravi@old.test', ?, 'active', NULL, '2026-01-03'),
      (?, 'eng', 'engineer', NULL, 'Esha', NULL, 'esha@old.test', NULL, 'pending', NULL, '2026-01-04'),
      (?, 'buyer', 'client', NULL, 'Buyer', NULL, 'buyer@old.test', ?, 'active', NULL, '2026-01-05')`,
    [ids.admin, hash, ids.agent, hash, ids.engineer, ids.client, hash],
  )
  await c.query(
    `INSERT INTO tenders (id, t247Id, referenceNo, tenderBrief, estimatedCost, deadline, organization, emd, msmeExemption, sheetType, status, workflowStatus,
       previousWorkflowStatus, assignedToAgent, agentAssignedAt, company, winningAmount, awardNumber, priceReviewNotes, priceReviewedAt, priceReviewedBy,
       wonNotes, wonAt, rejectionComment, rejectedAt, agentNotes, assignedToEngineer, engineerStatus, createdAt, updatedAt) VALUES
      (?, '901', 'GEM/2026/B/1', 'Supply of laptops', 3200000, '2026-03-10', 'Indian Railways', 64000, 'NA', 'GeM', 'won', 'won',
       NULL, ?, '2026-02-01', NULL, 3100000, 'PO-77', 'Rates are fine', '2026-02-05', ?, 'Won at L1', '2026-03-20', NULL, NULL,
       'Automatically marked as expired', ?, 'site-visit', '2026-01-20', '2026-03-20'),
      (?, '902', 'PWD/2', 'Road work', 100000, '2026-03-01', 'PWD', 0, NULL, 'Non-GeM', 'expired', 'not-bidded',
       'price-review', ?, '2026-02-01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-21', '2026-03-02'),
      (?, '903', 'PWD/3', 'Painting', 5000, '2026-03-01', 'PWD', 0, NULL, 'Non-GeM', 'rejected', 'new',
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Not our line of work', '2026-01-25', NULL, NULL, NULL, '2026-01-22', '2026-01-25')`,
    [
      ids.wonTender,
      ids.agent,
      ids.admin,
      ids.engineer,
      ids.missedTender,
      ids.agent,
      ids.rejectedTender,
    ],
  )
  const consignees = [
    {
      name: 'Stores, Nashik Road',
      designation: 'Storekeeper',
      number: '0253000000',
      assignedEngineerId: ids.engineer,
      engineerStatus: 'completed',
      callAlignedDate: '2026-04-01T00:00:00.000Z',
      reportCards: [
        {
          title: 'Report Template 1',
          itemName: 'Laptop i5 16GB',
          quantity: 2,
          warrantyYears: 3,
          itemGroups: [
            { fieldValues: { serialNumberCommon: 'LT-1', installationStatus: 'yes', remarks: '' } },
            {
              fieldValues: {
                serialNumberCommon: 'LT-2',
                installationStatus: 'no',
                remarks: 'Damaged box',
              },
            },
          ],
        },
      ],
    },
  ]
  await c.query(
    `INSERT INTO tender_reports VALUES ('r1', ?, 'PO-77', '2026-03-25', '2026-04-02', 'Indian Railways, Nashik', 'Electrical', 'ostnasik', ?, '2026-04-02')`,
    [ids.wonTender, JSON.stringify(consignees)],
  )
  await c.end()
}

describe('migration from the original TMS', () => {
  let planCode: string

  beforeAll(buildSourceDb)
  beforeEach(async () => {
    await resetDb()
    const planId = await createPlan()
    planCode = (await db.select({ code: plans.code }).from(plans)).find(Boolean)!.code
    expect(planId).toBeTruthy()
  })

  const run = (dryRun = false) =>
    migrateFromTms({ source: SOURCE, slug: 'migrated', name: 'Migrated Co', planCode, dryRun })

  it('a dry run reports what would happen and saves nothing', async () => {
    const r = await run(true)
    expect(r).toMatchObject({
      dryRun: true,
      tenders: 3,
      users: { migrated: 3, invited: 1, skipped: 1 },
      companies: 1,
    })
    expect((await request(app).get('/api/workspace').set('Host', HOST)).status).toBe(404)
  })

  it('moves users, tenders, history and installation data, and old passwords keep working', async () => {
    const r = await run()
    expect(r.installation).toEqual({ reports: 1, consignees: 1, units: 2 })
    expect(r.warnings.join(' ')).toContain('buyer-side')

    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', HOST)
      .send({ email: 'admin@old.test', password: 'old-password-1' })
    expect(login.status).toBe(200)
    expect(login.body.session).toMatchObject({
      user: { id: ids.admin, name: 'Asha Patil' },
      role: { key: 'admin' },
    })
    const token = login.body.accessToken as string

    const all = await listAll(HOST, token)
    const byRef = Object.fromEntries(all.items.map((t) => [t.referenceNo, t]))
    expect(byRef['GEM/2026/B/1']).toMatchObject({
      id: ids.wonTender,
      stage: { label: 'Won' },
      sheetType: 'gem',
      deadline: '2026-03-10',
    })
    expect(byRef['PWD/2']!.stage.label).toBe('Not bidded')
    expect(byRef['PWD/3']!.stage.label).toBe('Rejected')

    const won = (
      await request(app).get(`/api/tenders/${ids.wonTender}`).set('Host', HOST).set(bearer(token))
    ).body as TenderDetail
    expect(won).toMatchObject({
      awardAmount: 3100000,
      awardNumber: 'PO-77',
      msmeExemption: null,
      assignedAgent: { id: ids.agent },
      biddingCompany: { name: 'OST Nasik' },
    })
    // History rebuilt from the old notes, oldest last in the list.
    const comments = won.history.map((h) => h.comment)
    expect(comments.at(-1)).toBe('Added in the previous system')
    expect(comments).toContain('Rates are fine')
    expect(comments).toContain('Won at L1')
    expect(won.history.find((h) => h.comment === 'Rates are fine')!.changedBy).toEqual({
      id: ids.admin,
      name: 'Asha Patil',
    })
    // The old automatic note is kept, but not presented as a stage of its own.
    expect(comments[0]).toBe(
      'Carried over from the previous system. Notes: Automatically marked as expired',
    )

    const report = (
      await request(app)
        .get(`/api/tenders/${ids.wonTender}/installation-report`)
        .set('Host', HOST)
        .set(bearer(token))
    ).body as InstallationReport
    expect(report).toMatchObject({
      poNumber: 'PO-77',
      reportDate: '2026-04-02',
      customerName: 'Indian Railways, Nashik',
    })
    expect(report.consignees[0]).toMatchObject({
      status: 'completed',
      engineer: { id: ids.engineer },
      callAlignedDate: '2026-04-01',
    })
    expect(
      report.consignees[0]!.assets.map((a) => [a.serialNumber, a.installStatus, a.warrantyMonths]),
    ).toEqual([
      ['LT-1', 'installed', 36],
      ['LT-2', 'not_installed', 36],
    ])

    // The engineer never set a password: invited, waiting for a new invitation.
    const users = await request(app).get('/api/users').set('Host', HOST).set(bearer(token))
    expect(users.body.find((u: { email: string }) => u.email === 'esha@old.test').status).toBe(
      'invited',
    )
  })

  it('a "not bidded" tender can still go back to its earlier stage', async () => {
    await run()
    const [row] = await db.execute<any>(
      `SELECT s.\`key\` FROM tenders t JOIN workflow_stages s ON s.id = t.previous_stage_id WHERE t.id = '${ids.missedTender}'`,
    )
    expect((row as unknown as { key: string }[])[0]!.key).toBe('price-review')
  })

  it('refuses to migrate twice into the same workspace', async () => {
    await run()
    await expect(run()).rejects.toThrow(/already has tenders/)
  })
})
