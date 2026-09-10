import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKey, ApiScope, Role, User } from './domain/types.js';
import type { AuthService } from './services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    apiKey?: ApiKey;
  }
}

function extractToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const q = (req.query as Record<string, string | undefined>)?.token;
  return q || undefined;
}

/** Populate req.user from a bearer token (or ?token= for EventSource), or req.apiKey from x-api-key. */
export function makeAuthenticate(auth: AuthService) {
  return async function authenticate(req: FastifyRequest) {
    const h = req.headers['x-api-key'];
    const apiKey = Array.isArray(h) ? h[0] : h;
    if (apiKey) {
      req.apiKey = auth.authenticateApiKey(apiKey);
      return;
    }
    const token = extractToken(req);
    if (token) req.user = auth.authenticate(token);
  };
}

/** Require a valid API key carrying every listed scope. */
export function requireScope(...scopes: ApiScope[]) {
  return async function guard(req: FastifyRequest, reply: FastifyReply) {
    if (!req.apiKey) return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid x-api-key' });
    const missing = scopes.filter((s) => !req.apiKey!.scopes.includes(s));
    if (missing.length) return reply.code(403).send({ error: 'forbidden', message: `API key lacks scope: ${missing.join(', ')}` });
  };
}

/** Require a signed-in user with one of the given roles. */
export function requireRole(...roles: Role[]) {
  return async function guard(req: FastifyRequest, reply: FastifyReply) {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in first' });
    if (roles.length && !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'forbidden', message: `Requires role: ${roles.join(' or ')}` });
    }
  };
}
