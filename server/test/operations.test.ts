import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildSummary, toCsv } from '../src/routes/adminRoutes.js';
import { CBD, north } from './helpers.js';

type App = Awaited<ReturnType<typeof buildApp>>;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function setup(extra: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const app = await buildApp({ logger: false, autoTick: false, fetchImpl, env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', OFFER_FANOUT: '3', WEB_DIST: '/nonexistent', ...extra } });
  const login = async (b: Record<string, unknown>) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json() as { token: string; user: { id: string } };
  const ops = await login({ role: 'dispatcher', name: 'Ops', phone: '0210000000', dispatcherCode: 'ctrl' });
  const unit = async (name: string, phone: string, service = 'security', at = north(CBD, 2), joinCode?: string) => {
    const u = await login({ role: 'responder', name: `${name} crew`, phone });
    const h = bearer(u.token);
    const prof = await app.inject({ method: 'PUT', url: '/api/responders/me', headers: h, payload: { service, unitName: name, joinCode } });
    await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: h, payload: { status: 'available' } });
    await app.inject({ method: 'POST', url: '/api/responders/me/location', headers: h, payload: at });
    return { ...u, h, profileStatus: prof.statusCode, profile: prof.json() };
  };
  return { app, login, ops, o: bearer(ops.token), unit };
}

describe('organisations, join codes and coverage', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });
  afterEach(async () => {
    await s.app.close();
  });

  it('creates an organisation with a join code that units use to join', async () => {
    const org = await s.app.inject({ method: 'POST', url: '/api/admin/organisations', headers: s.o, payload: { name: 'Alpha Armed Response', services: ['security'], contactPhone: '021 555 0000' } });
    expect(org.statusCode).toBe(201);
    expect(org.json().joinCode).toMatch(/^ALPHA-[A-Z2-9]{4}$/);

    const u = await s.unit('SEC-1', '0831111111', 'security', north(CBD, 1), org.json().joinCode);
    expect(u.profileStatus).toBe(200);
    expect(u.profile.organisationId).toBe(org.json().id);
    expect(u.profile.organisation).toBe('Alpha Armed Response');

    const wrongService = await s.unit('MED-1', '0832222222', 'medical', north(CBD, 1), org.json().joinCode);
    expect(wrongService.profileStatus).toBe(409);
    const badCode = await s.unit('SEC-2', '0833333333', 'security', north(CBD, 1), 'NOPE-0000');
    expect(badCode.profileStatus).toBe(404);

    const list = (await s.app.inject({ method: 'GET', url: '/api/admin/organisations', headers: s.o })).json();
    expect(list[0].unitCount).toBe(1);
  });

  it('only offers jobs to units whose organisation covers the incident, and never to deactivated units', async () => {
    const covered = (await s.app.inject({ method: 'POST', url: '/api/admin/organisations', headers: s.o, payload: { name: 'City Guard', coverage: { ...CBD, radiusKm: 5 } } })).json();
    const farAway = (await s.app.inject({ method: 'POST', url: '/api/admin/organisations', headers: s.o, payload: { name: 'Northern Response', coverage: { ...north(CBD, 60), radiusKm: 5 } } })).json();
    const inCover = await s.unit('CITY-1', '0831111111', 'security', north(CBD, 3), covered.joinCode);
    const outOfCover = await s.unit('NORTH-1', '0832222222', 'security', north(CBD, 1), farAway.joinCode); // physically closest, but its org does not cover the CBD
    const independent = await s.unit('FREE-1', '0833333333', 'security', north(CBD, 4));
    const deactivated = await s.unit('OLD-1', '0834444444', 'security', north(CBD, 0.5));
    const patch = await s.app.inject({ method: 'PATCH', url: `/api/admin/units/${deactivated.user.id}`, headers: s.o, payload: { active: false } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().active).toBe(false);
    expect(patch.json().status).toBe('offline');
    expect((await s.app.inject({ method: 'POST', url: '/api/responders/me/status', headers: deactivated.h, payload: { status: 'available' } })).statusCode).toBe(409);

    const who = await s.login({ role: 'requester', name: 'T', phone: '0821111111' });
    const req = (await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD } })).json();
    const offers = (await s.app.inject({ method: 'GET', url: `/api/requests/${req.id}`, headers: s.o })).json().offers;
    expect(offers.map((o: { responderId: string }) => o.responderId).sort()).toEqual([inCover.user.id, independent.user.id].sort());
    expect(offers.map((o: { responderId: string }) => o.responderId)).not.toContain(outOfCover.user.id);

    // pausing an organisation removes its units from matching
    await s.app.inject({ method: 'PATCH', url: `/api/admin/organisations/${covered.id}`, headers: s.o, payload: { active: false } });
    const who2 = await s.login({ role: 'requester', name: 'U', phone: '0822222222' });
    const req2 = (await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who2.token), payload: { service: 'security', ...north(CBD, 0.2) } })).json();
    const offers2 = (await s.app.inject({ method: 'GET', url: `/api/requests/${req2.id}`, headers: s.o })).json().offers;
    expect(offers2.map((o: { responderId: string }) => o.responderId)).toEqual([independent.user.id]);
  });

  it('refuses to deactivate a unit that is on a job and lets ops move a unit between organisations', async () => {
    const org = (await s.app.inject({ method: 'POST', url: '/api/admin/organisations', headers: s.o, payload: { name: 'Bravo' } })).json();
    const u = await s.unit('SEC-1', '0831111111');
    const who = await s.login({ role: 'requester', name: 'T', phone: '0821111111' });
    const req = (await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD } })).json();
    const offer = (await s.app.inject({ method: 'GET', url: '/api/responders/me', headers: u.h })).json().offers[0].offer;
    await s.app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: u.h });
    expect((await s.app.inject({ method: 'PATCH', url: `/api/admin/units/${u.user.id}`, headers: s.o, payload: { active: false } })).statusCode).toBe(409);
    const moved = await s.app.inject({ method: 'PATCH', url: `/api/admin/units/${u.user.id}`, headers: s.o, payload: { organisationId: org.id, unitName: 'BRAVO-1' } });
    expect(moved.json().organisation).toBe('Bravo');
    expect(moved.json().unitName).toBe('BRAVO-1');
    expect(req.status).toBe('searching');
  });
});

describe('reports', () => {
  it('summarises response times by service and unit and exports CSV', async () => {
    const s = await setup();
    const u = await s.unit('SEC-1', '0831111111');
    const who = await s.login({ role: 'requester', name: 'Thandi', phone: '0821111111' });
    const req = (await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD, address: 'Long St, "The Corner"', flags: ['armed'] } })).json();
    const offer = (await s.app.inject({ method: 'GET', url: '/api/responders/me', headers: u.h })).json().offers[0].offer;
    await s.app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: u.h });
    for (const status of ['en_route', 'arrived', 'completed']) await s.app.inject({ method: 'POST', url: `/api/requests/${req.id}/progress`, headers: u.h, payload: { status } });
    await s.app.inject({ method: 'POST', url: `/api/requests/${req.id}/rate`, headers: bearer(who.token), payload: { rating: 4 } });

    const summary = (await s.app.inject({ method: 'GET', url: '/api/reports/summary', headers: s.o })).json();
    expect(summary.total).toBe(1);
    const sec = summary.byService.find((x: { service: string }) => x.service === 'security');
    expect(sec.completed).toBe(1);
    expect(sec.avgAcceptSeconds).toBeGreaterThanOrEqual(0);
    expect(sec.avgArrivalSeconds).toBeGreaterThanOrEqual(0);
    expect(summary.byUnit[0]).toMatchObject({ unitName: 'SEC-1', jobs: 1, completed: 1, avgRating: 4 });

    const csv = await s.app.inject({ method: 'GET', url: '/api/reports/incidents.csv', headers: s.o });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('reference,service,priority,status')).toBe(true);
    expect(lines[1]).toContain(req.reference);
    expect(lines[1]).toContain('"Long St, ""The Corner"""');
    expect(lines[1]).toContain('SEC-1');

    // outside the window -> empty
    const empty = (await s.app.inject({ method: 'GET', url: '/api/reports/summary?from=2020-01-01&to=2020-01-02', headers: s.o })).json();
    expect(empty.total).toBe(0);
    expect((await s.app.inject({ method: 'GET', url: '/api/reports/summary?from=garbage', headers: s.o })).statusCode).toBe(400);
    await s.app.close();
  });

  it('computes p90 and handles missing timestamps', () => {
    const base = { id: '', reference: '', requesterId: '', requesterName: '', requesterPhone: '', service: 'medical' as const, priority: 'urgent' as const, lat: 0, lng: 0, address: null, description: null, flags: [], responderId: 'u1', etaSeconds: null, updatedAt: '', enRouteAt: null, completedAt: null, cancelledAt: null, cancelReason: null, rating: null, ratingComment: null, searchStartedAt: '', source: 'app' as const, createdBy: null };
    const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ ...base, status: 'completed' as const, createdAt: at(0), assignedAt: at(10), arrivedAt: at(n * 60) }));
    rows.push({ ...base, status: 'cancelled' as const, createdAt: at(0), assignedAt: null, arrivedAt: null });
    const sum = buildSummary(rows, new Map([['u1', 'MED-1']]));
    const med = sum.byService.find((x) => x.service === 'medical')!;
    expect(med.total).toBe(11);
    expect(med.cancelled).toBe(1);
    expect(med.avgAcceptSeconds).toBe(10);
    expect(med.p90ArrivalSeconds).toBe(600);
    expect(sum.byUnit[0].jobs).toBe(11);
    expect(toCsv(rows.slice(0, 1), new Map()).split('\n')[1]).toContain(',u1,');
  });
});

describe('road-based ETAs', () => {
  it('refines the ETA from the router after assignment and on location updates', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 4200, duration: 540 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const s = await setup({ ROUTER_URL: 'https://router.example' }, fetchImpl);
    const u = await s.unit('SEC-1', '0831111111');
    const who = await s.login({ role: 'requester', name: 'T', phone: '0821111111' });
    const req = (await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD } })).json();
    const offer = (await s.app.inject({ method: 'GET', url: '/api/responders/me', headers: u.h })).json().offers[0].offer;
    const assigned = (await s.app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: u.h })).json();
    expect(assigned.etaSeconds).toBeLessThan(600); // straight-line first
    await s.app.ctx.dispatch.flushRouting();
    expect(calls[0]).toMatch(/^https:\/\/router\.example\/route\/v1\/driving\/18\.\d+,-33\.\d+;18\.\d+,-33\.\d+\?overview=false$/);
    const after = (await s.app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: bearer(who.token) })).json();
    expect(after.request.etaSeconds).toBe(600); // 540 s routed + 60 s overhead
    await s.app.close();
  });

  it('falls back silently when the router fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const s = await setup({ ROUTER_URL: 'https://router.example' }, fetchImpl);
    const u = await s.unit('SEC-1', '0831111111');
    const who = await s.login({ role: 'requester', name: 'T', phone: '0821111111' });
    await s.app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD } });
    const offer = (await s.app.inject({ method: 'GET', url: '/api/responders/me', headers: u.h })).json().offers[0].offer;
    const assigned = (await s.app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: u.h })).json();
    await s.app.ctx.dispatch.flushRouting();
    const track = (await s.app.inject({ method: 'GET', url: `/api/requests/${assigned.id}/track`, headers: bearer(who.token) })).json();
    expect(track.request.etaSeconds).toBe(assigned.etaSeconds);
    await s.app.close();
  });
});

describe('off-site backups', () => {
  it('uploads each backup with an AWS SigV4 signed PUT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dispatch-s3-'));
    const puts: { url: string; headers: Record<string, string>; bytes: number }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      puts.push({ url: String(url), headers: init!.headers as Record<string, string>, bytes: (init!.body as Buffer).length });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const app = await buildApp({
      logger: false,
      autoTick: false,
      fetchImpl,
      env: { DATABASE_PATH: join(dir, 'live.db'), BACKUP_DIR: join(dir, 'b'), DISPATCHER_CODE: 'ctrl', WEB_DIST: '/nonexistent', S3_ENDPOINT: 'https://s3.eu-west-1.amazonaws.com', S3_BUCKET: 'my-bucket', S3_REGION: 'eu-west-1', S3_ACCESS_KEY: 'AKIAEXAMPLE', S3_SECRET_KEY: 'secret', S3_PREFIX: 'dispatch' },
    });
    const ops = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'dispatcher', name: 'O', phone: '0210000000', dispatcherCode: 'ctrl' } })).json().token;
    const r = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: bearer(ops) });
    expect(r.statusCode).toBe(200);
    await app.ctx.backups.flush();
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toMatch(/^https:\/\/s3\.eu-west-1\.amazonaws\.com\/my-bucket\/dispatch\/dispatch-\d{8}-\d{6}\.db$/);
    expect(puts[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(puts[0].headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(puts[0].bytes).toBe(r.json().bytes);
    const status = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: bearer(ops) })).json();
    expect(status.offsite).toBe(true);
    expect(status.lastUpload.key).toMatch(/^my-bucket\/dispatch\//);
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
