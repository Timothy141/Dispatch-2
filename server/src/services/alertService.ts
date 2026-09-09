import { newId, nowIso } from '../domain/ids.js';
import type { Alert, NormalizedAlert } from '../domain/types.js';
import type { EventBus } from './eventBus.js';
import type { Repositories } from './repositories.js';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface AlertServiceOptions {
  minConfidence: number | null;
}

export class AlertService {
  constructor(
    private readonly repo: Repositories,
    private readonly bus: EventBus,
    private readonly opts: AlertServiceOptions = { minConfidence: null },
  ) {}

  /**
   * Persist a normalized alert. Idempotent on (source, externalId).
   * Unknown sites/cameras are auto-created so alerts are never dropped.
   */
  ingest(n: NormalizedAlert): { alert: Alert; created: boolean } {
    if (n.externalId) {
      const existing = this.repo.getAlertByExternalId(n.source, n.externalId);
      if (existing) return { alert: existing, created: false };
    }

    let siteId: string | null = null;
    if (n.site.externalRef) {
      const site =
        this.repo.getSiteByExternalRef(n.site.externalRef) ??
        this.repo.createSite({
          name: n.site.name ?? `Site ${n.site.externalRef}`,
          externalRef: n.site.externalRef,
        });
      siteId = site.id;
    } else if (n.site.name) {
      const site =
        this.repo.listSites().find((s) => s.name.toLowerCase() === n.site.name!.toLowerCase()) ??
        this.repo.createSite({ name: n.site.name });
      siteId = site.id;
    }

    let cameraId: string | null = null;
    if (n.camera.externalRef && siteId) {
      const cam =
        this.repo.getCameraByExternalRef(n.camera.externalRef) ??
        this.repo.createCamera({
          siteId,
          name: n.camera.name ?? `Camera ${n.camera.externalRef}`,
          externalRef: n.camera.externalRef,
        });
      cameraId = cam.id;
    } else if (n.camera.name && siteId) {
      const cam =
        this.repo.listCameras(siteId).find((c) => c.name.toLowerCase() === n.camera.name!.toLowerCase()) ??
        this.repo.createCamera({ siteId, name: n.camera.name });
      cameraId = cam.id;
    }

    const belowThreshold =
      this.opts.minConfidence !== null && n.confidence !== null && n.confidence < this.opts.minConfidence;

    const alert = this.repo.insertAlert({
      id: newId(),
      source: n.source,
      externalId: n.externalId,
      siteId,
      cameraId,
      eventType: n.eventType,
      confidence: n.confidence,
      severity: n.severity,
      title: n.title,
      description: n.description,
      snapshotUrl: n.snapshotUrl,
      clipUrl: n.clipUrl,
      occurredAt: n.occurredAt,
      receivedAt: nowIso(),
      status: belowThreshold ? 'dismissed' : 'new',
      raw: n.raw,
    });
    this.repo.audit({
      actor: `source:${n.source}`,
      action: belowThreshold ? 'alert.auto_dismissed' : 'alert.received',
      entityType: 'alert',
      entityId: alert.id,
      details: { eventType: alert.eventType, confidence: alert.confidence },
    });
    this.bus.publish('alert.created', alert);
    return { alert, created: true };
  }

  list = (filter: Parameters<Repositories['listAlerts']>[0]) => this.repo.listAlerts(filter);
  get = (id: string) => this.repo.getAlert(id);
  raw = (id: string) => this.repo.getAlertRaw(id);

  acknowledge(id: string, actor: string): Alert {
    const alert = this.repo.getAlert(id);
    if (!alert) throw new NotFoundError('Alert');
    if (alert.status !== 'new') throw new ConflictError(`Alert is already ${alert.status}`);
    const updated = this.repo.setAlertStatus(id, 'acknowledged', actor)!;
    this.repo.audit({ actor, action: 'alert.acknowledged', entityType: 'alert', entityId: id });
    this.bus.publish('alert.updated', updated);
    return updated;
  }

  dismiss(id: string, actor: string, reason?: string): Alert {
    const alert = this.repo.getAlert(id);
    if (!alert) throw new NotFoundError('Alert');
    if (alert.status === 'dispatched') throw new ConflictError('Alert has been dispatched; cancel the dispatch instead');
    const updated = this.repo.setAlertStatus(id, 'dismissed', actor)!;
    this.repo.audit({ actor, action: 'alert.dismissed', entityType: 'alert', entityId: id, details: { reason } });
    this.bus.publish('alert.updated', updated);
    return updated;
  }

  /** Called by DispatchService once a dispatch exists for this alert. */
  markDispatched(id: string, actor: string): Alert {
    const updated = this.repo.setAlertStatus(id, 'dispatched', actor);
    if (!updated) throw new NotFoundError('Alert');
    this.bus.publish('alert.updated', updated);
    return updated;
  }

  /** Reopen an alert when its dispatch is cancelled so it is not lost. */
  reopen(id: string, actor: string): Alert | undefined {
    const alert = this.repo.getAlert(id);
    if (!alert || alert.status !== 'dispatched') return alert;
    const updated = this.repo.setAlertStatus(id, 'acknowledged', actor)!;
    this.bus.publish('alert.updated', updated);
    return updated;
  }
}
