import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksum, compareChecksum } from './checksums.js';
import { pool } from './pool.js';

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
  reconciled: string[];
}

function findMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'db', 'migrations');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate db/migrations (set MIGRATIONS_DIR)');
}

export async function runMigrations(): Promise<MigrationResult> {
  const dir = findMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool('owner').connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  const reconciled: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const seen = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), 'utf8');
      const sum = checksum(sql);
      const previous = seen.get(file);

      if (previous !== undefined) {
        const verdict = compareChecksum(file, previous, sum);
        if (verdict === 'mismatch') {
          throw new Error(
            `migration ${file} was modified after it was applied ` +
              `(recorded ${previous.slice(0, 12)}, now ${sum.slice(0, 12)}). ` +
              'Add a new migration instead of editing an applied one.',
          );
        }
        if (verdict === 'earlier-equivalent') {
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [
            sum,
            file,
          ]);
          reconciled.push(file);
        }
        alreadyApplied.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, sum],
        );
        await client.query('COMMIT');
        applied.push(file);
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }

  if (reconciled.length > 0) {
    console.log(`[migrate] updated recorded checksum after comment-only change: ${reconciled.join(', ')}`);
  }

  return { applied, alreadyApplied, reconciled };
}
