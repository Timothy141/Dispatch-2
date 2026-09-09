import type { OutboundChannel } from './types.js';

/** Development / manual-dispatch channel: records the dispatch without calling anything. */
export function createLogChannel(log: (msg: string) => void = console.log): OutboundChannel {
  return {
    name: 'log',
    async send(n) {
      log(
        `[dispatch] ${n.dispatch.reference} ${n.dispatch.priority.toUpperCase()} -> ${n.responder.name}` +
          ` @ ${n.site?.name ?? 'unknown site'}: ${n.dispatch.reason}`,
      );
      return { success: true, detail: 'Logged (manual channel: phone/radio the responder)' };
    },
  };
}
