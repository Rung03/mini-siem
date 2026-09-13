// อ่านและตรวจค่า environment ทั้งหมด รวมเป็น object config

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [
  path.resolve(here, '../../.env'),
  path.resolve(here, '../../../.env'),
]) {
  if (existsSync(candidate) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(candidate);
    break;
  }
}

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? dflt : v === 'true' || v === '1'));

const int = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? dflt : Number(v)))
    .pipe(z.number().int());

const schema = z.object({
  DEPLOY_PROFILE: z.enum(['saas', 'appliance']).default('saas'),
  NODE_ENV: z.string().default('production'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: int(5432),
  POSTGRES_DB: z.string().default('siem'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().min(1),

  OWNER_DB_PASSWORD: z.string().min(1),
  APP_DB_PASSWORD: z.string().min(1),
  ADMIN_DB_PASSWORD: z.string().min(1),
  EVALUATOR_DB_PASSWORD: z.string().min(1),

  API_PORT: int(8080),
  SESSION_SECRET: z.string().min(16),
  SESSION_TTL_HOURS: int(12),
  COOKIE_SECURE: bool(true),
  TRUST_PROXY_HOPS: int(1),

  SYSLOG_UDP_PORT: int(514),
  SYSLOG_TCP_PORT: int(514),
  SYSLOG_ENABLED: bool(true),

  RETENTION_DAYS: int(7),
  PARTITION_DAYS_AHEAD: int(2),

  WEBHOOKS_ENABLED: bool(true),
  WEBHOOK_TIMEOUT_MS: int(5000),

  ENRICH_ENABLED: bool(true),
  GEOIP_CITY_DB: z.string().optional(),
  GEOIP_ASN_DB: z.string().optional(),
  ENRICH_RDNS_ENABLED: bool(true),
  RDNS_SERVERS: z.string().optional(),
  RDNS_TIMEOUT_MS: int(1500),
  RDNS_CACHE_MAX: int(10_000),
  RDNS_CONCURRENCY: int(8),
  RDNS_QUEUE_MAX: int(5_000),
  RDNS_POSITIVE_TTL_MS: int(6 * 60 * 60 * 1000),
  RDNS_NEGATIVE_TTL_MS: int(15 * 60 * 1000),

  ALERT_INTERVAL_MS: int(30_000),
  MAINTENANCE_INTERVAL_MS: int(3_600_000),

  INGEST_MAX_BODY_BYTES: int(4 * 1024 * 1024),
  INGEST_MAX_BATCH: int(5000),
  UPLOAD_MAX_BYTES: int(64 * 1024 * 1024),
  WRITE_BATCH_SIZE: int(500),
  WRITE_FLUSH_MS: int(250),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

function dsn(user: string, password: string): string {
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgres://${auth}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;
}

export const config = {
  profile: env.DEPLOY_PROFILE,
  isAppliance: env.DEPLOY_PROFILE === 'appliance',
  nodeEnv: env.NODE_ENV,

  db: {
    superuser: dsn(env.POSTGRES_USER, env.POSTGRES_PASSWORD),
    owner: dsn('siem_owner', env.OWNER_DB_PASSWORD),
    app: dsn('siem_app', env.APP_DB_PASSWORD),
    admin: dsn('siem_admin', env.ADMIN_DB_PASSWORD),
    evaluator: dsn('siem_evaluator', env.EVALUATOR_DB_PASSWORD),
    passwords: {
      owner: env.OWNER_DB_PASSWORD,
      app: env.APP_DB_PASSWORD,
      admin: env.ADMIN_DB_PASSWORD,
      evaluator: env.EVALUATOR_DB_PASSWORD,
    },
    name: env.POSTGRES_DB,
  },

  api: {
    port: env.API_PORT,
    sessionSecret: env.SESSION_SECRET,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    cookieSecure: env.COOKIE_SECURE,
    trustProxyHops: env.TRUST_PROXY_HOPS,
  },

  syslog: {
    enabled: env.SYSLOG_ENABLED,
    udpPort: env.SYSLOG_UDP_PORT,
    tcpPort: env.SYSLOG_TCP_PORT,
  },

  ingest: {
    maxBodyBytes: env.INGEST_MAX_BODY_BYTES,
    maxBatch: env.INGEST_MAX_BATCH,
    uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    writeBatchSize: env.WRITE_BATCH_SIZE,
    writeFlushMs: env.WRITE_FLUSH_MS,
  },

  retention: {
    days: env.RETENTION_DAYS,
    partitionDaysAhead: env.PARTITION_DAYS_AHEAD,
    maintenanceIntervalMs: env.MAINTENANCE_INTERVAL_MS,
  },

  enrich: {
    enabled: env.ENRICH_ENABLED,
    geoipCityDb: env.GEOIP_CITY_DB ?? '/app/geoip/dbip-city-lite.mmdb',
    geoipAsnDb: env.GEOIP_ASN_DB ?? '/app/geoip/dbip-asn-lite.mmdb',
    rdnsEnabled: env.ENRICH_RDNS_ENABLED,
    rdnsServers: (env.RDNS_SERVERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    rdnsTimeoutMs: env.RDNS_TIMEOUT_MS,
    rdnsCacheMax: env.RDNS_CACHE_MAX,
    rdnsConcurrency: env.RDNS_CONCURRENCY,
    rdnsQueueMax: env.RDNS_QUEUE_MAX,
    rdnsPositiveTtlMs: env.RDNS_POSITIVE_TTL_MS,
    rdnsNegativeTtlMs: env.RDNS_NEGATIVE_TTL_MS,
  },

  alerting: {
    intervalMs: env.ALERT_INTERVAL_MS,
    webhooksEnabled: env.WEBHOOKS_ENABLED,
    webhookTimeoutMs: env.WEBHOOK_TIMEOUT_MS,
  },
} as const;

export type Config = typeof config;
