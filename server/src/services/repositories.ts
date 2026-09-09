import type { Db } from '../db/db.js';
import { row, rows } from '../db/db.js';
import { newId, nowIso } from '../domain/ids.js';
import type {
  Alert,
  Camera,
  Dispatch,
  DispatchDelivery,
  DispatchEvent,
  Responder,
  Site,
} from '../domain/types.js';

// ---- mappers --------------------------------------------------------------

type Row = Record<string, unknown>;
const bool = (v: unknown) => v === 1 || v === true;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const mapSite = (r: Row): Site => ({
  id: String(r.id),
  name: String(r.name),
  address: str(r.address),
  latitude: num(r.latitude),
  longitude: num(r.longitude),
  externalRef: str(r.external_ref),
  defaultResponderId: str(r.default_responder_id),
  notes: str(r.notes),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export const mapCamera = (r: Row): Camera => ({
  id: String(r.id),
  siteId: String(r.site_id),
  name: String(r.name),
  externalRef: str(r.external_ref),
  createdAt: String(r.created_at),
});

export const mapResponder = (r: Row): Responder => ({
  id: String(r.id),
  name: String(r.name),
  type: r.type as Responder['type'],
  channel: r.channel as Responder['channel'],
  channelConfig: JSON.parse(String(r.channel_config ?? '{}')),
  phone: str(r.phone),
  email: str(r.email),
  active: bool(r.active),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export const mapAlert = (r: Row): Alert => ({
  id: String(r.id),
  source: String(r.source),
  externalId: str(r.external_id),
  siteId: str(r.site_id),
  siteName: str(r.site_name),
  cameraId: str(r.camera_id),
  cameraName: str(r.camera_name),
  eventType: String(r.event_type),
  confidence: num(r.confidence),
  severity: r.severity as Alert['severity'],
  title: String(r.title),
  description: str(r.description),
  snapshotUrl: str(r.snapshot_url),
  clipUrl: str(r.clip_url),
  occurredAt: String(r.occurred_at),
  receivedAt: String(r.received_at),
  status: r.status as Alert['status'],
  handledBy: str(r.handled_by),
  handledAt: str(r.handled_at),
  dispatchId: str(r.dispatch_id),
});

export const mapDispatch = (r: Row): Dispatch => ({
  id: String(r.id),
  reference: String(r.reference),
  alertId: str(r.alert_id),
  siteId: str(r.site_id),
  siteName: str(r.site_name),
  responderId: String(r.responder_id),
  responderName: String(r.responder_name ?? ''),
  priority: r.priority as Dispatch['priority'],
  reason: String(r.reason),
  notes: str(r.notes),
  requestedBy: String(r.requested_by),
  status: r.status as Dispatch['status'],
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  closedAt: str(r.closed_at),
});

export const mapDispatchEvent = (r: Row): DispatchEvent => ({
  id: String(r.id),
  dispatchId: String(r.dispatch_id),
  fromStatus: (str(r.from_status) as DispatchEvent['fromStatus']) ?? null,
  toStatus: r.to_status as DispatchEvent['toStatus'],
  actor: String(r.actor),
  note: str(r.note),
  createdAt: String(r.created_at),
});

export const mapDelivery = (r: Row): DispatchDelivery => ({
  id: String(r.id),
  dispatchId: String(r.dispatch_id),
  channel: String(r.channel),
  attempt: Number(r.attempt),
  success: bool(r.success),
  detail: str(r.detail),
  createdAt: String(r.created_at),
});

// ---- SQL fragments --------------------------------------------------------

const ALERT_SELECT = `
  SELECT a.*, s.name AS site_name, c.name AS camera_name,
         (SELECT d.id FROM dispatches d WHERE d.alert_id = a.id ORDER BY d.created_at DESC LIMIT 1) AS dispatch_id
  FROM alerts a
  LEFT JOIN sites s ON s.id = a.site_id
  LEFT JOIN cameras c ON c.id = a.camera_id`;

const DISPATCH_SELECT = `
  SELECT d.*, s.name AS site_name, r.name AS responder_name
  FROM dispatches d
  LEFT JOIN sites s ON s.id = d.site_id
  LEFT JOIN responders r ON r.id = d.responder_id`;

// ---- repositories ---------------------------------------------------------

export class Repositories {
  constructor(private readonly db: Db) {}

  // Sites
  listSites(): Site[] {
    return rows<Row>(this.db.prepare('SELECT * FROM sites ORDER BY name').all()).map(mapSite);
  }
  getSite(id: string): Site | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM sites WHERE id = ?').get(id));
    return r && mapSite(r);
  }
  getSiteByExternalRef(ref: string): Site | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM sites WHERE external_ref = ?').get(ref));
    return r && mapSite(r);
  }
  createSite(input: Partial<Site> & { name: string }): Site {
    const id = input.id ?? newId();
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO sites (id, name, address, latitude, longitude, external_ref, default_responder_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.externalRef ?? null,
        input.defaultResponderId ?? null,
        input.notes ?? null,
        t,
        t,
      );
    return this.getSite(id)!;
  }
  updateSite(id: string, patch: Partial<Site>): Site | undefined {
    const cur = this.getSite(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE sites SET name=?, address=?, latitude=?, longitude=?, external_ref=?, default_responder_id=?, notes=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.address,
        next.latitude,
        next.longitude,
        next.externalRef,
        next.defaultResponderId,
        next.notes,
        next.updatedAt,
        id,
      );
    return this.getSite(id);
  }

  // Cameras
  listCameras(siteId?: string): Camera[] {
    const q = siteId
      ? this.db.prepare('SELECT * FROM cameras WHERE site_id = ? ORDER BY name').all(siteId)
      : this.db.prepare('SELECT * FROM cameras ORDER BY name').all();
    return rows<Row>(q).map(mapCamera);
  }
  getCameraByExternalRef(ref: string): Camera | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM cameras WHERE external_ref = ?').get(ref));
    return r && mapCamera(r);
  }
  createCamera(input: { siteId: string; name: string; externalRef?: string | null; id?: string }): Camera {
    const id = input.id ?? newId();
    this.db
      .prepare('INSERT INTO cameras (id, site_id, name, external_ref, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.siteId, input.name, input.externalRef ?? null, nowIso());
    return mapCamera(row<Row>(this.db.prepare('SELECT * FROM cameras WHERE id = ?').get(id))!);
  }

  // Responders
  listResponders(includeInactive = false): Responder[] {
    const sql = includeInactive
      ? 'SELECT * FROM responders ORDER BY name'
      : 'SELECT * FROM responders WHERE active = 1 ORDER BY name';
    return rows<Row>(this.db.prepare(sql).all()).map(mapResponder);
  }
  getResponder(id: string): Responder | undefined {
    const r = row<Row>(this.db.prepare('SELECT * FROM responders WHERE id = ?').get(id));
    return r && mapResponder(r);
  }
  createResponder(input: Omit<Responder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Responder {
    const id = input.id ?? newId();
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO responders (id, name, type, channel, channel_config, phone, email, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.type,
        input.channel,
        JSON.stringify(input.channelConfig ?? {}),
        input.phone ?? null,
        input.email ?? null,
        input.active ? 1 : 0,
        t,
        t,
      );
    return this.getResponder(id)!;
  }
  updateResponder(id: string, patch: Partial<Responder>): Responder | undefined {
    const cur = this.getResponder(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE responders SET name=?, type=?, channel=?, channel_config=?, phone=?, email=?, active=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.type,
        next.channel,
        JSON.stringify(next.channelConfig ?? {}),
        next.phone,
        next.email,
        next.active ? 1 : 0,
        next.updatedAt,
        id,
      );
    return this.getResponder(id);
  }

  // Alerts
  listAlerts(filter: { status?: string[]; siteId?: string; limit?: number; since?: string } = {}): Alert[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status?.length) {
      where.push(`a.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    if (filter.siteId) {
      where.push('a.site_id = ?');
      params.push(filter.siteId);
    }
    if (filter.since) {
      where.push('a.received_at >= ?');
      params.push(filter.since);
    }
    const sql = `${ALERT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.received_at DESC LIMIT ?`;
    params.push(Math.min(filter.limit ?? 100, 500));
    return rows<Row>(this.db.prepare(sql).all(...(params as never[]))).map(mapAlert);
  }
  getAlert(id: string): Alert | undefined {
    const r = row<Row>(this.db.prepare(`${ALERT_SELECT} WHERE a.id = ?`).get(id));
    return r && mapAlert(r);
  }
  getAlertByExternalId(source: string, externalId: string): Alert | undefined {
    const r = row<Row>(
      this.db.prepare(`${ALERT_SELECT} WHERE a.source = ? AND a.external_id = ?`).get(source, externalId),
    );
    return r && mapAlert(r);
  }
  getAlertRaw(id: string): unknown {
    const r = row<Row>(this.db.prepare('SELECT raw_payload FROM alerts WHERE id = ?').get(id));
    return r ? JSON.parse(String(r.raw_payload)) : undefined;
  }
  insertAlert(a: {
    id: string;
    source: string;
    externalId: string | null;
    siteId: string | null;
    cameraId: string | null;
    eventType: string;
    confidence: number | null;
    severity: string;
    title: string;
    description: string | null;
    snapshotUrl: string | null;
    clipUrl: string | null;
    occurredAt: string;
    receivedAt: string;
    status: string;
    raw: unknown;
  }): Alert {
    this.db
      .prepare(
        `INSERT INTO alerts (id, source, external_id, site_id, camera_id, event_type, confidence, severity, title, description,
                             snapshot_url, clip_url, occurred_at, received_at, status, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.source,
        a.externalId,
        a.siteId,
        a.cameraId,
        a.eventType,
        a.confidence,
        a.severity,
        a.title,
        a.description,
        a.snapshotUrl,
        a.clipUrl,
        a.occurredAt,
        a.receivedAt,
        a.status,
        JSON.stringify(a.raw ?? null),
      );
    return this.getAlert(a.id)!;
  }
  setAlertStatus(id: string, status: string, actor: string): Alert | undefined {
    this.db
      .prepare('UPDATE alerts SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?')
      .run(status, actor, nowIso(), id);
    return this.getAlert(id);
  }

  // Dispatches
  listDispatches(filter: { status?: string[]; limit?: number; alertId?: string } = {}): Dispatch[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status?.length) {
      where.push(`d.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    if (filter.alertId) {
      where.push('d.alert_id = ?');
      params.push(filter.alertId);
    }
    const sql = `${DISPATCH_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.created_at DESC LIMIT ?`;
    params.push(Math.min(filter.limit ?? 100, 500));
    return rows<Row>(this.db.prepare(sql).all(...(params as never[]))).map(mapDispatch);
  }
  getDispatch(id: string): Dispatch | undefined {
    const r = row<Row>(this.db.prepare(`${DISPATCH_SELECT} WHERE d.id = ?`).get(id));
    return r && mapDispatch(r);
  }
  getDispatchByReference(reference: string): (Dispatch & { callbackToken: string }) | undefined {
    const r = row<Row>(this.db.prepare(`${DISPATCH_SELECT} WHERE d.reference = ?`).get(reference));
    return r && { ...mapDispatch(r), callbackToken: String(r.callback_token) };
  }
  insertDispatch(d: {
    id: string;
    reference: string;
    alertId: string | null;
    siteId: string | null;
    responderId: string;
    priority: string;
    reason: string;
    notes: string | null;
    requestedBy: string;
    callbackToken: string;
  }): Dispatch {
    const t = nowIso();
    this.db
      .prepare(
        `INSERT INTO dispatches (id, reference, alert_id, site_id, responder_id, priority, reason, notes, requested_by, status, callback_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
      )
      .run(
        d.id,
        d.reference,
        d.alertId,
        d.siteId,
        d.responderId,
        d.priority,
        d.reason,
        d.notes,
        d.requestedBy,
        d.callbackToken,
        t,
        t,
      );
    return this.getDispatch(d.id)!;
  }
  setDispatchStatus(id: string, status: string, closed: boolean): Dispatch | undefined {
    const t = nowIso();
    this.db
      .prepare('UPDATE dispatches SET status = ?, updated_at = ?, closed_at = COALESCE(closed_at, ?) WHERE id = ?')
      .run(status, t, closed ? t : null, id);
    return this.getDispatch(id);
  }
  insertDispatchEvent(e: {
    dispatchId: string;
    fromStatus: string | null;
    toStatus: string;
    actor: string;
    note: string | null;
  }): DispatchEvent {
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO dispatch_events (id, dispatch_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, e.dispatchId, e.fromStatus, e.toStatus, e.actor, e.note, nowIso());
    return mapDispatchEvent(row<Row>(this.db.prepare('SELECT * FROM dispatch_events WHERE id = ?').get(id))!);
  }
  listDispatchEvents(dispatchId: string): DispatchEvent[] {
    return rows<Row>(
      this.db.prepare('SELECT * FROM dispatch_events WHERE dispatch_id = ? ORDER BY created_at').all(dispatchId),
    ).map(mapDispatchEvent);
  }
  insertDelivery(d: { dispatchId: string; channel: string; attempt: number; success: boolean; detail: string | null }) {
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO dispatch_deliveries (id, dispatch_id, channel, attempt, success, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, d.dispatchId, d.channel, d.attempt, d.success ? 1 : 0, d.detail, nowIso());
    return mapDelivery(row<Row>(this.db.prepare('SELECT * FROM dispatch_deliveries WHERE id = ?').get(id))!);
  }
  listDeliveries(dispatchId: string): DispatchDelivery[] {
    return rows<Row>(
      this.db.prepare('SELECT * FROM dispatch_deliveries WHERE dispatch_id = ? ORDER BY created_at').all(dispatchId),
    ).map(mapDelivery);
  }

  // Audit
  audit(entry: { actor: string; action: string; entityType: string; entityId?: string | null; details?: unknown }) {
    this.db
      .prepare(
        'INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId(),
        entry.actor,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.details === undefined ? null : JSON.stringify(entry.details),
        nowIso(),
      );
  }
  listAudit(limit = 200) {
    return rows<Row>(this.db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit)).map(
      (r) => ({
        id: String(r.id),
        actor: String(r.actor),
        action: String(r.action),
        entityType: String(r.entity_type),
        entityId: str(r.entity_id),
        details: r.details ? JSON.parse(String(r.details)) : null,
        createdAt: String(r.created_at),
      }),
    );
  }

  // Stats for the dashboard header
  stats() {
    const r = row<Row>(
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM alerts WHERE status = 'new') AS new_alerts,
             (SELECT COUNT(*) FROM alerts WHERE status = 'acknowledged') AS acknowledged_alerts,
             (SELECT COUNT(*) FROM dispatches WHERE status NOT IN ('resolved','cancelled')) AS active_dispatches,
             (SELECT COUNT(*) FROM dispatches WHERE created_at >= datetime('now','-1 day')) AS dispatches_24h,
             (SELECT COUNT(*) FROM alerts WHERE received_at >= datetime('now','-1 day')) AS alerts_24h`,
        )
        .get(),
    )!;
    return {
      newAlerts: Number(r.new_alerts),
      acknowledgedAlerts: Number(r.acknowledged_alerts),
      activeDispatches: Number(r.active_dispatches),
      dispatches24h: Number(r.dispatches_24h),
      alerts24h: Number(r.alerts_24h),
    };
  }
}
