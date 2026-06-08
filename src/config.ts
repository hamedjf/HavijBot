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
  RENEWAL_OPTIONS: z.string().default("20:30:100000,30:30:140000,50:30:220000,80:30:330000,120:30:450000"),
  REFERRAL_REWARD_TOMAN: z.coerce.number().int().nonnegative().default(30000)
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  ADMIN_IDS: parsed.ADMIN_TELEGRAM_IDS.split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isSafeInteger(id)),
  RENEWAL_PLANS: parseRenewalOptions(parsed.RENEWAL_OPTIONS)
};

function parseRenewalOptions(input: string) {
  return input.split(",").map((item) => {
    const [volumeGb, durationDays, priceToman] = item.split(":").map((part) => Number(part.trim()));
    if (!Number.isSafeInteger(volumeGb) || !Number.isSafeInteger(durationDays) || !Number.isSafeInteger(priceToman)) {
      throw new Error(`RENEWAL_OPTIONS invalid item: ${item}`);
    }

    return { volumeGb, durationDays, priceToman };
  });
}
