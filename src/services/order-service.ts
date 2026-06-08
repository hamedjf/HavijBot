import type { Order, Plan, PlanCategory, TelegramUser } from "@prisma/client";
import { prisma } from "../db.js";
import { calculateDiscountAmount, payableAmount, walletOffsetForOrder } from "../domain/checkout.js";
import { expirationFromNow, gbToBytes } from "../domain/plans.js";
import { sanitizeUsername, withRandomSuffix } from "../domain/username.js";
import { assertEnoughBalance } from "../domain/wallet.js";
import { remnawaveClient } from "../remnawave/remnawave-client.js";
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
    throw new Error("Plan faal peyda nashod.");
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

export async function createRenewalOrder(userId: string, serviceId: string, volumeGb: number, durationDays: number, priceToman: number) {
  const service = await prisma.purchasedService.findFirst({
    where: { id: serviceId, userId }
  });
  if (!service) {
    throw new Error("Service baraye tamdid peyda nashod.");
  }

  return prisma.order.create({
    data: {
      userId,
      type: "SERVICE_RENEWAL",
      status: "DRAFT",
      targetServiceId: serviceId,
      renewalVolumeGb: volumeGb,
      renewalDurationDays: durationDays,
      amountToman: priceToman
    }
  });
}

export async function submitCardReceipt(orderId: string, telegramFileId: string) {
  const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
  if (!orderBefore) {
    throw new Error("Order peyda nashod.");
  }
  const cardAmount = payableAmount(orderBefore.amountToman, orderBefore.discountAmountToman, orderBefore.walletAppliedToman);
  if (cardAmount <= 0) {
    throw new Error("Mablaghe card-to-card baraye in order sefr ast.");
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

export async function payServiceOrderByWallet(orderId: string): Promise<OrderWithUserPlan | Order> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, plan: { include: { category: true } }, targetService: true }
  });

  if (!order) {
    throw new Error("Order peyda nashod.");
  }

  if (order.type === "SERVICE_PURCHASE" && !order.plan) {
    throw new Error("Plan peyda nashod.");
  }

  if (order.type === "SERVICE_RENEWAL" && !order.targetService) {
    throw new Error("Service tamdid peyda nashod.");
  }

  const balance = await getWalletBalance(order.userId);
  const due = payableAmount(order.amountToman, order.discountAmountToman, 0);
  assertEnoughBalance(balance, due);

  await prisma.$transaction(async (tx) => {
    await tx.walletTransaction.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: "PURCHASE",
        amountToman: -due,
        description: order.type === "SERVICE_RENEWAL" ? "Tamdid service" : `Kharid service ${order.plan?.title ?? ""}`
      }
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paymentMethod: "WALLET", walletAppliedToman: due, cardAmountToman: 0 }
    });
  });

  return order.type === "SERVICE_RENEWAL" ? renewService(order.id) : provisionService(order.id);
}

export async function applyDiscountCode(orderId: string, code: string): Promise<Order> {
  const normalizedCode = code.trim().toUpperCase();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error("Order peyda nashod.");
  }

  const discount = await prisma.discountCode.findUnique({ where: { code: normalizedCode } });
  if (!discount || !discount.isEnabled) {
    throw new Error("Code takhfif motabar nist.");
  }
  if (discount.expiresAt && discount.expiresAt.getTime() < Date.now()) {
    throw new Error("Code takhfif expire shode.");
  }
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) {
    throw new Error("Zarfiat code takhfif tamam shode.");
  }

  const discountAmount = calculateDiscountAmount(order.amountToman, discount);
  if (discountAmount <= 0) {
    throw new Error("Code takhfif baraye in order mablaghi kam nemikone.");
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
    return updated;
  });
}

export async function applyWalletOffset(orderId: string): Promise<Order> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error("Order peyda nashod.");
  }

  const balance = await getWalletBalance(order.userId);
  const dueBeforeWallet = payableAmount(order.amountToman, order.discountAmountToman, 0);
  const walletApplied = walletOffsetForOrder(dueBeforeWallet, balance);
  if (walletApplied <= 0) {
    throw new Error("Mojoodi kife pool baraye kam kardan vojood nadare.");
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
    throw new Error("Order peyda nashod.");
  }

  const due = payableAmount(order.amountToman, order.discountAmountToman, order.walletAppliedToman);
  if (due > 0) {
    throw new Error("In order hanooz mablaghe card-to-card dare.");
  }
  if (order.walletAppliedToman <= 0 && order.discountAmountToman < order.amountToman) {
    throw new Error("Mablagh order ba wallet ya takhfif pooshesh dade nashode.");
  }

  await prisma.$transaction(async (tx) => {
    if (order.walletAppliedToman > 0) {
      await tx.walletTransaction.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          type: "PURCHASE",
          amountToman: -order.walletAppliedToman,
          description: "Pardakht ba kife pool"
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
    throw new Error("Order peyda nashod.");
  }
  return { order, due: payableAmount(order.amountToman, order.discountAmountToman, order.walletAppliedToman) };
}

export async function approvePayment(receiptId: string, adminTelegramId: number): Promise<OrderWithUserPlan | Order> {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { id: receiptId },
    include: { order: { include: { user: true, plan: { include: { category: true } } } } }
  });

  if (!receipt) {
    throw new Error("Receipt peyda nashod.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentReceipt.update({
      where: { id: receiptId },
      data: { status: "APPROVED", adminTelegramId: BigInt(adminTelegramId) }
    });
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
            description: "Kam kardan bakhshi az mablagh ba kife pool"
          }
        });
      }
    }

    if (receipt.order.type === "WALLET_TOPUP") {
      await tx.walletTransaction.create({
        data: {
          userId: receipt.order.userId,
          orderId: receipt.orderId,
          type: "TOPUP",
          amountToman: receipt.order.amountToman,
          description: "Charge kife pool ba card-to-card"
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

export async function rejectPayment(receiptId: string, adminTelegramId: number, note = "Tarakonesh eshtebah ast.") {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.paymentReceipt.update({
      where: { id: receiptId },
      data: {
        status: "REJECTED",
        adminTelegramId: BigInt(adminTelegramId),
        adminNote: note
      },
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
    throw new Error("Order ya plan peyda nashod.");
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
      squadUuid: order.plan.category.remnawaveSquadUuid,
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

    return prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { user: true, plan: { include: { category: true } } }
    });
  } catch (error) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Provisioning failed"
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
    throw new Error("Order tamdid ya service peyda nashod.");
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
          subscriptionUrl
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

    return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  } catch (error) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message : "Renewal failed"
      }
    });
    throw error;
  }
}

async function reserveRemnawaveUsername(requestedUsername: string): Promise<string> {
  let candidate = sanitizeUsername(requestedUsername);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await remnawaveClient.getUser(candidate);
    if (!existing) {
      return candidate;
    }
    candidate = withRandomSuffix(candidate);
  }

  throw new Error("Username gheire tekrari peyda nashod.");
}

function addDaysFromBase(baseDate: Date, days: number): Date {
  const nextExpiryBase = baseDate.getTime() > Date.now() ? baseDate : new Date();
  const nextExpiresAt = new Date(nextExpiryBase);
  nextExpiresAt.setDate(nextExpiresAt.getDate() + days);
  return nextExpiresAt;
}
