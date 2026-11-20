import './env'

/** Recreates the test database schema from the migrations once per test run. */
export default async function setup() {
  const { ensureDatabase } = await import('../src/db/create-databases')
  const { env } = await import('../src/config/env')
  await ensureDatabase(env.DB_NAME)

  const { pool } = await import('../src/db/client')
  const [rows] = await pool.query<import('mysql2').RowDataPacket[]>(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
    [env.DB_NAME],
  )
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const row of rows) {
    await pool.query(`DROP TABLE IF EXISTS \`${row.name as string}\``)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1')

  const { runMigrations } = await import('../src/db/migrate')
  await runMigrations()
  await pool.end()

  const { rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  await rm(resolve(process.cwd(), env.STORAGE_DIR), { recursive: true, force: true })
}
