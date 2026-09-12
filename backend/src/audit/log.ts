import type { Actor, Queryable } from '../db/tenant.js';
import { withActor } from '../db/tenant.js';

export interface AuditEntry {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
  tenantId?: string | null;
  srcIp?: string | null;
}

export async function auditIn(
  db: Queryable,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (actor_id, actor_email, actor_role, tenant_id, action, target_type, target_id, details, src_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor.userId,
      actor.email,
      actor.role,
      entry.tenantId !== undefined ? entry.tenantId : actor.tenantId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.srcIp ?? null,
    ],
  );
}

export async function audit(actor: Actor, entry: AuditEntry): Promise<void> {
  try {
    await withActor(actor, (db) => auditIn(db, actor, entry));
  } catch (err) {
    console.error(`[audit] FAILED to record "${entry.action}" by ${actor.email}:`, err);
  }
}
