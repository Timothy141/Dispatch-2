import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./data/dispatch.db'),
  LOG_LEVEL: z.string().default('info'),
  OPERATOR_API_KEY: z.string().default(''),
  WEBHOOK_SECRET_DEEPALERT: z.string().default(''),
  WEBHOOK_SECRET_GENERIC: z.string().default(''),
  DISPATCH_SIGNING_SECRET: z.string().default('dev-dispatch-signing-secret'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8080'),
  MIN_CONFIDENCE: z
    .string()
    .default('')
    .transform((v) => (v.trim() === '' ? null : Number(v)))
    .pipe(z.number().min(0).max(1).nullable()),
  WEB_DIST: z.string().default(''),
});

export type Config = z.infer<typeof EnvSchema> & {
  webhookSecrets: Record<string, string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    webhookSecrets: {
      deepalert: parsed.WEBHOOK_SECRET_DEEPALERT,
      generic: parsed.WEBHOOK_SECRET_GENERIC,
    },
  };
}
