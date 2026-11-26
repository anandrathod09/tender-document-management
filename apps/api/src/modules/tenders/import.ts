import { randomUUID } from 'node:crypto'
import { count, eq, gte, inArray } from 'drizzle-orm'
import type { ExcelChange, ImportResult, ImportRowIssue } from '@tdm/shared'
import { env } from '../../config/env'
import { db, type Tx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import {
  importRuns,
  organizations,
  plans,
  tenders,
  tenderStageHistory,
  type Tender,
  type WorkflowStage,
} from '../../db/schema'
import { writeAudit } from '../../lib/audit'
import { todayIn } from '../../lib/dates'
import { badRequest, conflict } from '../../lib/errors'
import { logger } from '../../lib/logger'
import type { TenantAuth } from '../../types/express'
import { getStageByRole, listStages } from '../workflow/service'
import {
  parseTender247,
  parseTenderWorkbook,
  profileColumns,
  type ParsedTender,
  type ParseResult,
  isOwnExport,
} from './excel'
import { getImportProfile } from './import-profiles'

const MAX_ISSUES = 200
const BATCH = 200

/** Fields compared on re-upload; changes are shown on the tender as "Updated from Excel". */
const TRACKED: {
  field: keyof ParsedTender & keyof Tender
  label: string
  kind: 'date' | 'number' | 'text' | 'long'
}[] = [
  { field: 'deadline', label: 'Deadline', kind: 'date' },
  { field: 'estimatedCost', label: 'Estimated cost', kind: 'number' },
  { field: 'emd', label: 'EMD', kind: 'number' },
  { field: 'documentFee', label: 'Document fee', kind: 'number' },
  { field: 'quantity', label: 'Quantity', kind: 'text' },
  { field: 'location', label: 'Location', kind: 'text' },
  { field: 'buyerOrganization', label: 'Buyer organization', kind: 'text' },
  { field: 'msmeExemption', label: 'MSME exemption', kind: 'text' },
  { field: 'startupExemption', label: 'Startup exemption', kind: 'text' },
  { field: 'sheetType', label: 'Sheet type', kind: 'text' },
  { field: 'title', label: 'Tender brief', kind: 'long' },
  { field: 'eligibilityCriteria', label: 'Eligibility criteria', kind: 'long' },
  { field: 'checklist', label: 'Checklist', kind: 'long' },
  { field: 'documentsRequired', label: 'Documents required from seller', kind: 'long' },
]

function diff(existing: Tender, incoming: ParsedTender): ExcelChange[] {
  const changes: ExcelChange[] = []
  for (const { field, label, kind } of TRACKED) {
    const a = existing[field]
    const b = incoming[field]
    if (kind === 'number') {
      const from = Math.round(Number(a ?? 0) * 100) / 100
      const to = Math.round(Number(b ?? 0) * 100) / 100
      if (from !== to) changes.push({ field, label, from, to })
    } else {
      const from = String(a ?? '').trim()
      const to = String(b ?? '').trim()
      if (from !== to) {
        // Long texts are listed by name only; their full text is on the tender.
        changes.push(
          kind === 'long' ? { field, label } : { field, label, from: from || null, to: to || null },
        )
      }
    }
  }
  return changes
}

const dataColumns = (t: ParsedTender) => ({
  sourceTenderId: t.sourceTenderId,
  title: t.title,
  briefUrl: t.briefUrl,
  buyerOrganization: t.buyerOrganization,
  location: t.location,
  estimatedCost: t.estimatedCost,
  emd: t.emd,
  documentFee: t.documentFee,
  deadline: t.deadline,
  sheetType: t.sheetType,
  msmeExemption: t.msmeExemption,
  startupExemption: t.startupExemption,
  quantity: t.quantity,
  eligibilityCriteria: t.eligibilityCriteria,
  checklist: t.checklist,
  documentsRequired: t.documentsRequired,
  sourceFile: t.sourceFile,
})

/**
 * Imports a tender list from Excel into the user's workspace. Without a
 * profile the file is read as a Tender247 export; with one, the profile's
 * column headings are used.
 *
 * - Rows without a reference number (or portal tender ID), or with a deadline
 *   before today (in the client's time zone), are skipped.
 * - A reference number already in the workspace updates that tender's data
 *   but keeps its stage, assignment and notes.
 * - A tender that had missed its deadline goes back to the stage it was in
 *   when the new sheet extends the deadline.
 */
export async function importTenders(
  auth: TenantAuth,
  file: { buffer: Buffer; originalname: string },
  profileId?: string,
): Promise<ImportResult> {
  const orgId = auth.org.id
  const fileName = file.originalname.slice(0, 255)
  const profile = profileId ? await getImportProfile(db, orgId, profileId) : null
  const source = profile ? 'custom' : 'tender247'
  const layout = profile?.name ?? 'Tender247 export'

  let parsed: ParseResult
  try {
    parsed = profile
      ? await parseTenderWorkbook(file.buffer, fileName, profileColumns(profile.columns))
      : await parseTender247(file.buffer, fileName)
  } catch {
    throw badRequest(
      'UNREADABLE_FILE',
      'This file could not be read. Upload an Excel (.xlsx) file.',
    )
  }
  if (parsed.sheetsMatched === 0) {
    // A common mix-up: our own "Export to Excel" file uploaded instead of the portal's.
    if (await isOwnExport(file.buffer)) {
      throw badRequest(
        'OWN_EXPORT',
        `This file was exported from ${env.PRODUCT_NAME} (it has Stage and Assigned agent columns), not downloaded from Tender247. Upload the file you downloaded from the Tender247 website.`,
      )
    }
    const detail = parsed.issues.map((i) => `${i.sheet}: ${i.message}.`).join(' ')
    throw badRequest(
      'COLUMNS_NOT_FOUND',
      profile
        ? `No sheet in this file has the columns of the "${profile.name}" layout. Check the file, or edit the layout to match its column headings.${detail ? ` ${detail}` : ''}`
        : `No sheet in this file has the Tender247 columns (REFERENCE NO or T247 ID, TENDER BRIEF and DEADLINE). If the file comes from somewhere else, set up its layout first.${detail ? ` ${detail}` : ''}`,
    )
  }

  const today = todayIn(auth.org.timezone)
  const issues: ImportRowIssue[] = [...parsed.issues]
  const skipped = {
    expired: 0,
    noReference: parsed.noReference,
    duplicateInFile: 0,
    invalid: parsed.invalidRows,
  }

  const rows: ParsedTender[] = []
  const seen = new Set<string>()
  for (const t of parsed.tenders) {
    if (t.deadline < today) {
      skipped.expired++
      continue
    }
    const key = t.referenceNo.toLowerCase()
    if (seen.has(key)) {
      skipped.duplicateInFile++
      issues.push({
        sheet: t.sheet,
        row: t.row,
        message: `Reference ${t.referenceNo} appears twice; only the first was used`,
      })
      continue
    }
    seen.add(key)
    rows.push(t)
  }

  const runId = randomUUID()
  try {
    const result = await db.transaction(async (tx) => {
      const existing = new Map<string, Tender>()
      for (let i = 0; i < rows.length; i += 500) {
        const refs = rows.slice(i, i + 500).map((r) => r.referenceNo)
        const found = await tx
          .select()
          .from(tenders)
          .where(orgWhere(tenders, orgId, inArray(tenders.referenceNo, refs)))
        for (const t of found) existing.set(t.referenceNo.toLowerCase(), t)
      }

      const toCreate = rows.filter((r) => !existing.has(r.referenceNo.toLowerCase()))
      await assertMonthlyLimit(tx, orgId, toCreate.length)

      const intake = await getStageByRole(tx, orgId, 'intake')
      const missed = await getStageByRole(tx, orgId, 'missed_deadline')
      const stages = new Map((await listStages(tx, orgId)).map((s) => [s.id, s]))
      const now = new Date()

      // New tenders
      for (let i = 0; i < toCreate.length; i += BATCH) {
        const batch = toCreate.slice(i, i + BATCH).map((t) => ({
          id: randomUUID(),
          organizationId: orgId,
          source,
          referenceNo: t.referenceNo,
          ...dataColumns(t),
          stageId: intake.id,
          stageChangedAt: now,
        }))
        await tx.insert(tenders).values(batch)
        await tx.insert(tenderStageHistory).values(
          batch.map((t) => ({
            organizationId: orgId,
            tenderId: t.id,
            fromStageId: null,
            toStageId: intake.id,
            comment: `Imported from ${fileName}`,
            changedBy: auth.user.id,
          })),
        )
      }

      // Tenders already in the workspace
      let updated = 0
      let unchanged = 0
      let restored = 0
      for (const t of rows) {
        const current = existing.get(t.referenceNo.toLowerCase())
        if (!current) continue
        const changes = diff(current, t)
        const restoreTo =
          current.stageId === missed.id && current.previousStageId
            ? pickRestoreStage(stages, current, intake)
            : null

        if (changes.length === 0 && !restoreTo) {
          unchanged++
          continue
        }
        await tx
          .update(tenders)
          .set({
            ...dataColumns(t),
            excelUpdate: {
              at: now.toISOString(),
              changes,
              ...(restoreTo && { restoredTo: restoreTo.label }),
            },
            excelUpdatedAt: now,
            ...(restoreTo && {
              stageId: restoreTo.id,
              previousStageId: null,
              stageChangedAt: now,
              deadlineMissedAt: null,
            }),
          })
          .where(orgWhere(tenders, orgId, eq(tenders.id, current.id)))

        if (restoreTo) {
          restored++
          await tx.insert(tenderStageHistory).values({
            organizationId: orgId,
            tenderId: current.id,
            fromStageId: current.stageId,
            toStageId: restoreTo.id,
            comment: `Deadline extended to ${t.deadline} in ${fileName}`,
            changedBy: auth.user.id,
          })
        }
        if (changes.length > 0) updated++
      }

      const totalSkipped =
        skipped.expired + skipped.noReference + skipped.duplicateInFile + skipped.invalid
      await tx.insert(importRuns).values({
        id: runId,
        organizationId: orgId,
        fileName,
        source,
        uploadedBy: auth.user.id,
        status: 'completed',
        created: toCreate.length,
        updated,
        unchanged,
        restored,
        skipped: totalSkipped,
        issues: issues.slice(0, MAX_ISSUES),
      })
      await writeAudit(tx, {
        organizationId: orgId,
        actorType: 'user',
        actorId: auth.user.id,
        action: 'tenders.imported',
        entity: 'import_run',
        entityId: runId,
        details: {
          fileName,
          layout,
          created: toCreate.length,
          updated,
          restored,
          skipped: totalSkipped,
        },
      })
      return { created: toCreate.length, updated, unchanged, restored }
    })

    return {
      id: runId,
      fileName,
      layout,
      ...result,
      skipped,
      issues: issues.slice(0, MAX_ISSUES),
    }
  } catch (err) {
    // Keep a record of failed imports too (outside the rolled-back transaction).
    await db
      .insert(importRuns)
      .values({
        id: runId,
        organizationId: orgId,
        fileName,
        source,
        uploadedBy: auth.user.id,
        status: 'failed',
      })
      .catch((e: unknown) => logger.error({ err: e }, 'Could not record failed import'))
    throw err
  }
}

/** Where a tender goes back to when a new sheet extends its missed deadline. */
function pickRestoreStage(
  stages: Map<string, WorkflowStage>,
  tender: Tender,
  intake: WorkflowStage,
): WorkflowStage {
  const previous = tender.previousStageId ? stages.get(tender.previousStageId) : undefined
  if (previous?.isVisible) return previous
  const preparing = [...stages.values()]
    .filter((s) => s.type === 'preparing' && s.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0]
  return tender.assignedAgentId && preparing ? preparing : intake
}

/** Refuses an import that would take the client over its plan's monthly tender limit. */
async function assertMonthlyLimit(tx: Tx, orgId: string, adding: number) {
  if (adding === 0) return
  const [plan] = await tx
    .select({ max: plans.maxTendersPerMonth })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(eq(organizations.id, orgId))
    .limit(1)
  if (!plan) return
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await tx
    .select({ n: count() })
    .from(tenders)
    .where(orgWhere(tenders, orgId, gte(tenders.createdAt, monthStart)))
  const used = row?.n ?? 0
  if (used + adding > plan.max) {
    throw conflict(
      'PLAN_TENDER_LIMIT',
      `This upload adds ${adding} new tenders, but your plan allows ${plan.max} per month and ${used} are already used. Upgrade the plan or upload fewer tenders.`,
    )
  }
}
