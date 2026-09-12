import { createHash } from 'node:crypto';

export const EQUIVALENT_EARLIER_CHECKSUMS: Readonly<Record<string, readonly string[]>> = {
  '001_schema.sql': ['64fb3a1d9601104c30392e5bd687bf96d12b0d2a644cf064adca9d025b2fa99b'],
  '002_rls.sql': ['e48520dc9f722d802a860b3a13e3dc6c41903817c838bc51c6fc2e8209deb68b'],
  '003_functions.sql': ['09061b2416a927b8cb3b332b54455a14587cc82de3605a598ea27afe4159e3e0'],
  '004_schema_alignment.sql': ['bd96bf34a0193248d651f64a76002f309f4eff75db9261f9077390f574aac6cf'],
  '005_default_partition.sql': ['0d7f477940bffd8a1330e0c9406e84575363b114cadd47eb3f4107353b1e8bce'],
  '006_enrichment.sql': ['6731290e0b69271a01f901654f62f1d64f965fd2324a6c8f2b6497918a986cf8'],
};

export type ChecksumVerdict = 'match' | 'earlier-equivalent' | 'mismatch';

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function compareChecksum(file: string, recorded: string, current: string): ChecksumVerdict {
  if (recorded === current) return 'match';
  if (EQUIVALENT_EARLIER_CHECKSUMS[file]?.includes(recorded)) return 'earlier-equivalent';
  return 'mismatch';
}
