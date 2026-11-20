import type { DbOrTx } from '../db/client'
import { auditLog } from '../db/schema'

export interface AuditEntry {
  organizationId: string | null
  actorType: 'user' | 'platform' | 'system'
  actorId: string | null
  action: string
  entity: string
  entityId?: string | null
  details?: Record<string, unknown>
  ip?: string | null
}

/** Records a sensitive action. Pass the transaction when the action runs in one. */
export async function writeAudit(conn: DbOrTx, entry: AuditEntry): Promise<void> {
  await conn.insert(auditLog).values({
    organizationId: entry.organizationId,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    details: entry.details ?? null,
    ip: entry.ip ?? null,
  })
}
