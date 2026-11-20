import type { z } from 'zod'
import { badRequest } from './errors'

/** Parses request input with a shared schema; invalid input becomes a 400 with field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Some fields are not valid',
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    )
  }
  return result.data
}
