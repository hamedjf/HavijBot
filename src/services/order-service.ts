import type { Order, Plan, PlanCategory, TelegramUser } from "@prisma/client";
import { prisma } from "../db.js";
import { calculateDiscountAmount, payableAmount, walletOffsetForOrder } from "../domain/checkout.js";
import { expirationFromNow, gbToBytes } from "../domain/plans.js";
import { sanitizeUsername, withRandomSuffix } from "../domain/username.js";
import { remnawaveClient } from "../remnawave/remnawave-client.js";
import { grantPurchaseReferralReward } from "./referral-service.js";
import { getWalletBalance } from "./wallet-service.js";

export type OrderWithUserPlan = Order & {
  user: TelegramUser;
  plan: (Plan & { category: PlanCategory }) | null;
};

export async function createServiceOrder(userId: string, planId: string, requestedUsername: string) {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, isEnabled: true, category: { isEnabled: true } }
  });
  if (!plan) {
    throw new Error("پلن فعال پیدا نشد.");
  }

  return prisma.order.create({
    data: {
      userId,
      planId,
      type: "SERVICE_PURCHASE",
      status: "DRAFT",
      amountToman: plan.priceToman,
      requestedUsername: sanitizeUsername(requestedUsername)
    }
  });
}

export async function createWalletTopupOrder(userId: string, amountToman: number) {
  return prisma.order.create({
    data: {
      userId,
      type: "WALLET_TOPUP",
      status: "WAITING_PAYMENT",
      paymentMethod: "CARD_TO_CARD",
      amountToman,
      walletTopupAmountToman: amountToman
    }
  });
}

export async function createRenewalOrder(userId: string, serviceId: string, renewalPlanId: string) {
  const service = await prisma.purchasedService.findFirst({
    where: { id: serviceId, userId }
  });
  if (!service) {
    throw new Error("سرویس برای تمدید پیدا نشد.");
  }
  const currentPlan = await prisma.plan.findUnique({ where: { id: service.planId } });
  if (!currentPlan) {
    throw new Error("پلن فعلی سرویس پیدا نشد.");
  }
  const plan = await prisma.plan.findFirst({
    where: {
      id: renewalPlanId,
      categoryId: currentPlan.categoryId,
      isEnabled: true,
      category: { isEnabled: true }
    }
  });
  if (!plan) {
    throw new Error("پلن فعال برای تمدید پیدا نشد.");
  }

  return prisma.order.create({
    data: {
      userId,
      type: "SERVICE_RENEWAL",
      status: "DRAFT",
      targetServiceId: serviceId,
      planId: plan.id,
      renewalVolumeGb: plan.volumeGb,
      renewalDurationDays: plan.durationDays,
      amountToman: plan.priceToman
    }
  });
}

export async function submitCardReceipt(orderId: string, telegramFileId: string) {
  const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
  if (!orderBefore) {
    throw new Error("سفارش پیدا نشد.");
  }
  const cardAmount = payableAmount(orderBefore.amountToman, orderBefore.discountAmountToman, orderBefore.walletAppliedToman);
  if (cardAmount <= 0) {
    throw new Error("مبلغ کارت‌به‌کارت برای این سفارش صفر است.");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        status: "WAITING_ADMIN",
        paymentMethod: orderBefore.walletAppliedToman > 0 ? "MIXED" : "CARD_TO_CARD",
        cardAmountToman: cardAmount
      }
    });

    const receipt = await tx.paymentReceipt.create({
      data: { orderId, telegramFileId }
    });

    return { order, receipt };
  });
}

export async function applyDiscountCode(orderId: string, code: string): Promise<Order> {
  const normalizedCode = code.trim().toUpperCase();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error("سفارش پیدا نشد.");
  }
  if (order.discountCodeId) {
    throw new Error("برای این سفارش قبلا کد تخفیف ثبت شده است.");
  }

  const discount = await prisma.discountCode.findUnique({ where: { code: normalizedCode } });
  if (!discount || !discount.isEnabled) {
    throw new Error("کد تخفیف معتبر نیست.");
  }
  if (discount.expiresAt && discount.expiresAt.getTime() < Date.now()) {
    throw new Error("کد تخفیف منقضی شده است.");
  }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) {
    throw new Error("ظرفیت کد تخفیف تمام شده است.");
  }
  if (discount.oneUsePerUser) {
    const existingUsage = await prisma.discountCodeUsage.findUnique({
      where: { discountCodeId_userId: { discountCodeId: discount.id, userId: order.userId } }
    });
    if (existingUsage) {
      throw new Error("این کد قبلا استفاده شده است!");
    }
  }

  const discountAmount = calculateDiscountAmount(order.amountToman, discount);
  if (discountAmount <= 0) {
    throw new Error("این کد تخفیف مبلغی از سفارش کم نمی‌کند.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        discountCodeId: discount.id,
        discountAmountToman: discountAmount,
        walletAppliedToman: 0,
        cardAmountToman: null
      }
    });
    await tx.discountCode.update({
      where: { id: discount.id },
      data: { usedCount: { increment: 1 } }
    });
    if (discount.oneUsePerUser) {
      await tx.discountCodeUsage.create({
        data: {
          discountCodeId: discount.id,
          userId: order.userId,
          orderId
        }
      });
    }
    return updated;
  });
}

export async function applyWalletOffset(orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error("سفارش پیدا نشد.");
  }

  const balance = await getWalletBalance(order.userId);
  const dueBeforeWallet = payableAmount(order.amountToman, order.discountAmountToman, 0);
  const walletApplied = walletOffsetForOrder(dueBeforeWallet, balance);
  if (walletApplied <= 0) {
    throw new Error("موجودی کیف پول برای کم کردن از سفارش کافی نیست.");
  }

  const cardAmount = payableAmount(order.amountToman, order.discountAmountToman, walletApplied);
  return prisma.order.update({
    where: { id: order.id },
    data: {
      walletAppliedToman: walletApplied,
      cardAmountToman: cardAmount,
      paymentMethod: cardAmount > 0 ? "MIXED" : "WALLET"
    }
  });
}

export async function finalizeWalletCoveredOrder(orderId: string): Promise<OrderWithUserPlan | Order> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, plan: { include: { category: true } }, targetService: true }
  });

  if (!order) {
    throw new Error("سفارش پیدا نشد!");
  }

  const due = payableAmount(order.amountToman, order.discountAmountToman, order.walletAppliedToman);
  if (due > 0) {
    throw new Error("این سفارش هنوز مبلغ کارت‌به‌کارت دارد.");
  }
  if (order.walletAppliedToman <= 0 && order.discountAmountToman < order.amountToman) {
    throw new Error("مبلغ سفارش با کیف پول یا تخفیف تکمیل نشد.");
  }

  await prisma.$transaction(async (tx) => {
    if (order.walletAppliedToman > 0) {
      await tx.walletTransaction.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          type: "PURCHASE",
          amountToman: -order.walletAppliedToman,
          description: "پرداخت با کیف پول"
        }
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paymentMethod: "WALLET", cardAmountToman: 0 }
    });
  });

  return order.type === "SERVICE_RENEWAL" ? renewService(order.id) : provisionService(order.id);
}

export async function getOrderPayable(orderId: string): Promise<{ order: Order; due: number }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error("سفارش پیدا نشد.");
  }
  return { order, due: payableAmount(order.amountToman, order.discountAmountToman, order.walletAppliedToman) };
}

export async function approvePayment(receiptId: string, adminTelegramId: number): Promise<OrderWithUserPlan | Order> {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id: receiptId },
    include: { order: { include: { user: true, plan: { include: { category: true } } } } }
  });

  if (!receipt) {
    throw new Error("رسید پیدا نشد");
  }

  if (receipt.status !== "PENDING") {
    throw new Error("این رسید قبلا بررسی شده است.");
  }
  await prisma.$transaction(async (tx) => {
    const updatedReceipt = await tx.paymentReceipt.updateMany({
      where: { id: receiptId, status: "PENDING" },
      data: { status: "APPROVED", adminTelegramId: BigInt(adminTelegramId) }
    });
    if (updatedReceipt.count !== 1) {
      throw new Error("این رسید قبلا بررسی شده است.");
    }
    await tx.order.update({
      where: { id: receipt.orderId },
      data: { status: "PAID" }
    });

    if (receipt.order.walletAppliedToman > 0) {
      const existingWalletDebit = await tx.walletTransaction.findFirst({
        where: { orderId: receipt.orderId, type: "PURCHASE" }
      });
      if (!existingWalletDebit) {
        await tx.walletTransaction.create({
          data: {
            userId: receipt.order.userId,
            orderId: receipt.orderId,
            type: "PURCHASE",
            amountToman: -receipt.order.walletAppliedToman,
            description: "کم کردن میزان کیف پول از سفارش"
          }
        });
      }
    }

    if (receipt.order.type === "WALLET_TOPUP") {
      const existingTopup = await tx.walletTransaction.findFirst({
        where: { orderId: receipt.orderId, type: "TOPUP" }
      });
      if (existingTopup) {
        return;
      }
      await tx.walletTransaction.create({
        data: {
          userId: receipt.order.userId,
          orderId: receipt.orderId,
          type: "TOPUP",
          amountToman: receipt.order.amountToman,
          description: "شارژ کیف پول با کارت به کارت"
        }
      });
    }
  });

  if (receipt.order.type === "SERVICE_PURCHASE") {
    return provisionService(receipt.orderId);
  }

  if (receipt.order.type === "SERVICE_RENEWAL") {
    return renewService(receipt.orderId);
  }

  return prisma.order.findUniqueOrThrow({ where: { id: receipt.orderId } });
}

export async function rejectPayment(receiptId: string, adminTelegramId: number, note = "تراکنش اشتباه است.") {
  const existingReceipt = await prisma.paymentReceipt.findUnique({
    where: { id: receiptId },
    select: { status: true }
  });
  if (!existingReceipt) {
    throw new Error("رسید پیدا نشد.");
  }
  if (existingReceipt.status !== "PENDING") {
    throw new Error("این رسید قبلا بررسی شده است.");
  }
  return prisma.$transaction(async (tx) => {
    const updatedReceipt = await tx.paymentReceipt.updateMany({
      where: { id: receiptId, status: "PENDING" },
      data: {
        status: "REJECTED",
        adminTelegramId: BigInt(adminTelegramId),
        adminNote: note
      }
    });
    if (updatedReceipt.count !== 1) {
      throw new Error("این رسید قبلا بررسی شده است.");
    }

    const receipt = await tx.paymentReceipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: { order: true }
    });

    await tx.order.update({
      where: { id: receipt.orderId },
      data: {
        status: "REJECTED",
        failureReason: note
      }
    });

    return receipt;
  });
}

export async function provisionService(orderId: string): Promise<OrderWithUserPlan> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, plan: { include: { category: true } } }
  });

  if (!order || !order.plan) {
    throw new Error("سفارش یا پلن پیدا نشد.");
  }

  await prisma.order.update({ where: { id: order.id }, data: { status: "PROVISIONING" } });

  try {
    const finalUsername = await reserveRemnawaveUsername(order.requestedUsername ?? `user_${order.user.telegramId}`);
    const expiresAt = expirationFromNow(order.plan.durationDays);
    const remoteUser = await remnawaveClient.createUser({
      username: finalUsername,
      telegramId: Number(order.user.telegramId),
      trafficLimitBytes: gbToBytes(order.plan.volumeGb),
      expiresAt,
      squadUuids: getPlanSquadUuids(order.plan),
      orderId: order.id
    });
    const subscriptionUrl = await remnawaveClient.getSubscriptionUrl(remoteUser.uuid);

    await prisma.$transaction(async (tx) => {
      await tx.purchasedService.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          planId: order.planId!,
          remnawaveUserUuid: remoteUser.uuid,
          remnawaveShortUuid: remoteUser.shortUuid,
          username: remoteUser.username,
          subscriptionUrl,
          volumeGb: order.plan!.volumeGb,
          expiresAt
        }
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PROVISIONED",
          finalUsername: remoteUser.username
        }
      });
      await tx.auditLog.create({
        data: {
          action: "remnawave.user.create",
          entityType: "order",
          entityId: order.id,
          metadata: {
            remnawaveUserUuid: remoteUser.uuid,
            telegramId: order.user.telegramId.toString()
          }
        }
      });
    });

    await grantPurchaseReferralReward(order.id);

    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { user: true, plan: { include: { category: true } } }
    });
  } catch (error) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "ساخت سرویس ناموفق بود."
      }
    });
    throw error;
  }
}

export async function renewService(orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, targetService: true }
  });

  if (!order || !order.targetService || !order.renewalVolumeGb || !order.renewalDurationDays) {
    throw new Error("سفارش تمدید یا سرویس پیدا نشد.");
  }

  const targetService = order.targetService;

  await prisma.order.update({ where: { id: order.id }, data: { status: "PROVISIONING" } });

  try {
    const addedBytes = gbToBytes(order.renewalVolumeGb);
    const remoteUser = await remnawaveClient.extendUserTrafficAndExpiry({
      userUuid: targetService.remnawaveUserUuid,
      addTrafficBytes: addedBytes,
      addDays: order.renewalDurationDays,
      fallbackTrafficLimitBytes: gbToBytes(targetService.volumeGb),
      fallbackExpiresAt: targetService.expiresAt,
      orderId: order.id,
      telegramId: Number(order.user.telegramId)
    });

    const nextExpiresAt = remoteUser.expiresAt ?? addDaysFromBase(targetService.expiresAt, order.renewalDurationDays);
    const subscriptionUrl = await remnawaveClient.getSubscriptionUrl(targetService.remnawaveUserUuid);

    await prisma.$transaction(async (tx) => {
      await tx.purchasedService.update({
        where: { id: order.targetServiceId! },
        data: {
          volumeGb: targetService.volumeGb + order.renewalVolumeGb!,
          expiresAt: nextExpiresAt,
          subscriptionUrl,
          lowTrafficNotifiedAt: null
        }
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PROVISIONED" }
      });
      await tx.auditLog.create({
        data: {
          action: "remnawave.user.extend",
          entityType: "order",
          entityId: order.id,
          metadata: {
            remnawaveUserUuid: targetService.remnawaveUserUuid,
            addedVolumeGb: order.renewalVolumeGb,
            addedDays: order.renewalDurationDays,
            telegramId: order.user.telegramId.toString()
          }
        }
      });
    });

    await grantPurchaseReferralReward(order.id);

    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  } catch (error) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "تمدید سرویس ناموفق بود."
      }
    });
    throw error;
  }
}

async function reserveRemnawaveUsername(requestedUsername: string): Promise<string> {
  const baseUsername = sanitizeUsername(requestedUsername);
  const checkedCandidates = new Set<string>();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? baseUsername : withRandomSuffix(baseUsername);
    if (checkedCandidates.has(candidate)) {
      continue;
    }
    checkedCandidates.add(candidate);

    const existing = await remnawaveClient.getUser(candidate);
    if (!existing) {
      return candidate;
    }
  }

  throw new Error("نام کاربری غیرتکراری پیدا نشد.");
}

function addDaysFromBase(baseDate: Date, days: number): Date {
  const nextExpiryBase = baseDate.getTime() > Date.now() ? baseDate : new Date();
  const nextExpiresAt = new Date(nextExpiryBase);
  nextExpiresAt.setDate(nextExpiresAt.getDate() + days);
  return nextExpiresAt;
}

function getPlanSquadUuids(plan: Plan & { category: PlanCategory }): string[] {
  const planSquads = plan.remnawaveSquadUuids.filter(Boolean);
  if (planSquads.length > 0) {
    return planSquads;
  }

  const categorySquads = plan.category.remnawaveSquadUuids.filter(Boolean);
  if (categorySquads.length > 0) {
    return categorySquads;
  }

  return [plan.category.remnawaveSquadUuid].filter(Boolean);
}
