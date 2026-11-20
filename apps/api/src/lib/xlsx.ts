import ExcelJS from 'exceljs'

export interface Column<T> {
  header: string
  width: number
  value: (row: T) => string | number | Date | null | undefined
  /** Excel number format, e.g. '#,##0' or 'dd-mm-yyyy'. */
  format?: string
}

/** A one-sheet workbook with a bold, frozen header row and filters. */
export async function buildWorkbook<T>(
  sheetName: string,
  columns: Column<T>[],
  rows: T[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width,
    style: c.format ? { numFmt: c.format } : {},
  }))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF3FF' } }
  for (const row of rows) ws.addRow(columns.map((c) => c.value(row) ?? null))
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Excel shows a YYYY-MM-DD date as a real date cell. */
export const asDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null
