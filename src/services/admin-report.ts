import type { Telegram } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { formatToman } from "../domain/format.js";
import { logger } from "../logger.js";

const REPORT_ACTION = "admin.daily_report";
const REPORT_HOUR_TEHRAN = 9;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

export function startAdminDailyReport(telegram: Telegram) {
  void sendDailyReportIfDue(telegram);
  setInterval(() => void sendDailyReportIfDue(telegram), CHECK_INTERVAL_MS).unref();
}

async function sendDailyReportIfDue(telegram: Telegram) {
  const now = new Date();
  const tehranNow = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  if (tehranNow.getUTCHours() < REPORT_HOUR_TEHRAN) {
    return;
  }

  const reportDate = tehranNow.toISOString().slice(0, 10);
  const alreadySent = await prisma.auditLog.findFirst({
    where: { action: REPORT_ACTION, entityId: reportDate }
  });
  if (alreadySent) {
    return;
  }

  const { startUtc, endUtc } = getTehranDayRangeUtc(reportDate);
  const message = await buildDailyReport(reportDate, startUtc, endUtc);
  const results = await Promise.allSettled(config.ADMIN_IDS.map((adminId) => telegram.sendMessage(adminId, message)));
  const sentCount = results.filter((result) => result.status === "fulfilled").length;

  if (sentCount > 0) {
    await prisma.auditLog.create({
      data: {
        action: REPORT_ACTION,
        entityType: "admin_report",
        entityId: reportDate,
        metadata: { sentCount }
      }
    });
  }

  const failedAdminIds = config.ADMIN_IDS.filter((_adminId, index) => results[index]?.status === "rejected");
  if (failedAdminIds.length > 0) {
    logger.warn({ reportDate, failedAdminIds }, "Daily admin report delivery failed for some admins");
  }
}

async function buildDailyReport(reportDate: string, startUtc: Date, endUtc: Date): Promise<string> {
  const [todayStarts, totalUsers, todayOrders, totalOrders, todayRenewals, totalRenewals, todayRevenue, totalRevenue, todayBuyerRows, totalBuyerRows] =
    await Promise.all([
      prisma.telegramUser.count({ where: { createdAt: { gte: startUtc, lt: endUtc } } }),
      prisma.telegramUser.count(),
      prisma.order.count({ where: { type: "SERVICE_PURCHASE", status: "PROVISIONED", updatedAt: { gte: startUtc, lt: endUtc } } }),
      prisma.order.count({ where: { type: "SERVICE_PURCHASE", status: "PROVISIONED" } }),
      prisma.order.count({ where: { type: "SERVICE_RENEWAL", status: "PROVISIONED", updatedAt: { gte: startUtc, lt: endUtc } } }),
      prisma.order.count({ where: { type: "SERVICE_RENEWAL", status: "PROVISIONED" } }),
      prisma.order.findMany({
        where: { type: { in: ["SERVICE_PURCHASE", "SERVICE_RENEWAL"] }, status: "PROVISIONED", updatedAt: { gte: startUtc, lt: endUtc } },
        select: { amountToman: true, discountAmountToman: true }
      }),
      prisma.order.findMany({
        where: { type: { in: ["SERVICE_PURCHASE", "SERVICE_RENEWAL"] }, status: "PROVISIONED" },
        select: { amountToman: true, discountAmountToman: true }
      }),
      prisma.order.findMany({
        where: { type: { in: ["SERVICE_PURCHASE", "SERVICE_RENEWAL"] }, status: "PROVISIONED", updatedAt: { gte: startUtc, lt: endUtc } },
        distinct: ["userId"],
        select: { userId: true }
      }),
      prisma.order.findMany({
        where: { type: { in: ["SERVICE_PURCHASE", "SERVICE_RENEWAL"] }, status: "PROVISIONED" },
        distinct: ["userId"],
        select: { userId: true }
      })
    ]);

  const todayRevenueToman = sumRevenue(todayRevenue);
  const totalRevenueToman = sumRevenue(totalRevenue);

  return [
    `📊 گزارش روزانه ربات - ${reportDate}`,
    "",
    "امروز:",
    `👤 استارت‌های جدید: ${todayStarts}`,
    `🛒 خرید سرویس: ${todayOrders}`,
    `🔄 تمدید سرویس: ${todayRenewals}`,
    `🧑‍💼 خریدارهای یکتا: ${todayBuyerRows.length}`,
    `💰 مبلغ فروش: ${formatToman(todayRevenueToman)}`,
    "",
    "کل:",
    `👥 کل کاربران: ${totalUsers}`,
    `🛒 کل خرید سرویس: ${totalOrders}`,
    `🔄 کل تمدیدها: ${totalRenewals}`,
    `🧑‍💼 کل خریدارهای یکتا: ${totalBuyerRows.length}`,
    `💰 کل فروش: ${formatToman(totalRevenueToman)}`
  ].join("\n");
}

function sumRevenue(orders: Array<{ amountToman: number; discountAmountToman: number }>) {
  return orders.reduce((sum, order) => sum + Math.max(0, order.amountToman - order.discountAmountToman), 0);
}

function getTehranDayRangeUtc(reportDate: string) {
  const [year, month, day] = reportDate.split("-").map(Number);
  const startUtc = new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0) - TEHRAN_OFFSET_MS);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}
