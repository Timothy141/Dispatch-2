import { hashToken, newToken } from '../domain/ids.js';
import type { Role, User } from '../domain/types.js';
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
}

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : digits.replace(/^0/, '+27'); // default to ZA when no country code
}
