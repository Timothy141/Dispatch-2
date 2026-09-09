import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { makeWebhookAuth } from '../auth.js';
import { PayloadError } from '../integrations/inbound/types.js';

export async function webhookRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Params: { source: string } }>(
    '/api/webhooks/:source',
    { preHandler: makeWebhookAuth(ctx.config) },
    async (req, reply) => {
      const adapter = ctx.inbound.get(req.params.source);
      if (!adapter) return reply.code(404).send({ error: 'unknown_source' });
      let normalized;
      try {
        normalized = adapter.parse(req.body, req.headers);
      } catch (err) {
        if (err instanceof PayloadError) return reply.code(400).send({ error: 'bad_payload', message: err.message });
        throw err;
      }
      const results = normalized.map((n) => ctx.alerts.ingest(n));
      req.log.info(
        { source: req.params.source, received: results.length, created: results.filter((r) => r.created).length },
        'alerts ingested',
      );
      return reply.code(202).send({
        accepted: results.length,
        created: results.filter((r) => r.created).length,
        alerts: results.map((r) => ({ id: r.alert.id, status: r.alert.status, created: r.created })),
      });
    },
  );
}
