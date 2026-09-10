import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./data/dispatch.db'),
  LOG_LEVEL: z.string().default('info'),
  /** Shared code a user must present to sign in as a dispatcher. Empty = anyone (dev only). */
  DISPATCHER_CODE: z.string().default(''),
  /** Seconds a responder has to accept an offer before it goes to the next unit. */
  OFFER_TIMEOUT_SECONDS: z.coerce.number().positive().default(20),
  /** How many nearest responders are offered a job at the same time (1 = Uber-style sequential). */
  OFFER_FANOUT: z.coerce.number().int().min(1).max(20).default(3),
  /** Only responders within this radius of the incident are considered. */
  MAX_RADIUS_KM: z.coerce.number().positive().default(30),
  /** Give up searching (mark unfulfilled) after this long without an acceptance. */
  SEARCH_TIMEOUT_SECONDS: z.coerce.number().positive().default(300),
  /** Responders whose last location is older than this are not offered jobs. */
  LOCATION_STALE_SECONDS: z.coerce.number().positive().default(300),
  /** Used for ETA estimates. */
  AVERAGE_SPEED_KMH: z.coerce.number().positive().default(45),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  WEB_DIST: z.string().default(''),
  /** Running behind a cloud load balancer / reverse proxy (Render, Fly, Cloud Run, nginx). */
  TRUST_PROXY: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  /** Address search for manual call-outs. Any Nominatim-compatible endpoint. */
  GEOCODER_URL: z.string().default('https://nominatim.openstreetmap.org/search'),
  GEOCODER_USER_AGENT: z.string().default('dispatch-app (set GEOCODER_USER_AGENT to your contact email)'),
  /** Outgoing webhook delivery. */
  WEBHOOK_TIMEOUT_MS: z.coerce.number().positive().default(8000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  /** Require an SMS one-time code at sign-in. Turn on for any public deployment. */
  OTP_REQUIRED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** log (prints the code to the server log) | twilio | http (generic JSON gateway). */
  SMS_PROVIDER: z.enum(['log', 'twilio', 'http']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),
  SMS_HTTP_URL: z.string().default(''),
  /** JSON object of extra headers, e.g. {"Authorization":"Bearer x"} */
  SMS_HTTP_HEADERS: z.string().default('{}'),
  /** JSON body template; {to} and {text} are replaced. */
  SMS_HTTP_BODY: z.string().default('{"to":"{to}","message":"{text}"}'),

  /** Web Push (generate once with: npx web-push generate-vapid-keys). Empty = push disabled. */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:ops@example.com'),

  /** Automatic SQLite backups. 0 disables. */
  BACKUP_INTERVAL_HOURS: z.coerce.number().min(0).default(24),
  BACKUP_DIR: z.string().default(''),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
