// ทางเข้าฐานข้อมูลทางเดียว: เปิด transaction ด้วย role ที่ถูกต้องและปักหมุด tenant

import type { QueryResult, QueryResultRow } from 'pg';
import { pool } from './pool.js';

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
    }
    throw err;
  } finally {
    client.release();
  }
}

export function withApp<T>(tenantId: string, fn: Work<T>): Promise<T> {
  if (!tenantId) throw new Error('withApp requires a tenant id');
  return transact('app', tenantId, fn);
}

export function withUnscopedApp<T>(fn: Work<T>): Promise<T> {
  return transact('app', null, fn);
}

export function withAdmin<T>(fn: Work<T>, tenantId: string | null = null): Promise<T> {
  return transact('admin', tenantId, fn);
}

export function withOwner<T>(fn: Work<T>): Promise<T> {
  return transact('owner', null, fn);
}

export function withEvaluator<T>(fn: Work<T>): Promise<T> {
  return transact('evaluator', null, fn);
}

export function withActor<T>(actor: Actor, fn: Work<T>): Promise<T> {
  if (actor.role === 'admin') return withAdmin(fn);
  if (!actor.tenantId) throw new Error('viewer without a tenant id');
  return withApp(actor.tenantId, fn);
}
