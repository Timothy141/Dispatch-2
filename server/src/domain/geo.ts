import type { LatLng } from './types.js';

const R = 6371000; // metres

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Initial bearing from a to b in degrees (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Move from `from` towards `to` by `metres` (clamped at destination). */
export function stepTowards(from: LatLng, to: LatLng, metres: number): LatLng {
  const d = haversineM(from, to);
  if (d <= metres || d === 0) return { ...to };
  const f = metres / d;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}

const ROAD_FACTOR = 1.3; // straight line -> road distance
const DISPATCH_OVERHEAD_S = 60; // getting moving

/** ETA estimate in seconds from a straight-line distance. */
export function etaSeconds(distanceM: number, avgSpeedKmh: number): number {
  const mps = (avgSpeedKmh * 1000) / 3600;
  return Math.round((distanceM * ROAD_FACTOR) / mps + DISPATCH_OVERHEAD_S);
}

export function isValidLatLng(p: Partial<LatLng>): p is LatLng {
  return (
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
