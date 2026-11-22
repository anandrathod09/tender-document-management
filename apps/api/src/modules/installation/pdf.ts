import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { ConsigneeRow, InstallationReport } from '@tdm/shared'
import { embedImage, pdfSafe, wrap, type Image } from '../compliance/pdf'

/**
 * The Hardware Installation Report from the original TMS: one section per
 * consignee with the delivery details, a table of installed units, and
 * signature boxes for the engineer and the customer.
 */

const A4L: [number, number] = [841.89, 595.28] // landscape: the unit table is wide
const M = 36
const W = A4L[0] - M * 2
const GRID = rgb(0.55, 0.55, 0.55)
const SHADE = rgb(0.93, 0.95, 1)
const BLUE = rgb(0, 0.4, 0.8)

export interface InstallationPdfInput {
  report: InstallationReport
  tenderRef: string
  company: { name: string; address: string } | null
  logo: Image | null
  date: string
  /** Only this consignee; all when omitted. */
  consigneeId?: string
}

const fmt = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '')

export async function buildInstallationPdf(input: InstallationPdfInput) {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let logo: PDFImage | null = null
  try {
    if (input.logo) logo = await embedImage(doc, input.logo)
  } catch {
    logo = null
  }
  const { report } = input
  doc.setTitle(pdfSafe(`Hardware Installation Report - ${input.tenderRef}`))

  const consignees = report.consignees.filter(
    (c) => !input.consigneeId || c.id === input.consigneeId,
  )
  if (!consignees.length) throw new Error('NO_CONSIGNEES')

  for (const c of consignees) drawConsignee(doc, { regular, bold }, logo, input, c)

  // Page numbers across the whole document.
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, {
      x: A4L[0] - M - regular.widthOfTextAtSize(label, 8),
      y: 18,
      size: 8,
      font: regular,
    })
  })
  return { bytes: await doc.save(), pageCount: pages.length }
}

type Fonts = { regular: PDFFont; bold: PDFFont }

function drawConsignee(
  doc: PDFDocument,
  f: Fonts,
  logo: PDFImage | null,
  input: InstallationPdfInput,
  c: ConsigneeRow,
) {
  const { report } = input
  let page!: PDFPage
  let y = 0

  const header = () => {
    page = doc.addPage(A4L)
    y = A4L[1] - M
    if (input.company) {
      page.drawText(pdfSafe(input.company.name), {
        x: M,
        y: y - 14,
        size: 14,
        font: f.bold,
        color: BLUE,
      })
      for (const line of wrap(`Address: ${input.company.address}`, f.regular, 8, W - 170)) {
        y -= 11
        page.drawText(line, { x: M, y: y - 14, size: 8, font: f.regular })
      }
    }
    if (logo) {
      const s = logo.scaleToFit(140, 42)
      page.drawImage(logo, {
        x: A4L[0] - M - s.width,
        y: A4L[1] - M - s.height,
        width: s.width,
        height: s.height,
      })
    }
    y = Math.min(y - 22, A4L[1] - M - 50)
    const title = 'Hardware Installation Report'
    page.drawText(title, {
      x: M + (W - f.bold.widthOfTextAtSize(title, 13)) / 2,
      y: y - 13,
      size: 13,
      font: f.bold,
    })
    y -= 24
  }

  // Every label box has the same width, so half-width and full-width rows line up.
  const LABEL_W = W * 0.2

  /** A row of label/value cells with borders; moves y down. */
  const row = (cells: [string, string, number][]) => {
    const height =
      Math.max(
        ...cells.map(
          ([, value, width]) => wrap(value || ' ', f.regular, 8, width * W - LABEL_W - 8).length,
        ),
      ) *
        10 +
      8
    let x = M
    for (const [label, value, width] of cells) {
      const cw = width * W
      const lw = LABEL_W
      page.drawRectangle({
        x,
        y: y - height,
        width: lw,
        height,
        color: SHADE,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      page.drawRectangle({
        x: x + lw,
        y: y - height,
        width: cw - lw,
        height,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      wrap(label, f.bold, 8, lw - 8)
        .slice(0, 2)
        .forEach((l, i) =>
          page.drawText(l, { x: x + 4, y: y - 11 - i * 10, size: 8, font: f.bold }),
        )
      wrap(value || '', f.regular, 8, cw - lw - 8).forEach((l, i) =>
        page.drawText(l, { x: x + lw + 4, y: y - 11 - i * 10, size: 8, font: f.regular }),
      )
      x += cw
    }
    y -= height
  }

  header()
  row([
    ['Tender Ref No.', input.tenderRef, 0.5],
    ['Date', fmt(report.reportDate) || input.date, 0.5],
  ])
  row([
    ['Purchase Order No.', report.poNumber ?? '', 0.5],
    ['PO Date', fmt(report.poDate), 0.5],
  ])
  row([['Customer Name', report.customerName ?? '', 1]])
  row([['Customer Address', report.customerAddress ?? '', 1]])
  row([
    ['State Office', report.stateOffice ?? '', 0.5],
    [
      'Contact Person',
      [report.contactPersonName, report.contactPersonDesignation, report.contactPersonPhone]
        .filter(Boolean)
        .join(' - '),
      0.5,
    ],
  ])
  y -= 8
  row([
    ['Consignee Name & Designation', [c.name, c.designation].filter(Boolean).join(' - '), 0.5],
    ['Contact Number', c.phone ?? '', 0.5],
  ])
  row([
    ['Engineer', c.engineer?.name ?? '', 0.5],
    ['Department', report.department ?? '', 0.5],
  ])
  row([
    ['Call Aligned Date', fmt(c.callAlignedDate), 0.5],
    ['Email ID', c.email ?? '', 0.5],
  ])
  row([['FAX No', c.fax ?? '', 1]])
  y -= 10

  // Unit table, as in the old report: one SR.NO per report template with its item name
  // written once down all its rows. Monitor/CPU columns appear when any template uses
  // them; a common serial then spans both.
  const anySplit = c.items.some((i) => i.serialType === 'split')
  const COL = { sr: 0.06, item: 0.3, serial: 0.34, installed: 0.1, remark: 0.2 }
  const INSTALLED = { installed: 'Y', not_installed: 'N', pending: '' } as const

  const tableHeader = () => {
    const heads: [string, number][] = [
      ['SR.NO', COL.sr],
      ['ITEM NAME & CONFIG', COL.item],
      ...((anySplit
        ? [
            ['MONITOR SERIAL NO', COL.serial / 2],
            ['CPU SERIAL NO', COL.serial / 2],
          ]
        : [['SERIAL NUMBER', COL.serial]]) as [string, number][]),
      ['INSTALLED (Y/N)', COL.installed],
      ['REMARK', COL.remark],
    ]
    let x = M
    for (const [title, w] of heads) {
      page.drawRectangle({
        x,
        y: y - 20,
        width: w * W,
        height: 20,
        color: SHADE,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      page.drawText(pdfSafe(title), { x: x + 4, y: y - 13, size: 7.5, font: f.bold })
      x += w * W
    }
    y -= 20
  }
  const cellBox = (x: number, w: number, top: number, h: number, lines: string[]) => {
    page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: GRID, borderWidth: 0.5 })
    lines
      .slice(0, Math.max(1, Math.floor((h - 4) / 10)))
      .forEach((l, li) =>
        page.drawText(l, { x: x + 4, y: top - 11 - li * 10, size: 8, font: f.regular }),
      )
  }

  const SIGN_H = 70
  tableHeader()
  c.items.forEach((item, k) => {
    const split = item.serialType === 'split'
    const rowCount = Math.max(item.quantity, item.units.length, 1)
    const itemLines = wrap(item.itemName || ' ', f.regular, 8, COL.item * W - 8)
    const rows = Array.from({ length: rowCount }, (_, r) => {
      const u = item.units[r]
      const serials = split
        ? [u?.monitorSerial ?? '', u?.cpuSerial ?? '']
        : [u?.serialNumber ?? u?.monitorSerial ?? u?.cpuSerial ?? '']
      const serialW = split || !anySplit ? COL.serial / serials.length : COL.serial
      const lines = [
        ...serials.map((v) => wrap(v || ' ', f.regular, 8, serialW * W - 8)),
        wrap(u ? INSTALLED[u.installStatus] : ' ', f.regular, 8, COL.installed * W - 8),
        wrap(u?.remarks || ' ', f.regular, 8, COL.remark * W - 8),
      ]
      return { serials, serialW, lines, h: Math.max(...lines.map((l) => l.length)) * 10 + 8 }
    })
    // Tall item descriptions make the template's last row taller.
    const needed = itemLines.length * 10 + 8
    const total = rows.reduce((n, r) => n + r.h, 0)
    if (total < needed) rows[rows.length - 1]!.h += needed - total

    let groupTop = y
    let lineFrom = 0
    const closeGroup = () => {
      const h = groupTop - y
      if (h <= 0) return
      cellBox(M, COL.sr * W, groupTop, h, [String(k + 1)])
      const fit = Math.max(1, Math.floor((h - 4) / 10))
      cellBox(M + COL.sr * W, COL.item * W, groupTop, h, itemLines.slice(lineFrom, lineFrom + fit))
      lineFrom += fit
    }
    for (const r of rows) {
      if (y - r.h < M + 20) {
        closeGroup()
        header()
        tableHeader()
        groupTop = y
        if (lineFrom >= itemLines.length) lineFrom = 0
      }
      let x = M + (COL.sr + COL.item) * W
      r.serials.forEach((_, si) => {
        cellBox(x, r.serialW * W, y, r.h, r.lines[si]!)
        x += r.serialW * W
      })
      cellBox(x, COL.installed * W, y, r.h, r.lines[r.serials.length]!)
      x += COL.installed * W
      cellBox(x, COL.remark * W, y, r.h, r.lines[r.serials.length + 1]!)
      y -= r.h
    }
    closeGroup()
  })
  if (!c.items.length) {
    page.drawText('No units recorded yet.', { x: M + 4, y: y - 14, size: 8, font: f.regular })
    y -= 20
  }

  // Signatures.
  if (y - SIGN_H - 12 < M + 20) header()
  y -= 12
  const box = (x: number, title: string, name: string) => {
    page.drawRectangle({
      x,
      y: y - SIGN_H,
      width: W / 2 - 6,
      height: SIGN_H,
      borderColor: GRID,
      borderWidth: 0.5,
    })
    page.drawText(pdfSafe(title), { x: x + 6, y: y - 14, size: 8, font: f.bold })
    if (name)
      page.drawText(pdfSafe(name), { x: x + 6, y: y - SIGN_H + 8, size: 8, font: f.regular })
  }
  box(M, 'Signature of Engineer with Date', c.engineer?.name ?? '')
  box(
    M + W / 2 + 6,
    'Stamp and Signature of Customer',
    [c.name, c.designation].filter(Boolean).join(' - '),
  )
  y -= SIGN_H
}
