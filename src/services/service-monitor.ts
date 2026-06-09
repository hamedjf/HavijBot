import { Markup, type Telegram } from "telegraf";
import { prisma } from "../db.js";
import { bytesToGb, formatGb } from "../domain/format.js";
import { logger } from "../logger.js";
import { remnawaveClient } from "../remnawave/remnawave-client.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const LOW_TRAFFIC_BYTES = 1024 * 1024 * 1024;

export function startServiceMonitor(telegram: Telegram) {
  void checkPurchasedServices(telegram);
  const timer = setInterval(() => void checkPurchasedServices(telegram), CHECK_INTERVAL_MS);
  timer.unref();
}

async function checkPurchasedServices(telegram: Telegram) {
  const services = await prisma.purchasedService.findMany({
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 500
  });

  for (const service of services) {
    try {
      const usage = await remnawaveClient.getUserUsage(service.remnawaveUserUuid);
      const remainingBytes = Math.max(0, (usage.trafficLimitBytes || service.volumeGb * 1024 * 1024 * 1024) - usage.usedTrafficBytes);
      if (remainingBytes < LOW_TRAFFIC_BYTES && !service.lowTrafficNotifiedAt) {
        await telegram.sendMessage(
          Number(service.user.telegramId),
          [
            "⚠️ حجم سرویس شما کمتر از 1 گیگابایت شده است.",
            `👤 سرویس: ${service.username}`,
            `📦 حجم باقی‌مانده: ${formatGb(bytesToGb(remainingBytes))}`,
            "برای جلوگیری از قطع شدن، می‌توانید همین الان تمدید کنید."
          ].join("\n"),
          Markup.inlineKeyboard([[Markup.button.callback("🔄 تمدید سرویس", `renew:${service.id}`)]])
        );
        await prisma.purchasedService.update({ where: { id: service.id }, data: { lowTrafficNotifiedAt: new Date() } });
      }
    } catch (error) {
      if (isMissingRemnawaveUserError(error)) {
        await prisma.purchasedService.delete({ where: { id: service.id } }).catch(() => null);
        await telegram
          .sendMessage(
            Number(service.user.telegramId),
            [
              "⚠️ پروفایل سرویس شما داخل پنل پیدا نشد و از لیست سرویس‌های ربات حذف شد.",
              `👤 سرویس: ${service.username}`,
              "اگر فکر می‌کنید اشتباهی رخ داده، لطفا با پشتیبانی در ارتباط باشید."
            ].join("\n")
          )
          .catch((sendError) => logger.warn({ err: sendError, serviceId: service.id }, "Deleted service notification failed"));
        continue;
      }

      logger.warn({ err: error, serviceId: service.id }, "Service monitor check failed");
    }
  }
}

function isMissingRemnawaveUserError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("peyda nashod") || error.message.includes("(404)"));
}
