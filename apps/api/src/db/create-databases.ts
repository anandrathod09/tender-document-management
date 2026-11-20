import mysql from 'mysql2/promise'
import { env } from '../config/env'

/** Creates the database if it does not exist yet. Names are checked by env.ts. */
export async function ensureDatabase(name: string): Promise<void> {
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  })
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
  } finally {
    await conn.end()
  }
}

// Run directly: npm run db:create
if (process.argv[1] && /create-databases\.(ts|js)$/.test(process.argv[1])) {
  const names = [env.DB_NAME, env.TEST_DB_NAME].filter((n): n is string => Boolean(n))
  for (const name of names) {
    await ensureDatabase(name)
    console.log(`Database ready: ${name}`)
  }
}
