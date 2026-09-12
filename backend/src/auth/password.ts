import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from node:crypto.
 *
 * Deliberately not argon2 or bcrypt: those need a native build step, and an
 * appliance that has to compile a C addon on the customer's machine is an
 * appliance that fails to install. scrypt is memory-hard, in the standard
 * library, and available everywhere Node is.
 *
 * Stored form: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');

  try {
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification. Called when the email is
 * unknown, so that a wrong address and a wrong password are indistinguishable
 * from the outside.
 */
export async function dummyVerify(): Promise<void> {
  await scrypt('not-a-real-password', randomBytes(SALT_LENGTH), KEY_LENGTH, PARAMS).catch(
    () => undefined,
  );
}
