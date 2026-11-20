import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { env } from '../config/env'
import * as schema from './schema'

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  timezone: 'Z',
  charset: 'utf8mb4',
})

export const db = drizzle(pool, { schema, mode: 'default' })

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** Functions that should work inside or outside a transaction accept either. */
export type DbOrTx = Db | Tx
