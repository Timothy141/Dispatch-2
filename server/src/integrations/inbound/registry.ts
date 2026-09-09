import { createDeepAlertAdapter } from './deepalert.js';
import { genericAdapter } from './generic.js';
import type { InboundAdapter } from './types.js';

export function createInboundRegistry(): Map<string, InboundAdapter> {
  const adapters: InboundAdapter[] = [createDeepAlertAdapter(), genericAdapter];
  return new Map(adapters.map((a) => [a.source, a]));
}
