import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// Return int8 (counts, audit ids) as JS numbers rather than strings. Row
// counts in this system never approach 2^53.
types.setTypeParser(20, (v) => Number(v));

export type PoolName = 'owner' | 'app' | 'admin' | 'evaluator';

const pools = new Map<PoolName, pg.Pool>();

function create(name: PoolName): pg.Pool {
  const pool = new Pool({
    connectionString: config.db[name],
    application_name: `mini-siem-${name}`,
    max: name === 'app' ? 12 : 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Partition bounds are written as UTC dates, so every session has to agree
  // on what a day is.
  pool.on('connect', (client) => {
    void client.query("SET TIME ZONE 'UTC'");
  });

  pool.on('error', (err) => {
    console.error(`[db:${name}] idle client error`, err);
  });

  return pool;
}

export function pool(name: PoolName): pg.Pool {
  let p = pools.get(name);
  if (!p) {
    p = create(name);
    pools.set(name, p);
  }
  return p;
}

/** A one-off superuser connection. Used only by the role bootstrap at boot. */
export async function withSuperuser<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: config.db.superuser,
    application_name: 'mini-siem-bootstrap',
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function closeAllPools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => undefined)));
  pools.clear();
}
