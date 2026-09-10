import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { matches, sign } from '../src/services/webhookService.js';
import { CBD, north } from './helpers.js';

type App = Awaited<ReturnType<typeof buildApp>>;

function makeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('ok', { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('agent call-outs and integrations', () => {
  let app: App;
  let hooks: ReturnType<typeof makeFetch>;
  beforeEach(async () => {
    hooks = makeFetch();
    app = await buildApp({
      logger: false,
      autoTick: false,
      fetchImpl: hooks.fetchImpl,
      awaitWebhooks: true,
      env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', OFFER_FANOUT: '1', WEB_DIST: '/nonexistent', WEBHOOK_MAX_ATTEMPTS: '2' },
    });
  });
  afterEach(async () => {
    await app.close();
  });

  const login = async (body: Record<string, unknown>) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: body })).json() as { token: string; user: { id: string } };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  async function onlineUnit(service: string, unit: string, phone: string, at = north(CBD, 2)) {
    const u = await login({ role: 'responder', name: `${unit} crew`, phone });
    const h = bearer(u.token);
    await app.inject({ method: 'PUT', url: '/api/responders/me', headers: h, payload: { service, unitName: unit } });
    await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: h, payload: { status: 'available' } });
    await app.inject({ method: 'POST', url: '/api/responders/me/location', headers: h, payload: at });
    return { ...u, h };
  }

  it('lets an agent create a manual call-out and send it straight to a chosen officer', async () => {
    const ops = await login({ role: 'dispatcher', name: 'Agent', phone: '0210000000', dispatcherCode: 'ctrl' });
    const near = await onlineUnit('security', 'SEC-1', '0831111111', north(CBD, 1));
    const chosen = await onlineUnit('security', 'SEC-9', '0832222222', north(CBD, 9));

    const res = await app.inject({
      method: 'POST',
      url: '/api/callouts',
      headers: bearer(ops.token),
      payload: {
        service: 'security',
        contactName: 'Mrs Naidoo',
        contactPhone: '083 555 0000',
        lat: CBD.lat,
        lng: CBD.lng,
        address: '12 Long St',
        description: 'Caller reports two men at her gate',
        flags: ['in_progress'],
        responderId: chosen.user.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const req = res.json();
    expect(req.source).toBe('agent');
    expect(req.createdBy).toBe(ops.user.id);
    expect(req.status).toBe('assigned');
    expect(req.responderId).toBe(chosen.user.id); // not the nearest one: the agent chose
    expect(req.priority).toBe('urgent');
    expect(req.requesterName).toBe('Mrs Naidoo');

    // the chosen officer sees it as their active job; the nearer unit was never asked
    const me = (await app.inject({ method: 'GET', url: '/api/responders/me', headers: chosen.h })).json();
    expect(me.activeJob.id).toBe(req.id);
    expect(me.responder.status).toBe('busy');
    const other = (await app.inject({ method: 'GET', url: '/api/responders/me', headers: near.h })).json();
    expect(other.offers).toHaveLength(0);

    // the caller can sign in with the same number and track the unit
    const caller = await login({ role: 'requester', name: 'Mrs Naidoo', phone: '0835550000' });
    const track = await app.inject({ method: 'GET', url: `/api/requests/${req.id}/track`, headers: bearer(caller.token) });
    expect(track.statusCode).toBe(200);
    expect(track.json().responder.unitName).toBe('SEC-9');

    // refuses a busy officer and a unit of the wrong service
    const again = await app.inject({ method: 'POST', url: '/api/callouts', headers: bearer(ops.token), payload: { service: 'security', contactName: 'X', contactPhone: '0830000001', ...CBD, responderId: chosen.user.id } });
    expect(again.statusCode).toBe(409);
    const wrong = await app.inject({ method: 'POST', url: '/api/callouts', headers: bearer(ops.token), payload: { service: 'medical', contactName: 'X', contactPhone: '0830000002', ...CBD, responderId: near.user.id } });
    expect(wrong.statusCode).toBe(409);
  });

  it('falls back to automatic matching when the agent does not pick an officer', async () => {
    const ops = await login({ role: 'dispatcher', name: 'Agent', phone: '0210000000', dispatcherCode: 'ctrl' });
    const unit = await onlineUnit('fire', 'FIRE-1', '0833333333');
    const res = await app.inject({ method: 'POST', url: '/api/callouts', headers: bearer(ops.token), payload: { service: 'fire', contactName: 'Mr K', contactPhone: '0830000003', ...CBD } });
    expect(res.json().status).toBe('searching');
    const me = (await app.inject({ method: 'GET', url: '/api/responders/me', headers: unit.h })).json();
    expect(me.offers).toHaveLength(1);
  });

  it('issues API keys that other systems use to create and read call-outs, scoped and revocable', async () => {
    const ops = await login({ role: 'dispatcher', name: 'Agent', phone: '0210000000', dispatcherCode: 'ctrl' });
    await onlineUnit('medical', 'MED-1', '0834444444');

    const created = await app.inject({ method: 'POST', url: '/api/integrations/keys', headers: bearer(ops.token), payload: { name: 'Alarm panel bridge', scopes: ['requests:write'] } });
    expect(created.statusCode).toBe(201);
    const { key, id, prefix } = created.json();
    expect(key.startsWith('dsp_')).toBe(true);
    expect(prefix).toBe(key.slice(0, 12));
    const listed = (await app.inject({ method: 'GET', url: '/api/integrations/keys', headers: bearer(ops.token) })).json();
    expect(listed[0]).not.toHaveProperty('key'); // plaintext never listed again

    expect((await app.inject({ method: 'POST', url: '/api/v1/callouts', headers: { 'x-api-key': 'dsp_wrong' }, payload: {} })).statusCode).toBe(401);
    const viaApi = await app.inject({
      method: 'POST',
      url: '/api/v1/callouts',
      headers: { 'x-api-key': key },
      payload: { service: 'medical', contactName: 'Panel 44', contactPhone: '+27830000044', ...CBD, flags: ['unconscious'] },
    });
    expect(viaApi.statusCode).toBe(201);
    expect(viaApi.json().source).toBe('api');
    expect(viaApi.json().createdBy).toBe(`apikey:${id}`);
    expect(viaApi.json().status).toBe('searching');

    // read scope is missing on this key
    expect((await app.inject({ method: 'GET', url: '/api/v1/callouts', headers: { 'x-api-key': key } })).statusCode).toBe(403);

    // the human dispatcher sees it in the normal list; revoked keys stop working
    const list = (await app.inject({ method: 'GET', url: '/api/requests?status=searching', headers: bearer(ops.token) })).json();
    expect(list).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/integrations/keys/${id}`, headers: bearer(ops.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/callouts', headers: { 'x-api-key': key }, payload: {} })).statusCode).toBe(401);
  });

  it('delivers signed webhooks for subscribed events and records deliveries', async () => {
    const ops = await login({ role: 'dispatcher', name: 'Agent', phone: '0210000000', dispatcherCode: 'ctrl' });
    const hook = await app.inject({
      method: 'POST',
      url: '/api/integrations/webhooks',
      headers: bearer(ops.token),
      payload: { name: 'CRM', url: 'https://crm.example/hooks/dispatch', events: ['request.*'] },
    });
    expect(hook.statusCode).toBe(201);
    const { id, secret } = hook.json();
    expect(secret.startsWith('whsec_')).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/integrations/webhooks', headers: bearer(ops.token), payload: { name: 'bad', url: 'http://insecure.example/x' } })).statusCode).toBe(400);

    const who = await login({ role: 'requester', name: 'T', phone: '0821111111' });
    await app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'fire', ...CBD } });
    await app.ctx.webhooks.flush();

    expect(hooks.calls.length).toBeGreaterThanOrEqual(1);
    const call = hooks.calls[0];
    expect(call.url).toBe('https://crm.example/hooks/dispatch');
    const body = String(call.init.body);
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-dispatch-event']).toBe('request.created');
    expect(headers['x-dispatch-signature']).toBe(sign(secret, body));
    const evt = JSON.parse(body);
    expect(evt.type).toBe('request.created');
    expect(evt.data.service).toBe('fire');
    expect(evt.data.contact.phone).toBe('+27821111111');
    expect(evt.data).not.toHaveProperty('requesterId');

    const deliveries = (await app.inject({ method: 'GET', url: `/api/integrations/webhooks/${id}/deliveries`, headers: bearer(ops.token) })).json();
    expect(deliveries[0].success).toBe(true);
    expect(deliveries[0].statusCode).toBe(200);

    const ping = await app.inject({ method: 'POST', url: `/api/integrations/webhooks/${id}/test`, headers: bearer(ops.token) });
    expect(ping.json().delivered).toBe(true);
  });

  it('retries failed webhook deliveries', async () => {
    await app.close();
    hooks = makeFetch(500);
    app = await buildApp({ logger: false, autoTick: false, fetchImpl: hooks.fetchImpl, awaitWebhooks: true, env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', WEB_DIST: '/nonexistent', WEBHOOK_MAX_ATTEMPTS: '2' } });
    const ops = await login({ role: 'dispatcher', name: 'Agent', phone: '0210000000', dispatcherCode: 'ctrl' });
    const { id } = (await app.inject({ method: 'POST', url: '/api/integrations/webhooks', headers: bearer(ops.token), payload: { name: 'flaky', url: 'https://flaky.example/h' } })).json();
    const ping = await app.inject({ method: 'POST', url: `/api/integrations/webhooks/${id}/test`, headers: bearer(ops.token) });
    expect(ping.json().delivered).toBe(false);
    expect(hooks.calls).toHaveLength(2);
    const deliveries = (await app.inject({ method: 'GET', url: `/api/integrations/webhooks/${id}/deliveries`, headers: bearer(ops.token) })).json();
    expect(deliveries.map((d: { attempt: number }) => d.attempt).sort()).toEqual([1, 2]);
  });

  it('serves the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/api/v1/callouts']).toBeTruthy();
  });
});

describe('webhook event matching', () => {
  it('supports wildcards and opt-in location events', () => {
    expect(matches(['*'], 'request.created')).toBe(true);
    expect(matches(['request.*'], 'request.updated')).toBe(true);
    expect(matches(['request.*'], 'offer.created')).toBe(false);
    expect(matches(['*'], 'responder.location')).toBe(false);
    expect(matches(['responder.location'], 'responder.location')).toBe(true);
  });
});
