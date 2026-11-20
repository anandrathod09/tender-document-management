import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A real 1×1 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** A small valid PDF with the given number of pages. */
export async function makePdf(pages = 1, label = 'Test document'): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    doc.addPage([595, 842]).drawText(`${label} - page ${i + 1}`, { x: 72, y: 760, size: 14, font })
  }
  return Buffer.from(await doc.save())
}

/** Starts like a PDF but is not one: must be skipped with a warning, not crash the build. */
export const BROKEN_PDF = Buffer.from('%PDF-1.7\nthis is not really a pdf')

/** A Windows executable renamed to .pdf: must be refused on upload. */
export const EXE_AS_PDF = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 fake program')
