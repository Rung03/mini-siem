// ตรวจกฎแจ้งเตือนทุก 30 วินาที และสร้าง alert เมื่อเกินเกณฑ์

import { config } from '../config.js';
import { withEvaluator } from '../db/tenant.js';
import { deliverPendingWebhooks } from './webhook.js';

export interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  match_category: string | null;
  match_action: string | null;
  match_outcome: string | null;
  match_source: string | null;
  group_by: 'src_ip' | 'user_name' | 'host';
  window_seconds: number;
  threshold: number;
  severity: number;
  suppress_seconds: number;
  webhook_url: string | null;
}

const GROUP_COLUMNS: Record<AlertRule['group_by'], string> = {
  src_ip: 'host(src_ip)',
  user_name: 'user_name',
  host: 'host',
};

function titleFor(rule: AlertRule, groupValue: string, count: number): string {
  const what =
    rule.match_outcome === 'failure'
      ? 'failed logins'
      : rule.match_outcome === 'success'
        ? 'successful logins'
        : 'events';
  const subject =
    rule.group_by === 'src_ip'
      ? `from ${groupValue}`
      : rule.group_by === 'user_name'
        ? `for user ${groupValue}`
        : `on host ${groupValue}`;
  const minutes = Math.round(rule.window_seconds / 60);
  const window = minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}`
                              : `${rule.window_seconds} seconds`;
  return `${count} ${what} ${subject} within ${window}`;
}

export async function loadRules(): Promise<AlertRule[]> {
  return withEvaluator(async (db) => {
    const { rows } = await db.query<AlertRule>(
      `SELECT id, tenant_id, name, match_category, match_action, match_outcome,
              match_source, group_by, window_seconds, threshold, severity,
              suppress_seconds, webhook_url
       FROM alert_rules
       WHERE enabled
       ORDER BY tenant_id, name`,
    );
    return rows;
  });
}

interface Breach {
  group_value: string;
  event_count: number;
  first_seen: Date;
  last_seen: Date;
}

export async function evaluateRule(rule: AlertRule): Promise<number> {
  const column = GROUP_COLUMNS[rule.group_by];

  const breaches = await withEvaluator(async (db) => {
    const { rows } = await db.query<Breach>(
      `SELECT ${column} AS group_value,
              count(*)::int AS event_count,
              min(ts) AS first_seen,
              max(ts) AS last_seen
       FROM events
       WHERE tenant_id = $1::uuid
         AND ts >= now() - make_interval(secs => $2::int)
         AND ($3::text IS NULL OR event_category = $3)
         AND ($4::text IS NULL OR event_action   = $4)
         AND ($5::text IS NULL OR event_outcome  = $5)
         AND ($6::text IS NULL OR source_type    = $6)
         AND ${column} IS NOT NULL
       GROUP BY 1
       HAVING count(*) >= $7::int`,
      [
        rule.tenant_id,
        rule.window_seconds,
        rule.match_category,
        rule.match_action,
        rule.match_outcome,
        rule.match_source,
        rule.threshold,
      ],
    );
    return rows;
  });

  if (breaches.length === 0) return 0;

  let raised = 0;

  for (const breach of breaches) {
    const bucket =
      rule.suppress_seconds > 0
        ? Math.floor(Date.now() / 1000 / rule.suppress_seconds)
        : Math.floor(Date.now() / 1000);
    const dedupeKey = `${rule.id}:${breach.group_value}:${bucket}`;

    const inserted = await withEvaluator(async (db) => {
      const { rows } = await db.query<{ id: string; inserted: boolean }>(
        `INSERT INTO alerts
           (tenant_id, rule_id, first_seen, last_seen, severity, group_by,
            group_value, event_count, title, details, dedupe_key, webhook_status)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         ON CONFLICT (tenant_id, dedupe_key) DO UPDATE
           SET event_count = EXCLUDED.event_count,
               last_seen   = EXCLUDED.last_seen,
               title       = EXCLUDED.title
         RETURNING id, (xmax = 0) AS inserted`,
        [
          rule.tenant_id,
          rule.id,
          breach.first_seen,
          breach.last_seen,
          rule.severity,
          rule.group_by,
          breach.group_value,
          breach.event_count,
          titleFor(rule, breach.group_value, breach.event_count),
          JSON.stringify({
            rule_name: rule.name,
            window_seconds: rule.window_seconds,
            threshold: rule.threshold,
            match: {
              category: rule.match_category,
              action: rule.match_action,
              outcome: rule.match_outcome,
              source: rule.match_source,
            },
          }),
          dedupeKey,
          rule.webhook_url && config.alerting.webhooksEnabled
            ? 'pending'
            : rule.webhook_url
              ? 'disabled'
              : 'none',
        ],
      );
      return rows[0]?.inserted ?? false;
    });

    if (inserted) raised++;
  }

  return raised;
}

export async function evaluateAll(): Promise<number> {
  const rules = await loadRules();
  let raised = 0;

  for (const rule of rules) {
    try {
      raised += await evaluateRule(rule);
    } catch (err) {
      console.error(`[alerting] rule "${rule.name}" failed:`, (err as Error).message);
    }
  }

  if (raised > 0) console.log(`[alerting] raised ${raised} new alert(s)`);
  return raised;
}

export async function runEvaluationCycle(): Promise<void> {
  await evaluateAll();
  await deliverPendingWebhooks();
}

export function startAlertLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runEvaluationCycle().catch((err) => console.error('[alerting] cycle failed', err));
  }, config.alerting.intervalMs);
  timer.unref();

  console.log(
    `[alerting] evaluating rules every ${Math.round(config.alerting.intervalMs / 1000)}s`,
  );
  return timer;
}
