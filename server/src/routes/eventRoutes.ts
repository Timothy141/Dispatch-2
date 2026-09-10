import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import type { DomainEvent } from '../services/eventBus.js';
import type { User } from '../domain/types.js';

export function eventVisibleTo(user: User, evt: DomainEvent): boolean {
  if (user.role === 'dispatcher') return true;
  const a = evt.audience;
  if (user.role === 'requester') return a.requesterId === user.id;
  if (user.role === 'responder') return a.responderIds?.includes(user.id) ?? false;
  return false;
}

/** Server-Sent Events, filtered per user so nobody sees other people's emergencies. */
export async function eventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/events', { preHandler: requireRole() }, async (req, reply) => {
    const user = req.user!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': (req.headers.origin as string | undefined) ?? '*',
      'access-control-allow-credentials': 'true',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), role: user.role })}\n\n`);

    const unsubscribe = ctx.bus.subscribe((evt) => {
      if (!eventVisibleTo(user, evt)) return;
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify({ type: evt.type, at: evt.at, data: evt.data })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
  });
}
