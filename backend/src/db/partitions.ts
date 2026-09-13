// ดูแล partition: สร้างล่วงหน้า, ลบที่เกินอายุ, ล้าง session หมดอายุ

import { config } from '../config.js';
import { withOwner } from './tenant.js';

export async function ensurePartitions(daysAhead = config.retention.partitionDaysAhead) {
  return withOwner(async (db) => {
    const { rows } = await db.query<{ ensure_partitions: string }>(
      'SELECT ensure_partitions($1) AS ensure_partitions',
      [daysAhead],
    );
    return rows.map((r) => r.ensure_partitions);
  });
}

export async function dropOldPartitions(keepDays = config.retention.days) {
  return withOwner(async (db) => {
    const { rows } = await db.query<{ drop_old_partitions: string }>(
      'SELECT drop_old_partitions($1) AS drop_old_partitions',
      [keepDays],
    );
    return rows.map((r) => r.drop_old_partitions);
  });
}

export async function purgeBackfill(keepDays = config.retention.days): Promise<number> {
  return withOwner(async (db) => {
    const { rows } = await db.query<{ purge_backfill_partition: number }>(
      'SELECT purge_backfill_partition($1) AS purge_backfill_partition',
      [keepDays],
    );
    return rows[0]?.purge_backfill_partition ?? 0;
  });
}

export async function purgeExpiredSessions(): Promise<number> {
  return withOwner(async (db) => {
    const { rows } = await db.query<{ session_purge_expired: number }>(
      'SELECT session_purge_expired() AS session_purge_expired',
    );
    return rows[0]?.session_purge_expired ?? 0;
  });
}

export async function runMaintenance(): Promise<void> {
  const created = await ensurePartitions();
  const dropped = await dropOldPartitions();
  const backfilled = await purgeBackfill();
  const sessions = await purgeExpiredSessions();

  if (backfilled > 0) {
    console.log(
      `[maintenance] removed ${backfilled} expired row(s) from the catch-all partition`,
    );
  }
  if (dropped.length > 0) {
    console.log(
      `[maintenance] retention ${config.retention.days}d — dropped ${dropped.length} ` +
        `day partition(s): ${dropped.join(', ')}`,
    );
  }
  console.log(
    `[maintenance] ${created.length} partition(s) present for the next ` +
      `${config.retention.partitionDaysAhead} day(s); purged ${sessions} expired session(s)`,
  );
}

export function startMaintenanceLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runMaintenance().catch((err) => console.error('[maintenance] failed', err));
  }, config.retention.maintenanceIntervalMs);
  timer.unref();
  return timer;
}
