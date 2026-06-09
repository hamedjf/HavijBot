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
  await ctx.reply(await getCardPaymentText(due), getCardCopyKeyboard(orderId));
  await ctx.reply(await getText("payment.sendReceipt"));
}

export async function handlePayWallet(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;

  try {
    const order = await payServiceOrderByWallet(orderId);
    await notifyAdminsInstantPayment(ctx, order.id, "Pardakht kamel ba kife pool");
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
      await notifyAdminsInstantPayment(ctx, paidOrder.id, "Tasvie kamel ba kife pool/takhfif");
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
  await ctx.reply(await getCardChargeText(amount), getCardCopyKeyboard(order.id));
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
    include: { user: true, plan: { include: { category: true } }, targetService: true, discountCode: true }
  });

  const caption = buildAdminPaymentSummary(orderWithDetails ?? order);

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

export async function handleCopyCardNumber(ctx: BotContext) {
  await ctx.answerCbQuery(extractCardNumber() ?? config.CARD_TO_CARD_TEXT.slice(0, 180), { show_alert: true });
}

export async function handleCopyRialAmount(ctx: BotContext, orderId: string) {
  const { due } = await getOrderPayable(orderId);
  await ctx.answerCbQuery(`${due * 10}`, { show_alert: true });
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
  await sendSubscriptionConfigs(ctx, service.remnawaveUserUuid, subscriptionUrl);
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
  await sendSubscriptionConfigs(ctx, service.remnawaveUserUuid, service.subscriptionUrl);
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
  await sendSubscriptionConfigs(ctx, service.remnawaveUserUuid, service.subscriptionUrl);
  await replyMainMenu(ctx);
}

type AdminPaymentSummaryInput = {
  id: string;
  type: string;
  amountToman: number;
  discountAmountToman: number;
  walletAppliedToman: number;
  cardAmountToman: number | null;
  renewalVolumeGb: number | null;
  renewalDurationDays: number | null;
  user?: { username: string | null; telegramId: bigint };
  plan?: { title: string; category: { title: string } } | null;
  targetService?: { username: string } | null;
  discountCode?: { code: string } | null;
};

function buildAdminPaymentSummary(order: AdminPaymentSummaryInput) {
  const userLabel = order.user ? order.user.username ? `@${order.user.username}` : order.user.telegramId.toString() : "unknown";
  return [
    "Receipt jadid",
    `Order: ${order.id}`,
    `Type: ${order.type}`,
    `Amount asli: ${formatToman(order.amountToman)}`,
    `Code takhfif: ${order.discountCode?.code ?? "nadare"}`,
    `Mablaghe takhfif: ${formatToman(order.discountAmountToman)}`,
    `Masraf az kife pool: ${formatToman(order.walletAppliedToman)}`,
    `Mablaghe card-to-card: ${formatToman(order.cardAmountToman ?? 0)}`,
    `Mablaghe rial baraye variz: ${new Intl.NumberFormat("en-US").format((order.cardAmountToman ?? 0) * 10)} rial`,
    `User: ${userLabel}`,
    order.plan ? `Plan: ${order.plan.category.title} / ${order.plan.title}` : undefined,
    order.targetService ? `Tamdid: ${order.targetService.username} / ${order.renewalVolumeGb}GB / ${order.renewalDurationDays} rooz` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

async function notifyAdminsInstantPayment(ctx: BotContext, orderId: string, reason: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, plan: { include: { category: true } }, targetService: true, discountCode: true }
  });
  if (!order) return;

  const message = [`✅ ${reason}`, buildAdminPaymentSummary(order)].join("\n\n");
  const results = await Promise.allSettled(config.ADMIN_IDS.map((adminId) => ctx.telegram.sendMessage(adminId, message)));
  const failedAdminIds = config.ADMIN_IDS.filter((_adminId, index) => results[index]?.status === "rejected");
  if (failedAdminIds.length > 0) {
    logger.warn({ orderId, failedAdminIds }, "Instant payment notification to some admins failed");
  }
}

async function getCardPaymentText(amountToman: number) {
  const rial = new Intl.NumberFormat("en-US").format(amountToman * 10);
  const cardNumber = extractCardNumber() ?? config.CARD_TO_CARD_TEXT;
  const text = await getText("payment.cardInstruction", {
    amount: formatToman(amountToman),
    rialAmount: `${rial} rial`,
    cardText: config.CARD_TO_CARD_TEXT,
    cardNumber
  });
  return [text, "", `Shomare cart: ${cardNumber}`, `Mablagh be rial: ${rial} rial`].join("\n");
}

async function getCardChargeText(amountToman: number) {
  const rial = new Intl.NumberFormat("en-US").format(amountToman * 10);
  const cardNumber = extractCardNumber() ?? config.CARD_TO_CARD_TEXT;
  const text = await getText("wallet.chargeInstruction", {
    amount: formatToman(amountToman),
    rialAmount: `${rial} rial`,
    cardText: config.CARD_TO_CARD_TEXT,
    cardNumber
  });
  return [text, "", `Shomare cart: ${cardNumber}`, `Mablagh be rial: ${rial} rial`].join("\n");
}

function getCardCopyKeyboard(orderId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Copy shomare cart", "copy_card"),
      Markup.button.callback("Copy mablagh be rial", `copy_rial:${orderId}`)
    ]
  ]);
}

function extractCardNumber() {
  const normalized = config.CARD_TO_CARD_TEXT.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const match = normalized.replace(/[^\d]/g, "").match(/\d{16}/);
  return match?.[0] ?? null;
}

async function sendSubscriptionConfigs(ctx: BotContext, usernameOrUuid: string, subscriptionUrl: string) {
  try {
    const configs = await remnawaveClient.getSubscriptionConfigs(usernameOrUuid);
    if (configs.length === 0) {
      await ctx.reply(`🔗 لینک ساب شما:\n${subscriptionUrl}`);
      return;
    }

    const body = [
      `🔗 لینک ساب شما:\n${subscriptionUrl}`,
      "",
      "📋 کانفیگ‌ها:",
      configs.map((configLine) => `<code>${escapeHtml(configLine)}</code>`).join("\n\n")
    ].join("\n");

    await ctx.reply(body.slice(0, 3900), { parse_mode: "HTML" });
  } catch (error) {
    logger.warn({ err: error, usernameOrUuid }, "Subscription configs could not be fetched");
    await ctx.reply(`🔗 لینک ساب شما:\n${subscriptionUrl}`);
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const summary = await getText("checkout.summary", {
    amount: formatToman(order.amountToman),
    discount: formatToman(order.discountAmountToman),
    wallet: formatToman(order.walletAppliedToman),
    due: formatToman(due),
    balance: formatToman(balance)
  });

  await ctx.reply(
    summary,
    Markup.inlineKeyboard([
      [Markup.button.callback(await getText("checkout.discountButton"), `discount:${orderId}`)],
      [Markup.button.callback(await getText("checkout.walletOffsetButton"), `apply_wallet:${orderId}`)],
      [Markup.button.callback(await getText("checkout.walletPayButton"), `pay_wallet:${orderId}`)],
      [Markup.button.callback(await getText("checkout.cardButton"), `pay_card:${orderId}`)]
    ])
  );
}
