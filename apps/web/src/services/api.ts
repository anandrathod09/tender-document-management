import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { ApiError, LoginResponse } from '@tdm/shared'

/**
 * Same-origin API client. The access token lives only in memory (never in
 * localStorage); the refresh token is an HttpOnly cookie the browser sends to
 * /api/auth only. On a 401 the client refreshes once and retries.
 */
export const api = axios.create({ baseURL: '/api', withCredentials: true, timeout: 30_000 })

let accessToken: string | null = null
export function setAccessToken(token: string | null) {
  accessToken = token
}

let onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

// One refresh at a time, shared by all requests that failed together.
let refreshing: Promise<LoginResponse> | null = null
export function refreshSession(): Promise<LoginResponse> {
  refreshing ??= axios
    .post<LoginResponse>('/api/auth/refresh', null, { withCredentials: true })
    .then((res) => {
      setAccessToken(res.data.accessToken)
      return res.data
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

api.interceptors.response.use(undefined, async (error: AxiosError<ApiError>) => {
  const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined
  const isAuthCall = original?.url?.startsWith('/auth/')
  if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
    original._retried = true
    try {
      await refreshSession()
      return api(original)
    } catch {
      setAccessToken(null)
      onSessionExpired?.()
    }
  }
  throw error
})

/** A message that is safe to show the user for any failed request. */
export function errorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as ApiError | undefined
    if (data?.error?.message) return data.error.message
    if (!err.response) return 'Cannot reach the server. Check your connection.'
  }
  return fallback
}

export function errorCode(err: unknown): string | undefined {
  if (err instanceof AxiosError) return (err.response?.data as ApiError | undefined)?.error?.code
  return undefined
}

/** Per-field messages from a VALIDATION_ERROR, keyed by field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof AxiosError)) return {}
  const details = (err.response?.data as ApiError | undefined)?.error?.details
  if (!Array.isArray(details)) return {}
  const out: Record<string, string> = {}
  for (const d of details as { field?: string; message?: string }[]) {
    if (d.field && d.message && !out[d.field]) out[d.field] = d.message
  }
  return out
}
