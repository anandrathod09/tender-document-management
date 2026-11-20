import { and, eq, type SQL } from 'drizzle-orm'
import type { MySqlColumn } from 'drizzle-orm/mysql-core'

/**
 * Builds a WHERE clause that is always limited to one client.
 *
 * Every read, update and delete on a client-owned table must use this, so a
 * query can never return or change another client's rows:
 *
 *   db.select().from(users).where(orgWhere(users, orgId, eq(users.id, userId)))
 *
 * Inserts must set `organizationId` from the request's workspace, never from
 * request input.
 */
export function orgWhere(
  table: { organizationId: MySqlColumn },
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(table.organizationId, organizationId), ...conditions) as SQL
}
