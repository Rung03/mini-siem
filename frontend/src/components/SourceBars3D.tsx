// คอลัมน์ 3D จำนวน event แยกตามแหล่ง: คลิกคอลัมน์เพื่อกรองทั้ง dashboard ข้อมูลชุดเดียวจึงใช้สีเดียว ค่าอยู่บนหัวคอลัมน์

import { useState, type CSSProperties } from 'react';
import type { TopRow } from '../api/client.js';

function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function SourceBars3D({
  rows,
  selected,
  onSelect,
}: {
  rows: TopRow[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (rows.length === 0) return <div className="empty">No data.</div>;

  const max = Math.max(...rows.map((r) => r.total), 1);
  const active = hover !== null ? rows[hover] : undefined;

  return (
    <div className="bars3d">
      <div className="bars3d-scroll">
        <div className="bars3d-stage" role="group" aria-label="Events by source — click to filter">
          {rows.map((r, i) => {
            const isSelected = selected === r.value;
            const dim = selected !== null && !isSelected;
            return (
              <div
                key={r.value}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                className={`bar3d${dim ? ' dim' : ''}${isSelected ? ' selected' : ''}${hover === i ? ' hot' : ''}`}
                style={{ '--i': i } as CSSProperties}
                aria-label={`${r.value}: ${r.total.toLocaleString()} events, ${r.failure.toLocaleString()} failed`}
                onClick={() => onSelect(r.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.value);
                  }
                }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <div className="bar3d-plot">
                  <div
                    className="bar3d-col"
                    style={{ height: `${Math.max((r.total / max) * 100, 3)}%` }}
                  >
                    <span className="bar3d-value">{compact(r.total)}</span>
                    <i className="bar3d-front" />
                    <i className="bar3d-side" />
                    <i className="bar3d-top" />
                  </div>
                </div>
                <span className="bar3d-label">{r.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bars3d-readout" aria-live="polite">
        {active ? (
          <>
            <strong>{active.total.toLocaleString()}</strong>
            <span>events from {active.value}</span>
            <span className="faint">·</span>
            <strong>{active.failure.toLocaleString()}</strong>
            <span>failed</span>
          </>
        ) : (
          <span className="faint">
            {selected ? 'Click the column again to clear the filter' : 'Click a column to filter the dashboard'}
          </span>
        )}
      </div>
    </div>
  );
}
