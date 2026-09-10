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
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
