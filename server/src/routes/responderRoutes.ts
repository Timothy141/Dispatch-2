import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { SERVICES } from '../domain/types.js';

const ProfileBody = z.object({
  service: z.enum(SERVICES),
  unitName: z.string().min(1).max(60),
  organisation: z.string().max(120).nullable().optional(),
  vehicle: z.string().max(120).nullable().optional(),
  capabilities: z.array(z.string().max(40)).max(20).optional(),
});
const StatusBody = z.object({ status: z.enum(['available', 'offline']) });
const LocationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).nullable().optional(),
});
const ProgressBody = z.object({ status: z.enum(['en_route', 'arrived', 'completed']), note: z.string().max(500).nullable().optional() });
const ReleaseBody = z.object({ reason: z.string().max(300).nullable().optional() }).default({});

/** Endpoints used by the responder (driver-style) app. */
export async function responderRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = { preHandler: requireRole('responder') };

  app.get('/api/responders/me', guard, async (req) => ({
    responder: ctx.repo.getResponder(req.user!.id) ?? null,
    activeJob: ctx.dispatch.activeJobFor(req.user!.id) ?? null,
    offers: ctx.dispatch.pendingOffersFor(req.user!),
  }));

  app.put('/api/responders/me', guard, async (req) => {
    const body = ProfileBody.parse(req.body);
    const r = ctx.repo.upsertResponderProfile({ userId: req.user!.id, ...body });
    ctx.repo.audit({ actor: req.user!.id, action: 'responder.profile', entityType: 'responder', entityId: r.userId, details: body });
    return r;
  });

  app.post('/api/responders/me/status', guard, async (req) => {
    const body = StatusBody.parse(req.body);
    return ctx.dispatch.setResponderStatus(req.user!, body.status);
  });

  app.post('/api/responders/me/location', guard, async (req) => {
    const body = LocationBody.parse(req.body);
    return ctx.dispatch.updateResponderLocation(req.user!, body.lat, body.lng, body.heading ?? null);
  });

  app.get('/api/responders/me/offers', guard, async (req) => ctx.dispatch.pendingOffersFor(req.user!));

  app.post<{ Params: { id: string } }>('/api/offers/:id/accept', guard, async (req) => ctx.dispatch.acceptOffer(req.user!, req.params.id));

  app.post<{ Params: { id: string } }>('/api/offers/:id/decline', guard, async (req) => {
    ctx.dispatch.declineOffer(req.user!, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/progress', guard, async (req) => {
    const body = ProgressBody.parse(req.body);
    return ctx.dispatch.progress(req.user!, req.params.id, body.status, body.note ?? null);
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/release', guard, async (req) => {
    const body = ReleaseBody.parse(req.body ?? {});
    return ctx.dispatch.releaseJob(req.user!, req.params.id, body.reason ?? null);
  });
}
