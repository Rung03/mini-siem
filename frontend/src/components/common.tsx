import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ApiUser, type Tenant } from '../api/client.js';

/** Ranges the dashboard offers, in the order they appear. */
export const RANGES = [
  { key: '1h', label: 'Last hour', ms: 60 * 60 * 1000, bucket: 'minute' as const },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000, bucket: 'hour' as const },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000, bucket: 'day' as const },
];

export type RangeKey = (typeof RANGES)[number]['key'];

export function useTimeRange(initial: RangeKey = '24h') {
  const [key, setKey] = useState<RangeKey>(initial);
  const range = RANGES.find((r) => r.key === key) ?? RANGES[1]!;

  // Anchored to the minute so the query key does not change on every render,
  // which would defeat caching entirely.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const from = new Date(now - range.ms).toISOString();
  const to = new Date(now).toISOString();

  return { key, setKey, from, to, bucket: range.bucket };
}

export function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="range">Time range</label>
      <select id="range" value={value} onChange={(e) => onChange(e.target.value)}>
        {RANGES.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </select>
    </div>
  );
}

export function useTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'),
    enabled,
    refetchInterval: false,
  });
}

/**
 * Only shown to Admins. A Viewer has exactly one tenant and the server ignores
 * the parameter for them anyway — the database would too.
 */
export function TenantSelect({
  user,
  value,
  onChange,
}: {
  user: ApiUser;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useTenants(user.role === 'admin');
  if (user.role !== 'admin') return null;

  return (
    <div className="field">
      <label htmlFor="tenant">Tenant</label>
      <select id="tenant" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All tenants</option>
        {data?.tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * id -> display name. An Admin sees rows from every tenant side by side, and
 * collectors and rules are commonly named the same thing in each one, so
 * without this the tables show what look like duplicate rows.
 */
export function useTenantNames(): Map<string, string> {
  const { data } = useTenants(true);
  return new Map((data?.tenants ?? []).map((t) => [t.id, t.name]));
}

export function Outcome({ value }: { value: string }) {
  const cls = value === 'success' ? 'success' : value === 'failure' ? 'failure' : 'unknown';
  return <span className={`pill ${cls}`}>{value}</span>;
}

export function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  tone?: 'success' | 'failure';
  sub?: string;
}) {
  return (
    <div className="card stat">
      <span className="label">{label}</span>
      <span className={`value${tone ? ` ${tone}` : ''}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatBucket(iso: string, bucket: 'minute' | 'hour' | 'day'): string {
  const d = new Date(iso);
  if (bucket === 'day') {
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  }
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error">{error instanceof Error ? error.message : 'request failed'}</div>;
}
