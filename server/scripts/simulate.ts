/**
 * Demo fleet: signs in a set of security / medical / fire units around a city,
 * puts them online, accepts offers and "drives" to the incident.
 *
 *   npm run simulate                       # Cape Town fleet
 *   BASE_URL=https://host npm run simulate
 *   CENTER_LAT=-26.2041 CENTER_LNG=28.0473 npm run simulate   # Johannesburg
 */
import { stepTowards, haversineM, bearingDeg } from '../src/domain/geo.js';

const base = process.env.BASE_URL ?? 'http://localhost:8080';
const center = { lat: Number(process.env.CENTER_LAT ?? -33.9249), lng: Number(process.env.CENTER_LNG ?? 18.4241) };
const TICK_MS = 2000;
const SPEED_M_PER_TICK = Number(process.env.SIM_SPEED_M ?? 350); // ~630 km/h demo speed so arrivals take ~30s
const ON_SCENE_MS = 12000;

type Unit = { unit: string; service: 'security' | 'medical' | 'fire'; vehicle: string; org: string; token?: string; pos: { lat: number; lng: number }; arrivedAt?: number };

const jitter = (km: number) => ({ lat: center.lat + ((Math.random() - 0.5) * km) / 111, lng: center.lng + ((Math.random() - 0.5) * km) / 92 });

const fleet: Unit[] = [
  { unit: 'SEC-Alpha 1', service: 'security', vehicle: 'Ranger CA 412-981', org: 'Alpha Armed Response', pos: jitter(6) },
  { unit: 'SEC-Alpha 2', service: 'security', vehicle: 'Hilux CA 118-220', org: 'Alpha Armed Response', pos: jitter(6) },
  { unit: 'SEC-Bravo 7', service: 'security', vehicle: 'Polo CA 903-114', org: 'Bravo Tactical', pos: jitter(8) },
  { unit: 'MED-Echo 3', service: 'medical', vehicle: 'Ambulance CA 771-005', org: 'Echo Medical Response', pos: jitter(6) },
  { unit: 'MED-Echo 5', service: 'medical', vehicle: 'Response bike CA 002-118', org: 'Echo Medical Response', pos: jitter(6) },
  { unit: 'FIRE-Engine 12', service: 'fire', vehicle: 'Pumper 12', org: 'City Fire & Rescue', pos: jitter(8) },
  { unit: 'FIRE-Rapid 4', service: 'fire', vehicle: 'Rapid intervention 4', org: 'City Fire & Rescue', pos: jitter(8) },
];

async function api<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message ?? ''}`);
  return json;
}

for (const [i, u] of fleet.entries()) {
  const phone = `+2783000${String(i).padStart(4, '0')}`;
  const { token } = await api<{ token: string }>('POST', '/api/auth/login', undefined, { role: 'responder', name: `${u.unit} crew`, phone });
  u.token = token;
  await api('PUT', '/api/responders/me', token, { service: u.service, unitName: u.unit, vehicle: u.vehicle, organisation: u.org });
  await api('POST', '/api/responders/me/location', token, { lat: u.pos.lat, lng: u.pos.lng });
  await api('POST', '/api/responders/me/status', token, { status: 'available' }).catch(() => undefined);
  console.log(`online  ${u.unit.padEnd(16)} ${u.service.padEnd(8)} @ ${u.pos.lat.toFixed(4)},${u.pos.lng.toFixed(4)}`);
}
console.log(`\n${fleet.length} units online at ${base}. Open the app, sign in as "I need help" and request a service.\n`);

type Me = { activeJob: null | { id: string; reference: string; status: string; lat: number; lng: number }; offers: { offer: { id: string; distanceM: number }; request: { reference: string } }[] };

async function tickUnit(u: Unit) {
  const me = await api<Me>('GET', '/api/responders/me', u.token);
  if (!me.activeJob && me.offers.length) {
    const o = me.offers[0];
    console.log(`accept  ${u.unit.padEnd(16)} ${o.request.reference} (${(o.offer.distanceM / 1000).toFixed(1)} km)`);
    await api('POST', `/api/offers/${o.offer.id}/accept`, u.token).catch((e) => console.log(`        ${e.message}`));
    return;
  }
  const job = me.activeJob;
  if (!job) return;
  if (job.status === 'assigned') {
    await api('POST', `/api/requests/${job.id}/progress`, u.token, { status: 'en_route' });
    console.log(`enroute ${u.unit.padEnd(16)} ${job.reference}`);
    return;
  }
  if (job.status === 'en_route') {
    const target = { lat: job.lat, lng: job.lng };
    const heading = bearingDeg(u.pos, target);
    u.pos = stepTowards(u.pos, target, SPEED_M_PER_TICK);
    await api('POST', '/api/responders/me/location', u.token, { lat: u.pos.lat, lng: u.pos.lng, heading });
    if (haversineM(u.pos, target) < 25) {
      await api('POST', `/api/requests/${job.id}/progress`, u.token, { status: 'arrived' });
      u.arrivedAt = Date.now();
      console.log(`arrived ${u.unit.padEnd(16)} ${job.reference}`);
    }
    return;
  }
  if (job.status === 'arrived' && u.arrivedAt && Date.now() - u.arrivedAt > ON_SCENE_MS) {
    await api('POST', `/api/requests/${job.id}/progress`, u.token, { status: 'completed', note: 'Scene handled (simulated)' });
    u.arrivedAt = undefined;
    console.log(`done    ${u.unit.padEnd(16)} ${job.reference}`);
  }
}

setInterval(() => {
  for (const u of fleet) tickUnit(u).catch((e) => console.log(`error   ${u.unit}: ${e.message}`));
}, TICK_MS);
