import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireRole } from '../auth.js';
import { ROLES, SERVICE_FLAGS, SERVICES } from '../domain/types.js';

const LoginBody = z.object({
  role: z.enum(ROLES),
  name: z.string().min(1).max(80),
  phone: z.string().min(6).max(20),
  dispatcherCode: z.string().max(80).optional(),
});

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/auth/login', async (req) => {
    const body = LoginBody.parse(req.body);
    const { user, token } = ctx.auth.login(body);
    const responder = user.role === 'responder' ? ctx.repo.getResponder(user.id) ?? null : null;
    return { user, token, responder };
  });

  app.get('/api/auth/me', { preHandler: requireRole() }, async (req) => ({
    user: req.user,
    responder: req.user!.role === 'responder' ? ctx.repo.getResponder(req.user!.id) ?? null : null,
  }));

  /** Static catalogue the apps render from (services + quick flags). */
  app.get('/api/catalogue', async () => ({
    services: SERVICES,
    flags: SERVICE_FLAGS,
    matching: {
      offerTimeoutSeconds: ctx.config.OFFER_TIMEOUT_SECONDS,
      searchTimeoutSeconds: ctx.config.SEARCH_TIMEOUT_SECONDS,
      maxRadiusKm: ctx.config.MAX_RADIUS_KM,
    },
  }));
}
