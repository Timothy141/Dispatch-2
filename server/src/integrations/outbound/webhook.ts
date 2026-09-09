import { createHmac } from 'node:crypto';
import type { OutboundChannel, DispatchNotification, DeliveryResult } from './types.js';

export interface WebhookChannelOptions {
  signingSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Message body posted to the responder's webhook. */
export function buildDispatchPayload(n: DispatchNotification) {
  return {
    type: 'dispatch.requested',
    dispatch: {
      id: n.dispatch.id,
      reference: n.dispatch.reference,
      priority: n.dispatch.priority,
      reason: n.dispatch.reason,
      notes: n.dispatch.notes,
      requestedBy: n.dispatch.requestedBy,
      requestedAt: n.dispatch.createdAt,
      callbackUrl: n.callbackUrl,
    },
    site: n.site
      ? {
          id: n.site.id,
          name: n.site.name,
          address: n.site.address,
          latitude: n.site.latitude,
          longitude: n.site.longitude,
          notes: n.site.notes,
        }
      : null,
    alert: n.alert
      ? {
          id: n.alert.id,
          source: n.alert.source,
          eventType: n.alert.eventType,
          title: n.alert.title,
          confidence: n.alert.confidence,
          severity: n.alert.severity,
          camera: n.alert.cameraName,
          snapshotUrl: n.alert.snapshotUrl,
          clipUrl: n.alert.clipUrl,
          occurredAt: n.alert.occurredAt,
        }
      : null,
  };
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function createWebhookChannel(opts: WebhookChannelOptions): OutboundChannel {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return {
    name: 'webhook',
    async send(n): Promise<DeliveryResult> {
      const url = n.responder.channelConfig.url;
      if (typeof url !== 'string' || !url) {
        return { success: false, detail: 'Responder has no channelConfig.url configured' };
      }
      const body = JSON.stringify(buildDispatchPayload(n));
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-dispatch-signature': sign(opts.signingSecret, body),
        'x-dispatch-reference': n.dispatch.reference,
      };
      const extra = n.responder.channelConfig.headers;
      if (extra && typeof extra === 'object') {
        for (const [k, v] of Object.entries(extra as Record<string, unknown>)) headers[k] = String(v);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
        const text = (await res.text().catch(() => '')).slice(0, 500);
        return res.ok
          ? { success: true, detail: `HTTP ${res.status}` }
          : { success: false, detail: `HTTP ${res.status} ${text}`.trim() };
      } catch (err) {
        return { success: false, detail: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
