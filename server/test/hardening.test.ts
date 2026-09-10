import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { SmsProvider } from '../src/services/smsService.js';
import { CBD, north } from './helpers.js';

type App = Awaited<ReturnType<typeof buildApp>>;

function captureSms(): SmsProvider & { last: () => { to: string; code: string } | undefined; fail?: boolean } {
  const sent: { to: string; code: string }[] = [];
  return {
    name: 'test',
    async send(to, text) {
      sent.push({ to, code: text.match(/code: (\d{6})/)![1] });
    },
    last: () => sent[sent.length - 1],
  };
}

describe('SMS one-time-code sign-in', () => {
  let app: App;
  let sms: ReturnType<typeof captureSms>;
  beforeEach(async () => {
    sms = captureSms();
    app = await buildApp({ logger: false, autoTick: false, smsProvider: sms, env: { DATABASE_PATH: ':memory:', OTP_REQUIRED: 'true', WEB_DIST: '/nonexistent' } });
  });
  afterEach(async () => {
    await app.close();
  });

  it('requires a valid code, limits attempts, and expires codes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/catalogue' })).json().auth.otpRequired).toBe(true);
    const noCode = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111' } });
    expect(noCode.statusCode).toBe(403);

    const req = await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '082 111 1111' } });
    expect(req.statusCode).toBe(200);
    expect(req.json().phone).toBe('+27821111111');
    const { to, code } = sms.last()!;
    expect(to).toBe('+27821111111');
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111', code: '000000' } });
    expect(wrong.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111', code } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    // single use
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111', code } });
    expect(reuse.statusCode).toBe(403);

    // brute force: 5 wrong attempts burn the code
    await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '0821111111' } });
    const real = sms.last()!.code;
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111', code: '111111' } });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111', code: real } })).statusCode).toBe(403);

    // expiry
    await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '0821111111' } });
    const fresh = sms.last()!.code;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(app.ctx.otp.verify('0821111111', fresh)).toBe(false);
    vi.useRealTimers();
  });

  it('rate limits code requests per number', async () => {
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '0829999999' } })).statusCode;
    expect(last).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: '0828888888' } })).statusCode).toBe(200);
  });

  it('rejects invalid numbers', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/otp/request', payload: { phone: 'abcdefg' } })).statusCode).toBe(409);
  });
});

describe('push notifications', () => {
  it('notifies the offered responder and the requester on assignment, and drops dead subscriptions', async () => {
    const sent: { endpoint: string; payload: { title: string; body: string } }[] = [];
    const app = await buildApp({
      logger: false,
      autoTick: false,
      pushSender: async (sub, payload) => {
        if (sub.endpoint.includes('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      },
      env: { DATABASE_PATH: ':memory:', OFFER_FANOUT: '1', WEB_DIST: '/nonexistent' },
    });
    expect((await app.inject({ method: 'GET', url: '/api/catalogue' })).json().push.vapidPublicKey).toBeNull(); // no key configured, sender injected

    const login = async (b: Record<string, unknown>) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json() as { token: string; user: { id: string } };
    const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
    const unit = await login({ role: 'responder', name: 'U', phone: '0831111111' });
    await app.inject({ method: 'PUT', url: '/api/responders/me', headers: bearer(unit.token), payload: { service: 'security', unitName: 'SEC-1' } });
    await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: bearer(unit.token), payload: { status: 'available' } });
    await app.inject({ method: 'POST', url: '/api/responders/me/location', headers: bearer(unit.token), payload: north(CBD, 1) });
    const sub = await app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: bearer(unit.token), payload: { endpoint: 'https://push.example/unit', keys: { p256dh: 'p', auth: 'a' } } });
    expect(sub.statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: bearer(unit.token), payload: { endpoint: 'https://push.example/dead', keys: { p256dh: 'p', auth: 'a' } } });

    const who = await login({ role: 'requester', name: 'T', phone: '0821111111' });
    await app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: bearer(who.token), payload: { endpoint: 'https://push.example/who', keys: { p256dh: 'p', auth: 'a' } } });
    const req = (await app.inject({ method: 'POST', url: '/api/requests', headers: bearer(who.token), payload: { service: 'security', ...CBD, address: '12 Long St', flags: ['armed'] } })).json();
    await app.ctx.push.flush();

    const toUnit = sent.filter((s) => s.endpoint.endsWith('/unit'));
    expect(toUnit).toHaveLength(1);
    expect(toUnit[0].payload.title).toMatch(/SECURITY job/);
    expect(toUnit[0].payload.body).toMatch(/critical · 12 Long St · armed/);
    expect(app.ctx.repo.countPushSubscriptions(unit.user.id)).toBe(1); // the 410 endpoint was removed

    const offer = (await app.inject({ method: 'GET', url: '/api/responders/me', headers: bearer(unit.token) })).json().offers[0].offer;
    await app.inject({ method: 'POST', url: `/api/offers/${offer.id}/accept`, headers: bearer(unit.token) });
    await app.ctx.push.flush();
    const toWho = sent.filter((s) => s.endpoint.endsWith('/who'));
    expect(toWho).toHaveLength(1);
    expect(toWho[0].payload.title).toBe(`${req.reference}: assigned`);
    await app.close();
  });

  it('refuses subscriptions when push is not configured', async () => {
    const app = await buildApp({ logger: false, autoTick: false, env: { DATABASE_PATH: ':memory:', WEB_DIST: '/nonexistent' } });
    const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'requester', name: 'T', phone: '0821111111' } })).json().token;
    const res = await app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: { authorization: `Bearer ${t}` }, payload: { endpoint: 'https://x.example/e', keys: { p256dh: 'p', auth: 'a' } } });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});

describe('backups', () => {
  it('writes a consistent copy, lists it, and prunes old ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dispatch-bk-'));
    const app = await buildApp({ logger: false, autoTick: false, env: { DATABASE_PATH: join(dir, 'live.db'), BACKUP_DIR: join(dir, 'backups'), BACKUP_KEEP: '2', BACKUP_INTERVAL_HOURS: '24', DISPATCHER_CODE: 'ctrl', WEB_DIST: '/nonexistent' } });
    const ops = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'dispatcher', name: 'O', phone: '0210000000', dispatcherCode: 'ctrl' } })).json().token;
    const h = { authorization: `Bearer ${ops}` };
    const r1 = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: h });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().bytes).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1100)); // distinct timestamps
    await app.inject({ method: 'POST', url: '/api/admin/backups', headers: h });
    await new Promise((r) => setTimeout(r, 1100));
    await app.inject({ method: 'POST', url: '/api/admin/backups', headers: h });
    const list = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: h })).json();
    expect(list.enabled).toBe(true);
    expect(list.backups).toHaveLength(2);
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is disabled for in-memory databases', async () => {
    const app = await buildApp({ logger: false, autoTick: false, env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', WEB_DIST: '/nonexistent' } });
    const ops = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { role: 'dispatcher', name: 'O', phone: '0210000000', dispatcherCode: 'ctrl' } })).json().token;
    expect((await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { authorization: `Bearer ${ops}` } })).statusCode).toBe(409);
    await app.close();
  });
});

describe('event actor names', () => {
  it('resolves agents and units to readable names in the timeline', async () => {
    const app = await buildApp({ logger: false, autoTick: false, env: { DATABASE_PATH: ':memory:', DISPATCHER_CODE: 'ctrl', WEB_DIST: '/nonexistent' } });
    const login = async (b: Record<string, unknown>) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json() as { token: string; user: { id: string } };
    const ops = await login({ role: 'dispatcher', name: 'Agent Lerato', phone: '0210000000', dispatcherCode: 'ctrl' });
    const unit = await login({ role: 'responder', name: 'Sipho', phone: '0831111111' });
    await app.inject({ method: 'PUT', url: '/api/responders/me', headers: { authorization: `Bearer ${unit.token}` }, payload: { service: 'fire', unitName: 'FIRE-1' } });
    await app.inject({ method: 'POST', url: '/api/responders/me/status', headers: { authorization: `Bearer ${unit.token}` }, payload: { status: 'available' } });
    const req = (await app.inject({ method: 'POST', url: '/api/callouts', headers: { authorization: `Bearer ${ops.token}` }, payload: { service: 'fire', contactName: 'C', contactPhone: '0830000009', ...CBD, responderId: unit.user.id } })).json();
    const detail = (await app.inject({ method: 'GET', url: `/api/requests/${req.id}`, headers: { authorization: `Bearer ${ops.token}` } })).json();
    expect(detail.events.map((e: { type: string; actorName: string | null }) => [e.type, e.actorName])).toEqual([
      ['created', 'Agent Lerato'],
      ['sent_to_officer', 'Agent Lerato'],
    ]);
    await app.close();
  });
});
