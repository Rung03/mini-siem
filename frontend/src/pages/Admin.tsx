// หน้าผู้ดูแล: collector, กฎแจ้งเตือน, ผู้ใช้, tenant, audit trail และ partition

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  uploadFile,
  type ApiUser,
  type AuditEntry,
  type Collector,
  type Rule,
  type Tenant,
} from '../api/client.js';
import {
  ErrorNote,
  formatTime,
  useTenantNames,
  useTenants,
} from '../components/common.js';

type Tab = 'collectors' | 'rules' | 'users' | 'tenants' | 'audit' | 'storage';

const TABS: { key: Tab; label: string }[] = [
  { key: 'collectors', label: 'Collectors' },
  { key: 'rules', label: 'Alert rules' },
  { key: 'users', label: 'Users' },
  { key: 'tenants', label: 'Tenants' },
  { key: 'audit', label: 'Audit trail' },
  { key: 'storage', label: 'Storage' },
];

export function Admin({ user }: { user: ApiUser }) {
  const [tab, setTab] = useState<Tab>('collectors');

  return (
    <>
      <div className="page-head">
        <h1>Administration</h1>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'collectors' && <Collectors />}
      {tab === 'rules' && <Rules />}
      {tab === 'users' && <Users currentUserId={user.id} />}
      {tab === 'tenants' && <Tenants />}
      {tab === 'audit' && <Audit />}
      {tab === 'storage' && <Storage />}
    </>
  );
}

function Collectors() {
  const queryClient = useQueryClient();
  const tenants = useTenants(true);
  const tenantNames = useTenantNames();
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);
  const [form, setForm] = useState({
    tenant_id: '',
    name: '',
    kind: 'http',
    source_type: 'generic',
    source_cidr: '',
  });

  const list = useQuery({
    queryKey: ['collectors'],
    queryFn: () => api.get<{ collectors: Collector[] }>('/collectors'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ collector: Collector; token: string | null }>('/collectors', {
        tenant_id: form.tenant_id,
        name: form.name,
        kind: form.kind,
        source_type: form.source_type,
        source_cidr: form.kind === 'syslog' ? form.source_cidr : null,
      }),
    onSuccess: (data) => {
      if (data.token) setIssued({ name: data.collector.name, token: data.token });
      setForm((f) => ({ ...f, name: '', source_cidr: '' }));
      void queryClient.invalidateQueries({ queryKey: ['collectors'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (c: Collector) => api.patch(`/collectors/${c.id}`, { enabled: !c.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collectors'] }),
  });

  const rotate = useMutation({
    mutationFn: (c: Collector) =>
      api.post<{ token: string }>(`/collectors/${c.id}/rotate-token`).then((r) => ({
        name: c.name,
        token: r.token,
      })),
    onSuccess: (data) => setIssued(data),
  });

  return (
    <>
      <ErrorNote error={create.error ?? toggle.error ?? rotate.error} />

      {issued && (
        <div className="notice">
          <strong>Token for {issued.name}</strong>
          <div className="mono" style={{ margin: '6px 0', wordBreak: 'break-all' }}>
            {issued.token}
          </div>
          <span className="muted">Shown once.</span>
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setIssued(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Add a collector</h2>
        <form
          className="filters"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="field">
            <label>Tenant</label>
            <select
              required
              value={form.tenant_id}
              onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
            >
              <option value="">Choose…</option>
              {tenants.data?.tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="edge-firewall"
            />
          </div>

          <div className="field">
            <label>Channel</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="http">HTTP POST /ingest</option>
              <option value="syslog">Syslog 514</option>
              <option value="file">File upload</option>
            </select>
          </div>

          <div className="field">
            <label>Source type</label>
            <select
              value={form.source_type}
              onChange={(e) => setForm({ ...form, source_type: e.target.value })}
            >
              {['fortigate', 'windows_ad', 'm365', 'aws_cloudtrail', 'crowdstrike', 'generic'].map(
                (s) => <option key={s} value={s}>{s}</option>,
              )}
            </select>
          </div>

          {form.kind === 'syslog' && (
            <div className="field">
              <label>Sender CIDR</label>
              <input
                required
                value={form.source_cidr}
                onChange={(e) => setForm({ ...form, source_cidr: e.target.value })}
                placeholder="10.10.0.0/24"
              />
            </div>
          )}

          <button className="primary" type="submit" disabled={create.isPending}>
            Create
          </button>
        </form>
      </div>

      <FileUpload collectors={list.data?.collectors ?? []} />

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Collectors</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Tenant</th>
                <th>Channel</th>
                <th>Source type</th>
                <th>Sender</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data?.collectors ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{tenantNames.get(c.tenant_id) ?? <span className="faint">-</span>}</td>
                  <td className="muted">{c.kind}</td>
                  <td className="muted">{c.source_type}</td>
                  <td className="mono">{c.cidr ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className={`pill ${c.enabled ? 'success' : 'unknown'}`}>
                      {c.enabled ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => toggle.mutate(c)}>
                      {c.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {c.kind === 'http' && (
                      <button style={{ marginLeft: 6 }} onClick={() => rotate.mutate(c)}>
                        Rotate token
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FileUpload({ collectors }: { collectors: Collector[] }) {
  const tenantNames = useTenantNames();
  const [collectorId, setCollectorId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [keepTimestamps, setKeepTimestamps] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !collectorId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await uploadFile(collectorId, file, keepTimestamps);
      const days = Math.round(r.timestamps_shifted_seconds / 86_400);
      const shifted =
        r.timestamps_shifted_seconds > 0
          ? ` — timestamps were older than retention and moved forward ${days} day(s); ` +
            'originals are kept in attrs.original_ts'
          : '';
      setResult(`${r.filename}: ${r.accepted} accepted, ${r.unparsed} unparsed${shifted}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Upload a log file</h2>
      {error && <div className="error">{error}</div>}
      {result && <div className="notice">{result}</div>}

      <form className="file-row" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label>Collector</label>
          <select required value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
            <option value="">Choose…</option>
            {collectors.map((c) => (
              <option key={c.id} value={c.id}>
                {tenantNames.get(c.tenant_id) ?? '?'} - {c.name} ({c.source_type})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>File</label>
          <input
            type="file"
            required
            accept=".log,.json,.ndjson,.csv,.tsv,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="field">
          <label htmlFor="keep-timestamps">Timestamps</label>
          <label htmlFor="keep-timestamps" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              id="keep-timestamps"
              type="checkbox"
              checked={keepTimestamps}
              onChange={(e) => setKeepTimestamps(e.target.checked)}
            />
            Keep original (older than retention is dropped)
          </label>
        </div>

        <button className="primary" type="submit" disabled={busy || !file || !collectorId}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>
    </div>
  );
}

function Rules() {
  const queryClient = useQueryClient();
  const tenantNames = useTenantNames();
  const list = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get<{ rules: Rule[] }>('/rules'),
  });

  const toggle = useMutation({
    mutationFn: (r: Rule) => api.patch(`/rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  return (
    <div className="card">
      <h2>Alert rules</h2>
      <ErrorNote error={toggle.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Tenant</th>
              <th>Condition</th>
              <th>Grouped by</th>
              <th>Webhook</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data?.rules ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{tenantNames.get(r.tenant_id) ?? <span className="faint">-</span>}</td>
                <td className="muted">
                  {r.threshold}+ {r.match_outcome ?? 'any'} {r.match_category ?? 'event'}
                  {' in '}
                  {Math.round(r.window_seconds / 60)} min
                </td>
                <td className="mono">{r.group_by}</td>
                <td className="mono">{r.webhook_url ?? <span className="muted">—</span>}</td>
                <td>
                  <span className={`pill ${r.enabled ? 'success' : 'unknown'}`}>
                    {r.enabled ? 'yes' : 'no'}
                  </span>
                </td>
                <td>
                  <button onClick={() => toggle.mutate(r)}>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AdminUser {
  id: string;
  email: string;
  role: string;
  tenant_id: string | null;
  tenant_name: string | null;
  active: boolean;
}

function Users({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const tenants = useTenants(true);
  const [form, setForm] = useState({ email: '', password: '', role: 'viewer', tenant_id: '' });

  const list = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: AdminUser[] }>('/users'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/users', {
        email: form.email,
        password: form.password,
        role: form.role,
        tenant_id: form.role === 'viewer' ? form.tenant_id : null,
      }),
    onSuccess: () => {
      setForm({ email: '', password: '', role: 'viewer', tenant_id: '' });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (u: AdminUser) => api.patch(`/users/${u.id}`, { active: !u.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <ErrorNote error={create.error ?? toggle.error} />

      <div className="card">
        <h2>Add a user</h2>
        <form
          className="filters"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {form.role === 'viewer' && (
            <div className="field">
              <label>Tenant</label>
              <select
                required
                value={form.tenant_id}
                onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {tenants.data?.tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <button className="primary" type="submit" disabled={create.isPending}>Create</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Users</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th><th>Role</th><th>Tenant</th><th>Active</th><th />
              </tr>
            </thead>
            <tbody>
              {(list.data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td className="muted">{u.role}</td>
                  <td>{u.tenant_name ?? <span className="muted">all tenants</span>}</td>
                  <td>
                    <span className={`pill ${u.active ? 'success' : 'unknown'}`}>
                      {u.active ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => toggle.mutate(u)}
                      disabled={u.id === currentUserId}
                      title={u.id === currentUserId ? 'You cannot deactivate yourself' : undefined}
                    >
                      {u.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Tenants() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '' });
  const list = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/tenants', form),
    onSuccess: () => {
      setForm({ slug: '', name: '' });
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  return (
    <>
      <ErrorNote error={create.error} />
      <div className="card">
        <h2>Add a tenant</h2>
        <form
          className="filters"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        >
          <div className="field">
            <label>Slug</label>
            <input required pattern="[a-z0-9][a-z0-9-]*" value={form.slug}
                   onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </div>
          <div className="field">
            <label>Name</label>
            <input required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <button className="primary" type="submit" disabled={create.isPending}>Create</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Tenants</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Slug</th><th>Created</th></tr></thead>
            <tbody>
              {(list.data?.tenants ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono">{t.slug}</td>
                  <td className="mono">{formatTime(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Audit() {
  const list = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<{ entries: AuditEntry[] }>('/audit?limit=200'),
  });

  return (
    <div className="card">
      <h2>Audit trail</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th><th>Who</th><th>Action</th><th>Target</th>
              <th>From</th><th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatTime(e.at)}</td>
                <td>
                  {e.actor_email}
                  <div className="muted" style={{ fontSize: 11 }}>{e.actor_role}</div>
                </td>
                <td className="mono">{e.action}</td>
                <td className="muted">{e.target_type ?? '—'}</td>
                <td className="mono">{e.src_ip ?? '—'}</td>
                <td className="mono" style={{ fontSize: 11, maxWidth: 300 }}>
                  {JSON.stringify(e.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Partition { day_partition: string; subpartitions: number }
interface Drop {
  id: number; at: string; channel: string; reason: string;
  src_ip: string | null; sample: string | null;
}

function Storage() {
  const partitions = useQuery({
    queryKey: ['partitions'],
    queryFn: () => api.get<{ partitions: Partition[] }>('/partitions'),
  });
  const drops = useQuery({
    queryKey: ['drops'],
    queryFn: () => api.get<{ drops: Drop[] }>('/ingest-drops'),
  });

  return (
    <>
      <div className="card">
        <h2>Event partitions</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Day partition</th><th style={{ textAlign: 'right' }}>Tenant tables</th></tr></thead>
            <tbody>
              {(partitions.data?.partitions ?? []).map((p) => (
                <tr key={p.day_partition}>
                  <td className="mono">{p.day_partition}</td>
                  <td className="num">{p.subpartitions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Rejected ingest</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Channel</th><th>Reason</th><th>From</th></tr>
            </thead>
            <tbody>
              {(drops.data?.drops ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="mono">{formatTime(d.at)}</td>
                  <td className="muted">{d.channel}</td>
                  <td>{d.reason}</td>
                  <td className="mono">{d.src_ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {drops.data?.drops.length === 0 && <div className="empty">Nothing rejected.</div>}
        </div>
      </div>
    </>
  );
}
