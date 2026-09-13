// หน้ารายการ alert และปุ่ม Acknowledge

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Alert, type ApiUser } from '../api/client.js';
import {
  ErrorNote,
  TenantSelect,
  formatTime,
  useTenantNames,
} from '../components/common.js';

const SEVERITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
  5: 'Info',
};

export function Alerts({ user }: { user: ApiUser }) {
  const queryClient = useQueryClient();
  const [tenant, setTenant] = useState('');
  const [status, setStatus] = useState<'' | 'open' | 'acknowledged'>('');

  const alerts = useQuery({
    queryKey: ['alerts', tenant, status],
    queryFn: () =>
      api.get<{ alerts: Alert[] }>(
        `/alerts${qs({ tenant_id: tenant || undefined, status: status || undefined, limit: 100 })}`,
      ),
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/ack`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const rows = alerts.data?.alerts ?? [];
  const open = rows.filter((a) => a.status === 'open').length;
  const tenantNames = useTenantNames();
  const showTenant = user.role === 'admin';

  return (
    <>
      <div className="page-head">
        <h1>Alerts{open > 0 ? ` (${open} open)` : ''}</h1>
        <div className="filters" style={{ marginBottom: 0 }}>
          <TenantSelect user={user} value={tenant} onChange={setTenant} />
          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
            </select>
          </div>
        </div>
      </div>

      <ErrorNote error={alerts.error ?? ack.error} />

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Raised</th>
                {showTenant && <th>Tenant</th>}
                <th>Severity</th>
                <th>Alert</th>
                <th>Matched on</th>
                <th style={{ textAlign: 'right' }}>Events</th>
                <th>Webhook</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {formatTime(a.created_at)}
                  </td>
                  {showTenant && (
                    <td>{tenantNames.get(a.tenant_id) ?? <span className="faint">-</span>}</td>
                  )}
                  <td>
                    <span className={`pill ${a.severity <= 2 ? 'failure' : 'unknown'}`}>
                      {SEVERITY_LABELS[a.severity] ?? a.severity}
                    </span>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    {a.title}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.rule_name ?? 'rule removed'}
                    </div>
                  </td>
                  <td className="mono">
                    {a.group_by} = {a.group_value}
                  </td>
                  <td className="num">{a.event_count}</td>
                  <td className="muted">
                    {a.webhook_status}
                    {a.webhook_error && (
                      <div style={{ fontSize: 11 }}>{a.webhook_error}</div>
                    )}
                  </td>
                  <td>
                    {a.status === 'open' ? (
                      <span className="pill open">open</span>
                    ) : (
                      <span className="pill success">acknowledged</span>
                    )}
                  </td>
                  <td>
                    {a.status === 'open' && (
                      <button
                        onClick={() => ack.mutate(a.id)}
                        disabled={ack.isPending}
                      >
                        Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="empty">No alerts.</div>
          )}
        </div>
      </div>
    </>
  );
}
