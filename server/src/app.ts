import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { makeOperatorAuth } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { openDatabase, type Db } from './db/db.js';
import { InvalidTransitionError } from './domain/dispatchStateMachine.js';
import { createInboundRegistry } from './integrations/inbound/registry.js';
import type { InboundAdapter } from './integrations/inbound/types.js';
import { createOutboundRegistry } from './integrations/outbound/registry.js';
import type { OutboundChannel } from './integrations/outbound/types.js';
import { adminRoutes } from './routes/admin.js';
import { alertRoutes } from './routes/alerts.js';
import { dispatchCallbackRoutes, dispatchOperatorRoutes } from './routes/dispatches.js';
import { eventRoutes } from './routes/events.js';
import { webhookRoutes } from './routes/webhooks.js';
import { AlertService, ConflictError, NotFoundError } from './services/alertService.js';
import { DispatchService } from './services/dispatchService.js';
import { EventBus } from './services/eventBus.js';
import { Repositories } from './services/repositories.js';

export interface AppContext {
  config: Config;
  db: Db;
  repo: Repositories;
  bus: EventBus;
  alerts: AlertService;
  dispatches: DispatchService;
  inbound: Map<string, InboundAdapter>;
  outbound: Map<string, OutboundChannel>;
}

export interface BuildOptions {
  config?: Partial<Config>;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  awaitDelivery?: boolean;
  retryDelayMs?: number;
  logger?: boolean | object;
}

export function buildContext(opts: BuildOptions = {}, log: FastifyInstance['log'] | Console = console): AppContext {
  const config = { ...loadConfig(opts.env ?? process.env), ...opts.config } as Config;
  const db = openDatabase(config.DATABASE_PATH);
  const repo = new Repositories(db);
  const bus = new EventBus();
  const alerts = new AlertService(repo, bus, { minConfidence: config.MIN_CONFIDENCE });
  const outbound = createOutboundRegistry({
    signingSecret: config.DISPATCH_SIGNING_SECRET,
    fetchImpl: opts.fetchImpl,
    log: (m) => log.info(m),
  });
  const dispatches = new DispatchService(
    repo,
    alerts,
    bus,
    outbound,
    {
      publicBaseUrl: config.PUBLIC_BASE_URL,
      awaitDelivery: opts.awaitDelivery ?? false,
      retryDelayMs: opts.retryDelayMs,
    },
    log as never,
  );
  return { config, db, repo, bus, alerts, dispatches, inbound: createInboundRegistry(), outbound };
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance & { ctx: AppContext }> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 5 * 1024 * 1024,
  });
  const ctx = buildContext(opts, app.log);

  await app.register(cors, { origin: true, credentials: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation',
        message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
    if (err instanceof InvalidTransitionError) {
      return reply.code(409).send({ error: 'invalid_transition', message: err.message, from: err.from, to: err.to });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
  });

  app.get('/api/health', async () => ({
    ok: true,
    at: new Date().toISOString(),
    sources: [...ctx.inbound.keys()],
    channels: [...ctx.outbound.keys()],
  }));

  // Public-ish endpoints: inbound webhooks (own secrets) and responder callbacks (own tokens).
  await app.register(async (pub) => {
    await webhookRoutes(pub, ctx);
    dispatchCallbackRoutes(pub, ctx);
  });

  // Operator endpoints: protected by the operator API key.
  await app.register(async (op) => {
    op.addHook('preHandler', makeOperatorAuth(ctx.config));
    await alertRoutes(op, ctx);
    dispatchOperatorRoutes(op, ctx);
    await adminRoutes(op, ctx);
    await eventRoutes(op, ctx);
  });

  // Serve the built operator console if present.
  const webDist = ctx.config.WEB_DIST || resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
    app.log.info({ webDist }, 'serving operator console');
  }

  app.addHook('onClose', async () => ctx.db.close());
  return Object.assign(app, { ctx }) as FastifyInstance & { ctx: AppContext };
}
