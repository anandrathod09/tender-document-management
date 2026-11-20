import './env'
import { afterAll } from 'vitest'

afterAll(async () => {
  const { pool } = await import('../src/db/client')
  await pool.end()
})
