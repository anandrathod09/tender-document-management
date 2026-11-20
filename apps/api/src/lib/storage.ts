import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { env } from '../config/env'

/**
 * Where file bytes are kept. Keys look like org/<organization_id>/<kind>/<file_id>.pdf
 * and are always created by the API, never taken from user input.
 *
 * Development uses the local disk. An S3-compatible driver (Cloudflare R2,
 * DigitalOcean Spaces) with the same interface is added for production.
 */
export interface FileStorage {
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>
  read(key: string): Promise<Buffer>
  stream(key: string): Promise<{ stream: Readable; size: number }>
  remove(key: string): Promise<void>
}

class LocalDiskStorage implements FileStorage {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(process.cwd(), root)
  }

  private pathOf(key: string): string {
    const full = resolve(this.root, key)
    // Defence in depth: a key can never point outside the storage folder.
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`)
    return full
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key))
  }

  async stream(key: string) {
    const path = this.pathOf(key)
    const { size } = await stat(path)
    return { stream: createReadStream(path), size }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }
}

export const storage: FileStorage = new LocalDiskStorage(env.STORAGE_DIR)
