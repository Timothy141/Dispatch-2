import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { makeAuthenticate } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { openDatabase, type Db } from './db/db.js';
import { InvalidTransitionError } from './domain/requestStateMachine.js';
import { authRoutes } from './routes/authRoutes.js';
import { dispatcherRoutes } from './routes/dispatcherRoutes.js';
import { eventRoutes } from './routes/eventRoutes.js';
import { requestRoutes } from './routes/requestRoutes.js';
import { responderRoutes } from './routes/responderRoutes.js';
import { AuthService } from './services/authService.js';
import { DispatchService } from './services/dispatchService.js';
import { ConflictError, ForbiddenError, NotFoundError } from './services/errors.js';
import { EventBus } from './services/eventBus.js';
import { Repositories } from './services/repositories.js';

export interface AppContext {
  config: Config;
  db: Db;
  repo: Repositories;
  bus: EventBus;
  auth: AuthService;
  dispatch: DispatchService;
}

export interface BuildOptions {
  config?: Partial<Config>;
  env?: NodeJS.ProcessEnv;
  logger?: boolean | object;
  /** Run the matching tick automatically (default true; tests drive tick() manually). */
  autoTick?: boolean;
}

export function buildContext(opts: BuildOptions = {}, log: FastifyInstance['log'] | Console = console): AppContext {
  const config = { ...loadConfig(opts.env ?? process.env), ...opts.config } as Config;
  const db = openDatabase(config.DATABASE_PATH);
  const repo = new Repositories(db);
  const bus = new EventBus();
  const auth = new AuthService(repo, config.DISPATCHER_CODE);
  const dispatch = new DispatchService(repo, bus, config, log as never);
  return { config, db, repo, bus, auth, dispatch };
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance & { ctx: AppContext }> {
  const app = Fastify({ logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1024 * 1024 });
  const ctx = buildContext(opts, app.log);

  await app.register(cors, { origin: true, credentials: true });
  // Accept JSON POSTs with an empty body (e.g. /accept, /retry) as `{}`.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body).trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
  app.addHook('preHandler', makeAuthenticate(ctx.auth));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'conflict', message: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'forbidden', message: err.message });
    if (err instanceof InvalidTransitionError) return reply.code(409).send({ error: 'invalid_transition', message: err.message, from: err.from, to: err.to });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));

  await authRoutes(app, ctx);
  await requestRoutes(app, ctx);
  await responderRoutes(app, ctx);
  await dispatcherRoutes(app, ctx);
  await eventRoutes(app, ctx);

  const webDist = ctx.config.WEB_DIST || resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
    app.log.info({ webDist }, 'serving web app');
  }

  let ticker: ReturnType<typeof setInterval> | undefined;
  if (opts.autoTick ?? true) {
    ticker = setInterval(() => {
      try {
        ctx.dispatch.tick();
      } catch (err) {
        app.log.error({ err }, 'matching tick failed');
      }
    }, 1000);
  }
  app.addHook('onClose', async () => {
    if (ticker) clearInterval(ticker);
    ctx.db.close();
  });
  return Object.assign(app, { ctx }) as FastifyInstance & { ctx: AppContext };
}
