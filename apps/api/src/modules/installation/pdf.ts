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

  // Unit table. Monitor/CPU columns only when this consignee uses them (as in the old report).
  const split = c.assets.some((a) => a.monitorSerial || a.cpuSerial)
  const cols: { title: string; w: number; value: (i: number) => string }[] = [
    { title: 'SR.NO', w: 0.06, value: (i) => String(i + 1) },
    {
      title: 'ITEM NAME & CONFIG',
      w: split ? 0.34 : 0.44,
      value: (i) => [c.assets[i]!.itemName, c.assets[i]!.makeModel].filter(Boolean).join(' / '),
    },
    ...(split
      ? [
          {
            title: 'MONITOR SERIAL NO',
            w: 0.17,
            value: (i: number) => c.assets[i]!.monitorSerial ?? '',
          },
          {
            title: 'CPU SERIAL NO',
            w: 0.17,
            value: (i: number) => c.assets[i]!.cpuSerial ?? c.assets[i]!.serialNumber ?? '',
          },
        ]
      : [
          {
            title: 'SERIAL NUMBER',
            w: 0.24,
            value: (i: number) => c.assets[i]!.serialNumber ?? '',
          },
        ]),
    {
      title: 'INSTALLED (Y/N)',
      w: 0.1,
      value: (i) =>
        ({ installed: 'Y', not_installed: 'N', pending: '' })[c.assets[i]!.installStatus],
    },
    { title: 'REMARK', w: split ? 0.16 : 0.16, value: (i) => c.assets[i]!.remarks ?? '' },
  ]

  const tableHeader = () => {
    let x = M
    for (const col of cols) {
      page.drawRectangle({
        x,
        y: y - 20,
        width: col.w * W,
        height: 20,
        color: SHADE,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      page.drawText(pdfSafe(col.title), { x: x + 4, y: y - 13, size: 7.5, font: f.bold })
      x += col.w * W
    }
    y -= 20
  }
  const SIGN_H = 70
  tableHeader()
  c.assets.forEach((_, i) => {
    const lines = cols.map((col) => wrap(col.value(i) || ' ', f.regular, 8, col.w * W - 8))
    const h = Math.max(...lines.map((l) => l.length)) * 10 + 8
    if (y - h < M + 20) {
      header()
      tableHeader()
    }
    let x = M
    cols.forEach((col, ci) => {
      page.drawRectangle({
        x,
        y: y - h,
        width: col.w * W,
        height: h,
        borderColor: GRID,
        borderWidth: 0.5,
      })
      lines[ci]!.forEach((l, li) =>
        page.drawText(l, { x: x + 4, y: y - 11 - li * 10, size: 8, font: f.regular }),
      )
      x += col.w * W
    })
    y -= h
  })
  if (!c.assets.length) {
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
