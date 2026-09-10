import { createHmac } from 'node:crypto';
import type { Request } from '../domain/types.js';
import type { DomainEvent, EventBus } from './eventBus.js';
import type { Repositories } from './repositories.js';

export interface WebhookServiceOptions {
  timeoutMs: number;
  maxAttempts: number;
  fetchImpl?: typeof fetch;
  /** Await deliveries (tests). */
  awaitDelivery?: boolean;
}

/**
 * Outgoing webhooks so other cloud systems (control-room software, CRMs,
 * SMS gateways, Zapier/Make, data warehouses) can react to what happens here.
 *
 * Every delivery is a POST with JSON body
 *   { id, type, at, data }
 * and headers
 *   x-dispatch-event:     <type>
 *   x-dispatch-delivery:  <delivery id>
 *   x-dispatch-signature: sha256=<HMAC-SHA256 of the raw body with the webhook secret>
 */
export class WebhookService {
  private readonly fetchImpl: typeof fetch;
  private stop?: () => void;

  constructor(
    private readonly repo: Repositories,
    private readonly bus: EventBus,
    private readonly opts: WebhookServiceOptions,
    private readonly log: { warn: (o: unknown, m?: string) => void } = console,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  start() {
    this.stop = this.bus.subscribe((evt) => {
      // responder.location is high volume; only send it to hooks that ask for it explicitly.
      const p = this.dispatch(evt);
      if (this.opts.awaitDelivery) this.pending.push(p);
      else p.catch((err) => this.log.warn({ err }, 'webhook dispatch failed'));
    });
  }
  close() {
    this.stop?.();
  }
  /** Tests: wait for in-flight deliveries. */
  private pending: Promise<unknown>[] = [];
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  private async dispatch(evt: DomainEvent) {
    const hooks = this.repo.listWebhooks(true).filter((h) => matches(h.events, evt.type));
    if (!hooks.length) return;
    const body = JSON.stringify({ id: cryptoId(), type: evt.type, at: evt.at, data: externalPayload(evt) });
    await Promise.all(hooks.map((h) => this.deliver(h.id, evt.type, body)));
  }

  /** Deliver a raw body to one webhook with retries. Returns true on success. */
  async deliver(webhookId: string, eventType: string, body: string): Promise<boolean> {
    const hook = this.repo.getWebhook(webhookId);
    if (!hook) return false;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      let statusCode: number | null = null;
      let error: string | null = null;
      try {
        const res = await this.fetchImpl(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'dispatch-webhooks/1',
            'x-dispatch-event': eventType,
            'x-dispatch-delivery': cryptoId(),
            'x-dispatch-signature': sign(hook.secret, body),
          },
          body,
          signal: controller.signal,
        });
        statusCode = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
      this.repo.addWebhookDelivery({ webhookId, eventType, attempt, success: !error, statusCode, error });
      if (!error) return true;
      if (attempt < this.opts.maxAttempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    return false;
  }

  /** Send a synthetic ping so an integrator can verify their endpoint and signature. */
  async test(webhookId: string): Promise<boolean> {
    const body = JSON.stringify({ id: cryptoId(), type: 'ping', at: new Date().toISOString(), data: { message: 'Dispatch webhook test' } });
    return this.deliver(webhookId, 'ping', body);
  }
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function matches(subscribed: string[], type: string): boolean {
  if (type === 'responder.location') return subscribed.includes('responder.location');
  return subscribed.includes('*') || subscribed.includes(type) || subscribed.some((s) => s.endsWith('.*') && type.startsWith(s.slice(0, -1)));
}

const cryptoId = () => globalThis.crypto.randomUUID();

/** Strip internal-only fields before sending outside. */
function externalPayload(evt: DomainEvent): unknown {
  if (evt.type === 'request.created' || evt.type === 'request.updated') {
    const r = evt.data as Request;
    return {
      id: r.id,
      reference: r.reference,
      service: r.service,
      priority: r.priority,
      status: r.status,
      source: r.source,
      location: { lat: r.lat, lng: r.lng, address: r.address },
      description: r.description,
      flags: r.flags,
      contact: { name: r.requesterName, phone: r.requesterPhone },
      responderId: r.responderId,
      etaSeconds: r.etaSeconds,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      assignedAt: r.assignedAt,
      enRouteAt: r.enRouteAt,
      arrivedAt: r.arrivedAt,
      completedAt: r.completedAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      rating: r.rating,
    };
  }
  return evt.data;
}
