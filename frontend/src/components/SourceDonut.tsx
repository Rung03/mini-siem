// กราฟโดนัทสัดส่วน event ต่อแหล่ง: คลิกชิ้นหรือแถวในคำอธิบายเพื่อกรองทั้ง dashboard สีผูกกับแหล่งเสมอไม่ขึ้นกับอันดับ

import { useState, type CSSProperties } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts';
import { SOURCES, type TopRow } from '../api/client.js';
import { COLORS, OTHER_COLOR, SOURCE_COLORS } from '../theme.js';

interface Slice {
  key: string;
  label: string;
  total: number;
  failure: number;
  color: string;
  filterable: boolean;
}

const OTHER_KEY = '__other';

function toSlices(rows: TopRow[]): Slice[] {
  const byValue = new Map(rows.map((r) => [r.value, r]));
  const slices: Slice[] = [];

  for (const source of SOURCES) {
    const row = byValue.get(source);
    if (row && row.total > 0) {
      slices.push({
        key: source,
        label: source,
        total: row.total,
        failure: row.failure,
        color: SOURCE_COLORS[source] ?? OTHER_COLOR,
        filterable: true,
      });
    }
  }

  const other = rows.filter((r) => !(SOURCES as readonly string[]).includes(r.value));
  const otherTotal = other.reduce((n, r) => n + r.total, 0);
  if (otherTotal > 0) {
    slices.push({
      key: OTHER_KEY,
      label: 'other',
      total: otherTotal,
      failure: other.reduce((n, r) => n + r.failure, 0),
      color: OTHER_COLOR,
      filterable: false,
    });
  }

  return slices;
}

interface SectorShape {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  fill: string;
}

function ActiveSlice(props: unknown) {
  const p = props as SectorShape;
  return (
    <Sector
      cx={p.cx}
      cy={p.cy}
      innerRadius={p.innerRadius}
      outerRadius={p.outerRadius + 7}
      startAngle={p.startAngle}
      endAngle={p.endAngle}
      fill={p.fill}
      stroke={COLORS.surface}
      strokeWidth={2}
    />
  );
}

export function SourceDonut({
  rows,
  selected,
  onSelect,
}: {
  rows: TopRow[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const slices = toSlices(rows);

  if (slices.length === 0) return <div className="empty">No data.</div>;

  const total = slices.reduce((n, s) => n + s.total, 0);
  const focusKey = hover ?? selected;
  const focus = slices.find((s) => s.key === focusKey);
  const activeIndex = slices.findIndex((s) => s.key === focusKey);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const pick = (s: Slice | undefined) => {
    if (s?.filterable) onSelect(s.key);
  };

  return (
    <div className="donut">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="total"
              nameKey="label"
              innerRadius="62%"
              outerRadius="84%"
              startAngle={90}
              endAngle={-270}
              stroke={COLORS.surface}
              strokeWidth={2}
              animationDuration={800}
              animationEasing="ease-out"
              activeIndex={activeIndex >= 0 ? activeIndex : undefined}
              activeShape={ActiveSlice}
              onMouseEnter={(_: unknown, i: number) => setHover(slices[i]?.key ?? null)}
              onMouseLeave={() => setHover(null)}
              onClick={(_: unknown, i: number) => pick(slices[i])}
            >
              {slices.map((s) => (
                <Cell
                  key={s.key}
                  fill={s.color}
                  opacity={selected && s.key !== selected ? 0.3 : 1}
                  style={{ cursor: s.filterable ? 'pointer' : 'default', outline: 'none' }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="donut-center" aria-live="polite">
          <strong>{(focus?.total ?? total).toLocaleString()}</strong>
          <span>{focus ? focus.label : 'events'}</span>
          {focus && (
            <small>
              {pct(focus.total)} · {focus.failure.toLocaleString()} failed
            </small>
          )}
        </div>
      </div>

      <ul className="donut-legend" aria-label="Events by source — click to filter">
        {slices.map((s, i) => {
          const isSelected = selected === s.key;
          const dim = selected !== null && !isSelected;
          return (
            <li key={s.key}>
              <button
                className={`legend-row${isSelected ? ' selected' : ''}${dim ? ' dim' : ''}`}
                style={{ '--i': i } as CSSProperties}
                disabled={!s.filterable}
                aria-pressed={s.filterable ? isSelected : undefined}
                title={s.filterable ? (isSelected ? 'Click to clear this filter' : `Show only ${s.label}`) : 'Sources no longer supported'}
                onClick={() => pick(s)}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(s.key)}
                onBlur={() => setHover(null)}
              >
                <i className="legend-swatch" style={{ background: s.color }} aria-hidden="true" />
                <span className="legend-name">{s.label}</span>
                <span className="legend-count">{s.total.toLocaleString()}</span>
                <span className="legend-pct">{pct(s.total)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
