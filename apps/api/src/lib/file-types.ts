/**
 * Works out a file's real type from its first bytes, not from its name or
 * the browser's claim, so a renamed executable can never be stored as a PDF.
 */
export interface DetectedType {
  mime: string
  ext: string
  /** PDFs and images can be merged into a compliance PDF; office files cannot. */
  mergeable: boolean
}

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b)
const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? ''

export function detectFileType(buf: Buffer, originalName: string): DetectedType | null {
  const ext = extOf(originalName)
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46]))
    return { mime: 'application/pdf', ext: 'pdf', mergeable: true }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png', mergeable: true }
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff]))
    return { mime: 'image/jpeg', ext: 'jpg', mergeable: true }

  // Office Open XML and zip archives share the zip signature; trust the extension only among these.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const zipTypes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip',
    }
    return zipTypes[ext] ? { mime: zipTypes[ext]!, ext, mergeable: false } : null
  }
  // Older .doc / .xls files.
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const oleTypes: Record<string, string> = {
      doc: 'application/msword',
      xls: 'application/vnd.ms-excel',
    }
    return oleTypes[ext] ? { mime: oleTypes[ext]!, ext, mergeable: false } : null
  }
  return null
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg']
