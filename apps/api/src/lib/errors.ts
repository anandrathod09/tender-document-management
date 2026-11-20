/** An error that is safe to show to the caller. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details)
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Please sign in') =>
  new AppError(401, code, message)
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this') =>
  new AppError(403, code, message)
export const notFound = (code = 'NOT_FOUND', message = 'Not found') =>
  new AppError(404, code, message)
export const conflict = (code: string, message: string) => new AppError(409, code, message)

/** True when MySQL rejected an insert or update because of a unique index. */
export function isDuplicateKeyError(err: unknown): boolean {
  let e: unknown = err
  // Drizzle wraps driver errors; the MySQL error is in `cause`.
  for (let i = 0; i < 3 && e; i++) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
