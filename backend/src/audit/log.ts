import type { Actor, Queryable } from '../db/tenant.js';
import { withActor } from '../db/tenant.js';

/**
 * The administrator audit trail.
 *
 * The README's claim is that every administrative action is recorded as
 * evidence that cannot be erased. The "cannot be erased" half is not enforced
 * here — it is enforced by never granting UPDATE or DELETE on audit_log to any
 * role (002_rls.sql). This file only makes sure the rows get written.
 *
 * Prefer auditIn(): passing the caller's transaction means the audit row and
 * the change it describes commit together, or neither does.
 */

export interface AuditEntry {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
  /** Defaults to the actor's own tenant; admins may name one explicitly. */
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

/** Standalone write, for events that are not part of a larger transaction. */
export async function audit(actor: Actor, entry: AuditEntry): Promise<void> {
  try {
    await withActor(actor, (db) => auditIn(db, actor, entry));
  } catch (err) {
    // An unrecorded action is a real problem, so it is loud — but failing the
    // user's request after their change already committed would be worse.
    console.error(`[audit] FAILED to record "${entry.action}" by ${actor.email}:`, err);
  }
}
