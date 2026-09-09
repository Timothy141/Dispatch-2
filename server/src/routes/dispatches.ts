import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { operatorName } from '../auth.js';
import { nextStatuses } from '../domain/dispatchStateMachine.js';
import { DISPATCH_STATUSES, PRIORITIES } from '../domain/types.js';

const ListQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const CreateBody = z.object({
  siteId: z.string(),
  responderId: z.string().nullable().optional(),
  priority: z.enum(PRIORITIES).default('high'),
  reason: z.string().min(1).max(500),
  notes: z.string().max(2000).nullable().optional(),
});

const StatusBody = z.object({
  status: z.enum(DISPATCH_STATUSES),
  note: z.string().max(2000).nullable().optional(),
});

const CallbackBody = z.object({
  status: z.enum(DISPATCH_STATUSES),
  note: z.string().max(2000).nullable().optional(),
  actor: z.string().max(80).optional(),
});

export function dispatchOperatorRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/dispatches', async (req) => {
    const q = ListQuery.parse(req.query);
    const status = q.status
      ? q.status.split(',').filter((s): s is (typeof DISPATCH_STATUSES)[number] => (DISPATCH_STATUSES as readonly string[]).includes(s))
      : undefined;
    return ctx.dispatches.list({ status, limit: q.limit });
  });

  /** Manual dispatch without an alert (e.g. operator spots something on a live feed). */
  app.post('/api/dispatches', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const dispatch = await ctx.dispatches.create({
      siteId: body.siteId,
      responderId: body.responderId ?? null,
      priority: body.priority,
      reason: body.reason,
      notes: body.notes ?? null,
      requestedBy: operatorName(req),
    });
    return reply.code(201).send(dispatch);
  });

  app.get<{ Params: { id: string } }>('/api/dispatches/:id', async (req) => {
    const d = ctx.dispatches.detail(req.params.id);
    return { ...d, nextStatuses: nextStatuses(d.dispatch.status) };
  });

  app.post<{ Params: { id: string } }>('/api/dispatches/:id/status', async (req) => {
    const body = StatusBody.parse(req.body);
    return ctx.dispatches.transition(req.params.id, body.status, operatorName(req), body.note ?? null);
  });

  app.post<{ Params: { id: string } }>('/api/dispatches/:id/redeliver', async (req) => {
    const ok = await ctx.dispatches.deliver(req.params.id);
    return { delivered: ok };
  });
}

/** Public (token-authenticated) callback for responders to report progress. */
export function dispatchCallbackRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Params: { reference: string }; Querystring: { token?: string } }>(
    '/api/dispatches/callback/:reference',
    async (req, reply) => {
      const token = req.query.token;
      if (!token) return reply.code(401).send({ error: 'unauthorized' });
      const body = CallbackBody.parse(req.body);
      const d = ctx.dispatches.transitionByReference(
        req.params.reference,
        token,
        body.status,
        body.actor ? `responder:${body.actor}` : 'responder',
        body.note ?? null,
      );
      return { reference: d.reference, status: d.status };
    },
  );
}
