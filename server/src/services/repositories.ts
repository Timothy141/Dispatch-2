import type { Db } from '../db/db.js';
import { row, rows } from '../db/db.js';
import { newId, nowIso } from '../domain/ids.js';
import type {
  ApiKey,
  ApiScope,
  Offer,
  PushSubscriptionRecord,
  Request,
  RequestSource,
  Webhook,
  WebhookDelivery,
  RequestEvent,
  RequestStatus,
  Responder,
  ResponderStatus,
  Role,
  Service,
  User,
} from '../domain/types.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const mapUser = (r: Row): User => ({
  id: String(r.id),
  role: r.role as Role,
  name: String(r.name),
  phone: String(r.phone),
  createdAt: String(r.created_at),
  lastSeenAt: String(r.last_seen_at),
});

export const mapResponder = (r: Row): Responder => ({
  userId: String(r.user_id),
  name: String(r.name ?? ''),
  phone: String(r.phone ?? ''),
  service: r.service as Service,
  unitName: String(r.unit_name),
  organisation: str(r.organisation),
  vehicle: str(r.vehicle),
  capabilities: json<string[]>(r.capabilities, []),
  status: r.status as ResponderStatus,
  lat: num(r.lat),
  lng: num(r.lng),
  heading: num(r.heading),
  locationAt: str(r.location_at),
  rating: Number(r.rating_count) > 0 ? Math.round((Number(r.rating_sum) / Number(r.rating_count)) * 10) / 10 : null,
  ratingCount: Number(r.rating_count),
  jobsCompleted: Number(r.jobs_completed),
  updatedAt: String(r.updated_at),
});

export const mapRequest = (r: Row): Request => ({
  id: String(r.id),
  reference: String(r.reference),
  requesterId: String(r.requester_id),
  requesterName: String(r.requester_name ?? ''),
  requesterPhone: String(r.requester_phone ?? ''),
  service: r.service as Service,
  priority: r.priority as Request['priority'],
  lat: Number(r.lat),
  lng: Number(r.lng),
  address: str(r.address),
  description: str(r.description),
  flags: json<string[]>(r.flags, []),
  status: r.status as RequestStatus,
  responderId: str(r.responder_id),
  etaSeconds: num(r.eta_seconds),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  assignedAt: str(r.assigned_at),
  enRouteAt: str(r.en_route_at),
  arrivedAt: str(r.arrived_at),
  completedAt: str(r.completed_at),
  cancelledAt: str(r.cancelled_at),
  cancelReason: str(r.cancel_reason),
  rating: num(r.rating),
  ratingComment: str(r.rating_comment),
  searchStartedAt: String(r.search_started_at),
  source: (str(r.source) ?? 'app') as RequestSource,
  createdBy: str(r.created_by),
});

export const mapApiKey = (r: Row): ApiKey => ({
  id: String(r.id),
  name: String(r.name),
  prefix: String(r.prefix),
  scopes: json<ApiScope[]>(r.scopes, []),
  createdBy: String(r.created_by),
  createdAt: String(r.created_at),
  lastUsedAt: str(r.last_used_at),
  revokedAt: str(r.revoked_at),
});

export const mapWebhook = (r: Row): Webhook => ({
  id: String(r.id),
  name: String(r.name),
  url: String(r.url),
  events: json<string[]>(r.events, ['*']),
  active: r.active === 1,
  createdBy: String(r.created_by),
  createdAt: String(r.created_at),
});

export const mapDelivery = (r: Row): WebhookDelivery => ({
  id: String(r.id),
  webhookId: String(r.webhook_id),
  eventType: String(r.event_type),
  attempt: Number(r.attempt),
  success: r.success === 1,
  statusCode: num(r.status_code),
  error: str(r.error),
  createdAt: String(r.created_at),
});

export const mapOffer = (r: Row): Offer => ({
  id: String(r.id),
  requestId: String(r.request_id),
  responderId: String(r.responder_id),
  status: r.status as Offer['status'],
  distanceM: Number(r.distance_m),
  etaSeconds: Number(r.eta_seconds),
  offeredAt: String(r.offered_at),
  expiresAt: String(r.expires_at),
  respondedAt: str(r.responded_at),
});

export const mapEvent = (r: Row): RequestEvent => ({
  id: String(r.id),
  requestId: String(r.request_id),
  type: String(r.type),
  actor: String(r.actor),
  actorName: str(r.actor_name),
  note: str(r.note),
  createdAt: String(r.created_at),
});

const RESPONDER_SELECT = `SELECT r.*, u.name, u.phone FROM responders r JOIN users u ON u.id = r.user_id`;
const REQUEST_SELECT = `SELECT q.*, u.name AS requester_name, u.phone AS requester_phone FROM requests q JOIN users u ON u.id = q.requester_id`;

export class Repositories {
  constructor(private readonly db: Db) {}

  // ---- users -------------------------------------------------------------
  getUser(id: string): User | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    return r && mapUser(r);
  }
  getUserByTokenHash(hash: string): User | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM users WHERE token_hash = ?').get(hash));
    return r && mapUser(r);
  }
  getUserByPhoneRole(phone: string, role: Role): User | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM users WHERE phone = ? AND role = ?').get(phone, role));
    return r && mapUser(r);
  }
  createUser(u: { role: Role; name: string; phone: string; tokenHash: string }): User {
    const id = newId();
    const t = nowIso();
    this.db
      .prepare('INSERT INTO users (id, role, name, phone, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, u.role, u.name, u.phone, u.tokenHash, t, t);
    return this.getUser(id)!;
  }
  rotateUserToken(id: string, tokenHash: string, name?: string) {
    this.db
      .prepare('UPDATE users SET token_hash = ?, name = COALESCE(?, name), last_seen_at = ? WHERE id = ?')
      .run(tokenHash, name ?? null, nowIso(), id);
  }
  touchUser(id: string) {
    this.db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
  }

  // ---- responders --------------------------------------------------------
  getResponder(userId: string): Responder | undefined {
    const r = row<Row>(this.db.prepare(`${RESPONDER_SELECT} WHERE r.user_id = ?`).get(userId));
    return r && mapResponder(r);
  }
  listResponders(filter: { service?: Service; status?: ResponderStatus[] } = {}): Responder[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.service) {
      where.push('r.service = ?');
      params.push(filter.service);
    }
    if (filter.status?.length) {
      where.push(`r.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    const sql = `${RESPONDER_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.unit_name`;
    return rows<Row>(this.db.prepare(sql).all(...(params as never[]))).map(mapResponder);
  }
  upsertResponderProfile(p: {
    userId: string;
    service: Service;
    unitName: string;
    organisation?: string | null;
    vehicle?: string | null;
    capabilities?: string[];
  }): Responder {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO responders (user_id, service, unit_name, organisation, vehicle, capabilities, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET service = excluded.service, unit_name = excluded.unit_name,
           organisation = excluded.organisation, vehicle = excluded.vehicle, capabilities = excluded.capabilities,
           updated_at = excluded.updated_at`,
      )
      .run(p.userId, p.service, p.unitName, p.organisation ?? null, p.vehicle ?? null, JSON.stringify(p.capabilities ?? []), t);
    return this.getResponder(p.userId)!;
  }
  setResponderStatus(userId: string, status: ResponderStatus): Responder | undefined {
    this.db.prepare('UPDATE responders SET status = ?, updated_at = ? WHERE user_id = ?').run(status, nowIso(), userId);
    return this.getResponder(userId);
  }
  setResponderLocation(userId: string, lat: number, lng: number, heading: number | null): Responder | undefined {
    const t = nowIso();
    this.db
      .prepare('UPDATE responders SET lat = ?, lng = ?, heading = ?, location_at = ?, updated_at = ? WHERE user_id = ?')
      .run(lat, lng, heading, t, t, userId);
    return this.getResponder(userId);
  }
  addResponderRating(userId: string, rating: number) {
    this.db
      .prepare('UPDATE responders SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE user_id = ?')
      .run(rating, userId);
  }
  incrementJobs(userId: string) {
    this.db.prepare('UPDATE responders SET jobs_completed = jobs_completed + 1 WHERE user_id = ?').run(userId);
  }

  // ---- requests ----------------------------------------------------------
  getRequest(id: string): Request | undefined {
    const r = row<Row>(this.db.prepare(`${REQUEST_SELECT} WHERE q.id = ?`).get(id));
    return r && mapRequest(r);
  }
  listRequests(filter: { status?: RequestStatus[]; requesterId?: string; responderId?: string; limit?: number } = {}): Request[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status?.length) {
      where.push(`q.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    if (filter.requesterId) {
      where.push('q.requester_id = ?');
      params.push(filter.requesterId);
    }
    if (filter.responderId) {
      where.push('q.responder_id = ?');
      params.push(filter.responderId);
    }
    params.push(Math.min(filter.limit ?? 100, 500));
    const sql = `${REQUEST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.created_at DESC LIMIT ?`;
    return rows<Row>(this.db.prepare(sql).all(...(params as never[]))).map(mapRequest);
  }
  insertRequest(q: {
    id: string;
    reference: string;
    requesterId: string;
    service: Service;
    priority: string;
    lat: number;
    lng: number;
    address: string | null;
    description: string | null;
    flags: string[];
    source?: RequestSource;
    createdBy?: string | null;
  }): Request {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO requests (id, reference, requester_id, service, priority, lat, lng, address, description, flags, status, created_at, updated_at, search_started_at, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'searching', ?, ?, ?, ?, ?)`,
      )
      .run(q.id, q.reference, q.requesterId, q.service, q.priority, q.lat, q.lng, q.address, q.description, JSON.stringify(q.flags), t, t, t, q.source ?? 'app', q.createdBy ?? null);
    return this.getRequest(q.id)!;
  }
  /** Generic patch of mutable request columns. */
  updateRequest(
    id: string,
    patch: Partial<{
      status: RequestStatus;
      responderId: string | null;
      etaSeconds: number | null;
      assignedAt: string | null;
      enRouteAt: string | null;
      arrivedAt: string | null;
      completedAt: string | null;
      cancelledAt: string | null;
      cancelReason: string | null;
      rating: number | null;
      ratingComment: string | null;
      searchStartedAt: string;
    }>,
  ): Request | undefined {
    const cols: Record<string, string> = {
      status: 'status',
      responderId: 'responder_id',
      etaSeconds: 'eta_seconds',
      assignedAt: 'assigned_at',
      enRouteAt: 'en_route_at',
      arrivedAt: 'arrived_at',
      completedAt: 'completed_at',
      cancelledAt: 'cancelled_at',
      cancelReason: 'cancel_reason',
      rating: 'rating',
      ratingComment: 'rating_comment',
      searchStartedAt: 'search_started_at',
    };
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [nowIso()];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !cols[k]) continue;
      sets.push(`${cols[k]} = ?`);
      params.push(v);
    }
    params.push(id);
    this.db.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).run(...(params as never[]));
    return this.getRequest(id);
  }
  addEvent(e: { requestId: string; type: string; actor: string; note?: string | null }): RequestEvent {
    const id = newId();
    this.db
      .prepare('INSERT INTO request_events (id, request_id, type, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, e.requestId, e.type, e.actor, e.note ?? null, nowIso());
    return mapEvent(row<Row>(this.db.prepare('SELECT * FROM request_events WHERE id = ?').get(id))!);
  }
  listEvents(requestId: string): RequestEvent[] {
    return rows<Row>(
      this.db
        .prepare(
          `SELECT e.*, COALESCE(r.unit_name, u.name) AS actor_name
           FROM request_events e
           LEFT JOIN users u ON u.id = e.actor
           LEFT JOIN responders r ON r.user_id = e.actor
           WHERE e.request_id = ? ORDER BY e.created_at`,
        )
        .all(requestId),
    ).map(mapEvent);
  }
  addLocationPoint(requestId: string, responderId: string, lat: number, lng: number) {
    this.db
      .prepare('INSERT INTO location_history (id, request_id, responder_id, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), requestId, responderId, lat, lng, nowIso());
  }
  listTrail(requestId: string): { lat: number; lng: number; at: string }[] {
    return rows<Row>(this.db.prepare('SELECT lat, lng, created_at FROM location_history WHERE request_id = ? ORDER BY created_at').all(requestId)).map(
      (r) => ({ lat: Number(r.lat), lng: Number(r.lng), at: String(r.created_at) }),
    );
  }

  // ---- offers ------------------------------------------------------------
  getOffer(id: string): Offer | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM offers WHERE id = ?').get(id));
    return r && mapOffer(r);
  }
  listOffers(filter: { requestId?: string; responderId?: string; status?: Offer['status'][] } = {}): Offer[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.requestId) {
      where.push('request_id = ?');
      params.push(filter.requestId);
    }
    if (filter.responderId) {
      where.push('responder_id = ?');
      params.push(filter.responderId);
    }
    if (filter.status?.length) {
      where.push(`status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    const sql = `SELECT * FROM offers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY offered_at`;
    return rows<Row>(this.db.prepare(sql).all(...(params as never[]))).map(mapOffer);
  }
  insertOffer(o: { requestId: string; responderId: string; distanceM: number; etaSeconds: number; expiresAt: string }): Offer {
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO offers (id, request_id, responder_id, status, distance_m, eta_seconds, offered_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, o.requestId, o.responderId, 'pending', o.distanceM, o.etaSeconds, nowIso(), o.expiresAt);
    return this.getOffer(id)!;
  }
  setOfferStatus(id: string, status: Offer['status']): Offer | undefined {
    this.db.prepare('UPDATE offers SET status = ?, responded_at = ? WHERE id = ?').run(status, nowIso(), id);
    return this.getOffer(id);
  }
  listExpiredPendingOffers(nowIsoStr: string): Offer[] {
    return rows<Row>(this.db.prepare("SELECT * FROM offers WHERE status = 'pending' AND expires_at <= ?").all(nowIsoStr)).map(mapOffer);
  }

  // ---- api keys ----------------------------------------------------------
  listApiKeys(): ApiKey[] {
    return rows<Row>(this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all()).map(mapApiKey);
  }
  getApiKeyByHash(hash: string): ApiKey | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(hash));
    return r && mapApiKey(r);
  }
  createApiKey(k: { name: string; prefix: string; keyHash: string; scopes: ApiScope[]; createdBy: string }): ApiKey {
    const id = newId();
    this.db
      .prepare('INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, k.name, k.prefix, k.keyHash, JSON.stringify(k.scopes), k.createdBy, nowIso());
    return mapApiKey(row<Row>(this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id))!);
  }
  touchApiKey(id: string) {
    this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), id);
  }
  revokeApiKey(id: string): boolean {
    return this.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id).changes > 0;
  }

  // ---- webhooks ----------------------------------------------------------
  listWebhooks(activeOnly = false): Webhook[] {
    const sql = activeOnly ? 'SELECT * FROM webhooks WHERE active = 1 ORDER BY created_at' : 'SELECT * FROM webhooks ORDER BY created_at';
    return rows<Row>(this.db.prepare(sql).all()).map(mapWebhook);
  }
  getWebhook(id: string): (Webhook & { secret: string }) | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id));
    return r && { ...mapWebhook(r), secret: String(r.secret) };
  }
  createWebhook(w: { name: string; url: string; secret: string; events: string[]; createdBy: string }): Webhook {
    const id = newId();
    this.db
      .prepare('INSERT INTO webhooks (id, name, url, secret, events, active, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, w.name, w.url, w.secret, JSON.stringify(w.events), w.createdBy, nowIso());
    return this.getWebhook(id)!;
  }
  updateWebhook(id: string, patch: Partial<{ name: string; url: string; events: string[]; active: boolean }>): Webhook | undefined {
    const cur = this.getWebhook(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.db
      .prepare('UPDATE webhooks SET name = ?, url = ?, events = ?, active = ? WHERE id = ?')
      .run(next.name, next.url, JSON.stringify(next.events), next.active ? 1 : 0, id);
    return this.getWebhook(id);
  }
  deleteWebhook(id: string): boolean {
    return this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes > 0;
  }
  addWebhookDelivery(d: { webhookId: string; eventType: string; attempt: number; success: boolean; statusCode: number | null; error: string | null }) {
    this.db
      .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_type, attempt, success, status_code, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), d.webhookId, d.eventType, d.attempt, d.success ? 1 : 0, d.statusCode, d.error, nowIso());
  }
  listWebhookDeliveries(webhookId: string, limit = 50): WebhookDelivery[] {
    return rows<Row>(this.db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?').all(webhookId, limit)).map(mapDelivery);
  }

  // ---- one-time codes ----------------------------------------------------
  getOtp(phone: string): { codeHash: string; expiresAt: string; attempts: number } | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(phone));
    return r && { codeHash: String(r.code_hash), expiresAt: String(r.expires_at), attempts: Number(r.attempts) };
  }
  upsertOtp(phone: string, codeHash: string, expiresAt: string) {
    this.db
      .prepare(
        `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
      )
      .run(phone, codeHash, expiresAt, nowIso());
  }
  bumpOtpAttempts(phone: string) {
    this.db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
  }
  deleteOtp(phone: string) {
    this.db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
  }

  // ---- push subscriptions ------------------------------------------------
  listPushSubscriptions(userId: string): PushSubscriptionRecord[] {
    return rows<Row>(this.db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      endpoint: String(r.endpoint),
      keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
      createdAt: String(r.created_at),
    }));
  }
  upsertPushSubscription(userId: string, endpoint: string, p256dh: string, auth: string) {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(newId(), userId, endpoint, p256dh, auth, nowIso());
  }
  deletePushSubscription(endpoint: string) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
  countPushSubscriptions(userId: string): number {
    return Number((row<Row>(this.db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(userId)) ?? { c: 0 }).c);
  }

  // ---- audit / stats -----------------------------------------------------
  audit(entry: { actor: string; action: string; entityType: string; entityId?: string | null; details?: unknown }) {
    this.db
      .prepare('INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), entry.actor, entry.action, entry.entityType, entry.entityId ?? null, entry.details === undefined ? null : JSON.stringify(entry.details), nowIso());
  }
  listAudit(limit = 200) {
    return rows<Row>(this.db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit)).map((r) => ({
      id: String(r.id),
      actor: String(r.actor),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: str(r.entity_id),
      details: json(r.details, null),
      createdAt: String(r.created_at),
    }));
  }
  stats() {
    const r = row<Row>(
      this.db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM requests WHERE status = 'searching') AS searching,
            (SELECT COUNT(*) FROM requests WHERE status IN ('assigned','en_route','arrived')) AS active,
            (SELECT COUNT(*) FROM requests WHERE status = 'unfulfilled') AS unfulfilled,
            (SELECT COUNT(*) FROM requests WHERE created_at >= datetime('now','-1 day')) AS requests_24h,
            (SELECT COUNT(*) FROM responders WHERE status = 'available') AS available,
            (SELECT COUNT(*) FROM responders WHERE status = 'busy') AS busy,
            (SELECT AVG((julianday(assigned_at) - julianday(created_at)) * 86400) FROM requests WHERE assigned_at IS NOT NULL AND created_at >= datetime('now','-1 day')) AS avg_assign_s,
            (SELECT AVG((julianday(arrived_at) - julianday(created_at)) * 86400) FROM requests WHERE arrived_at IS NOT NULL AND created_at >= datetime('now','-1 day')) AS avg_arrival_s`,
        )
        .get(),
    )!;
    return {
      searching: Number(r.searching),
      active: Number(r.active),
      unfulfilled: Number(r.unfulfilled),
      requests24h: Number(r.requests_24h),
      respondersAvailable: Number(r.available),
      respondersBusy: Number(r.busy),
      avgAssignSeconds: r.avg_assign_s === null ? null : Math.round(Number(r.avg_assign_s)),
      avgArrivalSeconds: r.avg_arrival_s === null ? null : Math.round(Number(r.avg_arrival_s)),
    };
  }
}
