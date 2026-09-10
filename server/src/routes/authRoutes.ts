import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { ROLES, SERVICE_FLAGS, SERVICES } from '../domain/types.js';
import { byIp, byIpAndPhone, rateLimit } from '../rateLimit.js';

const LoginBody = z.object({
  role: z.enum(ROLES),
  name: z.string().min(1).max(80),
  phone: z.string().min(6).max(20),
  dispatcherCode: z.string().max(80).optional(),
  code: z.string().max(10).optional(),
});
const OtpBody = z.object({ phone: z.string().min(6).max(20) });
const PushBody = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) });

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Step 1 when OTP_REQUIRED: text a 6-digit code to the number. */
  app.post(
    '/api/auth/otp/request',
    { preHandler: [rateLimit({ max: 5, windowMs: 10 * 60_000, key: byIpAndPhone, message: 'Too many codes requested for this number. Wait 10 minutes.' }), rateLimit({ max: 30, windowMs: 10 * 60_000, key: byIp })] },
    async (req) => {
      const body = OtpBody.parse(req.body);
      const r = await ctx.otp.request(body.phone);
      return { sent: true, phone: r.phone, expiresAt: r.expiresAt, provider: ctx.sms.name };
    },
  );

  app.post('/api/auth/login', { preHandler: rateLimit({ max: 20, windowMs: 10 * 60_000, key: byIp }) }, async (req) => {
    const body = LoginBody.parse(req.body);
    const { user, token } = ctx.auth.login(body);
    const responder = user.role === 'responder' ? ctx.repo.getResponder(user.id) ?? null : null;
    return { user, token, responder };
  });

  app.get('/api/auth/me', { preHandler: requireRole() }, async (req) => ({
    user: req.user,
    responder: req.user!.role === 'responder' ? ctx.repo.getResponder(req.user!.id) ?? null : null,
  }));

  /** Static catalogue the apps render from (services, quick flags, feature switches). */
  app.get('/api/catalogue', async () => ({
    services: SERVICES,
    flags: SERVICE_FLAGS,
    matching: {
      offerTimeoutSeconds: ctx.config.OFFER_TIMEOUT_SECONDS,
      searchTimeoutSeconds: ctx.config.SEARCH_TIMEOUT_SECONDS,
      maxRadiusKm: ctx.config.MAX_RADIUS_KM,
    },
    auth: { otpRequired: ctx.config.OTP_REQUIRED },
    push: { vapidPublicKey: ctx.push.enabled ? ctx.config.VAPID_PUBLIC_KEY || null : null },
  }));

  /** Browser push subscriptions (any signed-in role). */
  app.post('/api/push/subscriptions', { preHandler: requireRole() }, async (req, reply) => {
    if (!ctx.push.enabled) return reply.code(409).send({ error: 'push_disabled', message: 'Push is not configured on this server' });
    const body = PushBody.parse(req.body);
    ctx.push.subscribe(req.user!.id, body);
    return { ok: true, subscriptions: ctx.repo.countPushSubscriptions(req.user!.id) };
  });
  app.delete('/api/push/subscriptions', { preHandler: requireRole() }, async (req) => {
    const body = z.object({ endpoint: z.string().url() }).parse(req.body);
    ctx.push.unsubscribe(body.endpoint);
    return { ok: true };
  });
}
