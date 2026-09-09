import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';

/** Server-Sent Events stream of domain events for the operator console. */
export async function eventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/events', async (req, reply) => {
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
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    const unsubscribe = ctx.bus.subscribe((evt) => {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
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
