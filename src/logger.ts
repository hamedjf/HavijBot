import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["req.headers.authorization", "*.REMNAWAVE_API_TOKEN", "REMNAWAVE_API_TOKEN"],
    censor: "[redacted]"
  }
});

