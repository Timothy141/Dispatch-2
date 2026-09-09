import { randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid radio confusion

/** Short human-friendly reference read out over radio/phone, e.g. DSP-7KQ2M. */
export function newReference(prefix = 'DSP'): string {
  const bytes = randomBytes(5);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${out}`;
}

export const newToken = (): string => randomBytes(24).toString('base64url');

export const nowIso = (): string => new Date().toISOString();
