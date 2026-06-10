import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  PUBLIC_WEBHOOK_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  MAIN_CHANNEL_ID: z.string().min(1),
  ADMIN_TELEGRAM_IDS: z.string().min(1),
  SUPPORT_USERNAME: z.string().min(1),
  REMNAWAVE_BASE_URL: z.string().url(),
  REMNAWAVE_API_TOKEN: z.string().min(1),
  CARD_TO_CARD_TEXT: z.string().min(1),
  REFERRAL_REWARD_PERCENT: z.coerce.number().nonnegative().max(100).default(7),
  WEBHOOK_SECRET_TOKEN: z.string().min(16).optional()
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  ADMIN_IDS: parsed.ADMIN_TELEGRAM_IDS.split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isSafeInteger(id))
};
