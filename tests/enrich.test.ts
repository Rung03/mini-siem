// เทสต์ enrichment: event ต้องไม่หายแม้ GeoIP หรือ DNS มีปัญหา

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyIp,
  enrichBatch,
  hostnameFor,
  resetRdnsCache,
  setGeoProvider,
  setResolver,
} from '../backend/src/enrich/index.js';
import type { GeoProvider } from '../backend/src/enrich/geoip.js';
import { normalize } from '../backend/src/normalize/index.js';
import type { CanonicalEvent } from '../backend/src/normalize/schema.js';

function eventFor(ip: string): CanonicalEvent {
  return normalize('generic', {
    raw: JSON.stringify({ user: 'alice', ip, action: 'login', result: 'failed' }),
    receivedAt: new Date(),
  });
}

const stubGeo: GeoProvider = {
  available: true,
  description: 'stub',
  lookup: (ip) =>
    ip === '8.8.8.8'
      ? {
          countryIso: 'US',
          country: 'United States',
          city: 'Mountain View',
          latitude: 37.386,
          longitude: -122.084,
          asn: 15169,
          asOrg: 'Google LLC',
        }
      : null,
};

beforeEach(() => {
  resetRdnsCache();
  setGeoProvider(null);
  setResolver(async () => {
    throw new Error('no resolver configured for this test');
  });
});

afterEach(() => {
  resetRdnsCache();
  setGeoProvider(null);
  setResolver(null);
});

describe('address classification', () => {
  it.each([
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['8.8.8.8', 'public'],
    ['::1', 'loopback'],
    ['fd00::1', 'private'],
    ['2001:4860:4860::8888', 'public'],
    ['::ffff:10.0.0.1', 'private'],
  ])('%s is %s', (ip, expected) => {
    expect(classifyIp(ip)).toBe(expected);
  });

  it('treats the RFC5737 documentation ranges as reserved', () => {
    expect(classifyIp('203.0.113.66')).toBe('reserved');
    expect(classifyIp('198.51.100.23')).toBe('reserved');
    expect(classifyIp('192.0.2.31')).toBe('reserved');
  });

  it('returns null for something that is not an address', () => {
    expect(classifyIp('cloudformation.amazonaws.com')).toBeNull();
    expect(classifyIp(null)).toBeNull();
  });
});

describe('geo enrichment', () => {
  it('fills in the location of a public address', () => {
    setGeoProvider(stubGeo);
    const [event] = enrichBatch([eventFor('8.8.8.8')]);

    expect(event!.geoCountryIso).toBe('US');
    expect(event!.geoCountry).toBe('United States');
    expect(event!.geoCity).toBe('Mountain View');
    expect(event!.asn).toBe(15169);
    expect(event!.asOrg).toBe('Google LLC');
    expect(event!.tags).toContain('geo:US');
    expect(event!.tags).toContain('public-ip');
  });

  it('does not geolocate a private address', () => {
    setGeoProvider(stubGeo);
    const [event] = enrichBatch([eventFor('10.0.0.44')]);

    expect(event!.geoCountryIso).toBeNull();
    expect(event!.tags).toContain('private-ip');
    expect(event!.tags).not.toContain('geo:US');
  });

  it('leaves the event intact when no database is loaded', () => {
    const [event] = enrichBatch([eventFor('8.8.8.8')]);

    expect(event!.geoCountryIso).toBeNull();
    expect(event!.userName).toBe('alice');
    expect(event!.srcIp).toBe('8.8.8.8');
    expect(event!.parseOk).toBe(true);
  });

  it('keeps the event when the provider throws', () => {
    setGeoProvider({
      available: true,
      description: 'broken',
      lookup: () => {
        throw new Error('corrupt database');
      },
    });

    const events = enrichBatch([eventFor('8.8.8.8')]);

    expect(events).toHaveLength(1);
    expect(events[0]!.srcIp).toBe('8.8.8.8');
    expect(events[0]!.geoCountryIso).toBeNull();
  });

  it('does not lose the other events in a batch', () => {
    let call = 0;
    setGeoProvider({
      available: true,
      description: 'flaky',
      lookup: () => {
        call++;
        if (call === 2) throw new Error('boom');
        return {
          countryIso: 'TH', country: 'Thailand', city: null,
          latitude: null, longitude: null, asn: null, asOrg: null,
        };
      },
    });

    const events = enrichBatch([eventFor('1.1.1.1'), eventFor('8.8.4.4'), eventFor('9.9.9.9')]);

    expect(events).toHaveLength(3);
    expect(events[0]!.geoCountryIso).toBe('TH');
    expect(events[1]!.geoCountryIso).toBeNull();
    expect(events[2]!.geoCountryIso).toBe('TH');
  });
});

describe('reverse DNS', () => {
  it('returns null on the first sight of an address, then caches it', async () => {
    setResolver(async (ip) => (ip === '10.0.0.44' ? ['ws-114.corp.local'] : []));

    expect(hostnameFor('10.0.0.44')).toBeNull();

    await new Promise((r) => setTimeout(r, 20));

    expect(hostnameFor('10.0.0.44')).toBe('ws-114.corp.local');
  });

  it('applies the cached hostname to an event', async () => {
    setResolver(async () => ['dc01.corp.local']);
    hostnameFor('10.0.0.9');
    await new Promise((r) => setTimeout(r, 20));

    const [event] = enrichBatch([eventFor('10.0.0.9')]);
    expect(event!.srcHostname).toBe('dc01.corp.local');
  });

  it('caches a failure so it is not retried on every packet', async () => {
    let calls = 0;
    setResolver(async () => {
      calls++;
      throw new Error('ENOTFOUND');
    });

    hostnameFor('10.9.9.9');
    await new Promise((r) => setTimeout(r, 20));
    hostnameFor('10.9.9.9');
    hostnameFor('10.9.9.9');
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toBe(1);
  });

  it('never blocks, even when the resolver hangs forever', async () => {
    setResolver(() => new Promise<string[]>(() => {}));

    const started = Date.now();
    const [event] = enrichBatch([eventFor('10.0.0.77')]);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(50);
    expect(event!.srcHostname).toBeNull();
    expect(event!.srcIp).toBe('10.0.0.77');
  });
});

describe('enrichment never changes the shape of a batch', () => {
  it('returns every event it was given', () => {
    setGeoProvider(stubGeo);
    const input = [eventFor('8.8.8.8'), eventFor('10.0.0.1'), eventFor('not-an-ip')];
    expect(enrichBatch(input)).toHaveLength(3);
  });

  it('leaves raw untouched', () => {
    setGeoProvider(stubGeo);
    const event = eventFor('8.8.8.8');
    const before = event.raw;
    enrichBatch([event]);
    expect(event.raw).toBe(before);
  });
});
