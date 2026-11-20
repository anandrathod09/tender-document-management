import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { NotificationList } from '@tdm/shared'
import { db, type DbOrTx } from '../../db/client'
import { orgWhere } from '../../db/scope'
import { notifications } from '../../db/schema'
import type { TenantAuth } from '../../types/express'

export interface NewNotification {
  organizationId: string
  userId: string
  type: string
  title: string
  body?: string | null
  link?: string | null
}

/** Adds an in-app notification. Pass the transaction of the change that causes it. */
export async function notify(conn: DbOrTx, n: NewNotification): Promise<void> {
  await conn.insert(notifications).values({
    organizationId: n.organizationId,
    userId: n.userId,
    type: n.type,
    title: n.title.slice(0, 200),
    body: n.body?.slice(0, 500) ?? null,
    link: n.link ?? null,
  })
}

export async function listNotifications(auth: TenantAuth): Promise<NotificationList> {
  const mine = orgWhere(notifications, auth.org.id, eq(notifications.userId, auth.user.id))
  const rows = await db
    .select()
    .from(notifications)
    .where(mine)
    .orderBy(desc(notifications.createdAt))
    .limit(30)
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(mine, isNull(notifications.readAt)))
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      read: r.readAt !== null,
      createdAt: r.createdAt.toISOString(),
    })),
    unread: unread?.n ?? 0,
  }
}

/** Marks the given notifications, or all of the user's, as read. */
export async function markRead(auth: TenantAuth, ids: string[] | 'all'): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      orgWhere(
        notifications,
        auth.org.id,
        eq(notifications.userId, auth.user.id),
        isNull(notifications.readAt),
        ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : ['-']),
      ),
    )
}
