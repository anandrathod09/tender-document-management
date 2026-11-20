import bcrypt from 'bcryptjs'
import { env } from '../config/env'

// Lower cost in tests only, to keep the test run fast.
const COST = env.NODE_ENV === 'test' ? 4 : 12

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', COST)

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST)
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH)
    return false
  }
  return bcrypt.compare(password, hash)
}
