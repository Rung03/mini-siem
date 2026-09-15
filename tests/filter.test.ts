// เทสต์ตัวกรองของ /events และ /stats: ค่าที่คลิกจาก dashboard ต้องกรองแบบตรงตัว

import { describe, expect, it } from 'vitest';
import { buildFilter } from '../backend/src/api/routes/events.js';
import type { Actor } from '../backend/src/db/tenant.js';

const viewer: Actor = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'viewer@northwind.local',
  role: 'viewer',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
};
const range = { from: new Date('2026-09-13T00:00:00Z'), to: new Date('2026-09-14T00:00:00Z') };

describe('event filters', () => {
  it('matches a clicked user exactly, so "admin" does not also return "administrator"', () => {
    const { where, params } = buildFilter(viewer, { limit: 100, user_exact: 'admin' }, range);
    expect(where).toContain('user_name = $');
    expect(where).not.toContain('ILIKE');
    expect(params).toContain('admin');
  });

  it('keeps the typed user search as a partial match', () => {
    const { where, params } = buildFilter(viewer, { limit: 100, user: 'adm' }, range);
    expect(where).toContain('user_name ILIKE $');
    expect(params).toContain('%adm%');
  });

  it('combines every dashboard filter with AND and always scopes a viewer to their tenant', () => {
    const { where, params } = buildFilter(
      viewer,
      {
        limit: 100,
        outcome: 'failure',
        source: 'firewall',
        event_type: 'LogonFailed',
        country: 'th',
        ip: '203.0.113.66',
        user_exact: 'jsmith',
        tenant_id: '00000000-0000-0000-0000-0000000000bb',
      },
      range,
    );
    for (const clause of [
      'event_outcome =', 'source =', 'event_type =', 'geo_country_iso =',
      'src_ip =', 'user_name =', 'tenant_id =',
    ]) {
      expect(where).toContain(clause);
    }
    expect(params).toContain('TH');
    expect(params).toContain(viewer.tenantId);
    expect(params).not.toContain('00000000-0000-0000-0000-0000000000bb');
  });
});
