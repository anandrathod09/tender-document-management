import pino from 'pino'
import { env } from '../config/env'

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  // Never write tokens, cookies or passwords to the logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
    ],
    censor: '[redacted]',
  },
})
