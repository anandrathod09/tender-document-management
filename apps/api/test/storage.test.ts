import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { productionProblems } from '../src/config/env'
import { S3Storage } from '../src/lib/storage'

/** An in-memory stand-in for an S3 bucket. */
function fakeBucket() {
  const objects = new Map<string, { body: Buffer; type?: string }>()
  const client: Pick<S3Client, 'send'> = {
    send: (async (cmd: unknown) => {
      if (cmd instanceof PutObjectCommand) {
        const i = cmd.input
        objects.set(`${i.Bucket}/${i.Key}`, { body: i.Body as Buffer, type: i.ContentType })
        return {}
      }
      if (cmd instanceof GetObjectCommand) {
        const o = objects.get(`${cmd.input.Bucket}/${cmd.input.Key}`)
        if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
        const body = Object.assign(Readable.from([o.body]), {
          transformToByteArray: async () => new Uint8Array(o.body),
        })
        return { Body: body, ContentLength: o.body.length }
      }
      if (cmd instanceof DeleteObjectCommand) {
        objects.delete(`${cmd.input.Bucket}/${cmd.input.Key}`)
        return {}
      }
      throw new Error('unexpected command')
    }) as S3Client['send'],
  }
  return { client, objects }
}

describe('file storage', () => {
  it('the S3 driver puts, reads, streams and removes files', async () => {
    const { client, objects } = fakeBucket()
    const s3 = new S3Storage(client, 'tdm-files')
    const key = 'org/abc/tender_document/f1.pdf'

    await s3.put(key, Buffer.from('%PDF-1.4 hello'), 'application/pdf')
    expect(objects.get(`tdm-files/${key}`)?.type).toBe('application/pdf')
    expect((await s3.read(key)).toString()).toBe('%PDF-1.4 hello')

    const { stream, size } = await s3.stream(key)
    expect(size).toBe(14)
    const chunks: Buffer[] = []
    for await (const c of stream) chunks.push(Buffer.from(c))
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.4 hello')

    await s3.remove(key)
    await expect(s3.read(key)).rejects.toThrow('NoSuchKey')
  })
})

describe('production settings', () => {
  const base = {
    NODE_ENV: 'production' as const,
    BASE_DOMAIN: 'tendermanager.in',
    PUBLIC_URL_TEMPLATE: 'https://{slug}.tendermanager.in',
    COOKIE_SECURE: true,
    ENCRYPTION_KEY: 'e'.repeat(64),
    JWT_ACCESS_SECRET: 'j'.repeat(64),
    STORAGE_DRIVER: 'local' as const,
  }
  const check = (over: object) =>
    productionProblems({ ...base, ...over } as Parameters<typeof productionProblems>[0])

  it('accepts a safe set-up and ignores development', () => {
    expect(check({})).toEqual([])
    expect(
      check({ NODE_ENV: 'development', COOKIE_SECURE: false, BASE_DOMAIN: 'localhost' }),
    ).toEqual([])
  })

  it('names every unsafe setting', () => {
    const problems = check({
      BASE_DOMAIN: 'localhost',
      PUBLIC_URL_TEMPLATE: 'http://{slug}.localhost:5173',
      COOKIE_SECURE: false,
      ENCRYPTION_KEY: undefined,
      JWT_ACCESS_SECRET: 'short-but-32-characters-long-xxx',
      STORAGE_DRIVER: 's3',
    }).map((p) => p.split(':')[0])
    expect(problems).toEqual([
      'BASE_DOMAIN',
      'PUBLIC_URL_TEMPLATE',
      'COOKIE_SECURE',
      'ENCRYPTION_KEY',
      'JWT_ACCESS_SECRET',
      'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    ])
  })
})
