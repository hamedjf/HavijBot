import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { config } from "../../config.js";
import { bytesToGb, formatDays, formatGb, formatToman } from "../../domain/format.js";
import { parseReferralPayload } from "../../domain/referral.js";
import { prisma } from "../../db.js";
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
    await ctx.reply("Hanooz plani faal nist.");
    return;
  }

  await ctx.reply(
    "Noe service ro entekhab kon:",
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
    await ctx.reply("Baraye in category plan faal nist.");
    return;
  }

  await ctx.reply(
    "Plan ro entekhab kon:",
    Markup.inlineKeyboard(
      plans.map((plan) => [
        Markup.button.callback(
          `${plan.title} - ${formatGb(plan.volumeGb)} - ${formatDays(plan.durationDays)} - ${formatToman(plan.priceToman)}`,
          `plan:${plan.id}`
        )
      ])
    )
  );
}

export async function handlePlan(ctx: BotContext, planId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "purchase_username";
  ctx.session.planId = planId;
  await ctx.reply("Username service ro befrest. Mesal: Hamed");
}

export async function handleUsernameMessage(ctx: BotContext, text: string) {
  const user = await upsertTelegramUser(ctx);
  if (!ctx.session.planId) {
    await ctx.reply("Plan peyda nashod. Dobare az menu kharid shoroo kon.");
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
    await ctx.reply("Mablaghe card-to-card sefr ast. Az payment wallet/takhfif edame bede.");
    return;
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "WAITING_PAYMENT", paymentMethod: "CARD_TO_CARD", cardAmountToman: due }
  });
  ctx.session.flow = "awaiting_receipt";
  ctx.session.orderId = orderId;
  await ctx.reply(`Lotfan ${formatToman(due)} ro card be card kon:\n\n${config.CARD_TO_CARD_TEXT}`);
  await ctx.reply("Bad az pardakht, screenshot resid ro haminja befrest.");
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
    await ctx.reply(error instanceof Error ? error.message : "Pardakht ba wallet namovafagh bood.");
  }
}

export async function handleDiscountStart(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "discount_code";
  ctx.session.orderId = orderId;
  await ctx.reply("Code takhfif ro befrest.");
}

export async function handleDiscountCode(ctx: BotContext, text: string) {
  if (!ctx.session.orderId) {
    await ctx.reply("Order peyda nashod. Dobare kharid ro shoroo kon.");
    ctx.session = {};
    return;
  }

  try {
    const order = await applyDiscountCode(ctx.session.orderId, text);
    ctx.session.flow = undefined;
    await ctx.reply(`Code takhfif emal shod: ${formatToman(order.discountAmountToman)} kam shod.`);
    await sendCheckoutOptions(ctx, order.id);
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Code takhfif emal nashod.");
  }
}

export async function handleApplyWallet(ctx: BotContext, orderId: string) {
  if (!(await ensureAllowed(ctx))) return;
  try {
    const order = await applyWalletOffset(orderId);
    const due = order.cardAmountToman ?? 0;
    await ctx.reply(`Az kife pool ${formatToman(order.walletAppliedToman)} kam mishe.${due > 0 ? ` Mablaghe baghimande: ${formatToman(due)}` : ""}`);
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
    await ctx.reply(error instanceof Error ? error.message : "Kife pool emal nashod.");
  }
}

export async function handleWalletCharge(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  ctx.session.flow = "wallet_amount";
  await ctx.reply("Mablaghe charge kife pool ro be toman befrest. Mesal: 200000");
}

export async function handleWalletAmount(ctx: BotContext, text: string) {
  const user = await upsertTelegramUser(ctx);
  const amount = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(amount) || amount < 1000) {
    await ctx.reply("Mablagh dorost nist. Mesal: 200000");
    return;
  }

  const order = await createWalletTopupOrder(user.id, amount);
  ctx.session.flow = "awaiting_receipt";
  ctx.session.orderId = order.id;
  await ctx.reply(`Baraye charge ${formatToman(amount)} card be card kon:\n\n${config.CARD_TO_CARD_TEXT}`);
  await ctx.reply("Bad az pardakht, screenshot resid ro befrest.");
}

export async function handleReceiptPhoto(ctx: BotContext, fileId: string) {
  const orderId = ctx.session.orderId;
  if (!orderId || ctx.session.flow !== "awaiting_receipt") {
    await ctx.reply("Pardakht pending peyda nashod. Aval az menu kharid ya charge shoroo kon.");
    return;
  }

  const { order, receipt } = await submitCardReceipt(orderId, fileId);
  ctx.session = {};
  await ctx.reply("Resid baraye admin ersal shod. Bad az taeed, natije behet elam mishe.");

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

  for (const adminId of config.ADMIN_IDS) {
    await ctx.telegram.sendPhoto(adminId, fileId, {
      caption,
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback("Taeed", `admin:approve:${receipt.id}`),
          Markup.button.callback("Rad", `admin:reject:${receipt.id}`)
        ]
      ]).reply_markup
    });
  }
}

export async function handleMyServices(ctx: BotContext) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const services = await prisma.purchasedService.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" }
  });

  if (services.length === 0) {
    await ctx.reply("Hanooz service faal nadari.");
    return;
  }

  await ctx.reply(
    "Service haye shoma:",
    Markup.inlineKeyboard(services.map((service) => [Markup.button.callback(service.username, `svc:${service.id}`)]))
  );
}

export async function handleServiceDetail(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) {
    await ctx.reply("Service peyda nashod.");
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
        `Username: ${service.username}`,
        `Link: ${subscriptionUrl}`,
        `Masraf: ${usedGb} / ${totalGb} GB`,
        `Rooz baghimande: ${daysLeft}`
      ].join("\n"),
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("Tamdid service", `renew:${service.id}`)]]).reply_markup
    }
  );
}

export async function handleRenewService(ctx: BotContext, serviceId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const user = await upsertTelegramUser(ctx);
  const service = await prisma.purchasedService.findFirst({ where: { id: serviceId, userId: user.id } });
  if (!service) {
    await ctx.reply("Service baraye tamdid peyda nashod.");
    return;
  }

  await ctx.reply(
    "Hajme tamdid ro entekhab kon. Be har gozine zaman ham ezafe mishe:",
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
    await ctx.reply("Gozine tamdid peyda nashod.");
    return;
  }

  const order = await createRenewalOrder(user.id, serviceId, option.volumeGb, option.durationDays, option.priceToman);
  ctx.session.orderId = order.id;
  await ctx.reply(`Tamdid ${formatGb(option.volumeGb)} + ${formatDays(option.durationDays)} sabt shod.`);
  await sendCheckoutOptions(ctx, order.id);
}

export async function handleReferral(ctx: BotContext) {
  const user = await upsertTelegramUser(ctx);
  const botInfo = await ctx.telegram.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.referralCode}`;
  const balance = await getWalletBalance(user.id);
  await ctx.reply([`Link davat shoma:`, link, `Reward har invite: ${formatToman(config.REFERRAL_REWARD_TOMAN)}`, `Mojoodi shoma: ${formatToman(balance)}`].join("\n"));
}

export async function handleContent(ctx: BotContext, kind: "TRAINING" | "SOFTWARE") {
  if (!(await ensureAllowed(ctx))) return;
  const items = await prisma.adminContent.findMany({
    where: { kind, isEnabled: true },
    orderBy: { createdAt: "desc" }
  });

  if (items.length === 0) {
    await ctx.reply("Hanooz itemi sabt nashode.");
    return;
  }

  await ctx.reply(
    "Yeki ro entekhab kon:",
    Markup.inlineKeyboard(items.map((item) => [Markup.button.callback(item.title, `content_item:${item.id}`)]))
  );
}

export async function handleContentItem(ctx: BotContext, itemId: string) {
  if (!(await ensureAllowed(ctx))) return;
  const item = await prisma.adminContent.findUnique({ where: { id: itemId } });
  if (!item || !item.isEnabled) {
    await ctx.reply("Item peyda nashod.");
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
  await ctx.reply(`Poshtibani: ${config.SUPPORT_USERNAME}`);
}

export async function sendProvisionedService(ctx: BotContext, orderId: string) {
  const service = await prisma.purchasedService.findUnique({ where: { orderId } });
  if (!service) {
    await ctx.reply("Service sakhte shod vali local record peyda nashod. Be admin etela bede.");
    return;
  }

  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [`Service shoma amade ast.`, `Username: ${service.username}`, `Link: ${service.subscriptionUrl}`].join("\n")
    }
  );
}

export async function sendRenewedService(ctx: BotContext, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { targetService: true }
  });
  if (!order?.targetService) {
    await ctx.reply("Tamdid anjam shod vali service local peyda nashod. Be admin etela bede.");
    return;
  }

  const service = order.targetService;
  const qr = await remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid);
  const daysLeft = Math.max(0, Math.ceil((service.expiresAt.getTime() - Date.now()) / 86_400_000));
  await ctx.replyWithPhoto(
    { source: qr },
    {
      caption: [
        "Service shoma tamdid shod.",
        `Username: ${service.username}`,
        `Link: ${service.subscriptionUrl}`,
        `Hajm jadid: ${formatGb(service.volumeGb)}`,
        `Rooz baghimande: ${daysLeft}`
      ].join("\n")
    }
  );
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
      `Mablagh asli: ${formatToman(order.amountToman)}`,
      order.discountAmountToman > 0 ? `Takhfif: ${formatToman(order.discountAmountToman)}` : undefined,
      order.walletAppliedToman > 0 ? `Kife pool: ${formatToman(order.walletAppliedToman)}` : undefined,
      `Mablaghe payable: ${formatToman(due)}`,
      `Mojoodi kife pool: ${formatToman(balance)}`
    ]
      .filter(Boolean)
      .join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Code takhfif daram", `discount:${orderId}`)],
      [Markup.button.callback("Kam kardan az kife pool", `apply_wallet:${orderId}`)],
      [Markup.button.callback("Pardakht kamel ba wallet", `pay_wallet:${orderId}`)],
      [Markup.button.callback("Card be card", `pay_card:${orderId}`)]
    ])
  );
}
