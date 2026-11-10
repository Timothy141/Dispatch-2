import type { LatLng } from '../domain/types.js';

export interface RouteEstimate {
  distanceM: number;
  durationS: number;
}

type Logger = { warn: (o: unknown, m?: string) => void };

/**
 * Road-based distance and travel time from an OSRM-compatible router
 * (ROUTER_URL, e.g. https://router.project-osrm.org for evaluation or your
 * own OSRM/Valhalla/Mapbox-compatible endpoint). Disabled when unset; the app
 * then uses straight-line estimates.
 */
export class RoutingService {
  readonly enabled: boolean;
  private readonly cache = new Map<string, { at: number; value: RouteEstimate | null }>();

  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly log: Logger = console,
    private readonly cacheMs = 30_000,
  ) {
    this.enabled = Boolean(url);
  }

  async estimate(from: LatLng, to: LatLng): Promise<RouteEstimate | null> {
    if (!this.enabled) return null;
    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.value;
    let value: RouteEstimate | null = null;
    try {
      const u = `${this.url.replace(/\/$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
      const res = await this.fetchImpl(u, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (res.ok) {
        const j = (await res.json()) as { code?: string; routes?: { distance: number; duration: number }[] };
        const r = j.routes?.[0];
        if (j.code === 'Ok' && r) value = { distanceM: Math.round(r.distance), durationS: Math.round(r.duration) };
      } else this.log.warn({ status: res.status }, 'router error');
    } catch (err) {
      this.log.warn({ err }, 'router unreachable');
    }
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 5000) this.cache.clear();
    return value;
  }
}
