import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { SERVICES } from '../domain/types.js';

export const CalloutBody = z.object({
  service: z.enum(SERVICES),
  contactName: z.string().min(1).max(80),
  contactPhone: z.string().min(6).max(20),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  flags: z.array(z.string().max(40)).max(10).optional(),
  /** Send directly to this response officer; omit for automatic matching. */
  responderId: z.string().nullable().optional(),
});

const GeocodeQuery = z.object({ q: z.string().min(3).max(200), limit: z.coerce.number().int().min(1).max(10).default(5) });

/** Agent tooling: manual call-outs and address search. */
export async function calloutRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/callouts', { preHandler: requireRole('dispatcher') }, async (req, reply) => {
    const body = CalloutBody.parse(req.body);
    const request = ctx.dispatch.createCallout({ ...body, source: 'agent', createdBy: req.user!.id }, (n, p) => ctx.auth.resolveContact(n, p));
    return reply.code(201).send(request);
  });

  /** Address search proxied server-side (keeps the geocoder's user-agent policy and CORS out of the browser). */
  app.get('/api/geocode', { preHandler: requireRole('dispatcher', 'requester', 'responder') }, async (req, reply) => {
    const q = GeocodeQuery.parse(req.query);
    const url = new URL(ctx.config.GEOCODER_URL);
    url.searchParams.set('q', q.q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(q.limit));
    url.searchParams.set('addressdetails', '0');
    try {
      const res = await fetch(url, { headers: { 'user-agent': ctx.config.GEOCODER_USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return reply.code(502).send({ error: 'geocoder', message: `Geocoder returned ${res.status}` });
      const items = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      return items.map((i) => ({ label: i.display_name, lat: Number(i.lat), lng: Number(i.lon) }));
    } catch (err) {
      return reply.code(502).send({ error: 'geocoder', message: err instanceof Error ? err.message : String(err) });
    }
  });
}
