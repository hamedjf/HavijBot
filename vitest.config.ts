import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      BOT_TOKEN: "test-token",
      PUBLIC_WEBHOOK_URL: "https://bot.example.test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      MAIN_CHANNEL_ID: "@test_channel",
      ADMIN_TELEGRAM_IDS: "1",
      SUPPORT_USERNAME: "@support",
      REMNAWAVE_BASE_URL: "https://remnawave.example.test",
      REMNAWAVE_API_TOKEN: "test-remnawave-token",
      CARD_TO_CARD_TEXT: "test card",
      RENEWAL_OPTIONS: "20:30:100000,30:30:140000",
      REFERRAL_REWARD_TOMAN: "30000"
    }
  }
});
