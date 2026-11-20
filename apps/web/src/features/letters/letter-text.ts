import type { LetterBlock, LetterContent } from '@tdm/shared'
import { api, errorMessage } from '@/services/api'

/**
 * The editor shows every block as plain text: lists one item per line, and
 * "Label: value" lines for label blocks. These convert between the two.
 */
export interface EditableBlock {
  key: number
  kind: LetterBlock['kind']
  text: string
}

let nextKey = 1
export const newBlock = (kind: LetterBlock['kind'] = 'para', text = ''): EditableBlock => ({
  key: nextKey++,
  kind,
  text,
})

export function toEditable(b: LetterBlock): EditableBlock {
  if (b.kind === 'numbered' || b.kind === 'bullets') return newBlock(b.kind, b.items.join('\n'))
  if (b.kind === 'fields') return newBlock(b.kind, b.rows.map(([l, v]) => `${l}: ${v}`).join('\n'))
  return newBlock(b.kind, b.text)
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

export function fromEditable(b: EditableBlock): LetterBlock {
  if (b.kind === 'numbered' || b.kind === 'bullets') return { kind: b.kind, items: lines(b.text) }
  if (b.kind === 'fields') {
    return {
      kind: 'fields',
      rows: lines(b.text).map((l) => {
        const i = l.indexOf(':')
        return i > 0
          ? ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string])
          : ([l, ''] as [string, string])
      }),
    }
  }
  return { kind: b.kind, text: b.text.trim() }
}

/**
 * Opens a one-letter preview PDF in a new tab. The tab is opened first, so
 * popup blockers allow it.
 */
export async function openLetterPreview(
  letter: LetterContent & { companyId?: string | null },
  companyId?: string | null,
): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const res = await api.post<Blob>(
      '/letter-templates/preview',
      { letter, companyId: companyId ?? null },
      { responseType: 'blob', timeout: 60_000 },
    )
    const url = URL.createObjectURL(res.data)
    if (tab) tab.location.href = url
    else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    tab?.close()
    // Errors arrive as a Blob too; read the message out of it.
    const data = (err as { response?: { data?: unknown } }).response?.data
    if (data instanceof Blob) {
      try {
        const body = JSON.parse(await data.text()) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? 'The preview could not be made')
      } catch (e) {
        throw e instanceof Error ? e : new Error('The preview could not be made')
      }
    }
    throw new Error(errorMessage(err))
  }
}
