import { config } from "../config.js";
import { prisma } from "../db.js";

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

  await prisma.$transaction(async (tx) => {
    const existingReward = await tx.walletTransaction.findFirst({
      where: {
        userId: referrerId,
        orderId: order.id,
        type: "REFERRAL_REWARD"
      }
    });
    if (existingReward) {
      return;
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
  });
}
