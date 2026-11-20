import type { AxiosError } from 'axios'
import { api } from './api'

/** Gets a 5-minute link for a stored file (the API checks the user may see it). */
export async function fileLink(fileId: string, inline = false): Promise<string> {
  const { data } = await api.post<{ url: string }>(`/files/${fileId}/link`, null, {
    params: inline ? { inline: '1' } : undefined,
  })
  return data.url
}

/** Downloads a stored file through a short-lived link. */
export async function downloadFile(fileId: string): Promise<void> {
  const url = await fileLink(fileId)
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Opens a PDF or image in a new tab. */
export async function openFile(fileId: string): Promise<void> {
  // Open the tab first (synchronously, so pop-up blockers allow it), then point it at the link.
  const tab = window.open('about:blank', '_blank')
  try {
    const url = await fileLink(fileId, true)
    if (tab) tab.location.href = url
    else window.location.href = url
  } catch (err) {
    tab?.close()
    throw err
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Downloads a file the API generates on request (PDF report, Excel export).
 * Sent with the sign-in header, so it cannot be a plain link.
 */
export async function downloadFromApi(
  path: string,
  params?: Record<string, string>,
  fallbackName = 'download',
): Promise<void> {
  const res = await api
    .get<Blob>(path, { params, responseType: 'blob', timeout: 120_000 })
    .catch(async (err: AxiosError) => {
      // Errors arrive as a Blob too; turn them back into JSON so errorMessage() can read them.
      const data = err.response?.data
      if (data instanceof Blob && err.response) {
        try {
          err.response.data = JSON.parse(await data.text())
        } catch {
          // Not JSON: keep the generic message.
        }
      }
      throw err
    })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const name = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallbackName
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = decodeURIComponent(name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
