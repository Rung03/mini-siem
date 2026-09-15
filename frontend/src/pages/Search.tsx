// หน้าค้นหา event ข้ามทุกแหล่ง พร้อมตัวกรองและดู payload ดิบ

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SOURCES, api, qs, type ApiUser, type SiemEvent } from '../api/client.js';
import {
  ErrorNote,
  Outcome,
  RangePicker,
  TenantSelect,
  formatTime,
  useTimeRange,
} from '../components/common.js';

const SOURCE_TYPES = [
  'fortigate',
  'm365',
  'crowdstrike',
  'generic',
];

export function Search({ user }: { user: ApiUser }) {
  const { key, setKey, from, to } = useTimeRange('24h');
  const [tenant, setTenant] = useState('');
  const [outcome, setOutcome] = useState('');
  const [source, setSource] = useState('');
  const [family, setFamily] = useState('');
  const [eventType, setEventType] = useState('');
  const [country, setCountry] = useState('');
  const [userName, setUserName] = useState('');
  const [ip, setIp] = useState('');
  const [text, setText] = useState('');
  const [applied, setApplied] = useState(0);

  const params = {
    from,
    to,
    tenant_id: tenant || undefined,
    outcome: outcome || undefined,
    source_type: source || undefined,
    source: family || undefined,
    event_type: eventType || undefined,
    country: country || undefined,
    user: userName || undefined,
    ip: ip || undefined,
    q: text || undefined,
    limit: 200,
  };

  const events = useQuery({
    queryKey: ['search', params, applied],
    queryFn: () => api.get<{ events: SiemEvent[]; next_cursor: string | null }>(
      `/events${qs(params)}`,
    ),
  });

  return (
    <>
      <div className="page-head">
        <h1>Search</h1>
      </div>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied((n) => n + 1);
        }}
      >
        <TenantSelect user={user} value={tenant} onChange={setTenant} />
        <RangePicker value={key} onChange={setKey} />

        <div className="field">
          <label htmlFor="outcome">Outcome</label>
          <select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="family">Source</label>
          <select id="family" value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="">Any</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="source">Parser</label>
          <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Any</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="country">Country</label>
          <input
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="TH"
            maxLength={2}
            style={{ width: 70 }}
          />
        </div>

        <div className="field">
          <label htmlFor="event_type">Event type</label>
          <input
            id="event_type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="login_failed"
          />
        </div>

        <div className="field">
          <label htmlFor="user">User</label>
          <input id="user" value={userName} onChange={(e) => setUserName(e.target.value)}
                 placeholder="jsmith" />
        </div>

        <div className="field">
          <label htmlFor="ip">Address or CIDR</label>
          <input id="ip" value={ip} onChange={(e) => setIp(e.target.value)}
                 placeholder="203.0.113.0/24" />
        </div>

        <div className="field">
          <label htmlFor="q">Message contains</label>
          <input id="q" value={text} onChange={(e) => setText(e.target.value)} />
        </div>

        <button className="primary" type="submit">Search</button>
      </form>

      <ErrorNote error={events.error} />

      <div className="card">
        <h2>
          {events.isFetching ? 'Searching…' : `${events.data?.events.length ?? 0} events`}
          {events.data?.next_cursor && ' (first page)'}
        </h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Outcome</th>
                <th>Event type</th>
                <th>Action</th>
                <th>User</th>
                <th>Source address</th>
                <th>Resolved / country</th>
                <th>Destination</th>
                <th>Host</th>
                <th>Source</th>
                <th>Sev</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {(events.data?.events ?? []).map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </tbody>
          </table>

          {events.data?.events.length === 0 && (
            <div className="empty">No matching events.</div>
          )}
        </div>
      </div>
    </>
  );
}

function EventRow({ event }: { event: SiemEvent }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const loadRaw = async () => {
    setOpen(true);
    if (raw !== null) return;
    try {
      const data = await api.get<{ raw: string }>(
        `/events/${event.id}/raw${qs({ ts: event.ts })}`,
      );
      setRaw(data.raw);
    } catch (err) {
      setRaw(err instanceof Error ? `could not load raw payload: ${err.message}` : 'error');
    }
  };

  return (
    <tr>
      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{formatTime(event.ts)}</td>
      <td><Outcome value={event.event_outcome} /></td>
      <td>{event.event_type ?? <span className="faint">—</span>}</td>
      <td className="muted">{event.action ?? <span className="faint">—</span>}</td>
      <td>{event.user_name ?? <span className="faint">—</span>}</td>
      <td className="mono">
        {event.src_ip ?? <span className="faint">—</span>}
        {event.src_port ? <span className="faint">:{event.src_port}</span> : null}
      </td>
      <td>
        {event.src_hostname ? (
          <span className="mono">{event.src_hostname}</span>
        ) : (
          <span className="faint">—</span>
        )}
        {event.geo_country_iso && (
          <div className="muted" style={{ fontSize: 12 }}>
            {event.geo_country_iso}
            {event.geo_city ? ` · ${event.geo_city}` : ''}
          </div>
        )}
      </td>
      <td className="mono">
        {event.dst_ip ?? <span className="faint">—</span>}
        {event.dst_port ? <span className="faint">:{event.dst_port}</span> : null}
        {event.protocol ? <span className="faint"> {event.protocol}</span> : null}
      </td>
      <td>{event.host ?? <span className="faint">—</span>}</td>
      <td className="muted">
        {event.source ?? event.source_type}
        {!event.parse_ok && <span className="pill" style={{ marginLeft: 6 }}>unparsed</span>}
      </td>
      <td className="num">{event.severity ?? ''}</td>
      <td style={{ maxWidth: 460 }}>
        {event.message}
        <details className="raw" open={open}>
          <summary onClick={(e) => { e.preventDefault(); open ? setOpen(false) : void loadRaw(); }}>
            {open ? 'hide raw payload' : 'raw payload'}
          </summary>
          {open && <pre>{raw ?? 'loading…'}</pre>}
        </details>
      </td>
    </tr>
  );
}
