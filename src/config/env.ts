import { z } from 'zod';
import { config } from 'dotenv';

// Load .env file
config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  ENV: z.enum(['development', 'production']).default('development'),

  WEBHOOK_SECRET: z.string().min(16),
  IP_ALLOWLIST: z.string().optional(),

  OCEAN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_CHAT_ID: z.string(),
  TELEGRAM_POLLING: z.coerce.boolean().default(true),
  TELEGRAM_ALLOWED_CHATS: z.string().optional(), // Comma-separated chat IDs

  ALCHEMY_API_KEY: z.string().min(20), // For RPC calls (balance queries)
  ETHERSCAN_API_KEY: z.string().min(20), // For event log queries

  DEBOUNCE_MS: z.coerce.number().default(0),
  MIN_OCEAN_ALERT: z.coerce.number().default(1.0),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
