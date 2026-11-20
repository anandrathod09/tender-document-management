import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { db, pool } from './client'

/** Applies any migrations in apps/api/drizzle that have not run yet. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') })
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  try {
    await runMigrations()
    console.log('Migrations applied')
  } finally {
    await pool.end()
  }
}
