// ส่ง alert ที่รอส่งออกไปยัง webhook พร้อมลองซ้ำ

import { config } from '../config.js';
import { withEvaluator } from '../db/tenant.js';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

interface PendingAlert {
  id: string;
  tenant_id: string;
  title: string;
  severity: number;
  group_by: string;
  group_value: string;
  event_count: number;
  first_seen: string;
  last_seen: string;
  details: Record<string, unknown>;
  webhook_url: string;
  webhook_attempts: number;
}

export async function deliverPendingWebhooks(): Promise<number> {
  if (!config.alerting.webhooksEnabled) return 0;

  const pending = await withEvaluator(async (db) => {
    const { rows } = await db.query<PendingAlert>(
      `SELECT a.id, a.tenant_id, a.title, a.severity, a.group_by, a.group_value,
              a.event_count, a.first_seen, a.last_seen, a.details,
              r.webhook_url, a.webhook_attempts
       FROM alerts a
       JOIN alert_rules r ON r.id = a.rule_id
       WHERE a.webhook_status = 'pending'
         AND r.webhook_url IS NOT NULL
         AND a.webhook_attempts < $1
       ORDER BY a.created_at
       LIMIT $2`,
      [MAX_ATTEMPTS, BATCH],
    );
    return rows;
  });

  let sent = 0;

  for (const alert of pending) {
    const body = JSON.stringify({
      id: alert.id,
      tenant_id: alert.tenant_id,
      title: alert.title,
      severity: alert.severity,
      group_by: alert.group_by,
      group_value: alert.group_value,
      event_count: alert.event_count,
      first_seen: alert.first_seen,
      last_seen: alert.last_seen,
      details: alert.details,
    });

    let error: string | null = null;
    try {
      const response = await fetch(alert.webhook_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'mini-siem/0.1',
        },
        body,
        signal: AbortSignal.timeout(config.alerting.webhookTimeoutMs),
      });
      if (!response.ok) {
        error = `endpoint returned ${response.status}`;
      }
    } catch (err) {
      error = (err as Error).message;
    }

    const attempts = alert.webhook_attempts + 1;
    const status = error === null ? 'sent' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';

    await withEvaluator(async (db) => {
      await db.query(
        `UPDATE alerts
         SET webhook_status = $1, webhook_error = $2, webhook_attempts = $3
         WHERE id = $4`,
        [status, error, attempts, alert.id],
      );
    });

    if (error === null) sent++;
    else if (status === 'failed') {
      console.warn(`[webhook] giving up on alert ${alert.id} after ${attempts}: ${error}`);
    }
  }

  return sent;
}
