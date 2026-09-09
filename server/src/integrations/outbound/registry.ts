import { createLogChannel } from './log.js';
import type { OutboundChannel } from './types.js';
import { createWebhookChannel } from './webhook.js';

export function createOutboundRegistry(opts: { signingSecret: string; fetchImpl?: typeof fetch; log?: (m: string) => void }) {
  const channels: OutboundChannel[] = [
    createWebhookChannel({ signingSecret: opts.signingSecret, fetchImpl: opts.fetchImpl }),
    createLogChannel(opts.log),
  ];
  return new Map(channels.map((c) => [c.name, c]));
}
