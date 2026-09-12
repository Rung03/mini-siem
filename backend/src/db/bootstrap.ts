import { config } from '../config.js';
import { withSuperuser } from './pool.js';

/**
 * Creates the four database roles, once, at boot.
 *
 * Role names are fixed and passwords come from the environment, but both are
 * still quoted by Postgres itself via format(%I, %L) rather than pasted into a
 * string here. CREATE ROLE cannot take bind parameters, so this is the only
 * safe way to do it.
 *
 * The NOSUPERUSER NOBYPASSRLS is re-applied every boot on purpose: if someone
 * ever hand-grants BYPASSRLS to siem_app to "fix" a query, the next restart
 * takes it away again.
 */

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

    // The owner role owns the schema; migrations then create every object
    // inside it as that role.
    const { rows: own } = await client.query<{ sql: string }>(
      `SELECT format('ALTER SCHEMA public OWNER TO %I', 'siem_owner') AS sql`,
    );
    await client.query(own[0]!.sql);

    // Daily partition bounds are UTC dates; make that the database default so
    // a psql session poking around agrees with the application.
    const { rows: tz } = await client.query<{ sql: string }>(
      `SELECT format('ALTER DATABASE %I SET timezone TO %L', $1::text, 'UTC') AS sql`,
      [config.db.name],
    );
    await client.query(tz[0]!.sql);
  });
}
