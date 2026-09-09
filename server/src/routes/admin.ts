import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { operatorName } from '../auth.js';
import { CHANNELS, RESPONDER_TYPES } from '../domain/types.js';

const ResponderBody = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(RESPONDER_TYPES).default('armed_response'),
  channel: z.enum(CHANNELS).default('log'),
  channelConfig: z.record(z.unknown()).default({}),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  active: z.boolean().default(true),
});

const SiteBody = z.object({
  name: z.string().min(1).max(160),
  address: z.string().max(400).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  externalRef: z.string().max(120).nullable().optional(),
  defaultResponderId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/stats', async () => ctx.repo.stats());
  app.get('/api/audit', async (req) => {
    const limit = Number((req.query as Record<string, string>).limit ?? 200);
    return ctx.repo.listAudit(Number.isFinite(limit) ? Math.min(limit, 1000) : 200);
  });

  // Responders
  app.get('/api/responders', async (req) =>
    ctx.repo.listResponders((req.query as Record<string, string>).includeInactive === 'true'),
  );
  app.post('/api/responders', async (req, reply) => {
    const body = ResponderBody.parse(req.body);
    const r = ctx.repo.createResponder({ ...body, phone: body.phone ?? null, email: body.email ?? null });
    ctx.repo.audit({ actor: operatorName(req), action: 'responder.created', entityType: 'responder', entityId: r.id });
    return reply.code(201).send(r);
  });
  app.patch<{ Params: { id: string } }>('/api/responders/:id', async (req, reply) => {
    const body = ResponderBody.partial().parse(req.body);
    const r = ctx.repo.updateResponder(req.params.id, body as never);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    ctx.repo.audit({ actor: operatorName(req), action: 'responder.updated', entityType: 'responder', entityId: r.id });
    return r;
  });

  // Sites
  app.get('/api/sites', async () => ctx.repo.listSites());
  app.get<{ Params: { id: string } }>('/api/sites/:id', async (req, reply) => {
    const s = ctx.repo.getSite(req.params.id);
    if (!s) return reply.code(404).send({ error: 'not_found' });
    return { ...s, cameras: ctx.repo.listCameras(s.id) };
  });
  app.post('/api/sites', async (req, reply) => {
    const body = SiteBody.parse(req.body);
    const s = ctx.repo.createSite(body);
    ctx.repo.audit({ actor: operatorName(req), action: 'site.created', entityType: 'site', entityId: s.id });
    return reply.code(201).send(s);
  });
  app.patch<{ Params: { id: string } }>('/api/sites/:id', async (req, reply) => {
    const body = SiteBody.partial().parse(req.body);
    const s = ctx.repo.updateSite(req.params.id, body);
    if (!s) return reply.code(404).send({ error: 'not_found' });
    ctx.repo.audit({ actor: operatorName(req), action: 'site.updated', entityType: 'site', entityId: s.id });
    return s;
  });
}
