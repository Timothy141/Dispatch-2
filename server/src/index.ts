import { buildApp } from './app.js';

const app = await buildApp();
const { PORT, HOST } = app.ctx.config;

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Dispatch server ready. Webhooks: POST /api/webhooks/{${[...app.ctx.inbound.keys()].join('|')}}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}
