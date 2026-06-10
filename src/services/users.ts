import type { Context } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { formatToman } from "../domain/format.js";
import { makeReferralCode } from "../domain/referral.js";
import { getWalletBalance } from "./wallet-service.js";

export async function upsertTelegramUser(ctx: Context, referralCode?: string | null) {
  const from = ctx.from;
  if (!from) {
    throw new Error("Telegram user peyda nashod.");
  }

  const ownReferralCode = makeReferralCode(from.id);
  const existingUser = await prisma.telegramUser.findUnique({ where: { telegramId: BigInt(from.id) } });

  const user = await prisma.telegramUser.upsert({
    where: { telegramId: BigInt(from.id) },
    update: {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name
    },
    create: {
      telegramId: BigInt(from.id),
      referralCode: ownReferralCode,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name
    }
  });

  if (!existingUser && referralCode && referralCode !== ownReferralCode) {
    const rewardedReferrer = await grantReferralReward(user.id, referralCode);
    if (rewardedReferrer) {
      await notifyReferralReward(ctx, rewardedReferrer.id, Number(rewardedReferrer.telegramId));
    }
  }

  return prisma.telegramUser.findUniqueOrThrow({ where: { id: user.id } });
}

async function grantReferralReward(newUserId: string, referralCode: string) {
  const referrer = await prisma.telegramUser.findUnique({ where: { referralCode } });
  if (!referrer || config.REFERRAL_REWARD_TOMAN <= 0) {
    return null;
  }

  const rewarded = await prisma.$transaction(async (tx) => {
    const newUser = await tx.telegramUser.findUnique({ where: { id: newUserId } });
    if (!newUser || newUser.referredByUserId || newUser.referralRewardGranted) {
      return null;
    }

    await tx.telegramUser.update({
      where: { id: newUserId },
      data: {
        referredByUserId: referrer.id,
        referralRewardGranted: true
      }
    });
    await tx.walletTransaction.create({
      data: {
        userId: referrer.id,
        type: "REFERRAL_REWARD",
        amountToman: config.REFERRAL_REWARD_TOMAN,
        description: `Referral reward for Telegram ${newUser.telegramId.toString()}`
      }
    });

    return { id: referrer.id, telegramId: referrer.telegramId };
  });

  return rewarded;
}

async function notifyReferralReward(ctx: Context, referrerId: string, referrerTelegramId: number) {
  const balance = await getWalletBalance(referrerId);
  await ctx.telegram
    .sendMessage(
      referrerTelegramId,
      [
        "🎉 تبریک، یک نفر با لینک دعوت شما وارد ربات شد.",
        "",
        `💰 موجودی جدید کیف پول شما: ${formatToman(balance)}`
      ].join("\n")
    )
    .catch(() => null);
}
