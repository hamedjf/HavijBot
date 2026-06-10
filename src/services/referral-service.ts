import { Telegram } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { formatToman } from "../domain/format.js";
import { getWalletBalance } from "./wallet-service.js";

export async function grantPurchaseReferralReward(orderId: string): Promise<void> {
  if (config.REFERRAL_REWARD_PERCENT <= 0) {
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true }
  });
  const referrerId = order?.user.referredByUserId;
  if (!order || !referrerId || order.userId === referrerId || (order.type !== "SERVICE_PURCHASE" && order.type !== "SERVICE_RENEWAL")) {
    return;
  }

  const rewardBaseToman = Math.max(0, order.amountToman - order.discountAmountToman);
  const rewardAmountToman = Math.floor((rewardBaseToman * config.REFERRAL_REWARD_PERCENT) / 100);
  if (rewardAmountToman <= 0) {
    return;
  }

  const rewardCreated = await prisma.$transaction(async (tx) => {
    const existingReward = await tx.walletTransaction.findFirst({
      where: {
        userId: referrerId,
        orderId: order.id,
        type: "REFERRAL_REWARD"
      }
    });
    if (existingReward) {
      return false;
    }

    await tx.walletTransaction.create({
      data: {
        userId: referrerId,
        orderId: order.id,
        type: "REFERRAL_REWARD",
        amountToman: rewardAmountToman,
        description: `پاداش دعوت ${config.REFERRAL_REWARD_PERCENT}% برای سفارش ${order.id}`
      }
    });
    return true;
  });

  if (!rewardCreated) {
    return;
  }

  const referrer = await prisma.telegramUser.findUnique({ where: { id: referrerId } });
  if (!referrer) {
    return;
  }

  const balance = await getWalletBalance(referrerId);
  const telegram = new Telegram(config.BOT_TOKEN);
  await telegram
    .sendMessage(
      Number(referrer.telegramId),
      ["تبریک یکی از زیرمجموعه‌های شما خرید انجام داد.", "", `موجودی کیف پول جدید شما: ${formatToman(balance)}`].join("\n")
    )
    .catch(() => null);
}
