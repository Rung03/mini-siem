// บันทึกการล็อกอินหน้าเว็บเป็น event ใน tenant "Mini SIEM" พร้อมกฎแจ้งเตือนการเดารหัสผ่าน

import { ensurePartitions } from '../db/partitions.js';
import { withAdmin } from '../db/tenant.js';
import { insertEvents } from '../pipeline/writer.js';
import { buildLoginEvent, type LoginAttempt } from './login-event.js';

export const SYSTEM_TENANT_SLUG = 'mini-siem';
const SYSTEM_TENANT_NAME = 'Mini SIEM';
const BRUTE_FORCE_RULE = 'Brute force: repeated web login failures from one address';

let systemTenantId: string | null = null;

export async function ensureSystemTenant(): Promise<string> {
  const tenantId = await withAdmin(async (db) => {
    await db.query(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING',
      [SYSTEM_TENANT_SLUG, SYSTEM_TENANT_NAME],
    );
    const { rows } = await db.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
      SYSTEM_TENANT_SLUG,
    ]);
    const id = rows[0]!.id;
    await db.query(
      `INSERT INTO alert_rules
         (tenant_id, name, match_category, match_outcome, group_by,
          window_seconds, threshold, severity, suppress_seconds)
       VALUES ($1, $2, 'authentication', 'failure', 'src_ip', 300, 5, 2, 900)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [id, BRUTE_FORCE_RULE],
    );
    return id;
  });

  await ensurePartitions();
  systemTenantId = tenantId;
  return tenantId;
}

export async function recordLogin(attempt: LoginAttempt): Promise<void> {
  try {
    const tenantId = systemTenantId ?? (await ensureSystemTenant());
    await insertEvents({ tenantId, collectorId: null, events: [buildLoginEvent(attempt)] });
  } catch (err) {
    console.error('[auth] could not record web login event:', (err as Error).message);
  }
}
