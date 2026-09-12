import { config } from '../config.js';
import { withSuperuser } from './pool.js';

const ROLES = [
  { name: 'siem_owner', password: () => config.db.passwords.owner },
  { name: 'siem_app', password: () => config.db.passwords.app },
  { name: 'siem_admin', password: () => config.db.passwords.admin },
  { name: 'siem_evaluator', password: () => config.db.passwords.evaluator },
] as const;

export async function bootstrapRoles(): Promise<void> {
  await withSuperuser(async (client) => {
    for (const role of ROLES) {
      const { rows } = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
        [role.name],
      );

      const verb = rows[0]?.exists ? 'ALTER' : 'CREATE';
      const { rows: stmt } = await client.query<{ sql: string }>(
        `SELECT format(
           '${verb} ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT',
           $1::text, $2::text) AS sql`,
        [role.name, role.password()],
      );
      await client.query(stmt[0]!.sql);

      const { rows: grant } = await client.query<{ sql: string }>(
        `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS sql`,
        [config.db.name, role.name],
      );
      await client.query(grant[0]!.sql);
    }

    const { rows: own } = await client.query<{ sql: string }>(
      `SELECT format('ALTER SCHEMA public OWNER TO %I', 'siem_owner') AS sql`,
    );
    await client.query(own[0]!.sql);

    const { rows: tz } = await client.query<{ sql: string }>(
      `SELECT format('ALTER DATABASE %I SET timezone TO %L', $1::text, 'UTC') AS sql`,
      [config.db.name],
    );
    await client.query(tz[0]!.sql);
  });
}
