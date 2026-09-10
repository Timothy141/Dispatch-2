import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Service } from './types.js';

export const newId = (): string => randomUUID();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid radio confusion
const PREFIX: Record<Service, string> = { security: 'SEC', medical: 'MED', fire: 'FIR' };

/** Short human-friendly reference read out over radio/phone, e.g. MED-7KQ2M. */
export function newReference(service: Service): string {
  const bytes = randomBytes(5);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${PREFIX[service]}-${out}`;
}

export const newToken = (): string => randomBytes(24).toString('base64url');
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

export const nowIso = (): string => new Date().toISOString();
export const addSeconds = (iso: string, s: number): string => new Date(new Date(iso).getTime() + s * 1000).toISOString();
