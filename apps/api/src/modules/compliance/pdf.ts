import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { fillLetterFields, type ComplianceLetterKey, type LetterContent } from '@tdm/shared'
import { LETTERS, letterValues, type Block, type LetterData } from './letters'

const A4: [number, number] = [595.28, 841.89]
const MARGIN_X = 64
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 64
const CONTENT_W = A4[0] - MARGIN_X * 2
const BODY_SIZE = 11
const LINE = 15.5
/** Space needed for "Thanking You", the signature image and the signatory lines. */
const SIGNATURE_H = 140
const BLUE = rgb(0, 0.4, 0.8)
const BLACK = rgb(0, 0, 0)

export interface Image {
  bytes: Uint8Array
  mime: string
}

export interface Attachment extends Image {
  title: string
}

export interface ComplianceInput {
  letters: ComplianceLetterKey[]
  /** The client's own letters, printed after the built-in ones. */
  customLetters?: LetterContent[]
  data: LetterData
  logo?: Image | null
  signature?: Image | null
  attachments: Attachment[]
}

/**
 * The standard PDF fonts only cover Western European characters. Anything
 * else is replaced, so a stray ₹ or curly quote never breaks the document.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/₹/g, 'Rs. ')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -​]/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF•]/g, '?')
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of pdfSafe(text).split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // A single word wider than the line (e.g. a long reference number) is split.
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

/** Uses the image's real format (from its first bytes), whatever it was labelled as. */
export async function embedImage(doc: PDFDocument, img: Image): Promise<PDFImage> {
  const isPng = img.bytes[0] === 0x89 && img.bytes[1] === 0x50 && img.bytes[2] === 0x4e
  return isPng ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes)
}

class LetterWriter {
  page!: PDFPage
  y = 0

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
    private readonly letterhead: (page: PDFPage) => number,
  ) {}

  newPage() {
    this.page = this.doc.addPage(A4)
    this.y = this.letterhead(this.page)
  }

  /** Starts a new page when fewer than `height` points are left. */
  ensure(height: number) {
    if (this.y - height < MARGIN_BOTTOM) this.newPage()
  }

  lines(
    text: string,
    opts: { font?: PDFFont; size?: number; indent?: number; align?: 'left' | 'center' } = {},
  ) {
    const font = opts.font ?? this.fonts.regular
    const size = opts.size ?? BODY_SIZE
    const indent = opts.indent ?? 0
    for (const line of wrap(text, font, size, CONTENT_W - indent)) {
      this.ensure(LINE)
      const x =
        opts.align === 'center'
          ? MARGIN_X + (CONTENT_W - font.widthOfTextAtSize(line, size)) / 2
          : MARGIN_X + indent
      this.page.drawText(line, { x, y: this.y - size, size, font, color: BLACK })
      this.y -= LINE
    }
  }

  gap(points = 8) {
    this.y -= points
  }

  /** "Label: value" with a bold label; the value wraps under itself. */
  field(label: string, value: string) {
    const { bold, regular } = this.fonts
    const labelText = pdfSafe(`${label}: `)
    const labelW = Math.min(bold.widthOfTextAtSize(labelText, BODY_SIZE), CONTENT_W / 2)
    const valueLines = wrap(value, regular, BODY_SIZE, CONTENT_W - labelW)
    this.ensure(LINE)
    this.page.drawText(labelText, {
      x: MARGIN_X,
      y: this.y - BODY_SIZE,
      size: BODY_SIZE,
      font: bold,
    })
    valueLines.forEach((line, i) => {
      if (i > 0) this.ensure(LINE)
      this.page.drawText(line, {
        x: MARGIN_X + labelW,
        y: this.y - BODY_SIZE,
        size: BODY_SIZE,
        font: regular,
      })
      this.y -= LINE
    })
  }

  /** Height a block will take, without drawing it. */
  measure(b: Block): number {
    const { regular, bold } = this.fonts
    const count = (text: string, indent = 0, font = regular) =>
      wrap(text, font, BODY_SIZE, CONTENT_W - indent).length
    switch (b.kind) {
      case 'para':
        return count(b.text) * LINE + 8
      case 'heading':
        return count(b.text, 0, bold) * LINE
      case 'center':
        return count(b.text, 0, bold) * LINE + 4
      case 'fields':
        return (
          b.rows.reduce((h, [label, value]) => {
            const labelW = Math.min(
              bold.widthOfTextAtSize(pdfSafe(`${label}: `), BODY_SIZE),
              CONTENT_W / 2,
            )
            return h + wrap(value, regular, BODY_SIZE, CONTENT_W - labelW).length * LINE
          }, 0) + 8
        )
      case 'numbered':
      case 'bullets':
        return b.items.reduce((h, item) => h + count(item, 22) * LINE + 4, 0) + 4
    }
  }

  block(b: Block) {
    const { bold } = this.fonts
    switch (b.kind) {
      case 'para':
        this.lines(b.text)
        this.gap()
        break
      case 'heading':
        this.ensure(LINE * 2)
        this.lines(b.text, { font: bold })
        break
      case 'center':
        this.lines(b.text, { font: bold, align: 'center' })
        this.gap(4)
        break
      case 'fields':
        for (const [label, value] of b.rows) this.field(label, value)
        this.gap()
        break
      case 'numbered':
      case 'bullets':
        b.items.forEach((item, i) => {
          const marker = b.kind === 'numbered' ? `${i + 1}.` : '•'
          this.ensure(LINE)
          this.page.drawText(marker, {
            x: MARGIN_X + 4,
            y: this.y - BODY_SIZE,
            size: BODY_SIZE,
            font: this.fonts.regular,
          })
          this.lines(item, { indent: 22 })
          this.gap(4)
        })
        this.gap(4)
        break
    }
  }
}

/**
 * Builds one PDF: each chosen letter on the company letterhead, followed by
 * the chosen documents. Documents that cannot be added (a damaged PDF, an
 * Office file) are skipped and listed in `warnings`.
 */
export async function buildCompliancePdf(input: ComplianceInput) {
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(`Compliance documents - ${input.data.tenderRef}`))
  doc.setAuthor(pdfSafe(input.data.companyName))
  doc.setCreator('Tender Manager')

  const fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  }
  const warnings: string[] = []

  let logo: PDFImage | null = null
  let signature: PDFImage | null = null
  try {
    if (input.logo) logo = await embedImage(doc, input.logo)
  } catch {
    warnings.push('The company logo could not be read, so letters were printed without it.')
  }
  try {
    if (input.signature) signature = await embedImage(doc, input.signature)
  } catch {
    warnings.push('The signature image could not be read, so letters were printed without it.')
  }

  const d = input.data
  /** Draws the letterhead and returns the y position below it. */
  const letterhead = (page: PDFPage): number => {
    const top = A4[1] - MARGIN_TOP
    let logoH = 0
    let textW = CONTENT_W
    if (logo) {
      const s = logo.scaleToFit(150, 60)
      page.drawImage(logo, {
        x: A4[0] - MARGIN_X - s.width,
        y: top - s.height,
        width: s.width,
        height: s.height,
      })
      logoH = s.height
      textW = CONTENT_W - s.width - 16
    }
    let y = top
    for (const line of wrap(d.companyName, fonts.bold, 16, textW)) {
      page.drawText(line, { x: MARGIN_X, y: y - 16, size: 16, font: fonts.bold, color: BLUE })
      y -= 20
    }
    for (const line of wrap(d.companyAddress, fonts.regular, 9, textW)) {
      page.drawText(line, { x: MARGIN_X, y: y - 9, size: 9, font: fonts.regular })
      y -= 12
    }
    y = Math.min(y, top - logoH) - 8
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: A4[0] - MARGIN_X, y },
      thickness: 1.5,
      color: BLACK,
    })
    return y - 22
  }

  const writer = new LetterWriter(doc, fonts, letterhead)

  // Built-in letters first, then the client's own, all printed the same way.
  const values = letterValues(d)
  const fill = (t: string) => fillLetterFields(t, values)
  const fillBlock = (b: Block): Block =>
    b.kind === 'numbered' || b.kind === 'bullets'
      ? { kind: b.kind, items: b.items.map(fill) }
      : b.kind === 'fields'
        ? { kind: 'fields', rows: b.rows.map(([l, v]) => [fill(l), fill(v)] as [string, string]) }
        : { kind: b.kind, text: fill(b.text) }
  const toPrint = [
    ...input.letters.map((key) => {
      const l = LETTERS[key]
      return {
        title: l.title,
        subtitle: l.subtitle ?? null,
        addressed: !!l.addressed,
        dateAtTop: !!l.dateAtTop,
        blocks: l.body(d),
      }
    }),
    ...(input.customLetters ?? []).map((c) => ({
      title: fill(c.title),
      subtitle: c.subtitle ? fill(c.subtitle) : null,
      addressed: c.addressed,
      dateAtTop: c.dateAtTop,
      blocks: c.body.map(fillBlock),
    })),
  ]

  for (const letter of toPrint) {
    writer.newPage()

    if (letter.dateAtTop) {
      writer.lines(`Date: ${d.date}`, { align: 'left' })
      writer.gap(6)
    }
    // Title, underlined and centred.
    for (const line of wrap(letter.title, fonts.bold, 13, CONTENT_W)) {
      const w = fonts.bold.widthOfTextAtSize(line, 13)
      const x = MARGIN_X + (CONTENT_W - w) / 2
      writer.page.drawText(line, { x, y: writer.y - 13, size: 13, font: fonts.bold })
      writer.page.drawLine({
        start: { x, y: writer.y - 15 },
        end: { x: x + w, y: writer.y - 15 },
        thickness: 0.8,
      })
      writer.y -= 18
    }
    if (letter.subtitle)
      writer.lines(letter.subtitle, { font: fonts.italic, size: 9, align: 'center' })
    writer.gap(14)

    if (letter.addressed) {
      writer.lines('To,', { font: fonts.bold })
      if (d.buyerOrganization) writer.lines(d.buyerOrganization, { font: fonts.bold })
      if (d.departmentAddress) writer.lines(d.departmentAddress)
      writer.gap(12)
    }

    const blocks = letter.blocks
    blocks.forEach((block, i) => {
      // Keep the last paragraph on the same page as the signature, so a
      // signature never stands alone on a page.
      if (i === blocks.length - 1) {
        const lastH = writer.measure(block)
        if (lastH + SIGNATURE_H < A4[1] - MARGIN_TOP - MARGIN_BOTTOM - 120)
          writer.ensure(lastH + SIGNATURE_H)
      }
      writer.block(block)
    })

    // Signature block, kept together on one page.
    writer.ensure(SIGNATURE_H)
    writer.gap(6)
    writer.lines('Thanking You,')
    writer.gap(6)
    if (signature) {
      const s = signature.scaleToFit(140, 50)
      writer.page.drawImage(signature, {
        x: MARGIN_X,
        y: writer.y - s.height,
        width: s.width,
        height: s.height,
      })
      writer.y -= s.height + 6
    } else {
      writer.gap(40)
    }
    writer.lines(d.signatoryName, { font: fonts.bold })
    writer.lines(d.designation)
    writer.lines(`For ${d.companyName}`)
    writer.lines(`Date: ${d.date}`)
  }

  for (const a of input.attachments) {
    try {
      if (a.mime === 'application/pdf') {
        const src = await PDFDocument.load(a.bytes, { ignoreEncryption: true })
        const pages = await doc.copyPages(src, src.getPageIndices())
        for (const p of pages) doc.addPage(p)
      } else if (a.mime === 'image/png' || a.mime === 'image/jpeg') {
        const img = await embedImage(doc, a)
        const page = doc.addPage(A4)
        const s = img.scaleToFit(A4[0] - 72, A4[1] - 72)
        page.drawImage(img, {
          x: (A4[0] - s.width) / 2,
          y: (A4[1] - s.height) / 2,
          width: s.width,
          height: s.height,
        })
      } else {
        warnings.push(`"${a.title}" is not a PDF or image, so it was not added.`)
      }
    } catch {
      warnings.push(
        `"${a.title}" could not be read (it may be damaged or password-protected), so it was not added.`,
      )
    }
  }

  if (doc.getPageCount() === 0) throw new Error('NOTHING_TO_INCLUDE')
  const bytes = await doc.save()
  return { bytes, pageCount: doc.getPageCount(), warnings }
}
