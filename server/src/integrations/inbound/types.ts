import type { NormalizedAlert } from '../../domain/types.js';

export interface InboundAdapter {
  /** URL slug: POST /api/webhooks/<source> */
  readonly source: string;
  /**
   * Convert a raw webhook body into zero or more normalized alerts.
   * Throw an Error with a helpful message for malformed payloads.
   */
  parse(body: unknown, headers: Record<string, string | string[] | undefined>): NormalizedAlert[];
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}

// ---- shared helpers -------------------------------------------------------

export function pick(obj: unknown, paths: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const path of paths) {
    let cur: unknown = obj;
    for (const part of path.split('.')) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

export const asString = (v: unknown): string | null =>
  v === undefined || v === null ? null : String(v);

/** Accepts 0-1 floats, 0-100 percentages or "95%" strings. Returns 0-1. */
export function asConfidence(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  let n = typeof v === 'string' ? Number.parseFloat(v.replace('%', '')) : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

export function asIsoDate(v: unknown, fallback: Date = new Date()): string {
  if (v === undefined || v === null) return fallback.toISOString();
  if (typeof v === 'number') {
    // seconds vs milliseconds
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}
