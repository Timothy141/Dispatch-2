import type { FastifyReply, FastifyRequest } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-memory rate limiter for the sign-in endpoints. Good for a single
 * instance; move to a shared store if you run several.
 */
export function rateLimit(opts: { max: number; windowMs: number; key: (req: FastifyRequest) => string; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const sweep = () => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  };
  return async function limiter(req: FastifyRequest, reply: FastifyReply) {
    if (buckets.size > 10000) sweep();
    const key = opts.key(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > opts.max) {
      reply.header('retry-after', String(Math.ceil((b.resetAt - now) / 1000)));
      return reply.code(429).send({ error: 'rate_limited', message: opts.message ?? 'Too many attempts. Please wait and try again.' });
    }
  };
}

export const byIp = (req: FastifyRequest) => req.ip;
export const byIpAndPhone = (req: FastifyRequest) => `${req.ip}:${String((req.body as { phone?: string })?.phone ?? '')}`;
