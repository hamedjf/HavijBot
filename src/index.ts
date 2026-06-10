import express from "express";
import { config } from "./config.js";
import { createBot } from "./bot/create-bot.js";
import { logger } from "./logger.js";
import { prisma } from "./db.js";
import { startServiceMonitor } from "./services/service-monitor.js";
import { startAdminDailyReport } from "./services/admin-report.js";

const bot = createBot();
const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/telegram/webhook", (req, res, next) => {
  if (!config.WEBHOOK_SECRET_TOKEN) {
    next();
    return;
  }

  if (req.header("x-telegram-bot-api-secret-token") !== config.WEBHOOK_SECRET_TOKEN) {
    res.sendStatus(401);
    return;
  }

  next();
});

app.use(bot.webhookCallback("/telegram/webhook"));

const server = app.listen(config.PORT, async () => {
  const webhookUrl = `${config.PUBLIC_WEBHOOK_URL.replace(/\/$/, "")}/telegram/webhook`;
  await bot.telegram.setMyCommands([]);
  if (config.WEBHOOK_SECRET_TOKEN) {
    await bot.telegram.setWebhook(webhookUrl, { secret_token: config.WEBHOOK_SECRET_TOKEN });
  } else {
    await bot.telegram.setWebhook(webhookUrl);
  }
  startServiceMonitor(bot.telegram);
  startAdminDailyReport(bot.telegram);
  logger.info({ port: config.PORT, webhookUrl }, "HavijBot started");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  await bot.telegram.deleteWebhook();
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
