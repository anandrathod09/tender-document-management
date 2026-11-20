import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
}

/** Turns errors into the API's error shape. Unexpected errors are logged and hidden. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
    return
  }

  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE'
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
        message: tooLarge ? 'The file is too large' : 'The upload could not be read',
      },
    })
    return
  }

  const e = err as { type?: string; status?: number }
  if (e.type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } })
    return
  }
  if (e.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } })
    return
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
}
