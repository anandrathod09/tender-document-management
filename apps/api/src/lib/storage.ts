import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../config/env'

/**
 * Where file bytes are kept. Keys look like org/<organization_id>/<kind>/<file_id>.pdf
 * and are always created by the API, never taken from user input.
 *
 * STORAGE_DRIVER picks the driver: "local" keeps files in a folder on this
 * server; "s3" keeps them in an S3-compatible bucket (Amazon S3, Cloudflare R2,
 * DigitalOcean Spaces, Backblaze B2, MinIO). The bucket must be private: files
 * are only ever served through the API's short download links.
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

/** Any S3-compatible bucket. Keys are the same as on local disk, so moving is a plain copy. */
export class S3Storage implements FileStorage {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mimeType }),
    )
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) throw new Error(`Empty object: ${key}`)
    return Buffer.from(await res.Body.transformToByteArray())
  }

  async stream(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) throw new Error(`Empty object: ${key}`)
    return { stream: res.Body as Readable, size: res.ContentLength ?? 0 }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}

function createStorage(): FileStorage {
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
      )
    }
    const client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    })
    return new S3Storage(client, env.S3_BUCKET)
  }
  return new LocalDiskStorage(env.STORAGE_DIR)
}

export const storage: FileStorage = createStorage()
