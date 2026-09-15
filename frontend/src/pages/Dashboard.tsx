// หน้าสรุป: คลิกการ์ด ชิ้นโดนัท หรือแถวเพื่อกรองทั้งหน้า, การ์ดตัวเลขเอียง 3D, กราฟพื้นที่ตามเวลา, โดนัทต่อแหล่ง และอันดับต่าง ๆ

import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  SOURCES,
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
import {
  IconActivity,
  IconShieldAlert,
  IconShieldCheck,
  IconUsers,
} from '../components/icons.js';
import { SourceDonut } from '../components/SourceDonut.js';
import { COLORS } from '../theme.js';

const SERIES = [
  { key: 'success', name: 'Successful', color: COLORS.success },
  { key: 'failure', name: 'Failed', color: COLORS.failure },
] as const;

type FilterKey = 'outcome' | 'source' | 'user' | 'ip' | 'event_type';
type Filters = Partial<Record<FilterKey, string>>;

const FILTER_LABELS: Record<FilterKey, string> = {
  outcome: 'Outcome',
  source: 'Source',
  user: 'User',
  ip: 'Address',
  event_type: 'Event type',
};

function filterParams(filters: Filters, omit?: FilterKey) {
  const pick = (k: FilterKey) => (k === omit ? undefined : filters[k]);
  return {
    outcome: pick('outcome'),
    source: pick('source'),
    user_exact: pick('user'),
    ip: pick('ip'),
    event_type: pick('event_type'),
  };
}

function activate(e: KeyboardEvent, run: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

interface TooltipContent {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number | string }[];
}

function ChartTooltip({ active, label, payload }: TooltipContent) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-label">{label}</div>
      {SERIES.map((s) => {
        const value = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <div className="tt-row" key={s.key}>
            <i className="legend-line" style={{ background: s.color }} />
            <strong>{Number(value).toLocaleString()}</strong>
            <span>{s.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ user }: { user: ApiUser }) {
  const { key, setKey, from, to, bucket } = useTimeRange('24h');
  const [tenant, setTenant] = useState('');
  const [filters, setFilters] = useState<Filters>({});

  const toggle = (k: FilterKey, value: string) =>
    setFilters((prev) => {
      const next = { ...prev };
      if (next[k] === value) delete next[k];
      else next[k] = value;
      return next;
    });

  const remove = (k: FilterKey) =>
    setFilters((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });

  const scope = { from, to, tenant_id: tenant || undefined };
  const params = { ...scope, ...filterParams(filters) };
  const except = (k: FilterKey) => ({ ...scope, ...filterParams(filters, k) });
  const activeFilters = Object.entries(filters) as [FilterKey, string][];
  const filterKey = JSON.stringify(filters);

  const summary = useQuery({
    queryKey: ['summary', params],
    queryFn: () => api.get<Summary>(`/stats/summary${qs(params)}`),
  });

  const series = useQuery({
    queryKey: ['timeseries', params, bucket],
    queryFn: () => api.get<{ buckets: Bucket[] }>(`/stats/timeseries${qs({ ...params, bucket })}`),
  });

  const bySourceParams = except('source');
  const bySource = useQuery({
    queryKey: ['top', 'source', bySourceParams],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...bySourceParams, field: 'source', top: 8 })}`),
  });

  const usersOutcome = filters.outcome ?? 'failure';
  const usersParams = { ...except('user'), outcome: usersOutcome };
  const topUsers = useQuery({
    queryKey: ['top', 'user_name', usersParams],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...usersParams, field: 'user_name', top: 8 })}`),
  });

  const ipParams = except('ip');
  const topIps = useQuery({
    queryKey: ['top', 'src_ip', ipParams],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...ipParams, field: 'src_ip', top: 8 })}`),
  });

  const typeParams = except('event_type');
  const topEventTypes = useQuery({
    queryKey: ['top', 'event_type', typeParams],
    queryFn: () =>
      api.get<{ rows: TopRow[] }>(`/stats/top${qs({ ...typeParams, field: 'event_type', top: 8 })}`),
  });

  const recent = useQuery({
    queryKey: ['recent', params],
    queryFn: () => api.get<{ events: SiemEvent[] }>(`/events${qs({ ...params, limit: 15 })}`),
  });

  const s = summary.data;
  const failureRate = s && s.total > 0 ? Math.round((s.failure / s.total) * 100) : 0;
  const refetching = (q: { isFetching: boolean; data: unknown }) =>
    q.isFetching && q.data !== undefined ? ' refetching' : '';

  const chartData = (series.data?.buckets ?? []).map((b) => ({
    ...b,
    label: formatBucket(b.bucket, bucket),
  }));

  return (
    <>
      <div className="page-head enter" style={{ '--i': 0 } as CSSProperties}>
        <h1>Security overview</h1>
        <div className="filters" style={{ marginBottom: 0 }}>
          <RangePicker value={key} onChange={setKey} />
          <TenantSelect user={user} value={tenant} onChange={setTenant} />
          <div className="field">
            <label htmlFor="dash-source">Source</label>
            <select
              id="dash-source"
              value={filters.source ?? ''}
              onChange={(e) =>
                e.target.value ? setFilters((f) => ({ ...f, source: e.target.value })) : remove('source')
              }
            >
              <option value="">All sources</option>
              {SOURCES.map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="filter-bar has-filters" aria-live="polite">
          <span className="filter-bar-label">Showing only</span>
          {activeFilters.map(([k, v]) => (
            <button
              key={k}
              className="chip"
              onClick={() => remove(k)}
              aria-label={`Remove filter ${FILTER_LABELS[k]} ${v}`}
            >
              <span className="chip-key">{FILTER_LABELS[k]}</span>
              <span className="chip-val">{v}</span>
              <span className="chip-x" aria-hidden="true">×</span>
            </button>
          ))}
          <button className="chip-clear" onClick={() => setFilters({})}>Clear all</button>
        </div>
      )}

      <ErrorNote error={summary.error ?? series.error} />

      <div className={`stat-grid${refetching(summary)}`}>
        <StatCard
          index={1}
          label="Successful"
          value={s?.success ?? 0}
          tone="success"
          icon={<IconShieldCheck />}
          sub="allowed and signed in"
          active={filters.outcome === 'success'}
          hint="Show only successful events"
          onClick={() => toggle('outcome', 'success')}
        />
        <StatCard
          index={2}
          label="Failed"
          value={s?.failure ?? 0}
          tone="failure"
          icon={<IconShieldAlert />}
          sub={`${failureRate}% of all attempts`}
          active={filters.outcome === 'failure'}
          hint="Show only failed events"
          onClick={() => toggle('outcome', 'failure')}
        />
        <StatCard
          index={3}
          label="Total events"
          value={s?.total ?? 0}
          tone="accent"
          icon={<IconActivity />}
          sub={`${(s?.unparsed ?? 0).toLocaleString()} unparsed`}
          hint="Clear every filter"
          onClick={() => setFilters({})}
        />
        <StatCard
          index={4}
          label="Distinct users"
          value={s?.unique_users ?? 0}
          tone="info"
          icon={<IconUsers />}
          sub={`${(s?.unique_ips ?? 0).toLocaleString()} distinct addresses`}
        />
      </div>

      <div className="grid-hero">
        <div className={`card enter${refetching(series)}`} style={{ '--i': 5 } as CSSProperties}>
          <h2>Activity over time</h2>
          <div className="chart-legend">
            {SERIES.map((sr) => (
              <span className="legend-item" key={sr.key}>
                <i className="legend-line" style={{ background: sr.color }} />
                {sr.name}
              </span>
            ))}
          </div>
          <div className="chart-depth" style={{ height: 262 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  {SERIES.map((sr) => (
                    <linearGradient key={sr.key} id={`fill-${sr.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={sr.color} stopOpacity={0.24} />
                      <stop offset="100%" stopColor={sr.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 11 }}
                       axisLine={{ stroke: COLORS.grid }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: COLORS.axis, fontSize: 11 }} axisLine={false} tickLine={false}
                       allowDecimals={false} width={44} />
                <Tooltip content={<ChartTooltip />}
                         cursor={{ stroke: COLORS.axis, strokeWidth: 1 }} />
                {SERIES.map((sr) => (
                  <Area
                    key={sr.key}
                    type="monotone"
                    dataKey={sr.key}
                    name={sr.name}
                    stroke={sr.color}
                    strokeWidth={2}
                    fill={`url(#fill-${sr.key})`}
                    dot={false}
                    activeDot={{ r: 5, fill: sr.color, stroke: COLORS.surface, strokeWidth: 2 }}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`card enter${refetching(bySource)}`} style={{ '--i': 6 } as CSSProperties}>
          <div className="card-head">
            <h2>Events by source</h2>
            {filters.source && (
              <button className="chip-clear small" onClick={() => remove('source')}>Clear</button>
            )}
          </div>
          <SourceDonut
            rows={bySource.data?.rows ?? []}
            selected={filters.source ?? null}
            onSelect={(v) => toggle('source', v)}
          />
        </div>
      </div>

      <div className="grid-2">
        <TopCard
          index={7}
          title={usersOutcome === 'success' ? 'Top successful sign-ins by user' : 'Top failed sign-ins by user'}
          header="User"
          rows={topUsers.data?.rows ?? []}
          selected={filters.user}
          onSelect={(v) => toggle('user', v)}
        />
        <TopCard
          index={8}
          title="Top source addresses"
          header="Address"
          mono
          rows={topIps.data?.rows ?? []}
          selected={filters.ip}
          onSelect={(v) => toggle('ip', v)}
        />
        <TopCard
          index={9}
          title="Top event types"
          header="Event type"
          rows={topEventTypes.data?.rows ?? []}
          selected={filters.event_type}
          onSelect={(v) => toggle('event_type', v)}
        />
      </div>

      <div className="card enter" style={{ marginTop: 16, '--i': 11 } as CSSProperties}>
        <div className="card-head">
          <h2>Recent events</h2>
          <span className="faint small">Click a user, address or source to filter</span>
        </div>
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
            <tbody key={filterKey}>
              {(recent.data?.events ?? []).map((e, i) => (
                <tr key={e.id} className="row-enter" style={{ '--i': i } as CSSProperties}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatTime(e.ts)}</td>
                  <td>
                    {e.event_outcome === 'success' || e.event_outcome === 'failure' ? (
                      <button className="cell-link" onClick={() => toggle('outcome', e.event_outcome)}>
                        <Outcome value={e.event_outcome} />
                      </button>
                    ) : (
                      <Outcome value={e.event_outcome} />
                    )}
                  </td>
                  <td>
                    {e.user_name ? (
                      <button className={`cell-link${filters.user === e.user_name ? ' on' : ''}`}
                              onClick={() => toggle('user', e.user_name!)}>
                        {e.user_name}
                      </button>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="mono">
                    {e.src_ip ? (
                      <button className={`cell-link mono${filters.ip === e.src_ip ? ' on' : ''}`}
                              onClick={() => toggle('ip', e.src_ip!)}>
                        {e.src_ip}
                      </button>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td>
                    {e.source ? (
                      <button className={`cell-link muted${filters.source === e.source ? ' on' : ''}`}
                              onClick={() => toggle('source', e.source!)}>
                        {e.source}
                      </button>
                    ) : (
                      <span className="muted">{e.source_type}</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.data?.events.length === 0 && (
            <div className="empty">No events match these filters.</div>
          )}
        </div>
      </div>
    </>
  );
}

function TopCard({
  index,
  title,
  header,
  rows,
  mono,
  selected,
  onSelect,
}: {
  index: number;
  title: string;
  header: string;
  rows: TopRow[];
  mono?: boolean;
  selected?: string;
  onSelect: (value: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className={`card enter${selected ? ' filtered' : ''}`} style={{ '--i': index } as CSSProperties}>
      <div className="card-head">
        <h2>{title}</h2>
        {selected && (
          <button className="chip-clear small" onClick={() => onSelect(selected)}>Clear</button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty">No data.</div>
      ) : (
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
              {rows.map((r, i) => {
                const isSelected = selected === r.value;
                return (
                  <tr
                    key={r.value}
                    className={`clickable row-enter${isSelected ? ' selected' : ''}${selected && !isSelected ? ' dimmed' : ''}`}
                    style={{ '--i': i } as CSSProperties}
                    tabIndex={0}
                    aria-selected={isSelected}
                    title={isSelected ? 'Click to clear this filter' : `Show only ${r.value}`}
                    onClick={() => onSelect(r.value)}
                    onKeyDown={(e) => activate(e, () => onSelect(r.value))}
                  >
                    <td>
                      <div className="meter-cell">
                        <span className={mono ? 'mono' : undefined}>{r.value}</span>
                        <div className="meter" aria-hidden="true">
                          <div className="meter-fill" style={{ width: `${(r.total / max) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="num">
                      {r.failure > 0 && <span className="dot failure" aria-hidden="true" />}
                      {r.failure.toLocaleString()}
                    </td>
                    <td className="num">{r.total.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
