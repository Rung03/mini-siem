import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

/**
 * A deliberately small migration runner: numbered .sql files, applied once, in
 * order, each inside its own transaction, as the owner role. Applied files are
 * checksummed so an edit to a migration that already ran is reported rather
 * than silently ignored.
 */

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Walk up from this module until a db/migrations directory turns up. */
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

function checksum(sql: string): string {
  // Normalise line endings so a Windows checkout and a Linux container agree.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function runMigrations(): Promise<MigrationResult> {
  const dir = findMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool('owner').connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

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
        if (previous !== sum) {
          throw new Error(
            `migration ${file} was modified after it was applied ` +
              `(recorded ${previous.slice(0, 12)}, now ${sum.slice(0, 12)}). ` +
              'Add a new migration instead of editing an applied one.',
          );
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

  return { applied, alreadyApplied };
}
