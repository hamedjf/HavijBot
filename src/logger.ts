import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "*.BOT_TOKEN",
      "BOT_TOKEN",
      "*.DATABASE_URL",
      "DATABASE_URL",
      "*.REMNAWAVE_API_TOKEN",
      "REMNAWAVE_API_TOKEN"
    ],
    censor: "[redacted]"
  }
});
