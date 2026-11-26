import ExcelJS from 'exceljs'
import type { ImportColumns, ImportField, ImportRowIssue, SheetType } from '@tdm/shared'
import { isValidDate } from '../../lib/dates'

/** One tender as read from a sheet, before it is compared with the database. */
export interface ParsedTender {
  sheet: string
  row: number
  referenceNo: string
  sourceTenderId: string | null
  title: string
  briefUrl: string | null
  buyerOrganization: string | null
  location: string | null
  estimatedCost: number
  emd: number
  documentFee: number
  deadline: string
  sheetType: SheetType
  msmeExemption: string | null
  startupExemption: string | null
  quantity: string | null
  eligibilityCriteria: string | null
  checklist: string | null
  documentsRequired: string | null
  sourceFile: string
}

export interface ParseResult {
  tenders: ParsedTender[]
  /** Rows with neither a reference number nor a portal tender ID. */
  noReference: number
  /** Rows that were skipped because a detail could not be read (listed in `issues`). */
  invalidRows: number
  /** Problems with single rows, and sheets that were skipped (row 1). */
  issues: ImportRowIssue[]
  /** Sheets that had a reference (or tender ID), tender brief and deadline column. */
  sheetsMatched: number
}

export interface ParseOptions {
  /**
   * Reference number to use when a row has none but has a portal tender ID.
   * Tender247 leaves REFERENCE NO empty for some tenders.
   */
  referenceFromId?: (id: string) => string
}

/**
 * Column names accepted for each field in a Tender247 export (GeM and
 * Non-GeM sheets). Matching ignores case and extra spaces. Taken from the
 * original TMS upload. Clients with other layouts save their own mapping
 * (an import profile), which replaces this list.
 */
export const TENDER247_COLUMNS = {
  sourceTenderId: ['T247 ID', 'T247ID', 'TENDER ID'],
  referenceNo: ['REFERENCE NO', 'REF NO', 'REFERENCE NUMBER', 'REFERENCE'],
  title: ['TENDER BRIEF', 'BRIEF', 'DESCRIPTION'],
  deadline: ['DEADLINE', 'CLOSING DATE', 'DUE DATE', 'BID END DATE'],
  location: ['LOCATION', 'CITY', 'ADDRESS'],
  buyerOrganization: ['ORGANIZATION', 'ORGANIZATION NAME', 'ORG', 'DEPARTMENT'],
  value: ['VALUE', 'BID VALUE', 'CONTRACT VALUE'],
  estimatedCost: ['ESTIMATED COST', 'COST'],
  documentFee: ['DOCUMENT FEES', 'DOCUMENT FEE', 'FEES', 'TENDER FEE'],
  emd: ['EMD', 'EARNEST MONEY', 'EARNEST MONEY DEPOSIT'],
  msmeExemption: ['MSME EXEMPTION', 'MSME', 'MSME EXEMPTIONS', 'MSME STATUS'],
  startupExemption: ['STARTUP EXEMPTION', 'STARTUP', 'STARTUP EXEMPTIONS', 'STARTUP STATUS'],
  quantity: ['QUANTITY', 'QTY', 'QTY.', 'QUANTITY REQUIRED', 'NOS', 'UNITS'],
  eligibilityCriteria: [
    'ELIGIBILITY CRITERIA',
    'ELIGIBILITY',
    'CRITERIA',
    'QUALIFICATION CRITERIA',
  ],
  checklist: [
    'CHECKLIST',
    'DOCUMENTS',
    'REQUIRED DOCUMENTS',
    'DOCUMENT CHECKLIST',
    'DOCUMENTS REQUIRED',
  ],
  documentsRequired: [
    'DOCUMENT REQUIRED FROM SELLER',
    'SELLER DOCUMENTS REQUIRED',
    'REQUIRED DOCUMENTS FROM SELLER',
    'SELLER DOCS',
  ],
  sheetType: ['SHEET TYPE', 'TYPE', 'CATEGORY'],
} as const satisfies Record<ImportField, readonly string[]>

export type Field = ImportField

/** For each field, the column headings that may hold it. Fields left out are not imported. */
export type ColumnMap = Partial<Record<Field, readonly string[]>>

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase()

/** Plain text of a cell, whatever ExcelJS stored (rich text, hyperlink, formula…). */
function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return ''
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return (cell.text ?? '').trim()
}

/** Text value, with the placeholders Tender247 uses for "nothing" turned into null. */
function optionalText(cell: ExcelJS.Cell | undefined, max = 255): string | null {
  const t = cellText(cell)
  if (!t || /^(na|n\/a|-|nil|none)$/i.test(t)) return null
  return t.slice(0, max)
}

const LONG_TEXT = 60_000

/** Money such as 1500000, "15,00,000", "₹ 15,00,000.00" or "Rs. 1500". Unreadable → 0. */
export function parseAmount(cell: ExcelJS.Cell | undefined): number {
  if (!cell) return 0
  const v = cell.value
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0
  const result = (v as { result?: unknown } | null)?.result
  if (typeof result === 'number') return result > 0 ? result : 0
  const digits = cellText(cell)
    .replace(/,/g, '')
    .match(/\d+(\.\d+)?/)
  return digits ? Number(digits[0]) : 0
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number | string) => String(n).padStart(2, '0')

/**
 * Reads a deadline as YYYY-MM-DD. Accepts Excel dates, Excel serial numbers,
 * DD-MM-YYYY / DD/MM/YYYY (Indian order), YYYY-MM-DD and DD-Mon-YYYY, with or
 * without a time. Returns null when it cannot be read.
 */
export function parseDeadline(cell: ExcelJS.Cell | undefined): string | null {
  if (!cell) return null
  const v = cell.value
  let out: string | null = null
  if (v instanceof Date) {
    // ExcelJS stores sheet dates as UTC midnight of the shown date.
    out = v.toISOString().slice(0, 10)
  } else if (typeof v === 'number' && v > 20000 && v < 80000) {
    out = new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10)
  } else {
    const t = cellText(cell)
    let m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
    if (m) out = `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`
    else if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)))
      out = `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`
    else if ((m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{4})/))) {
      const month = MONTHS.indexOf(m[2]!.toLowerCase())
      if (month >= 0) out = `${m[3]}-${pad(month + 1)}-${pad(m[1]!)}`
    }
  }
  return out && isValidDate(out) ? out : null
}

function sheetTypeOf(sheetName: string, override: string): SheetType {
  const o = override.toLowerCase().replace(/[\s.-]/g, '')
  if (o === 'gem') return 'gem'
  if (o === 'nongem') return 'non_gem'
  const n = sheetName.toLowerCase().replace(/[\s-]/g, '')
  return n.includes('gem') && !n.includes('nongem') ? 'gem' : 'non_gem'
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw new Error('UNREADABLE_FILE')
  }
  return workbook
}

/** The headings in row 1 of each sheet, so a client can map their own layout. */
export async function readHeadings(
  buffer: Buffer,
): Promise<{ name: string; headings: string[]; rows: number }[]> {
  const workbook = await loadWorkbook(buffer)
  const sheets: { name: string; headings: string[]; rows: number }[] = []
  workbook.eachSheet((sheet) => {
    const headings: string[] = []
    sheet.getRow(1).eachCell((cell) => {
      const t = cellText(cell).replace(/\s+/g, ' ').trim()
      if (t && !headings.includes(t)) headings.push(t.slice(0, 200))
    })
    sheets.push({ name: sheet.name, headings, rows: Math.max(0, sheet.actualRowCount - 1) })
  })
  return sheets
}

/** Headings found together only in this app's own "Export to Excel" tender list. */
const OWN_EXPORT_HEADINGS = ['TENDER BRIEF', 'STAGE', 'IN STAGE SINCE', 'STAGE NOTE']

/** True when a sheet is a tender list exported from this app, not a portal download. */
export function hasOwnExportHeadings(sheets: { headings: string[] }[]): boolean {
  return sheets.some((s) => {
    const names = new Set(s.headings.map(normalise))
    return OWN_EXPORT_HEADINGS.every((h) => names.has(h))
  })
}

export async function isOwnExport(buffer: Buffer): Promise<boolean> {
  try {
    return hasOwnExportHeadings(await readHeadings(buffer))
  } catch {
    return false
  }
}

/** Fields whose column heading matches a Tender247 name, picking the first match. */
export function suggestColumns(headings: readonly string[]): ImportColumns {
  const byName = new Map(headings.map((h) => [normalise(h), h]))
  const out: ImportColumns = {}
  for (const field of Object.keys(TENDER247_COLUMNS) as Field[]) {
    for (const name of TENDER247_COLUMNS[field]) {
      const found = byName.get(normalise(name))
      if (found && !Object.values(out).includes(found)) {
        out[field] = found
        break
      }
    }
  }
  return out
}

/** A saved profile's mapping (one heading per field) in the form the parser reads. */
export function profileColumns(columns: ImportColumns): ColumnMap {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([, heading]) => heading)
      .map(([field, heading]) => [field, [heading]]),
  )
}

/** Tender247 leaves REFERENCE NO empty for some tenders; their T247 ID stands in. */
export const t247Reference = (id: string) => `T247-${id}`

/** Reads a Tender247 export with the built-in column names. */
export function parseTender247(buffer: Buffer, fileName: string): Promise<ParseResult> {
  return parseTenderWorkbook(buffer, fileName, TENDER247_COLUMNS, {
    referenceFromId: t247Reference,
  })
}

/** Reads every sheet using the given column mapping. Does not touch the database. */
export async function parseTenderWorkbook(
  buffer: Buffer,
  fileName: string,
  columns: ColumnMap,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const workbook = await loadWorkbook(buffer)
  const result: ParseResult = {
    tenders: [],
    noReference: 0,
    invalidRows: 0,
    issues: [],
    sheetsMatched: 0,
  }
  const rowIssue = (sheet: string, row: number, message: string) => {
    result.invalidRows++
    result.issues.push({ sheet, row, message })
  }

  workbook.eachSheet((sheet) => {
    const header = new Map<string, number>()
    sheet.getRow(1).eachCell((cell, col) => {
      const name = normalise(cellText(cell))
      if (name && !header.has(name)) header.set(name, col)
    })
    const colOf = (field: Field): number | null => {
      for (const name of columns[field] ?? []) {
        const col = header.get(normalise(name))
        if (col) return col
      }
      return null
    }
    const cols = Object.fromEntries(
      (Object.keys(TENDER247_COLUMNS) as Field[]).map((f) => [f, colOf(f)]),
    ) as Record<Field, number | null>

    // A sheet without a reference or tender ID column is not a tender list (e.g. a summary tab).
    if (!cols.referenceNo && !cols.sourceTenderId) return
    if (!cols.title || !cols.deadline) {
      const missing = [!cols.title && 'tender brief', !cols.deadline && 'deadline']
        .filter(Boolean)
        .join(' and ')
      result.issues.push({
        sheet: sheet.name,
        row: 1,
        message: `No ${missing} column found, so this sheet was skipped`,
      })
      return
    }
    result.sheetsMatched++

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const at = (f: Field) => (cols[f] ? row.getCell(cols[f]!) : undefined)

      const sourceTenderId = optionalText(at('sourceTenderId'), 100)
      let referenceNo = cellText(at('referenceNo'))
      if (!referenceNo && sourceTenderId) {
        referenceNo = options.referenceFromId?.(sourceTenderId) ?? sourceTenderId
      }
      referenceNo = referenceNo.slice(0, 191)
      if (!referenceNo) {
        result.noReference++
        return
      }
      const deadline = parseDeadline(at('deadline'))
      if (!deadline) {
        rowIssue(
          sheet.name,
          rowNumber,
          `Deadline "${cellText(at('deadline')) || 'empty'}" could not be read`,
        )
        return
      }
      const titleCell = at('title')
      const title = cellText(titleCell)
      if (!title) {
        rowIssue(sheet.name, rowNumber, 'Tender brief is empty')
        return
      }

      // GeM sheets use "Value"; Non-GeM sheets use "Estimated cost".
      const value = parseAmount(at('value'))
      result.tenders.push({
        sheet: sheet.name,
        row: rowNumber,
        referenceNo,
        sourceTenderId,
        title: title.slice(0, LONG_TEXT),
        briefUrl: titleCell?.hyperlink ? String(titleCell.hyperlink).slice(0, 2000) : null,
        buyerOrganization: optionalText(at('buyerOrganization')),
        location: optionalText(at('location')),
        estimatedCost: value > 0 ? value : parseAmount(at('estimatedCost')),
        emd: parseAmount(at('emd')),
        documentFee: parseAmount(at('documentFee')),
        deadline,
        sheetType: sheetTypeOf(sheet.name, cellText(at('sheetType'))),
        msmeExemption: optionalText(at('msmeExemption')),
        startupExemption: optionalText(at('startupExemption')),
        quantity: optionalText(at('quantity')),
        eligibilityCriteria: optionalText(at('eligibilityCriteria'), LONG_TEXT),
        checklist: optionalText(at('checklist'), LONG_TEXT),
        documentsRequired: optionalText(at('documentsRequired'), LONG_TEXT),
        sourceFile: `${fileName} (${sheet.name})`.slice(0, 255),
      })
    })
  })

  return result
}
