import { describe, expect, it } from 'vitest';
import { bearingDeg, etaSeconds, haversineM, stepTowards } from '../src/domain/geo.js';

const capeTown = { lat: -33.9249, lng: 18.4241 };
const stellenbosch = { lat: -33.9321, lng: 18.8602 };

describe('geo', () => {
  it('computes great-circle distance', () => {
    const d = haversineM(capeTown, stellenbosch);
    expect(d).toBeGreaterThan(39000);
    expect(d).toBeLessThan(41500);
    expect(haversineM(capeTown, capeTown)).toBe(0);
  });
  it('estimates ETA with road factor and overhead', () => {
    expect(etaSeconds(0, 45)).toBe(60);
    expect(etaSeconds(10000, 45)).toBe(Math.round((10000 * 1.3) / 12.5 + 60));
  });
  it('steps towards a target and clamps at it', () => {
    const p = stepTowards(capeTown, stellenbosch, 20000);
    expect(haversineM(capeTown, p)).toBeCloseTo(20000, -3);
    expect(stepTowards(capeTown, stellenbosch, 1e6)).toEqual(stellenbosch);
    expect(bearingDeg(capeTown, stellenbosch)).toBeGreaterThan(80);
    expect(bearingDeg(capeTown, stellenbosch)).toBeLessThan(100);
  });
});
