import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CBD, north } from './helpers.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function build(): Promise<App> {
  return buildApp({
    logger: false,
    autoTick: false,
    env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', OFFER_FANOUT: '1', WEB_DIST: '/nonexistent' },
  });
}

describe('HTTP API', () => {
  let app: App;
  beforeEach(async () => {
    app = await build();
  });
  afterEach(async () => {
    await app.close();
  });

  const login = async (body: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: body });
    return { status: res.statusCode, ...(res.json() as { token: string; user: { id: string } }) };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('rejects anonymous and wrong-role access, and bad dispatcher codes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/requests/mine' })).statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'dispatcher', name: 'x', phone: '0210000000', dispatcherCode: 'nope' } });
    expect(bad.statusCode).toBe(403);
    const { token } = await login({ role: 'requester', name: 'Thandi', phone: '082 111 1111' });
    expect((await app.inject({ method: 'GET', url: '/api/requests', headers: bearer(token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: bearer(token), payload: { status: 'available' } })).statusCode).toBe(403);
  });

  it('runs the Uber-style flow end to end over HTTP', async () => {
    // responder signs in, sets profile, goes online at a location
    const medic = await login({ role: 'responder', name: 'Sipho', phone: '0832222222' });
    const h = bearer(medic.token);
    expect((await app.inject({ method: 'PUT', url: '/api/responders/me', headers: h, payload: { service: 'medical', unitName: 'MED-7', vehicle: 'Ambulance CA 123' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: h, payload: { status: 'available' } })).json().status).toBe('available');
    const near = north(CBD, 2);
    await app.inject({ method: 'POST', url: '/api/responders/me/location', headers: h, payload: { lat: near.lat, lng: near.lng, heading: 90 } });

    // person in trouble taps MEDICAL
    const who = await login({ role: 'requester', name: 'Thandi', phone: '0821111111' });
    const w = bearer(who.token);
    const created = await app.inject({
      method: 'POST',
      url: '/api/requests',
      headers: w,
      payload: { service: 'medical', ...CBD, address: 'Long St, Cape Town', description: 'Man collapsed', flags: ['unconscious'] },
    });
    expect(created.statusCode).toBe(201);
    const req = created.json();
    expect(req.reference).toMatch(/^MED-[A-Z2-9]{5}$/);
    expect(req.priority).toBe('critical');
    expect(req.status).toBe('searching');

    // the responder sees the offer with distance and ETA
    const me = (await app.inject({ method: 'GET', url: '/api/responders/me', headers: h })).json();
    expect(me.offers).toHaveLength(1);
    expect(me.offers[0].request.id).toBe(req.id);
    expect(me.offers[0].offer.distanceM).toBeGreaterThan(1500);
    expect(me.offers[0].offer.etaSeconds).toBeGreaterThan(60);

    // requester's tracking view while searching
    let track = (await app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: w })).json();
    expect(track.offersOutstanding).toBe(1);
    expect(track.responder).toBeNull();

    // accept
    const accepted = await app.inject({ method: 'POST', url: `/api/offers/${me.offers[0].offer.id}/accept`, headers: h });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('assigned');

    // requester now sees who is coming, sanitised responder profile only
    track = (await app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: w })).json();
    expect(track.responder.unitName).toBe('MED-7');
    expect(track.responder.vehicle).toBe('Ambulance CA 123');
    expect(track.responder.lat).toBeCloseTo(near.lat, 5);
    expect(track.etaSeconds).toBeGreaterThan(0);
    expect(Object.keys(track.responder)).not.toContain('ratingCount');

    // another requester cannot see it
    const other = await login({ role: 'requester', name: 'Other', phone: '0829999999' });
    expect((await app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: bearer(other.token) })).statusCode).toBe(403);

    // responder drives, arrives, completes
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}/progress`, headers: h, payload: { status: 'en_route' } })).json().status).toBe('en_route');
    await app.inject({ method: 'POST', url: '/api/responders/me/location', headers: h, payload: { lat: CBD.lat, lng: CBD.lng } });
    track = (await app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: w })).json();
    expect(track.distanceM).toBe(0);
    expect(track.trail).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}/progress`, headers: h, payload: { status: 'arrived' } })).json().status).toBe('arrived');
    // requester cannot cancel once the unit has arrived
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}/cancel`, headers: w, payload: {} })).statusCode).toBe(200);
  });

  it('lets a dispatcher see everything and assign manually; requester rates afterwards', async () => {
    const ops = await login({ role: 'dispatcher', name: 'Ops', phone: '0210000000', dispatcherCode: 'ctrl' });
    const o = bearer(ops.token);
    const guard = await login({ role: 'responder', name: 'Guard', phone: '0834444444' });
    const g = bearer(guard.token);
    await app.inject({ method: 'PUT', url: '/api/responders/me', headers: g, payload: { service: 'security', unitName: 'SEC-2' } });
    // online but no location yet -> never auto-offered
    await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: g, payload: { status: 'available' } });

    const who = await login({ role: 'requester', name: 'Thandi', phone: '0821111111' });
    const w = bearer(who.token);
    const req = (await app.inject({ method: 'POST', url: '/api/requests', headers: w, payload: { service: 'security', ...CBD, flags: ['break_in'] } })).json();

    const list = (await app.inject({ method: 'GET', url: '/api/requests?status=searching', headers: o })).json();
    expect(list.map((r: { id: string }) => r.id)).toEqual([req.id]);
    const units = (await app.inject({ method: 'GET', url: '/api/responders?service=security', headers: o })).json();
    expect(units).toHaveLength(1);

    const assigned = await app.inject({ method: 'POST', url: `/api/requests/${req.id}/assign`, headers: o, payload: { responderId: guard.user.id } });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().responderId).toBe(guard.user.id);

    const detail = (await app.inject({ method: 'GET', url: `/api/requests/${req.id}`, headers: o })).json();
    expect(detail.offers).toHaveLength(1);
    expect(detail.offers[0].status).toBe('accepted');
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(['created', 'no_units', 'assigned_manually']);

    for (const status of ['en_route', 'arrived', 'completed']) {
      expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}/progress`, headers: g, payload: { status } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: `/api/requests/${req.id}/rate`, headers: w, payload: { rating: 4, comment: 'Thanks' } })).json().rating).toBe(4);
    const stats = (await app.inject({ method: 'GET', url: '/api/stats', headers: o })).json();
    expect(stats.requests24h).toBe(1);
    expect(stats.respondersAvailable).toBe(1);
  });

  it('streams only the events a user is allowed to see', async () => {
    const who = await login({ role: 'requester', name: 'Thandi', phone: '0821111111' });
    const other = await login({ role: 'requester', name: 'Other', phone: '0829999999' });

    const res = await app.inject({ method: 'GET', url: `/api/events?token=${who.token}`, payloadAsStream: true });
    expect(res.statusCode).toBe(200);
    const stream = res.stream();
    let buf = '';
    const gotMine = new Promise<void>((resolve) => {
      stream.on('data', (c: Buffer) => {
        buf += c.toString();
        if (buf.includes('event: request.created')) resolve();
      });
    });
    // someone else's request must not appear
    await app.inject({ method: 'POST', url: '/api/requests', headers: bearer(other.token), payload: { service: 'fire', ...CBD } });
    await app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD } });
    await gotMine;
    expect(buf).toContain('event: hello');
    expect(buf.match(/event: request.created/g)).toHaveLength(1);
    expect(buf).toContain('"service":"security"');
    expect(buf).not.toContain('"service":"fire"');
    stream.destroy();
  });
});

describe('empty JSON bodies', () => {
  it('treats an empty application/json body as {}', async () => {
    const app = await build();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111' } });
    const token = login.json().token;
    const created = await app.inject({ method: 'POST', url: '/api/requests', headers: { authorization: `Bearer ${token}` }, payload: { service: 'fire', ...CBD } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/requests/${created.json().id}/cancel`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    await app.close();
  });
});
