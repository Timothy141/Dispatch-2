import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole, requireScope } from '../auth.js';
import { newToken } from '../domain/ids.js';
import { API_SCOPES, REQUEST_STATUSES, type RequestStatus } from '../domain/types.js';
import { CalloutBody } from './calloutRoutes.js';

const KeyBody = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1).default(['requests:write', 'requests:read']) });
const WebhookBody = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost') || u.startsWith('http://127.'), 'Webhook URLs must use https'),
  events: z.array(z.string().max(40)).min(1).default(['*']),
  active: z.boolean().default(true),
});
const ListQuery = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Two halves:
 *  - admin endpoints (dispatcher role) to manage API keys and webhooks
 *  - machine endpoints (x-api-key) other systems call to create/read call-outs
 */
export async function integrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const admin = { preHandler: requireRole('dispatcher') };

  // ---- OpenAPI ------------------------------------------------------------
  const spec = JSON.parse(readFileSync(join(here, '..', 'openapi.json'), 'utf8')) as { servers?: unknown[] };
  app.get('/api/openapi.json', async () => ({ ...spec, servers: [{ url: ctx.config.PUBLIC_BASE_URL }] }));
  app.get('/api/docs', async (_req, reply) =>
    reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Dispatch API</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head>
<body><redoc spec-url="/api/openapi.json"></redoc>
<script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`),
  );

  // ---- API keys -----------------------------------------------------------
  app.get('/api/integrations/keys', admin, async () => ctx.repo.listApiKeys());
  app.post('/api/integrations/keys', admin, async (req, reply) => {
    const body = KeyBody.parse(req.body);
    const { apiKey, key } = ctx.auth.createApiKey(req.user!, body.name, body.scopes);
    return reply.code(201).send({ ...apiKey, key }); // plaintext key is shown once
  });
  app.delete<{ Params: { id: string } }>('/api/integrations/keys/:id', admin, async (req, reply) => {
    if (!ctx.repo.revokeApiKey(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    ctx.repo.audit({ actor: req.user!.id, action: 'apikey.revoked', entityType: 'api_key', entityId: req.params.id });
    return { ok: true };
  });

  // ---- Webhooks -----------------------------------------------------------
  app.get('/api/integrations/webhooks', admin, async () => ctx.repo.listWebhooks());
  app.post('/api/integrations/webhooks', admin, async (req, reply) => {
    const body = WebhookBody.parse(req.body);
    const secret = `whsec_${newToken()}`;
    const hook = ctx.repo.createWebhook({ ...body, secret, createdBy: req.user!.id });
    ctx.repo.audit({ actor: req.user!.id, action: 'webhook.created', entityType: 'webhook', entityId: hook.id, details: { url: hook.url, events: hook.events } });
    return reply.code(201).send({ ...hook, secret }); // secret shown once
  });
  app.patch<{ Params: { id: string } }>('/api/integrations/webhooks/:id', admin, async (req, reply) => {
    const body = WebhookBody.partial().parse(req.body);
    const hook = ctx.repo.updateWebhook(req.params.id, body);
    if (!hook) return reply.code(404).send({ error: 'not_found' });
    return hook;
  });
  app.delete<{ Params: { id: string } }>('/api/integrations/webhooks/:id', admin, async (req, reply) => {
    if (!ctx.repo.deleteWebhook(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/integrations/webhooks/:id/deliveries', admin, async (req) => ctx.repo.listWebhookDeliveries(req.params.id));
  app.post<{ Params: { id: string } }>('/api/integrations/webhooks/:id/test', admin, async (req, reply) => {
    if (!ctx.repo.getWebhook(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const ok = await ctx.webhooks.test(req.params.id);
    return { delivered: ok };
  });

  // ---- Machine endpoints (x-api-key) --------------------------------------
  app.post('/api/v1/callouts', { preHandler: requireScope('requests:write') }, async (req, reply) => {
    const body = CalloutBody.parse(req.body);
    const request = ctx.dispatch.createCallout({ ...body, source: 'api', createdBy: `apikey:${req.apiKey!.id}` }, (n, p) => ctx.auth.resolveContact(n, p));
    return reply.code(201).send(request);
  });
  app.get('/api/v1/callouts', { preHandler: requireScope('requests:read') }, async (req) => {
    const q = ListQuery.parse(req.query);
    const status = q.status?.split(',').filter((s): s is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(s));
    return ctx.repo.listRequests({ status, limit: q.limit });
  });
  app.get<{ Params: { id: string } }>('/api/v1/callouts/:id', { preHandler: requireScope('requests:read') }, async (req, reply) => {
    const r = ctx.repo.getRequest(req.params.id);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const responder = r.responderId ? ctx.repo.getResponder(r.responderId) ?? null : null;
    return { request: r, responder, events: ctx.repo.listEvents(r.id) };
  });
  app.post<{ Params: { id: string } }>('/api/v1/callouts/:id/cancel', { preHandler: requireScope('requests:write') }, async (req) => {
    const body = z.object({ reason: z.string().max(300).nullable().optional() }).default({}).parse(req.body ?? {});
    const system = { id: `apikey:${req.apiKey!.id}`, role: 'dispatcher' as const, name: req.apiKey!.name, phone: '', createdAt: '', lastSeenAt: '' };
    return ctx.dispatch.cancelRequest(system, req.params.id, body.reason ?? null);
  });
  app.get('/api/v1/responders', { preHandler: requireScope('responders:read') }, async () =>
    ctx.repo.listResponders().map((r) => ({ userId: r.userId, unitName: r.unitName, service: r.service, status: r.status, organisation: r.organisation, lat: r.lat, lng: r.lng, locationAt: r.locationAt })),
  );
}
