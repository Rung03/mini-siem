// หน้าสรุป: การ์ดตัวเลข, กราฟตามเวลา และอันดับผู้ใช้ / IP / ประเภท / ประเทศ

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  api,
  qs,
  type ApiUser,
  type Bucket,
  type SiemEvent,
  type Summary,
  type TopRow,
} from '../api/client.js';
import {
  ErrorNote,
  Outcome,
  RangePicker,
  StatCard,
  TenantSelect,
  formatBucket,
  formatTime,
  useTimeRange,
} from '../components/common.js';

export function Dashboard({ user }: { user: ApiUser }) {
  const { key, setKey, from, to, bucket } = useTimeRange('24h');
  const [tenant, setTenant] = useState('');

  const params = { from, to, tenant_id: tenant || undefined };

  const summary = useQuery({
    queryKey: ['summary', params],
    queryFn: () => api.get<Summary>(`/stats/summary${qs(params)}`),
  });

  const series = useQuery({
    queryKey: ['timeseries', params, bucket],
    queryFn: () => api.get<{ buckets: Bucket[] }>(`/stats/timeseries${qs({ ...params, bucket })}`),
  });

  const topUsers = useQuery({
    queryKey: ['top', 'user_name', params],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(
        `/stats/top${qs({ ...params, field: 'user_name', outcome: 'failure', top: 8 })}`,
      ),
  });

  const topIps = useQuery({
    queryKey: ['top', 'src_ip', params],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...params, field: 'src_ip', top: 8 })}`),
  });

  const topEventTypes = useQuery({
    queryKey: ['top', 'event_type', params],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...params, field: 'event_type', top: 8 })}`),
  });

  const topCountries = useQuery({
    queryKey: ['top', 'geo_country_iso', params],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(
        `/stats/top${qs({ ...params, field: 'geo_country_iso', top: 8 })}`,
      ),
  });

  const recent = useQuery({
    queryKey: ['recent', params],
    queryFn: () => api.get<{ events: SiemEvent[] }>(`/events${qs({ ...params, limit: 15 })}`),
  });

  const s = summary.data;
  const failureRate = s && s.total > 0 ? Math.round((s.failure / s.total) * 100) : 0;

  const chartData = (series.data?.buckets ?? []).map((b) => ({
    ...b,
    label: formatBucket(b.bucket, bucket),
  }));

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="filters" style={{ marginBottom: 0 }}>
          <TenantSelect user={user} value={tenant} onChange={setTenant} />
          <RangePicker value={key} onChange={setKey} />
        </div>
      </div>

      <ErrorNote error={summary.error ?? series.error} />

      <div className="stat-grid">
        <StatCard label="Successful" value={s?.success ?? 0} tone="success" />
        <StatCard label="Failed" value={s?.failure ?? 0} tone="failure"
                  sub={`${failureRate}% of all attempts`} />
        <StatCard label="Total events" value={s?.total ?? 0} />
        <StatCard label="Distinct users" value={s?.unique_users ?? 0}
                  sub={`${(s?.unique_ips ?? 0).toLocaleString()} distinct addresses`} />
      </div>

      <div className="card">
        <h2>Activity over time</h2>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#f0f0f2" vertical={false} />
              <XAxis dataKey="label" stroke="#a1a1aa" fontSize={11} tickLine={false}
                     minTickGap={24} />
              <YAxis stroke="#a1a1aa" fontSize={11} tickLine={false} axisLine={false}
                     allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e6e6e9',
                  borderRadius: 6,
                  fontSize: 12,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="success" name="Successful" stroke="#15803d"
                    dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="failure" name="Failed" stroke="#b91c1c"
                    dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Top failed sign-ins by user</h2>
          <TopTable rows={topUsers.data?.rows ?? []} header="User" />
        </div>
        <div className="card">
          <h2>Top source addresses</h2>
          <TopTable rows={topIps.data?.rows ?? []} header="Address" mono />
        </div>
        <div className="card">
          <h2>Top event types</h2>
          <TopTable rows={topEventTypes.data?.rows ?? []} header="Event type" />
        </div>
        <div className="card">
          <h2>Top countries</h2>
          {(topCountries.data?.rows.length ?? 0) > 0 ? (
            <TopTable rows={topCountries.data?.rows ?? []} header="Country" />
          ) : (
            <div className="empty">
              No location data. Run <span className="mono">make geoip</span> to enable it.
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Recent events</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Outcome</th>
                <th>User</th>
                <th>Source address</th>
                <th>Source</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data?.events ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatTime(e.ts)}</td>
                  <td><Outcome value={e.event_outcome} /></td>
                  <td>{e.user_name ?? <span className="muted">—</span>}</td>
                  <td className="mono">{e.src_ip ?? <span className="muted">—</span>}</td>
                  <td className="muted">{e.source_type}</td>
                  <td style={{ maxWidth: 420 }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.data?.events.length === 0 && (
            <div className="empty">No events in this window.</div>
          )}
        </div>
      </div>
    </>
  );
}

function TopTable({
  rows,
  header,
  mono,
}: {
  rows: TopRow[];
  header: string;
  mono?: boolean;
}) {
  if (rows.length === 0) return <div className="empty">No data.</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{header}</th>
            <th style={{ textAlign: 'right' }}>Failed</th>
            <th style={{ textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value}>
              <td className={mono ? 'mono' : undefined}>{r.value}</td>
              <td className="num" style={{ color: r.failure > 0 ? 'var(--failure)' : undefined }}>
                {r.failure.toLocaleString()}
              </td>
              <td className="num">{r.total.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
