// จุดเริ่มระบบ: สร้าง role, รัน migration, เปิด API, syslog และตัวตรวจกฎแจ้งเตือน

import type { Server } from 'node:http';
import { createApp } from './api/app.js';
import { startAlertLoop } from './alerting/evaluator.js';
import { config } from './config.js';
import { initGeoip } from './enrich/index.js';
import { bootstrapRoles } from './db/bootstrap.js';
import { runMigrations } from './db/migrate.js';
import { runMaintenance, startMaintenanceLoop } from './db/partitions.js';
import { closeAllPools } from './db/pool.js';
import { startSyslogUdp, startSyslogTcp } from './ingest/syslog.js';
import { batcher } from './pipeline/batcher.js';

async function main(): Promise<void> {
  console.log(`[boot] mini-siem starting — profile: ${config.profile}`);

  await bootstrapRoles();
  const { applied, alreadyApplied } = await runMigrations();
  console.log(
    `[boot] schema ready (${applied.length} migration(s) applied, ` +
      `${alreadyApplied.length} already current)`,
  );

  await runMaintenance();
  await initGeoip();

  const app = createApp();
  const server: Server = app.listen(config.api.port, () => {
    console.log(`[boot] API listening on :${config.api.port}`);
  });

  const syslogUdp = config.syslog.enabled ? startSyslogUdp() : null;
  const syslogTcp = config.syslog.enabled ? startSyslogTcp() : null;

  const alertTimer = startAlertLoop();
  const maintenanceTimer = startMaintenanceLoop();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received`);

    clearInterval(alertTimer);
    clearInterval(maintenanceTimer);
    syslogUdp?.close();
    syslogTcp?.close();

    await new Promise<void>((resolve) => server.close(() => resolve()));

    await batcher.close();
    await closeAllPools();

    console.log('[shutdown] done');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (err) => {
  console.error('[boot] failed to start:', err);
  await closeAllPools().catch(() => undefined);
  process.exit(1);
});
