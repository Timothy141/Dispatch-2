import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { newJoinCode } from '../domain/ids.js';
import { SERVICES, type Request } from '../domain/types.js';

const Coverage = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().positive().max(500) }).nullable();
const OrgBody = z.object({
  name: z.string().min(1).max(120),
  services: z.array(z.enum(SERVICES)).min(1).default(['security']),
  contactPhone: z.string().max(40).nullable().optional(),
  coverage: Coverage.optional(),
  active: z.boolean().optional(),
});
const UnitPatch = z.object({
  service: z.enum(SERVICES).optional(),
  unitName: z.string().min(1).max(60).optional(),
  organisationId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  vehicle: z.string().max(120).nullable().optional(),
});
const Range = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function range(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw Object.assign(new Error('Invalid date range'), { statusCode: 400 });
  return { from: from.toISOString(), to: to.toISOString() };
}

const secs = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 1000 : null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const p90 = (xs: number[]) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]);
};

export function buildSummary(rows: Request[], unitNames: Map<string, string>) {
  const byService = SERVICES.map((service) => {
    const rs = rows.filter((r) => r.service === service);
    const accept = rs.map((r) => secs(r.createdAt, r.assignedAt)).filter((x): x is number => x !== null);
    const arrival = rs.map((r) => secs(r.createdAt, r.arrivedAt)).filter((x): x is number => x !== null);
    return {
      service,
      total: rs.length,
      completed: rs.filter((r) => r.status === 'completed').length,
      cancelled: rs.filter((r) => r.status === 'cancelled').length,
      unfulfilled: rs.filter((r) => r.status === 'unfulfilled').length,
      open: rs.filter((r) => ['searching', 'assigned', 'en_route', 'arrived'].includes(r.status)).length,
      avgAcceptSeconds: avg(accept),
      avgArrivalSeconds: avg(arrival),
      p90ArrivalSeconds: p90(arrival),
    };
  });
  const units = new Map<string, { responderId: string; unitName: string; jobs: number; completed: number; arrival: number[]; ratings: number[] }>();
  for (const r of rows) {
    if (!r.responderId) continue;
    const u = units.get(r.responderId) ?? { responderId: r.responderId, unitName: unitNames.get(r.responderId) ?? r.responderId.slice(0, 8), jobs: 0, completed: 0, arrival: [], ratings: [] };
    u.jobs++;
    if (r.status === 'completed') u.completed++;
    const a = secs(r.createdAt, r.arrivedAt);
    if (a !== null) u.arrival.push(a);
    if (r.rating !== null) u.ratings.push(r.rating);
    units.set(r.responderId, u);
  }
  const byUnit = [...units.values()]
    .map((u) => ({ responderId: u.responderId, unitName: u.unitName, jobs: u.jobs, completed: u.completed, avgArrivalSeconds: avg(u.arrival), avgRating: u.ratings.length ? Math.round((u.ratings.reduce((s, x) => s + x, 0) / u.ratings.length) * 10) / 10 : null }))
    .sort((a, b) => b.jobs - a.jobs);
  return { total: rows.length, byService, byUnit };
}

export function toCsv(rows: Request[], unitNames: Map<string, string>): string {
  const cols = ['reference', 'service', 'priority', 'status', 'source', 'createdAt', 'assignedAt', 'enRouteAt', 'arrivedAt', 'completedAt', 'cancelledAt', 'acceptSeconds', 'arrivalSeconds', 'unit', 'requesterName', 'requesterPhone', 'address', 'lat', 'lng', 'flags', 'description', 'cancelReason', 'rating'];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    const rec: Record<string, unknown> = {
      ...r,
      acceptSeconds: secs(r.createdAt, r.assignedAt),
      arrivalSeconds: secs(r.createdAt, r.arrivedAt),
      unit: r.responderId ? unitNames.get(r.responderId) ?? r.responderId : '',
      flags: r.flags.join('|'),
    };
    lines.push(cols.map((c) => esc(rec[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Control-room administration: organisations, units, reports. */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = { preHandler: requireRole('dispatcher') };

  // ---- organisations ------------------------------------------------------
  app.get('/api/admin/organisations', guard, async () => ctx.repo.listOrganisations());
  app.post('/api/admin/organisations', guard, async (req, reply) => {
    const body = OrgBody.parse(req.body);
    const org = ctx.repo.createOrganisation({ name: body.name, services: body.services, contactPhone: body.contactPhone ?? null, joinCode: newJoinCode(body.name), coverage: body.coverage ?? null });
    ctx.repo.audit({ actor: req.user!.id, action: 'organisation.created', entityType: 'organisation', entityId: org.id, details: { name: org.name } });
    return reply.code(201).send(org);
  });
  app.patch<{ Params: { id: string } }>('/api/admin/organisations/:id', guard, async (req, reply) => {
    const body = OrgBody.partial().parse(req.body);
    const org = ctx.repo.updateOrganisation(req.params.id, body);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    ctx.repo.audit({ actor: req.user!.id, action: 'organisation.updated', entityType: 'organisation', entityId: org.id, details: body });
    return org;
  });
  app.post<{ Params: { id: string } }>('/api/admin/organisations/:id/rotate-code', guard, async (req, reply) => {
    const org = ctx.repo.getOrganisation(req.params.id);
    if (!org) return reply.code(404).send({ error: 'not_found' });
    const code = newJoinCode(org.name);
    ctx.db.prepare('UPDATE organisations SET join_code = ?, updated_at = ? WHERE id = ?').run(code, new Date().toISOString(), org.id);
    return ctx.repo.getOrganisation(org.id);
  });

  // ---- units ------------------------------------------------------------------
  app.get('/api/admin/units', guard, async () => ctx.repo.listResponders({ includeInactive: true }));
  app.patch<{ Params: { id: string } }>('/api/admin/units/:id', guard, async (req, reply) => {
    const body = UnitPatch.parse(req.body);
    if (body.organisationId && !ctx.repo.getOrganisation(body.organisationId)) return reply.code(404).send({ error: 'not_found', message: 'Organisation not found' });
    const before = ctx.repo.getResponder(req.params.id);
    if (!before) return reply.code(404).send({ error: 'not_found' });
    if (body.active === false && before.status === 'busy') return reply.code(409).send({ error: 'conflict', message: 'Unit is on a job; wait for it to finish or release the job first' });
    const unit = ctx.repo.adminUpdateResponder(req.params.id, body)!;
    if (body.active === false && unit.status !== 'offline') ctx.repo.setResponderStatus(unit.userId, 'offline');
    ctx.repo.audit({ actor: req.user!.id, action: 'unit.updated', entityType: 'responder', entityId: unit.userId, details: body });
    ctx.bus.publish('responder.updated', ctx.repo.getResponder(unit.userId), { responderIds: [unit.userId] });
    return ctx.repo.getResponder(unit.userId);
  });

  // ---- reports ----------------------------------------------------------------
  const unitNames = () => new Map(ctx.repo.listResponders({ includeInactive: true }).map((r) => [r.userId, r.unitName]));
  app.get('/api/reports/summary', guard, async (req) => {
    const { from, to } = range(Range.parse(req.query));
    const rows = ctx.repo.listRequests({ from, to, limit: 500 });
    return { from, to, ...buildSummary(rows, unitNames()) };
  });
  app.get('/api/reports/incidents.csv', guard, async (req, reply) => {
    const { from, to } = range(Range.parse(req.query));
    const rows = ctx.repo.listRequests({ from, to, limit: 500 });
    reply.header('content-disposition', `attachment; filename="incidents-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv"`);
    return reply.type('text/csv; charset=utf-8').send(toCsv(rows, unitNames()));
  });
}
