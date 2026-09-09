import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { operatorName } from '../auth.js';
import { ALERT_STATUSES, PRIORITIES } from '../domain/types.js';

const ListQuery = z.object({
  status: z.string().optional(),
  siteId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  since: z.string().optional(),
});

const DispatchBody = z.object({
  responderId: z.string().nullable().optional(),
  priority: z.enum(PRIORITIES).default('high'),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function alertRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/alerts', async (req) => {
    const q = ListQuery.parse(req.query);
    const status = q.status
      ? q.status.split(',').filter((s): s is (typeof ALERT_STATUSES)[number] => (ALERT_STATUSES as readonly string[]).includes(s))
      : undefined;
    return ctx.alerts.list({ status, siteId: q.siteId, limit: q.limit, since: q.since });
  });

  app.get<{ Params: { id: string } }>('/api/alerts/:id', async (req, reply) => {
    const alert = ctx.alerts.get(req.params.id);
    if (!alert) return reply.code(404).send({ error: 'not_found' });
    const dispatches = ctx.dispatches.list({ alertId: alert.id });
    return { ...alert, dispatches };
  });

  app.get<{ Params: { id: string } }>('/api/alerts/:id/raw', async (req, reply) => {
    const raw = ctx.alerts.raw(req.params.id);
    if (raw === undefined) return reply.code(404).send({ error: 'not_found' });
    return raw;
  });

  app.post<{ Params: { id: string } }>('/api/alerts/:id/acknowledge', async (req) =>
    ctx.alerts.acknowledge(req.params.id, operatorName(req)),
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/api/alerts/:id/dismiss', async (req) =>
    ctx.alerts.dismiss(req.params.id, operatorName(req), req.body?.reason),
  );

  /** The dispatch button. */
  app.post<{ Params: { id: string } }>('/api/alerts/:id/dispatch', async (req, reply) => {
    const body = DispatchBody.parse(req.body ?? {});
    const dispatch = await ctx.dispatches.create({
      alertId: req.params.id,
      responderId: body.responderId ?? null,
      priority: body.priority,
      reason: body.reason,
      notes: body.notes ?? null,
      requestedBy: operatorName(req),
    });
    return reply.code(201).send(dispatch);
  });
}
