import webpush from 'web-push';
import type { Offer, Request } from '../domain/types.js';
import type { EventBus } from './eventBus.js';
import type { Repositories } from './repositories.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

type Logger = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };

/**
 * Web Push so a responder's phone rings a new offer even when the app is in
 * the background, and a requester is told when a unit accepts or arrives.
 * Disabled (enabled=false) until VAPID keys are configured.
 */
export class PushService {
  readonly enabled: boolean;
  private readonly send: PushSender;
  private stop?: () => void;
  private pending: Promise<unknown>[] = [];

  constructor(
    private readonly repo: Repositories,
    private readonly bus: EventBus,
    private readonly keys: { publicKey: string; privateKey: string; subject: string },
    private readonly log: Logger = console,
    sender?: PushSender,
  ) {
    this.enabled = Boolean(sender) || Boolean(keys.publicKey && keys.privateKey);
    if (sender) this.send = sender;
    else {
      if (this.enabled) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
      this.send = async (sub, payload) => {
        await webpush.sendNotification(sub, payload, { TTL: 60, urgency: 'high' });
      };
    }
  }

  start() {
    if (!this.enabled) return;
    this.stop = this.bus.subscribe((evt) => {
      let p: Promise<unknown> | undefined;
      if (evt.type === 'offer.created') {
        const { offer, request } = evt.data as { offer: Offer; request: Request };
        p = this.notifyUser(offer.responderId, {
          title: `${request.service.toUpperCase()} job · ${(offer.distanceM / 1000).toFixed(1)} km`,
          body: `${request.priority} · ${request.address ?? 'tap to view'}${request.flags.length ? ` · ${request.flags.join(', ')}` : ''}`,
          url: '/',
          tag: `offer-${offer.id}`,
        });
      } else if (evt.type === 'request.updated') {
        const r = evt.data as Request;
        const text: Record<string, string> = {
          assigned: 'A unit has accepted your request and is on the way.',
          arrived: 'Your unit has arrived.',
          unfulfilled: 'No unit could be reached automatically. The control room has been alerted.',
        };
        if (text[r.status]) p = this.notifyUser(r.requesterId, { title: `${r.reference}: ${r.status.replace('_', ' ')}`, body: text[r.status], url: '/', tag: `req-${r.id}` });
      }
      if (p) this.pending.push(p.catch((err) => this.log.warn({ err }, 'push failed')));
    });
  }
  close() {
    this.stop?.();
  }
  async flush() {
    await Promise.allSettled(this.pending);
    this.pending = [];
  }

  subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    this.repo.upsertPushSubscription(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  }
  unsubscribe(endpoint: string) {
    this.repo.deletePushSubscription(endpoint);
  }

  async notifyUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0;
    const subs = this.repo.listPushSubscriptions(userId);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload));
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.repo.deletePushSubscription(s.endpoint); // expired subscription
          else this.log.warn({ err, endpoint: s.endpoint.slice(0, 40) }, 'push delivery failed');
        }
      }),
    );
    return sent;
  }
}
