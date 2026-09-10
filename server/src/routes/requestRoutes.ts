import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { SERVICES } from '../domain/types.js';

const CreateBody = z.object({
  service: z.enum(SERVICES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  flags: z.array(z.string().max(40)).max(10).optional(),
});
const CancelBody = z.object({ reason: z.string().max(300).nullable().optional() }).default({});
const RateBody = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(500).nullable().optional() });

/** Endpoints used by the person requesting help. */
export async function requestRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/requests', { preHandler: requireRole('requester') }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const created = ctx.dispatch.createRequest(req.user!, body);
    return reply.code(201).send(created);
  });

  app.get('/api/requests/mine', { preHandler: requireRole('requester') }, async (req) => ctx.dispatch.listMine(req.user!));

  app.get<{ Params: { id: string } }>('/api/requests/:id/track', { preHandler: requireRole('requester', 'responder', 'dispatcher') }, async (req) =>
    ctx.dispatch.track(req.user!, req.params.id),
  );

  app.get<{ Params: { id: string } }>('/api/requests/:id', { preHandler: requireRole('requester', 'responder', 'dispatcher') }, async (req) =>
    ctx.dispatch.detail(req.user!, req.params.id),
  );

  app.post<{ Params: { id: string } }>('/api/requests/:id/cancel', { preHandler: requireRole('requester', 'dispatcher') }, async (req) => {
    const body = CancelBody.parse(req.body ?? {});
    return ctx.dispatch.cancelRequest(req.user!, req.params.id, body.reason ?? null);
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/rate', { preHandler: requireRole('requester') }, async (req) => {
    const body = RateBody.parse(req.body);
    return ctx.dispatch.rateRequest(req.user!, req.params.id, body.rating, body.comment ?? null);
  });
}
