import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { sign } from '../src/integrations/outbound/webhook.js';

const OPERATOR_KEY = 'op-key';
const DA_SECRET = 'da-secret';
const SIGNING = 'sign-secret';

type App = Awaited<ReturnType<typeof buildApp>>;

function makeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 200 ? 'ok' : 'nope', { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function build(fetchImpl?: typeof fetch): Promise<App> {
  return buildApp({
    logger: false,
    fetchImpl,
    awaitDelivery: true,
    retryDelayMs: 1,
    env: {
      DATABASE_PATH: ':memory:',
      OPERATOR_API_KEY: OPERATOR_KEY,
      WEBHOOK_SECRET_DEEPALERT: DA_SECRET,
      DISPATCH_SIGNING_SECRET: SIGNING,
      PUBLIC_BASE_URL: 'https://dispatch.example',
      WEB_DIST: '/nonexistent',
    },
  });
}

const op = { 'x-api-key': OPERATOR_KEY, 'x-operator': 'alice' };

describe('dispatch API', () => {
  let app: App;
  let fetchMock: ReturnType<typeof makeFetch>;

  beforeEach(async () => {
    fetchMock = makeFetch();
    app = await build(fetchMock.fetchImpl);
  });
  afterEach(async () => {
    await app.close();
  });

  async function seedResponder(channel: 'webhook' | 'log' = 'webhook') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responders',
      headers: op,
      payload: {
        name: 'Alpha Armed Response',
        type: 'armed_response',
        channel,
        channelConfig: channel === 'webhook' ? { url: 'https://responder.example/hook' } : {},
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function postDeepAlert(payload: unknown, secret = DA_SECRET) {
    return app.inject({
      method: 'POST',
      url: '/api/webhooks/deepalert',
      headers: { 'x-webhook-secret': secret },
      payload,
    });
  }

  it('rejects operator calls without the API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects webhooks with a bad secret and unknown sources', async () => {
    expect((await postDeepAlert({ alert_id: 'x' }, 'wrong')).statusCode).toBe(401);
    const unknown = await app.inject({ method: 'POST', url: '/api/webhooks/nothing', payload: {} });
    expect(unknown.statusCode).toBe(404);
  });

  it('ingests a DeepAlert webhook, auto-creating site and camera, idempotently', async () => {
    const payload = {
      alert_id: 'da-1',
      site_id: 'S1',
      site_name: 'Depot',
      camera_id: 'C1',
      camera_name: 'Yard',
      event_type: 'person',
      confidence: 0.97,
      image_url: 'https://cdn/snap.jpg',
    };
    const first = await postDeepAlert(payload);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ accepted: 1, created: 1 });

    const second = await postDeepAlert(payload);
    expect(second.json()).toMatchObject({ accepted: 1, created: 0 });

    const alerts = (await app.inject({ method: 'GET', url: '/api/alerts?status=new', headers: op })).json();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ siteName: 'Depot', cameraName: 'Yard', status: 'new', severity: 'high' });

    const sites = (await app.inject({ method: 'GET', url: '/api/sites', headers: op })).json();
    expect(sites).toHaveLength(1);
    expect(sites[0].externalRef).toBe('S1');
  });

  it('runs the full flow: alert -> acknowledge -> dispatch -> responder callback -> resolved', async () => {
    const responder = await seedResponder();
    await postDeepAlert({ alert_id: 'da-2', site_id: 'S1', site_name: 'Depot', event_type: 'intrusion', confidence: 0.9 });
    const [alert] = (await app.inject({ method: 'GET', url: '/api/alerts', headers: op })).json();

    const ack = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/acknowledge`, headers: op });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().status).toBe('acknowledged');
    expect(ack.json().handledBy).toBe('alice');

    // THE BUTTON
    const dispatched = await app.inject({
      method: 'POST',
      url: `/api/alerts/${alert.id}/dispatch`,
      headers: op,
      payload: { responderId: responder.id, priority: 'critical', notes: 'Two males climbing fence' },
    });
    expect(dispatched.statusCode).toBe(201);
    const dispatch = dispatched.json();
    expect(dispatch).toMatchObject({ status: 'requested', priority: 'critical', requestedBy: 'alice', responderName: 'Alpha Armed Response' });
    expect(dispatch.reference).toMatch(/^DSP-[A-Z2-9]{5}$/);

    // alert is now dispatched and a second dispatch is refused
    const alertAfter = (await app.inject({ method: 'GET', url: `/api/alerts/${alert.id}`, headers: op })).json();
    expect(alertAfter.status).toBe('dispatched');
    expect(alertAfter.dispatchId).toBe(dispatch.id);
    const again = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/dispatch`, headers: op, payload: { responderId: responder.id } });
    expect(again.statusCode).toBe(409);

    // responder was notified with a signed webhook
    expect(fetchMock.calls).toHaveLength(1);
    const call = fetchMock.calls[0];
    expect(call.url).toBe('https://responder.example/hook');
    const headers = call.init.headers as Record<string, string>;
    const body = String(call.init.body);
    expect(headers['x-dispatch-signature']).toBe(sign(SIGNING, body));
    const sent = JSON.parse(body);
    expect(sent.type).toBe('dispatch.requested');
    expect(sent.site.name).toBe('Depot');
    expect(sent.alert.eventType).toBe('intrusion');
    expect(sent.dispatch.callbackUrl).toContain(`/api/dispatches/callback/${dispatch.reference}?token=`);

    const detail = (await app.inject({ method: 'GET', url: `/api/dispatches/${dispatch.id}`, headers: op })).json();
    expect(detail.deliveries).toHaveLength(1);
    expect(detail.deliveries[0].success).toBe(true);
    expect(detail.nextStatuses).toContain('acknowledged');

    // responder uses the callback link (no operator key)
    const cbUrl = new URL(sent.dispatch.callbackUrl);
    const cb = await app.inject({
      method: 'POST',
      url: cbUrl.pathname + cbUrl.search,
      payload: { status: 'en_route', actor: 'Vehicle 12', note: 'ETA 6 min' },
    });
    expect(cb.statusCode).toBe(200);
    expect(cb.json().status).toBe('en_route');

    const badToken = await app.inject({
      method: 'POST',
      url: `${cbUrl.pathname}?token=wrong`,
      payload: { status: 'on_scene' },
    });
    expect(badToken.statusCode).toBe(404);

    // operator closes it out; invalid transitions are refused
    const back = await app.inject({ method: 'POST', url: `/api/dispatches/${dispatch.id}/status`, headers: op, payload: { status: 'requested' } });
    expect(back.statusCode).toBe(409);
    const resolved = await app.inject({ method: 'POST', url: `/api/dispatches/${dispatch.id}/status`, headers: op, payload: { status: 'resolved', note: 'Suspects fled' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().closedAt).toBeTruthy();

    const events = (await app.inject({ method: 'GET', url: `/api/dispatches/${dispatch.id}`, headers: op })).json().events;
    expect(events.map((e: { toStatus: string }) => e.toStatus)).toEqual(['requested', 'en_route', 'resolved']);
    expect(events[1].actor).toBe('responder:Vehicle 12');

    const audit = (await app.inject({ method: 'GET', url: '/api/audit', headers: op })).json();
    expect(audit.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['alert.received', 'alert.acknowledged', 'dispatch.created', 'dispatch.en_route', 'dispatch.resolved']),
    );
  });

  it('uses the site default responder and reopens the alert when a dispatch is cancelled', async () => {
    const responder = await seedResponder('log');
    await postDeepAlert({ alert_id: 'da-3', site_id: 'S9', site_name: 'Mall', event_type: 'loitering' });
    const [site] = (await app.inject({ method: 'GET', url: '/api/sites', headers: op })).json();
    await app.inject({ method: 'PATCH', url: `/api/sites/${site.id}`, headers: op, payload: { defaultResponderId: responder.id } });
    const [alert] = (await app.inject({ method: 'GET', url: '/api/alerts', headers: op })).json();

    const d = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/dispatch`, headers: op, payload: {} });
    expect(d.statusCode).toBe(201);
    expect(d.json().responderId).toBe(responder.id);
    expect(d.json().priority).toBe('high');
    expect(fetchMock.calls).toHaveLength(0); // log channel does not call out

    const cancelled = await app.inject({ method: 'POST', url: `/api/dispatches/${d.json().id}/status`, headers: op, payload: { status: 'cancelled', note: 'False alarm' } });
    expect(cancelled.statusCode).toBe(200);
    const alertAfter = (await app.inject({ method: 'GET', url: `/api/alerts/${alert.id}`, headers: op })).json();
    expect(alertAfter.status).toBe('acknowledged');
  });

  it('refuses to dispatch when no responder can be resolved', async () => {
    await postDeepAlert({ alert_id: 'da-4', event_type: 'vehicle' });
    const [alert] = (await app.inject({ method: 'GET', url: '/api/alerts', headers: op })).json();
    const d = await app.inject({ method: 'POST', url: `/api/alerts/${alert.id}/dispatch`, headers: op, payload: {} });
    expect(d.statusCode).toBe(409);
    expect(d.json().message).toMatch(/No responder/);
  });

  it('retries failed deliveries and records each attempt', async () => {
    await app.close();
    fetchMock = makeFetch(503);
    app = await build(fetchMock.fetchImpl);
    const responder = await seedResponder();
    const site = (await app.inject({ method: 'POST', url: '/api/sites', headers: op, payload: { name: 'Plant' } })).json();
    const d = await app.inject({
      method: 'POST',
      url: '/api/dispatches',
      headers: op,
      payload: { siteId: site.id, responderId: responder.id, priority: 'medium', reason: 'Suspicious vehicle at gate' },
    });
    expect(d.statusCode).toBe(201);
    expect(fetchMock.calls).toHaveLength(3);
    const detail = (await app.inject({ method: 'GET', url: `/api/dispatches/${d.json().id}`, headers: op })).json();
    expect(detail.deliveries.map((x: { success: boolean }) => x.success)).toEqual([false, false, false]);
    expect(detail.deliveries[0].detail).toMatch(/HTTP 503/);
  });

  it('accepts the generic alert format and validates it', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/webhooks/generic',
      payload: { id: 'g1', eventType: 'person', confidence: 0.8, site: { name: 'Office' }, severity: 'critical' },
    });
    expect(ok.statusCode).toBe(202);
    const bad = await app.inject({ method: 'POST', url: '/api/webhooks/generic', payload: { confidence: 3 } });
    expect(bad.statusCode).toBe(400);
    const [alert] = (await app.inject({ method: 'GET', url: '/api/alerts', headers: op })).json();
    expect(alert.severity).toBe('critical');
  });

  it('streams SSE events', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events', headers: op, payloadAsStream: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    const stream = res.stream();
    const chunks: string[] = [];
    const got = new Promise<void>((resolve) => {
      stream.on('data', (c: Buffer) => {
        chunks.push(c.toString());
        if (chunks.join('').includes('event: alert.created')) resolve();
      });
    });
    await postDeepAlert({ alert_id: 'sse-1', event_type: 'person' });
    await got;
    expect(chunks.join('')).toContain('event: hello');
    stream.destroy();
  });
});
