import type { QueryResult, QueryResultRow } from 'pg';
import { pool } from './pool.js';

/**
 * Every database access in this service goes through one of the helpers below.
 * Routes never touch a Pool directly, and they never build a connection of
 * their own — which is what makes the tenant guarantee hold.
 *
 * The guarantee itself is not in this file. It is in 002_rls.sql. What this
 * file does is make sure the right role connects and, for a Viewer, that the
 * tenant is pinned for the lifetime of one transaction:
 *
 *     set_config('app.tenant_id', <uuid>, true)
 *                                        ^^^^
 * That third argument is `is_local`. It scopes the setting to the current
 * transaction, so when the pooled connection goes back to the pool it carries
 * nothing with it. A session-level SET here would be a cross-tenant leak
 * waiting for the next request that happened to reuse the connection.
 */

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export type ActorRole = 'admin' | 'viewer';

export interface Actor {
  userId: string;
  email: string;
  role: ActorRole;
  /** null for admins, who are not scoped to a single tenant */
  tenantId: string | null;
}

type Work<T> = (db: Queryable) => Promise<T>;

async function transact<T>(
  poolName: 'owner' | 'app' | 'admin' | 'evaluator',
  tenantId: string | null,
  fn: Work<T>,
): Promise<T> {
  const client = await pool(poolName).connect();
  try {
    await client.query('BEGIN');
    if (tenantId !== null) {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; releasing it is all we can do.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A Viewer's connection, pinned to one tenant. Even a query that forgets its
 * WHERE clause entirely returns only this tenant's rows.
 */
export function withApp<T>(tenantId: string, fn: Work<T>): Promise<T> {
  if (!tenantId) throw new Error('withApp requires a tenant id');
  return transact('app', tenantId, fn);
}

/**
 * The app role with no tenant pinned. Only for the SECURITY DEFINER helpers
 * that legitimately run before a tenant is known: login and collector lookup.
 * With no pin, app_tenant_id() is NULL and every RLS policy matches nothing,
 * so a stray query on a real table here returns zero rows rather than leaking.
 */
export function withUnscopedApp<T>(fn: Work<T>): Promise<T> {
  return transact('app', null, fn);
}

/** An Admin's connection: every tenant readable, events still not deletable. */
export function withAdmin<T>(fn: Work<T>, tenantId: string | null = null): Promise<T> {
  return transact('admin', tenantId, fn);
}

/** Owner connection — DDL, partition management, retention drops. */
export function withOwner<T>(fn: Work<T>): Promise<T> {
  return transact('owner', null, fn);
}

/** The alert engine, which by nature evaluates rules across all tenants. */
export function withEvaluator<T>(fn: Work<T>): Promise<T> {
  return transact('evaluator', null, fn);
}

/** Dispatch on who is signed in. This is what request handlers call. */
export function withActor<T>(actor: Actor, fn: Work<T>): Promise<T> {
  if (actor.role === 'admin') return withAdmin(fn);
  if (!actor.tenantId) throw new Error('viewer without a tenant id');
  return withApp(actor.tenantId, fn);
}
