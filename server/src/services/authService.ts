import { hashToken, newToken } from '../domain/ids.js';
import type { ApiKey, ApiScope, Role, User } from '../domain/types.js';
import { ForbiddenError } from './errors.js';
import type { Repositories } from './repositories.js';

export interface LoginInput {
  role: Role;
  name: string;
  phone: string;
  /** Required for dispatcher when DISPATCHER_CODE is configured. */
  dispatcherCode?: string;
}

/**
 * Phone-number sign-in that issues a bearer token. One account per
 * (phone, role). Production deployments should put an OTP step in front of
 * this (see README); the token model does not change.
 */
export class AuthService {
  constructor(
    private readonly repo: Repositories,
    private readonly dispatcherCode: string,
  ) {}

  login(input: LoginInput): { user: User; token: string } {
    if (input.role === 'dispatcher' && this.dispatcherCode && input.dispatcherCode !== this.dispatcherCode) {
      throw new ForbiddenError('Invalid dispatcher code');
    }
    const phone = normalisePhone(input.phone);
    const token = newToken();
    const tokenHash = hashToken(token);
    const existing = this.repo.getUserByPhoneRole(phone, input.role);
    if (existing) {
      this.repo.rotateUserToken(existing.id, tokenHash, input.name.trim() || undefined);
      this.repo.audit({ actor: existing.id, action: 'auth.login', entityType: 'user', entityId: existing.id });
      return { user: this.repo.getUser(existing.id)!, token };
    }
    const user = this.repo.createUser({ role: input.role, name: input.name.trim(), phone, tokenHash });
    this.repo.audit({ actor: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, details: { role: user.role } });
    return { user, token };
  }

  authenticate(token: string): User | undefined {
    const user = this.repo.getUserByTokenHash(hashToken(token));
    if (user) this.repo.touchUser(user.id);
    return user;
  }

  /**
   * Find or create the account for a caller an agent is logging a call-out for,
   * so the caller can sign in with their number later and track the unit.
   */
  resolveContact(name: string, phone: string): User {
    const p = normalisePhone(phone);
    const existing = this.repo.getUserByPhoneRole(p, 'requester');
    if (existing) return existing;
    return this.repo.createUser({ role: 'requester', name: name.trim() || 'Caller', phone: p, tokenHash: hashToken(newToken()) });
  }

  // ---- machine-to-machine API keys -----------------------------------------

  createApiKey(createdBy: User, name: string, scopes: ApiScope[]): { apiKey: ApiKey; key: string } {
    const key = `dsp_${newToken()}`;
    const apiKey = this.repo.createApiKey({ name: name.trim(), prefix: key.slice(0, 12), keyHash: hashToken(key), scopes, createdBy: createdBy.id });
    this.repo.audit({ actor: createdBy.id, action: 'apikey.created', entityType: 'api_key', entityId: apiKey.id, details: { name, scopes } });
    return { apiKey, key };
  }

  authenticateApiKey(key: string): ApiKey | undefined {
    const k = this.repo.getApiKeyByHash(hashToken(key));
    if (k) this.repo.touchApiKey(k.id);
    return k;
  }
}

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : digits.replace(/^0/, '+27'); // default to ZA when no country code
}
