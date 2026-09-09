import { canTransition, InvalidTransitionError, isTerminal } from '../domain/dispatchStateMachine.js';
import { newId, newReference, newToken } from '../domain/ids.js';
import type { Dispatch, DispatchStatus, Priority } from '../domain/types.js';
import type { OutboundChannel } from '../integrations/outbound/types.js';
import { ConflictError, NotFoundError, type AlertService } from './alertService.js';
import type { EventBus } from './eventBus.js';
import type { Repositories } from './repositories.js';

export interface CreateDispatchInput {
  alertId?: string | null;
  siteId?: string | null;
  responderId?: string | null;
  priority: Priority;
  reason?: string;
  notes?: string | null;
  requestedBy: string;
}

export interface DispatchServiceOptions {
  publicBaseUrl: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Await delivery before returning (tests); default fire-and-forget. */
  awaitDelivery?: boolean;
}

export class DispatchService {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly repo: Repositories,
    private readonly alerts: AlertService,
    private readonly bus: EventBus,
    private readonly channels: Map<string, OutboundChannel>,
    private readonly opts: DispatchServiceOptions,
    private readonly log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void } = console,
  ) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
  }

  list = (filter: Parameters<Repositories['listDispatches']>[0]) => this.repo.listDispatches(filter);
  get = (id: string) => this.repo.getDispatch(id);

  detail(id: string) {
    const dispatch = this.repo.getDispatch(id);
    if (!dispatch) throw new NotFoundError('Dispatch');
    return {
      dispatch,
      alert: dispatch.alertId ? this.repo.getAlert(dispatch.alertId) ?? null : null,
      site: dispatch.siteId ? this.repo.getSite(dispatch.siteId) ?? null : null,
      responder: this.repo.getResponder(dispatch.responderId) ?? null,
      events: this.repo.listDispatchEvents(id),
      deliveries: this.repo.listDeliveries(id),
      callbackUrl: this.callbackUrl(dispatch.reference, this.repo.getDispatchByReference(dispatch.reference)!.callbackToken),
    };
  }

  /**
   * The "DISPATCH" button. Creates the dispatch record, marks the alert as
   * dispatched, and notifies the responder over their configured channel.
   */
  async create(input: CreateDispatchInput): Promise<Dispatch> {
    const alert = input.alertId ? this.repo.getAlert(input.alertId) : undefined;
    if (input.alertId && !alert) throw new NotFoundError('Alert');
    if (alert?.status === 'dispatched') {
      const open = this.repo
        .listDispatches({ alertId: alert.id })
        .find((d) => !isTerminal(d.status));
      if (open) throw new ConflictError(`Alert already has an active dispatch (${open.reference})`);
    }
    if (alert?.status === 'dismissed') throw new ConflictError('Alert was dismissed; reopen before dispatching');

    const siteId = input.siteId ?? alert?.siteId ?? null;
    const site = siteId ? this.repo.getSite(siteId) : undefined;
    if (siteId && !site) throw new NotFoundError('Site');

    const responderId = input.responderId ?? site?.defaultResponderId ?? null;
    if (!responderId) throw new ConflictError('No responder selected and the site has no default responder');
    const responder = this.repo.getResponder(responderId);
    if (!responder) throw new NotFoundError('Responder');
    if (!responder.active) throw new ConflictError(`Responder ${responder.name} is inactive`);

    const reason = input.reason?.trim() || alert?.title || 'Suspicious activity reported by operator';

    const dispatch = this.repo.insertDispatch({
      id: newId(),
      reference: newReference(),
      alertId: alert?.id ?? null,
      siteId,
      responderId,
      priority: input.priority,
      reason,
      notes: input.notes ?? null,
      requestedBy: input.requestedBy,
      callbackToken: newToken(),
    });
    this.repo.insertDispatchEvent({
      dispatchId: dispatch.id,
      fromStatus: null,
      toStatus: 'requested',
      actor: input.requestedBy,
      note: reason,
    });
    this.repo.audit({
      actor: input.requestedBy,
      action: 'dispatch.created',
      entityType: 'dispatch',
      entityId: dispatch.id,
      details: { reference: dispatch.reference, responderId, priority: input.priority, alertId: alert?.id },
    });
    if (alert) this.alerts.markDispatched(alert.id, input.requestedBy);
    this.bus.publish('dispatch.created', dispatch);

    const delivery = this.deliver(dispatch.id);
    if (this.opts.awaitDelivery) await delivery;
    else delivery.catch((err) => this.log.error({ err, dispatchId: dispatch.id }, 'dispatch delivery crashed'));

    return dispatch;
  }

  /** Notify the responder with retries; every attempt is recorded. */
  async deliver(dispatchId: string): Promise<boolean> {
    const detail = this.detail(dispatchId);
    if (!detail.responder) return false;
    const channel = this.channels.get(detail.responder.channel);
    if (!channel) {
      this.repo.insertDelivery({
        dispatchId,
        channel: detail.responder.channel,
        attempt: 1,
        success: false,
        detail: `Unknown channel '${detail.responder.channel}'`,
      });
      return false;
    }
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const result = await channel.send({
        dispatch: detail.dispatch,
        alert: detail.alert,
        site: detail.site,
        responder: detail.responder,
        callbackUrl: detail.callbackUrl,
      });
      const rec = this.repo.insertDelivery({
        dispatchId,
        channel: channel.name,
        attempt,
        success: result.success,
        detail: result.detail,
      });
      this.bus.publish('dispatch.delivery', rec);
      if (result.success) return true;
      this.log.error({ dispatchId, attempt, detail: result.detail }, 'dispatch delivery failed');
      if (attempt < this.maxAttempts) await sleep(this.retryDelayMs * attempt);
    }
    return false;
  }

  transition(id: string, to: DispatchStatus, actor: string, note?: string | null): Dispatch {
    const cur = this.repo.getDispatch(id);
    if (!cur) throw new NotFoundError('Dispatch');
    if (!canTransition(cur.status, to)) throw new InvalidTransitionError(cur.status, to);
    const updated = this.repo.setDispatchStatus(id, to, isTerminal(to))!;
    this.repo.insertDispatchEvent({ dispatchId: id, fromStatus: cur.status, toStatus: to, actor, note: note ?? null });
    this.repo.audit({ actor, action: `dispatch.${to}`, entityType: 'dispatch', entityId: id, details: { note } });
    if (to === 'cancelled' && cur.alertId) this.alerts.reopen(cur.alertId, actor);
    this.bus.publish('dispatch.updated', updated);
    return updated;
  }

  /** Responder-side callback authenticated by the per-dispatch token. */
  transitionByReference(reference: string, token: string, to: DispatchStatus, actor: string, note?: string | null) {
    const d = this.repo.getDispatchByReference(reference);
    if (!d || d.callbackToken !== token) throw new NotFoundError('Dispatch');
    return this.transition(d.id, to, actor, note);
  }

  callbackUrl(reference: string, token: string): string {
    return `${this.opts.publicBaseUrl.replace(/\/$/, '')}/api/dispatches/callback/${reference}?token=${token}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
