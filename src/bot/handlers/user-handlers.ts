import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { config } from "../../config.js";
import { bytesToGb, formatDays, formatGb, formatToman } from "../../domain/format.js";
import { parseReferralPayload } from "../../domain/referral.js";
import { isValidServiceUsername } from "../../domain/username.js";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { remnawaveClient } from "../../remnawave/remnawave-client.js";
import {
  applyDiscountCode,
  applyWalletOffset,
  createRenewalOrder,
  createServiceOrder,
  createWalletTopupOrder,
  finalizeWalletCoveredOrder,
  getOrderPayable,
  payServiceOrderByWallet,
  submitCardReceipt
} from "../../services/order-service.js";
import { upsertTelegramUser } from "../../services/users.js";
import { getText } from "../../services/text-service.js";
import { getWalletBalance } from "../../services/wallet-service.js";
import { isChannelMember } from "../membership.js";
import { replyJoinRequired, replyMainMenu } from "../replies.js";

export async function handleStart(ctx: BotContext) {
  const payload = "payload" in ctx ? String(ctx.payload ?? "") : "";
  await upsertTelegramUser(ctx, parseReferralPayload(payload));
  if (!(await isChannelMember(ctx))) {
    await replyJoinRequired(ctx);
    return;
  }
  await replyMainMenu(ctx);
}

export async function handleBuy(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;

  const categories = await prisma.planCategory.findMany({
    where: { isEnabled: true, plans: { some: { isEnabled: true } } },
    orderBy: { title: "asc" }
  });

  if (categories.length === 0) {
    await ctx.reply(await getText("buy.noPlans"));
    return;
  }

  await ctx.reply(
    await getText("buy.selectCategory"),
    Markup.inlineKeyboard(categories.map((category) => [Markup.button.callback(category.title, `cat:${category.id}`)]))
  );
}

export async function handleCategory(ctx: BotContext, categoryId: string) {
  if (!(await ensureAllowed(ctx))) return;

  const plans = await prisma.plan.findMany({
    where: { categoryId, isEnabled: true },
    orderBy: [{ durationDays: "asc" }, { volumeGb: "asc" }]
  });

  if (plans.length === 0) {
    await ctx.reply(await getText("buy.noCategoryPlans"));
    return;
  }

  await ctx.reply(
    await getText("buy.selectPlan"),
    Markup.inlineKeyboard(
      plans.map((plan) => [
        Markup.button.callback(plan.title, `plan:${plan.id}`)
      ])
    )
  );
}

export async function handlePlan(ctx: BotContext, planId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "purchase_username";
  ctx.session.planId = planId;
  await ctx.reply(await getText("buy.usernamePrompt"));
}

export async function handleUsernameMessage(ctx: BotContext, text: string) {
  const user = await upsertTelegramUser(ctx);
  if (!isValidServiceUsername(text)) {
    await ctx.reply(await getText("buy.invalidUsername"));
    return;
  }
  if (!ctx.session.planId) {
    await ctx.reply("❌ پلن پیدا نشد. دوباره از منوی خرید شروع کنید.");
    ctx.session = {};
    return;
  }

  const order = await createServiceOrder(user.id, ctx.session.planId, text);
  ctx.session.orderId = order.id;
  ctx.session.flow = undefined;
  await sendCheckoutOptions(ctx, order.id);
}

export async function handlePayCard(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const { due } = await getOrderPayable(orderId);
  if (due <= 0) {
    await ctx.reply(await getText("payment.cardZero"));
    return;
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "WAITING_PAYMENT", paymentMethod: "CARD_TO_CARD", cardAmountToman: due }
  });
  ctx.session.flow = "awaiting_receipt";
  ctx.session.orderId = orderId;
  await ctx.reply(await getText("payment.cardInstruction", { amount: formatToman(due), cardText: config.CARD_TO_CARD_TEXT }));
  await ctx.reply(await getText("payment.sendReceipt"));
}

export async function handlePayWallet(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;

  try {
    const order = await payServiceOrderByWallet(orderId);
    if (order.type === "SERVICE_RENEWAL") {
      await sendRenewedService(ctx, order.id);
    } else {
      await sendProvisionedService(ctx, order.id);
    }
  } catch (error) {
    await ctx.reply(error instanceof Error ? `❌ ${error.message}` : "❌ پرداخت با کیف پول ناموفق بود.");
  }
}

export async function handleDiscountStart(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "discount_code";
  ctx.session.orderId = orderId;
  await ctx.reply(await getText("discount.prompt"));
}

export async function handleDiscountCode(ctx: BotContext, text: string) {
  if (!ctx.session.orderId) {
    await ctx.reply(await getText("discount.orderMissing"));
    ctx.session = {};
    return;
  }

  try {
    const order = await applyDiscountCode(ctx.session.orderId, text);
    ctx.session.flow = undefined;
    await ctx.reply(await getText("discount.applied", { amount: formatToman(order.discountAmountToman) }));
    await sendCheckoutOptions(ctx, order.id);
  } catch (error) {
    await ctx.reply(error instanceof Error ? `❌ ${error.message}` : "❌ کد تخفیف اعمال نشد.");
  }
}

export async function handleApplyWallet(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  try {
    const order = await applyWalletOffset(orderId);
    const due = order.cardAmountToman ?? 0;
    await ctx.reply(`✅ مبلغ ${formatToman(order.walletAppliedToman)} از کیف پول استفاده می‌شود.${due > 0 ? `\nمبلغ باقی‌مانده: ${formatToman(due)}` : ""}`);
    if (due === 0) {
      const paidOrder = await finalizeWalletCoveredOrder(order.id);
      if (paidOrder.type === "SERVICE_RENEWAL") {
        await sendRenewedService(ctx, paidOrder.id);
      } else {
        await sendProvisionedService(ctx, paidOrder.id);
      }
      return;
    }
    await sendCheckoutOptions(ctx, order.id);
  } catch (error) {
    await ctx.reply(error instanceof Error ? `❌ ${error.message}` : "❌ کیف پول اعمال نشد.");
  }
}

export async function handleWalletCharge(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "wallet_amount";
  await ctx.reply(await getText("wallet.chargePrompt"));
}

export async function handleWalletAmount(ctx: BotContext, text: string) {
  const user = await upsertTelegramUser(ctx);
  const amount = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(amount) || amount < 1000) {
    await ctx.reply(await getText("wallet.invalidAmount"));
    return;
  }

  const order = await createWalletTopupOrder(user.id, amount);
  ctx.session.flow = "awaiting_receipt";
  ctx.session.orderId = order.id;
  await ctx.reply(await getText("wallet.chargeInstruction", { amount: formatToman(amount), cardText: config.CARD_TO_CARD_TEXT }));
  await ctx.reply(await getText("payment.sendReceipt"));
}

export async function handleReceiptPhoto(ctx: BotContext, fileId: string) {
  const orderId = ctx.session.orderId;
  if (!orderId || ctx.session.flow !== "awaiting_receipt") {
    await ctx.reply(await getText("payment.noPending"));
    await replyMainMenu(ctx);
    return;
  }

  const { order, receipt } = await submitCardReceipt(orderId, fileId);
  ctx.session = {};

  const orderWithDetails = await prisma.order.findUnique({
    where: { id: order.id },
    include: { user: true, plan: { include: { category: true } }, targetService: true }
  });

  const caption = [
    "Receipt jadid",
    `Order: ${order.id}`,
    `Type: ${order.type}`,
    `Amount asli: ${formatToman(order.amountToman)}`,
    orderWithDetails?.discountAmountToman ? `Takhfif: ${formatToman(orderWithDetails.discountAmountToman)}` : undefined,
    orderWithDetails?.walletAppliedToman ? `Kife pool: ${formatToman(orderWithDetails.walletAppliedToman)}` : undefined,
    orderWithDetails?.cardAmountToman ? `Card-to-card: ${formatToman(orderWithDetails.cardAmountToman)}` : undefined,
    `User: ${orderWithDetails?.user.username ? `@${orderWithDetails.user.username}` : orderWithDetails?.user.telegramId.toString()}`,
    orderWithDetails?.plan ? `Plan: ${orderWithDetails.plan.category.title} / ${orderWithDetails.plan.title}` : undefined,
    orderWithDetails?.targetService
      ? `Tamdid: ${orderWithDetails.targetService.username} / ${orderWithDetails.renewalVolumeGb}GB / ${orderWithDetails.renewalDurationDays} rooz`
      : undefined
  ]
    .filter(Boolean)
    .join("\n");

  const adminResults = await Promise.allSettled(config.ADMIN_IDS.map((adminId) => ctx.telegram.sendPhoto(adminId, fileId, {
      caption,
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback("Taeed", `admin:approve:${receipt.id}`),
          Markup.button.callback("Rad", `admin:reject:${receipt.id}`)
        ]
      ]).reply_markup
    })));

  const deliveredCount = adminResults.filter((result) => result.status === "fulfilled").length;
  const failedAdminIds = config.ADMIN_IDS.filter((_adminId, index) => adminResults[index]?.status === "rejected");
  if (failedAdminIds.length > 0) {
    logger.warn(
      {
        orderId: order.id,
        receiptId: receipt.id,
        failedAdminIds
      },
      "Receipt delivery to some admins failed"
    );
  }

  if (deliveredCount === 0) {
    await ctx.reply(await getText("payment.receiptNotSent"));
  } else {
    await ctx.reply(await getText("payment.receiptSent"));
  }
  await replyMainMenu(ctx);
}

export async function handleMyServices(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const services = await prisma.purchasedService.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  if (services.length === 0) {
    await ctx.reply(await getText("services.empty"));
    return;
  }

  await ctx.reply(
    await getText("services.listTitle"),
    Markup.inlineKeyboard(services.map((service) => [Markup.button.callback(service.username, `svc:${service.id}`)]))
  );
}

export async function handleServiceDetail(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) {
    await ctx.reply(await getText("services.notFound"));
    return;
  }

  const usage = await remnawaveClient.getUserUsage(service.remnawaveUserUuid);
  const subscriptionUrl = await remnawaveClient.getSubscriptionUrl(service.remnawaveUserUuid);
  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  const daysLeft = Math.max(0, Math.ceil((service.expiresAt.getTime() - Date.now()) / 86_400_000));
  const usedGb = bytesToGb(usage.usedTrafficBytes);
  const totalGb = usage.trafficLimitBytes ? bytesToGb(usage.trafficLimitBytes) : service.volumeGb;

  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        `👤 نام کاربری: ${service.username}`,
        `🔗 لینک: ${subscriptionUrl}`,
        `📊 مصرف: ${usedGb} / ${totalGb} GB`,
        `⏳ روز باقی‌مانده: ${daysLeft}`
      ].join("\n"),
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🔄 تمدید سرویس", `renew:${service.id}`)]]).reply_markup
    }
  );
}

export async function handleRenewService(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const service = await prisma.purchasedService.findFirst({ where: { id: serviceId, userId: user.id } });
  if (!service) {
    await ctx.reply(await getText("renew.notFound"));
    return;
  }

  await ctx.reply(
    await getText("renew.select"),
    Markup.inlineKeyboard(
      config.RENEWAL_PLANS.map((option) => [
        Markup.button.callback(
          `${formatGb(option.volumeGb)} / ${formatDays(option.durationDays)} - ${formatToman(option.priceToman)}`,
          `renew_opt:${service.id}:${option.volumeGb}`
        )
      ])
    )
  );
}

export async function handleRenewOption(ctx: BotContext, serviceId: string, volumeGb: number) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const option = config.RENEWAL_PLANS.find((item) => item.volumeGb === volumeGb);
  if (!option) {
    await ctx.reply(await getText("renew.optionNotFound"));
    return;
  }

  const order = await createRenewalOrder(user.id, serviceId, option.volumeGb, option.durationDays, option.priceToman);
  ctx.session.orderId = order.id;
  await ctx.reply(await getText("renew.created", { volume: formatGb(option.volumeGb), days: formatDays(option.durationDays) }));
  await sendCheckoutOptions(ctx, order.id);
}

export async function handleReferral(ctx: BotContext) {
  const user = await upsertTelegramUser(ctx);
  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.referralCode}`;
  const balance = await getWalletBalance(user.id);
  await ctx.reply(await getText("referral.message", { link, reward: formatToman(config.REFERRAL_REWARD_TOMAN), balance: formatToman(balance) }));
}

export async function handleContent(ctx: BotContext, kind: "TRAINING" | "SOFTWARE") {
  if (!(await ensureAllowed(ctx))) return;
  const items = await prisma.adminContent.findMany({
    where: { kind, isEnabled: true },
    orderBy: { createdAt: "desc" }
  });

  if (items.length === 0) {
    await ctx.reply(await getText("content.empty"));
    return;
  }

  await ctx.reply(
    await getText("content.select"),
    Markup.inlineKeyboard(items.map((item) => [Markup.button.callback(item.title, `content_item:${item.id}`)]))
  );
}

export async function handleContentItem(ctx: BotContext, itemId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const item = await prisma.adminContent.findUnique({ where: { id: itemId } });
  if (!item || !item.isEnabled) {
    await ctx.reply(await getText("content.notFound"));
    return;
  }

  const caption = item.body ?? item.title;
  if (item.telegramFileId && item.contentType === "PHOTO") {
    await ctx.replyWithPhoto(item.telegramFileId, { caption });
  } else if (item.telegramFileId && item.contentType === "DOCUMENT") {
    await ctx.replyWithDocument(item.telegramFileId, { caption });
  } else {
    await ctx.reply(caption);
  }
}

export async function handleSupport(ctx: BotContext) {
  await ctx.reply(`${await getText("support.message")} ${config.SUPPORT_USERNAME}`);
  await replyMainMenu(ctx);
}

export async function sendProvisionedService(ctx: BotContext, orderId: string) {
  const service = await prisma.purchasedService.findUnique({ where: { orderId } });
  if (!service) {
    await ctx.reply("⚠️ سرویس ساخته شد اما رکورد داخلی پیدا نشد. لطفا به پشتیبانی اطلاع دهید.");
    return;
  }

  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [`✅ سرویس شما آماده است.`, `👤 نام کاربری: ${service.username}`, `🔗 لینک: ${service.subscriptionUrl}`].join("\n")
    }
  );
  await replyMainMenu(ctx);
}

export async function sendRenewedService(ctx: BotContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { targetService: true }
  });
  if (!order?.targetService) {
    await ctx.reply("⚠️ تمدید انجام شد اما سرویس داخلی پیدا نشد. لطفا به پشتیبانی اطلاع دهید.");
    return;
  }

  const service = order.targetService;
  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  const daysLeft = Math.max(0, Math.ceil((service.expiresAt.getTime() - Date.now()) / 86_400_000));
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        "✅ سرویس شما تمدید شد.",
        `👤 نام کاربری: ${service.username}`,
        `🔗 لینک: ${service.subscriptionUrl}`,
        `📦 حجم جدید: ${formatGb(service.volumeGb)}`,
        `⏳ روز باقی‌مانده: ${daysLeft}`
      ].join("\n")
    }
  );
  await replyMainMenu(ctx);
}

async function ensureAllowed(ctx: BotContext): Promise<boolean> {
  await upsertTelegramUser(ctx);
  if (!(await isChannelMember(ctx))) {
    await replyJoinRequired(ctx);
    return false;
  }
  return true;
}

async function sendCheckoutOptions(ctx: BotContext, orderId: string) {
  const { order, due } = await getOrderPayable(orderId);
  const balance = await getWalletBalance(order.userId);
  await ctx.reply(
    [
      `💵 مبلغ اصلی: ${formatToman(order.amountToman)}`,
      order.discountAmountToman > 0 ? `🎟️ تخفیف: ${formatToman(order.discountAmountToman)}` : undefined,
      order.walletAppliedToman > 0 ? `👛 کیف پول: ${formatToman(order.walletAppliedToman)}` : undefined,
      `✅ مبلغ قابل پرداخت: ${formatToman(due)}`,
      `👛 موجودی کیف پول: ${formatToman(balance)}`
    ]
      .filter(Boolean)
      .join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback(await getText("checkout.discountButton"), `discount:${orderId}`)],
      [Markup.button.callback(await getText("checkout.walletOffsetButton"), `apply_wallet:${orderId}`)],
      [Markup.button.callback(await getText("checkout.walletPayButton"), `pay_wallet:${orderId}`)],
      [Markup.button.callback(await getText("checkout.cardButton"), `pay_card:${orderId}`)]
    ])
  );
}
