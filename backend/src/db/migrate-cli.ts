import { bootstrapRoles } from './bootstrap.js';
import { runMigrations } from './migrate.js';
import { ensurePartitions } from './partitions.js';
import { closeAllPools } from './pool.js';

async function main() {
  await bootstrapRoles();
  console.log('[migrate] roles ready');

  const { applied, alreadyApplied } = await runMigrations();
  console.log(
    `[migrate] ${applied.length} applied, ${alreadyApplied.length} already up to date`,
  );

  const partitions = await ensurePartitions();
  console.log(`[migrate] ${partitions.length} partition(s) ready`);
}

main()
  .then(() => closeAllPools())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[migrate] failed:', err.message ?? err);
    await closeAllPools();
    process.exit(1);
  });
