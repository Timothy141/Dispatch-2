import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Operator identity attached to each request (from x-operator header, default 'operator'). */
export function operatorName(req: FastifyRequest): string {
  const h = req.headers['x-operator'];
  const name = Array.isArray(h) ? h[0] : h;
  return (name && name.trim().slice(0, 80)) || 'operator';
}

export function makeOperatorAuth(config: Config) {
  return async function operatorAuth(req: FastifyRequest, reply: FastifyReply) {
    if (!config.OPERATOR_API_KEY) return; // auth disabled (dev)
    const h = req.headers['x-api-key'];
    const key = Array.isArray(h) ? h[0] : h;
    if (!key || !safeEqual(key, config.OPERATOR_API_KEY)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid x-api-key' });
    }
  };
}

export function makeWebhookAuth(config: Config) {
  return async function webhookAuth(req: FastifyRequest<{ Params: { source: string } }>, reply: FastifyReply) {
    const expected = config.webhookSecrets[req.params.source];
    if (expected === undefined) {
      return reply.code(404).send({ error: 'unknown_source', message: `No inbound adapter for '${req.params.source}'` });
    }
    if (!expected) return; // no secret configured for this source (dev)
    const h = req.headers['x-webhook-secret'];
    const fromHeader = Array.isArray(h) ? h[0] : h;
    const auth = req.headers.authorization;
    const fromBearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const fromQuery = (req.query as Record<string, string | undefined>)?.token;
    const provided = fromHeader ?? fromBearer ?? fromQuery;
    if (!provided || !safeEqual(provided, expected)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid webhook secret' });
    }
  };
}
