import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env'

/*
 * Encrypts small secrets kept in the database (such as authenticator app
 * keys), so a copy of the database alone does not reveal them.
 * AES-256-GCM; the key comes from ENCRYPTION_KEY (or, when that is not set,
 * is derived from JWT_ACCESS_SECRET).
 */

const key = createHash('sha256')
  .update(env.ENCRYPTION_KEY ?? `${env.JWT_ACCESS_SECRET}:data-encryption`)
  .digest()

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join('.')
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split('.')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
