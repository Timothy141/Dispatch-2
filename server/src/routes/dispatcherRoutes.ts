import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { REQUEST_STATUSES, RESPONDER_STATUSES, SERVICES, type RequestStatus, type ResponderStatus } from '../domain/types.js';

const ListQuery = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() });
const RespondersQuery = z.object({ service: z.enum(SERVICES).optional(), status: z.string().optional() });
const AssignBody = z.object({ responderId: z.string().min(1) });

/** Control-room endpoints: see everything, intervene when matching fails. */
export async function dispatcherRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = { preHandler: requireRole('dispatcher') };

  app.get('/api/requests', guard, async (req) => {
    const q = ListQuery.parse(req.query);
    const status = q.status?.split(',').filter((s): s is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(s));
    return ctx.repo.listRequests({ status, limit: q.limit });
  });

  app.get('/api/responders', guard, async (req) => {
    const q = RespondersQuery.parse(req.query);
    const status = q.status?.split(',').filter((s): s is ResponderStatus => (RESPONDER_STATUSES as readonly string[]).includes(s));
    return ctx.repo.listResponders({ service: q.service, status });
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/assign', guard, async (req) => {
    const body = AssignBody.parse(req.body);
    return ctx.dispatch.assignManually(req.user!, req.params.id, body.responderId);
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/retry', guard, async (req) => ctx.dispatch.retrySearch(req.user!, req.params.id));

  app.get('/api/stats', guard, async () => ctx.repo.stats());

  // Backups of the database (also taken automatically every BACKUP_INTERVAL_HOURS).
  app.get('/api/admin/backups', guard, async () => ({ enabled: ctx.backups.enabled, dir: ctx.backups.dir, backups: ctx.backups.list() }));
  app.post('/api/admin/backups', guard, async (req, reply) => {
    if (!ctx.backups.enabled) return reply.code(409).send({ error: 'backups_disabled', message: 'Backups are disabled for in-memory databases or when BACKUP_INTERVAL_HOURS=0' });
    const r = ctx.backups.run();
    ctx.repo.audit({ actor: req.user!.id, action: 'backup.created', entityType: 'backup', entityId: r.file });
    return r;
  });
  app.get('/api/audit', guard, async (req) => {
    const limit = Number((req.query as Record<string, string>).limit ?? 200);
    return ctx.repo.listAudit(Number.isFinite(limit) ? Math.min(limit, 1000) : 200);
  });
}
