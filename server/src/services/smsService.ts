import type { Config } from '../config.js';

export interface SmsProvider {
  readonly name: string;
  send(to: string, text: string): Promise<void>;
}

type Logger = { info: (o: unknown, m?: string) => void };

/** Development provider: the code appears in the server log. */
export function createLogSmsProvider(log: Logger): SmsProvider {
  return {
    name: 'log',
    async send(to, text) {
      log.info({ to, text }, 'SMS (log provider)');
    },
  };
}

/** Twilio Programmable Messaging. */
export function createTwilioProvider(cfg: Pick<Config, 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_FROM'>, fetchImpl: typeof fetch = fetch): SmsProvider {
  if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN || !cfg.TWILIO_FROM) throw new Error('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
  const auth = Buffer.from(`${cfg.TWILIO_ACCOUNT_SID}:${cfg.TWILIO_AUTH_TOKEN}`).toString('base64');
  return {
    name: 'twilio',
    async send(to, text) {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: cfg.TWILIO_FROM, Body: text }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

/** Any gateway that accepts a JSON POST (Clickatell, BulkSMS, SMSPortal, Zapier hook, ...). */
export function createHttpProvider(cfg: Pick<Config, 'SMS_HTTP_URL' | 'SMS_HTTP_HEADERS' | 'SMS_HTTP_BODY'>, fetchImpl: typeof fetch = fetch): SmsProvider {
  if (!cfg.SMS_HTTP_URL) throw new Error('SMS_PROVIDER=http needs SMS_HTTP_URL');
  const headers = JSON.parse(cfg.SMS_HTTP_HEADERS || '{}') as Record<string, string>;
  return {
    name: 'http',
    async send(to, text) {
      const body = cfg.SMS_HTTP_BODY.replace(/\{to\}/g, to).replace(/\{text\}/g, text.replace(/"/g, '\\"'));
      const res = await fetchImpl(cfg.SMS_HTTP_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`SMS gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function createSmsProvider(cfg: Config, log: Logger, fetchImpl?: typeof fetch): SmsProvider {
  switch (cfg.SMS_PROVIDER) {
    case 'twilio':
      return createTwilioProvider(cfg, fetchImpl);
    case 'http':
      return createHttpProvider(cfg, fetchImpl);
    default:
      return createLogSmsProvider(log);
  }
}
