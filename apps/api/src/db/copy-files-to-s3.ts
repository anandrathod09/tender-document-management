/**
 * Copies every stored file from the local storage folder to the S3 bucket,
 * for moving an existing server to STORAGE_DRIVER=s3. Keys stay the same, so
 * nothing in the database changes. Safe to run again: it copies everything
 * again and overwrites with the same bytes.
 *
 * Usage (with the S3_* settings filled in and STORAGE_DRIVER=s3):
 *   npm run storage:to-s3 -- --from storage
 * then restart the API. Keep the local folder until you have checked a few
 * downloads in the app.
 */
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { env } from '../config/env'
import { storage } from '../lib/storage'
import { db, pool } from './client'
import { files } from './schema'

const { values } = parseArgs({ options: { from: { type: 'string' } } })

async function main() {
  if (env.STORAGE_DRIVER !== 's3') {
    console.error('Set STORAGE_DRIVER=s3 and the S3_* settings first.')
    process.exit(1)
  }
  const root = resolve(process.cwd(), values.from ?? 'storage')
  const rows = await db.select({ key: files.storageKey, mimeType: files.mimeType }).from(files)
  let copied = 0
  const missing: string[] = []
  for (const row of rows) {
    const path = resolve(root, row.key)
    if (!path.startsWith(root + sep)) throw new Error(`Invalid storage key: ${row.key}`)
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch {
      missing.push(row.key)
      continue
    }
    await storage.put(row.key, bytes, row.mimeType)
    copied++
    if (copied % 100 === 0) console.log(`  ${copied} of ${rows.length}…`)
  }
  console.log(`Copied ${copied} of ${rows.length} files to bucket ${env.S3_BUCKET}.`)
  if (missing.length) {
    console.log(`${missing.length} file(s) were not in ${root}:`)
    for (const k of missing.slice(0, 20)) console.log(`  ${k}`)
  }
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
