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
  createFreeTrialService,
  createRenewalOrder,
  createServiceOrder,
  createWalletTopupOrder,
  finalizeWalletCoveredOrder,
  getOrderPayable,
  submitCardReceipt
} from "../../services/order-service.js";
import { getCardToCardText } from "../../services/settings-service.js";
import { upsertTelegramUser } from "../../services/users.js";
import { getText } from "../../services/text-service.js";
import { getWalletBalance } from "../../services/wallet-service.js";
import { userNavKeyboard } from "../keyboards.js";
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
    Markup.inlineKeyboard([
      ...categories.map((category) => [Markup.button.callback(category.title, `cat:${category.id}`)]),
      ...userNavKeyboard()
    ])
  );
}

export async function handleFreeTrial(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const existingTrial = await prisma.freeTrial.findUnique({ where: { userId: user.id } });
  if (existingTrial && existingTrial.status !== "FAILED") {
    await ctx.reply(await getText("trial.alreadyUsed"), Markup.inlineKeyboard(userNavKeyboard()));
    return;
  }

  const plans = await prisma.plan.findMany({
    where: { isEnabled: true, category: { isEnabled: true } },
    include: { category: true },
    orderBy: [{ category: { title: "asc" } }, { durationDays: "asc" }, { volumeGb: "asc" }]
  });

  if (plans.length === 0) {
    await ctx.reply(await getText("trial.noPlans"), Markup.inlineKeyboard(userNavKeyboard()));
    return;
  }

  await ctx.reply(
    await getText("trial.selectPlan"),
    Markup.inlineKeyboard([
      ...plans.map((plan) => [Markup.button.callback(`${plan.category.title} / ${plan.title}`, `trial_plan:${plan.id}`)]),
      ...userNavKeyboard()
    ])
  );
}

export async function handleFreeTrialPlan(ctx: BotContext, planId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  await ctx.reply(await getText("trial.creating"));

  try {
    const order = await createFreeTrialService(user.id, planId);
    await sendProvisionedService(ctx, order.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : await getText("trial.failed");
    await ctx.reply(`❌ ${message}`, Markup.inlineKeyboard(userNavKeyboard()));
  }
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
      [
        ...plans.map((plan) => [
          Markup.button.callback(formatPlanButton(plan), `plan:${plan.id}`)
        ]),
        ...userNavKeyboard("buy")
      ]
    )
  );
}

export async function handlePlan(ctx: BotContext, planId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "purchase_username";
  ctx.session.planId = planId;
  await ctx.reply(await getText("buy.usernamePrompt"), Markup.inlineKeyboard(userNavKeyboard("buy")));
}

export async function handleUsernameMessage(ctx: BotContext, text: string) {
  const user = await upsertTelegramUser(ctx);
  if (!isValidServiceUsername(text)) {
    await ctx.reply(await getText("buy.invalidUsername"));
    return;
  }
  if (!ctx.session.planId) {
    await ctx.reply("❌ پلن پیدا نشد. لطفا دوباره از منوی خرید شروع کنید.");
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
  await ctx.reply(await getCardPaymentText(due), await getCardCopyKeyboard(orderId));
  await ctx.reply(await getText("payment.sendReceipt"));
}

export async function handleDiscountStart(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "discount_code";
  ctx.session.orderId = orderId;
  await ctx.reply(await getText("discount.prompt"), Markup.inlineKeyboard(userNavKeyboard()));
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
    await ctx.reply(
      [
        `✅ مبلغ ${formatToman(order.walletAppliedToman)} از کیف پول برای این سفارش لحاظ شد.`,
        due > 0
          ? `💳 مبلغ باقی‌مانده برای کارت‌به‌کارت: ${formatToman(due)}\n\nاین مبلغ بعد از ارسال رسید و تایید ادمین از کیف پول کم می‌شود.`
          : "✅ موجودی کیف پول برای پرداخت کامل کافی است."
      ].join("\n")
    );
    if (due === 0) {
      const paidOrder = await finalizeWalletCoveredOrder(order.id);
      await notifyAdminsInstantPayment(ctx, paidOrder.id, "تسویه کامل با کیف پول/تخفیف");
      if (paidOrder.type === "SERVICE_RENEWAL") {
        await sendRenewedService(ctx, paidOrder.id);
      } else {
        await sendProvisionedService(ctx, paidOrder.id);
      }
      return;
    }
    await handlePayCard(ctx, order.id);
  } catch (error) {
    await ctx.reply(error instanceof Error ? `❌ ${error.message}` : "❌ پرداخت با کیف پول انجام نشد.");
  }
}

export async function handleWalletOverview(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const balance = await getWalletBalance(user.id);
  await ctx.reply(
    await getText("wallet.overview", { balance: formatToman(balance) }),
    Markup.inlineKeyboard([
      [Markup.button.callback(await getText("wallet.chargeButton"), "wallet_charge")],
      ...userNavKeyboard()
    ])
  );
}

export async function handleWalletCharge(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "wallet_amount";
  await ctx.reply(await getText("wallet.chargePrompt"), Markup.inlineKeyboard(userNavKeyboard()));
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
  await ctx.reply(await getCardChargeText(amount), await getCardCopyKeyboard(order.id));
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
          Markup.button.callback("✅ تایید", `admin:approve:${receipt.id}`),
          Markup.button.callback("❌ رد", `admin:reject:${receipt.id}`)
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
    Markup.inlineKeyboard([
      ...services.map((service) => [Markup.button.callback(service.username, `svc:${service.id}`)]),
      ...userNavKeyboard()
    ])
  );
}

export async function handleServiceDetail(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) {
    await ctx.reply(await getText("services.notFound"));
    return;
  }

  let usage;
  let subscriptionUrl;
  let qr;
  try {
    usage = await remnawaveClient.getUserUsage(service.remnawaveUserUuid);
    subscriptionUrl = await remnawaveClient.getSubscriptionUrl(service.remnawaveUserUuid);
    qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  } catch (error) {
    if (isMissingRemnawaveUserError(error)) {
      await prisma.purchasedService.delete({ where: { id: service.id } }).catch(() => null);
      await ctx.reply("⚠️ این سرویس داخل پنل پیدا نشد و از لیست سرویس‌های شما حذف شد.\n\nبرای بررسی بیشتر، لطفا با پشتیبانی در ارتباط باشید.");
      await replyMainMenu(ctx);
      return;
    }
    throw error;
  }
  const syncedExpiresAt = usage.expiresAt ?? service.expiresAt;
  const syncedVolumeGb = usage.trafficLimitBytes > 0 ? Math.ceil(bytesToGb(usage.trafficLimitBytes)) : service.volumeGb;
  if (
    syncedExpiresAt.getTime() !== service.expiresAt.getTime() ||
    syncedVolumeGb !== service.volumeGb ||
    subscriptionUrl !== service.subscriptionUrl
  ) {
    await prisma.purchasedService.update({
      where: { id: service.id },
      data: {
        expiresAt: syncedExpiresAt,
        volumeGb: syncedVolumeGb,
        subscriptionUrl
      }
    });
  }

  const daysLeft = Math.max(0, Math.ceil((syncedExpiresAt.getTime() - Date.now()) / 86_400_000));
  const usedGb = bytesToGb(usage.usedTrafficBytes);
  const totalGb = usage.trafficLimitBytes > 0 ? bytesToGb(usage.trafficLimitBytes) : syncedVolumeGb;

  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        "📦 جزئیات سرویس",
        "",
        `👤 نام کاربری: ${service.username}`,
        `🔗 لینک ساب: ${subscriptionUrl}`,
        `📊 مصرف: ${usedGb} / ${totalGb} GB`,
        `⏳ روز باقی‌مانده: ${daysLeft}`
      ].join("\n"),
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("🔄 تمدید سرویس", `renew:${service.id}`)],
        [Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)],
        ...userNavKeyboard("my_services")
      ]).reply_markup
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

  const plan = await prisma.plan.findUnique({ where: { id: service.planId } });
  if (!plan) {
    await ctx.reply("❌ پلن فعلی این سرویس پیدا نشد. لطفا با پشتیبانی در ارتباط باشید.");
    return;
  }

  const renewalPlans = await prisma.plan.findMany({
    where: { categoryId: plan.categoryId, isEnabled: true, category: { isEnabled: true } },
    orderBy: [{ durationDays: "asc" }, { volumeGb: "asc" }]
  });
  if (renewalPlans.length === 0) {
    await ctx.reply("❌ در حال حاضر پلن فعالی برای تمدید این سرویس وجود ندارد.");
    return;
  }

  ctx.session.renewalServiceId = service.id;
  await ctx.reply(
    [
      "🔄 پلن تمدید را انتخاب کنید:",
      "",
      "توجه داشته باشید که این حجم و روز به سرویس شما اضافه خواهد شد و سرویس ریست نخواهد شد!"
    ].join("\n"),
    Markup.inlineKeyboard([
      ...renewalPlans.map((renewalPlan) => [
        Markup.button.callback(
          formatRenewalPlanButton(renewalPlan),
          `renew_plan:${renewalPlan.id}`
        )
      ]),
      ...userNavKeyboard(`svc:${service.id}`)
    ])
  );
}

export async function handleRenewPlan(ctx: BotContext, planId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const serviceId = ctx.session.renewalServiceId;
  if (!serviceId) {
    await ctx.reply("❌ سرویس تمدید پیدا نشد. لطفا دوباره از بخش سرویس‌های من شروع کنید.");
    return;
  }
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan?.isEnabled) {
    await ctx.reply("❌ این پلن برای تمدید فعال نیست.");
    return;
  }

  const order = await createRenewalOrder(user.id, serviceId, planId);
  ctx.session.orderId = order.id;
  ctx.session.renewalServiceId = undefined;
  await ctx.reply(
    await getText("renew.created", {
      volume: formatGb(plan.volumeGb),
      days: formatDays(plan.durationDays),
      price: formatToman(plan.priceToman)
    })
  );
  await sendCheckoutOptions(ctx, order.id);
}

export async function handleReferral(ctx: BotContext) {
  const user = await upsertTelegramUser(ctx);
  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.referralCode}`;
  const balance = await getWalletBalance(user.id);
  const invitedCount = await prisma.telegramUser.count({ where: { referredByUserId: user.id } });
  const referralMessage = await getText("referral.message", {
    link,
    rewardPercent: config.REFERRAL_REWARD_PERCENT.toString(),
    balance: formatToman(balance)
  });
  const invitedCountMessage = await getText("referral.invitedCount", { invitedCount: invitedCount.toString() });
  await ctx.reply(
    [referralMessage, invitedCountMessage].filter(Boolean).join("\n\n")
  );
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
    Markup.inlineKeyboard([
      ...items.map((item) => [Markup.button.callback(item.title, `content_item:${item.id}`)]),
      ...userNavKeyboard()
    ])
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
  } else if (item.telegramFileId && item.contentType === "VIDEO") {
    await ctx.replyWithVideo(item.telegramFileId, { caption });
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
    await ctx.reply("⚠️ سرویس ساخته شد، اما رکورد داخلی آن پیدا نشد.\nلطفا موضوع را به پشتیبانی اطلاع دهید.");
    return;
  }

  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        "✅ سرویس شما آماده است",
        "",
        `👤 نام کاربری: ${service.username}`,
        "",
        "🔗 لینک ساب:",
        service.subscriptionUrl,
        "",
        "این لینک را کپی کنید و داخل اپ‌های VPN در بخش Import / Subscription وارد کنید.",
        "اگر روی لینک بزنید، صفحه اطلاعات ساب شما هم باز می‌شود.",
        "",
        "برای دریافت کانفیگ‌های تکی، از دکمه زیر استفاده کنید."
      ].join("\n"),
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url("🔗 باز کردن لینک ساب", service.subscriptionUrl)],
        [Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)],
        ...userNavKeyboard()
      ]).reply_markup
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
    await ctx.reply("⚠️ تمدید انجام شد، اما سرویس داخلی پیدا نشد.\nلطفا موضوع را به پشتیبانی اطلاع دهید.");
    return;
  }

  const service = order.targetService;
  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  const daysLeft = Math.max(0, Math.ceil((service.expiresAt.getTime() - Date.now()) / 86_400_000));
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        "✅ سرویس شما تمدید شد",
        "",
        `👤 نام کاربری: ${service.username}`,
        "",
        "🔗 لینک ساب:",
        service.subscriptionUrl,
        "",
        "این لینک را کپی کنید و داخل اپ‌های VPN در بخش Import / Subscription وارد کنید.",
        "اگر روی لینک بزنید، صفحه اطلاعات ساب شما هم باز می‌شود.",
        "",
        `📦 حجم جدید: ${formatGb(service.volumeGb)}`,
        `⏳ روز باقی‌مانده: ${daysLeft}`
      ].join("\n"),
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url("🔗 باز کردن لینک ساب", service.subscriptionUrl)],
        [Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)],
        ...userNavKeyboard()
      ]).reply_markup
    }
  );
  await replyMainMenu(ctx);
}

export async function handleServiceConfigs(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const service = await prisma.purchasedService.findFirst({ where: { id: serviceId, userId: user.id } });
  if (!service) {
    await ctx.reply(await getText("services.notFound"));
    return;
  }
  await sendSubscriptionConfigs(ctx, service.remnawaveUserUuid, service.subscriptionUrl);
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
    "🧾 رسید جدید",
    `شناسه سفارش: ${order.id}`,
    `نوع سفارش: ${order.type}`,
    `مبلغ اصلی: ${formatToman(order.amountToman)}`,
    `کد تخفیف: ${order.discountCode?.code ?? "ندارد"}`,
    `مبلغ تخفیف: ${formatToman(order.discountAmountToman)}`,
    `پرداخت از کیف پول: ${formatToman(order.walletAppliedToman)}`,
    `مبلغ کارت‌به‌کارت: ${formatToman(order.cardAmountToman ?? 0)}`,
    `مبلغ واریز به ریال: ${new Intl.NumberFormat("en-US").format((order.cardAmountToman ?? 0) * 10)} ریال`,
    `کاربر: ${userLabel}`,
    order.plan ? `پلن: ${order.plan.category.title} / ${order.plan.title}` : undefined,
    order.targetService ? `تمدید: ${order.targetService.username} / ${order.renewalVolumeGb}GB / ${order.renewalDurationDays} روز` : undefined
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
  const cardText = await getCardToCardText();
  const cardNumber = extractCardNumber(cardText) ?? cardText;
  const text = await getText("payment.cardInstruction", {
    amount: formatToman(amountToman),
    rialAmount: `${rial} ریال`,
    cardText,
    cardNumber
  });
  return text;
}

async function getCardChargeText(amountToman: number) {
  const rial = new Intl.NumberFormat("en-US").format(amountToman * 10);
  const cardText = await getCardToCardText();
  const cardNumber = extractCardNumber(cardText) ?? cardText;
  const text = await getText("wallet.chargeInstruction", {
    amount: formatToman(amountToman),
    rialAmount: `${rial} ریال`,
    cardText,
    cardNumber
  });
  return text;
}

async function getCardCopyKeyboard(orderId: string) {
  const cardText = await getCardToCardText();
  const cardNumber = extractCardNumber(cardText) ?? cardText;
  const { due } = await getOrderPayable(orderId);
  const rialAmount = `${due * 10}`;
  return Markup.inlineKeyboard([
    [
      copyTextButton("📋 کپی شماره کارت", cardNumber),
      copyTextButton("📋 کپی مبلغ ریالی", rialAmount)
    ],
    ...userNavKeyboard()
  ]);
}

function copyTextButton(label: string, text: string) {
  return { text: label, copy_text: { text } } as never;
}

function formatRenewalPlanButton(plan: { title: string; volumeGb: number; durationDays: number; priceToman: number }) {
  return `${plan.title} - ${formatToman(plan.priceToman)}`;
}

function formatPlanButton(plan: { title: string; priceToman: number }) {
  return `${plan.title} - 5 کاربره - ${formatToman(plan.priceToman)}`;
}

function extractCardNumber(cardText: string) {
  const normalized = cardText
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
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
      "📋 کانفیگ‌های دستی",
      "",
      `🔗 لینک ساب:\n${subscriptionUrl}`,
      "",
      "کانفیگ‌ها:",
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
      [Markup.button.callback(await getText("checkout.cardButton"), `pay_card:${orderId}`)],
      ...userNavKeyboard()
    ])
  );
}

function isMissingRemnawaveUserError(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("پیدا نشد") || error.message.includes("(404)"));
}
