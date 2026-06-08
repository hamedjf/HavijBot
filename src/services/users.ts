import type { Context } from "telegraf";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { makeReferralCode } from "../domain/referral.js";

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
    await grantReferralReward(user.id, referralCode);
  }

  return prisma.telegramUser.findUniqueOrThrow({ where: { id: user.id } });
}

async function grantReferralReward(newUserId: string, referralCode: string) {
  const referrer = await prisma.telegramUser.findUnique({ where: { referralCode } });
  if (!referrer || config.REFERRAL_REWARD_TOMAN <= 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const newUser = await tx.telegramUser.findUnique({ where: { id: newUserId } });
    if (!newUser || newUser.referredByUserId || newUser.referralRewardGranted) {
      return;
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
  });
}
