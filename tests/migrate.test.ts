// เทสต์ checksum ของ migration

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EQUIVALENT_EARLIER_CHECKSUMS,
  checksum,
  compareChecksum,
} from '../backend/src/db/checksums.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const current = (f: string) => checksum(readFileSync(path.join(dir, f), 'utf8'));

describe('migration checksums', () => {
  it('accepts a checksum that matches the file on disk', () => {
    for (const f of files) {
      expect(compareChecksum(f, current(f), current(f))).toBe('match');
    }
  });

  it('accepts the checksum a database recorded before comments were removed', () => {
    for (const f of files) {
      for (const earlier of EQUIVALENT_EARLIER_CHECKSUMS[f] ?? []) {
        expect(compareChecksum(f, earlier, current(f))).toBe('earlier-equivalent');
      }
    }
  });

  it('knows an earlier checksum for every migration that predates the cleanup', () => {
    const predating = files.filter((f) => f <= '006_enrichment.sql');
    expect(Object.keys(EQUIVALENT_EARLIER_CHECKSUMS).sort()).toEqual(predating);
  });

  it('does not treat the current files as the earlier ones', () => {
    for (const f of Object.keys(EQUIVALENT_EARLIER_CHECKSUMS)) {
      expect(EQUIVALENT_EARLIER_CHECKSUMS[f]).not.toContain(current(f));
    }
  });

  it('still refuses a migration that was really edited after being applied', () => {
    const f = files[0]!;
    expect(compareChecksum(f, 'f'.repeat(64), current(f))).toBe('mismatch');
  });

  it('treats CRLF and LF checkouts as the same file', () => {
    expect(checksum('a\r\nb\r\n')).toBe(checksum('a\nb\n'));
  });
});
