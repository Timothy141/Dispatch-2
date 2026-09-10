import { createHash, randomInt } from 'node:crypto';
import { addSeconds, nowIso } from '../domain/ids.js';
import { normalisePhone } from './authService.js';
import { ConflictError } from './errors.js';
import type { Repositories } from './repositories.js';
import type { SmsProvider } from './smsService.js';

const MAX_ATTEMPTS = 5;

/** One-time SMS codes proving the caller owns the phone number they sign in with. */
export class OtpService {
  constructor(
    private readonly repo: Repositories,
    private readonly sms: SmsProvider,
    private readonly opts: { ttlSeconds: number; appName?: string },
  ) {}

  async request(rawPhone: string): Promise<{ phone: string; expiresAt: string }> {
    const phone = normalisePhone(rawPhone);
    if (!/^\+\d{8,15}$/.test(phone)) throw new ConflictError('Enter a valid mobile number');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = addSeconds(nowIso(), this.opts.ttlSeconds);
    this.repo.upsertOtp(phone, hash(phone, code), expiresAt);
    await this.sms.send(phone, `${this.opts.appName ?? 'Dispatch'} code: ${code}. Valid for ${Math.round(this.opts.ttlSeconds / 60)} minutes. Never share it.`);
    return { phone, expiresAt };
  }

  verify(rawPhone: string, code: string): boolean {
    const phone = normalisePhone(rawPhone);
    const rec = this.repo.getOtp(phone);
    if (!rec) return false;
    if (new Date(rec.expiresAt).getTime() < Date.now() || rec.attempts >= MAX_ATTEMPTS) {
      this.repo.deleteOtp(phone);
      return false;
    }
    if (rec.codeHash !== hash(phone, code.trim())) {
      this.repo.bumpOtpAttempts(phone);
      return false;
    }
    this.repo.deleteOtp(phone);
    return true;
  }
}

const hash = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest('hex');
