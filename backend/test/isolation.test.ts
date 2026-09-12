import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapRoles } from '../src/db/bootstrap.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeAllPools } from '../src/db/pool.js';
import { withAdmin, withApp, withOwner, withUnscopedApp } from '../src/db/tenant.js';
import { normalize } from '../src/normalize/index.js';
import { insertEvents } from '../src/pipeline/writer.js';

/**
 * The tests that check the README's two security claims.
 *
 * These are the ones worth reading. Everything else in the suite checks that
 * the code does what it says; these check that it still holds when the code is
 * wrong — queries here deliberately omit their WHERE clause, and deliberately
 * try to erase evidence.
 *
 * Needs a live database. Run `docker compose up -d db` first; without one the
 * suite skips rather than failing, so `npm test` stays useful offline.
 */

async function databaseReachable(): Promise<boolean> {
  try {
    await bootstrapRoles();
    await runMigrations();
    return true;
  } catch {
    return false;
  }
}

const available = await databaseReachable();

interface Fixture {
  tenantA: string;
  tenantB: string;
}

describe.skipIf(!available)('tenant isolation is enforced by the database', () => {
  let fx: Fixture;

  beforeAll(async () => {
    // Fixed slugs, reused across runs. Timestamped ones would be tidier in
    // isolation, but events are append-only and tenants cannot be cleaned up
    // afterwards — so every run would leave another pair of tenants, and
    // another set of partitions, behind in whatever database it ran against.
    const make = (slug: string) =>
      withAdmin(async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO tenants (slug, name) VALUES ($1, $2)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [slug, slug],
        );
        return rows[0]!.id;
      });

    fx = {
      tenantA: await make('test-isolation-a'),
      tenantB: await make('test-isolation-b'),
    };

    await withOwner(async (db) => {
      await db.query('SELECT ensure_partitions($1)', [1]);
    });

    const event = (user: string) =>
      normalize('generic', {
        raw: JSON.stringify({ user, action: 'login', result: 'failed', ip: '203.0.113.1' }),
        receivedAt: new Date(),
      });

    await insertEvents({
      tenantId: fx.tenantA,
      collectorId: null,
      events: [event('alice-a'), event('alice-a2')],
    });
    await insertEvents({
      tenantId: fx.tenantB,
      collectorId: null,
      events: [event('bob-b')],
    });
  });

  afterAll(async () => {
    await closeAllPools();
  });

  it('returns only one tenant even when the query has no WHERE clause', async () => {
    // This is the query a buggy route would write. It is not filtered, on
    // purpose. The database is supposed to filter it anyway.
    const rows = await withApp(fx.tenantA, async (db) => {
      const result = await db.query<{ tenant_id: string; user_name: string }>(
        'SELECT tenant_id, user_name FROM events',
      );
      return result.rows;
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === fx.tenantA)).toBe(true);
    expect(rows.some((r) => r.user_name === 'bob-b')).toBe(false);
  });

  it('does not leak through an explicit filter on the other tenant', async () => {
    const rows = await withApp(fx.tenantA, async (db) => {
      const result = await db.query(
        'SELECT tenant_id FROM events WHERE tenant_id = $1::uuid',
        [fx.tenantB],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('returns nothing at all when no tenant is pinned', async () => {
    // Fail closed: a forgotten set_config means zero rows, not every row.
    const rows = await withUnscopedApp(async (db) => {
      const result = await db.query('SELECT tenant_id FROM events');
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses to file one tenant’s events under another', async () => {
    await expect(
      withApp(fx.tenantA, async (db) => {
        await db.query(
          `INSERT INTO events (tenant_id, ts, source_type, raw)
           VALUES ($1::uuid, now(), 'generic', 'smuggled')`,
          [fx.tenantB],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps alerts apart the same way', async () => {
    const rows = await withApp(fx.tenantA, async (db) => {
      const result = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM alerts');
      return result.rows;
    });
    expect(rows.every((r) => r.tenant_id === fx.tenantA)).toBe(true);
  });
});

describe.skipIf(!available)('logs cannot be deleted', () => {
  afterAll(async () => {
    await closeAllPools();
  });

  const tenant = async () =>
    withAdmin(async (db) => {
      const { rows } = await db.query<{ id: string }>('SELECT id FROM tenants LIMIT 1');
      return rows[0]!.id;
    });

  it('denies UPDATE on events to the application role', async () => {
    const id = await tenant();
    await expect(
      withApp(id, async (db) => {
        await db.query("UPDATE events SET message = 'rewritten'");
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies DELETE on events to the application role', async () => {
    const id = await tenant();
    await expect(
      withApp(id, async (db) => {
        await db.query('DELETE FROM events');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies DELETE on events to an administrator', async () => {
    // The README is explicit that this holds for Admin too: if the person who
    // administers the system can erase its logs, an attacker who takes that
    // account can erase their own tracks.
    await expect(
      withAdmin(async (db) => {
        await db.query('DELETE FROM events');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies UPDATE and DELETE on the audit trail', async () => {
    await expect(
      withAdmin(async (db) => {
        await db.query("UPDATE audit_log SET action = 'nothing happened'");
      }),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withAdmin(async (db) => {
        await db.query('DELETE FROM audit_log');
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe.skipIf(!available)('roles have no way around row level security', () => {
  afterAll(async () => {
    await closeAllPools();
  });

  it('grants no role BYPASSRLS or SUPERUSER', async () => {
    const rows = await withOwner(async (db) => {
      const result = await db.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
         WHERE rolname IN ('siem_app','siem_admin','siem_evaluator','siem_owner')`,
      );
      return result.rows;
    });

    expect(rows).toHaveLength(4);
    for (const role of rows) {
      expect(role.rolsuper, `${role.rolname} is superuser`).toBe(false);
      expect(role.rolbypassrls, `${role.rolname} has BYPASSRLS`).toBe(false);
    }
  });

  it('forces row level security on every tenant-scoped table', async () => {
    const rows = await withOwner(async (db) => {
      const result = await db.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname IN ('events','alerts','alert_rules','collectors','tenants','audit_log')
           AND relkind IN ('r','p')`,
      );
      return result.rows;
    });

    for (const table of rows) {
      expect(table.relrowsecurity, `${table.relname} RLS`).toBe(true);
      expect(table.relforcerowsecurity, `${table.relname} FORCE RLS`).toBe(true);
    }
  });

  it('grants the app role nothing on the partitions themselves', async () => {
    // Privileges are checked on the parent when access goes through it, so the
    // app role can query events normally — but cannot reach around it to a
    // partition, where the parent's policies would not apply.
    const rows = await withOwner(async (db) => {
      const result = await db.query<{ relname: string }>(
        `SELECT c.relname
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = 'events'
           AND has_table_privilege('siem_app', c.oid, 'SELECT')`,
      );
      return result.rows;
    });

    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
