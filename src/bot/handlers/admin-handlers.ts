import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { prisma } from "../../db.js";
import { formatToman } from "../../domain/format.js";
import { approvePayment, rejectPayment } from "../../services/order-service.js";
import { adminMenu } from "../keyboards.js";
import { isAdmin } from "../membership.js";

export async function handleAdmin(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply("Admin menu:", adminMenu());
}

export async function handlePendingPayments(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const receipts = await prisma.paymentReceipt.findMany({
    where: { status: "PENDING" },
    include: { order: { include: { user: true, plan: { include: { category: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 20
  });

  if (receipts.length === 0) {
    await ctx.reply("Payment pending nadarim.");
    return;
  }

  for (const receipt of receipts) {
    await ctx.reply(
      [
        `Receipt: ${receipt.id}`,
        `Order: ${receipt.orderId}`,
        `Type: ${receipt.order.type}`,
        `Amount asli: ${formatToman(receipt.order.amountToman)}`,
        receipt.order.discountAmountToman ? `Takhfif: ${formatToman(receipt.order.discountAmountToman)}` : undefined,
        receipt.order.walletAppliedToman ? `Kife pool: ${formatToman(receipt.order.walletAppliedToman)}` : undefined,
        receipt.order.cardAmountToman ? `Card-to-card: ${formatToman(receipt.order.cardAmountToman)}` : undefined,
        `User: ${receipt.order.user.username ? `@${receipt.order.user.username}` : receipt.order.user.telegramId.toString()}`,
        receipt.order.plan ? `Plan: ${receipt.order.plan.category.title} / ${receipt.order.plan.title}` : undefined
      ]
        .filter(Boolean)
        .join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("Taeed", `admin:approve:${receipt.id}`), Markup.button.callback("Rad", `admin:reject:${receipt.id}`)]
      ])
    );
  }
}

export async function handleApprove(ctx: BotContext, receiptId: string) {
  if (!ensureAdmin(ctx)) return;
  try {
    const result = await approvePayment(receiptId, ctx.from!.id);
    await ctx.reply("Payment taeed shod.");

    const order = await prisma.order.findUnique({
      where: { id: result.id },
      include: { user: true, service: true, targetService: true }
    });

    if (!order) return;

    if (order.type === "WALLET_TOPUP") {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "Charge kife pool taeed shod.");
    } else if (order.service) {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "Pardakht taeed shod. Service shoma amade ast.");
      await sendServiceToUser(ctx, Number(order.user.telegramId), order.service.id);
    } else if (order.type === "SERVICE_RENEWAL" && order.targetService) {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "Pardakht taeed shod. Service shoma tamdid shod.");
      await sendRenewedServiceToUser(ctx, Number(order.user.telegramId), order.targetService.id);
    }
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Taeed payment namovafagh bood.");
  }
}

export async function handleReject(ctx: BotContext, receiptId: string) {
  if (!ensureAdmin(ctx)) return;
  const receipt = await rejectPayment(receiptId, ctx.from!.id);
  await ctx.reply("Payment rad shod.");
  const order = await prisma.order.findUnique({ where: { id: receipt.orderId }, include: { user: true } });
  if (order) {
    await ctx.telegram.sendMessage(Number(order.user.telegramId), "Tarakonesh eshtebah ast.");
  }
}

export async function startAddCategory(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_category";
  await ctx.reply("Format category ro befrest:\ntitle | slug | remnawave_squad_uuid\nMesal: VIP | vip | 00000000-0000-0000-0000-000000000000");
}

export async function handleAddCategoryText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [title, slug, remnawaveSquadUuid] = splitParts(text, 3);
  if (!title || !slug || !remnawaveSquadUuid) {
    await ctx.reply("Format dorost nist.");
    return;
  }

  await prisma.planCategory.upsert({
    where: { slug },
    update: { title, remnawaveSquadUuid, isEnabled: true },
    create: { title, slug, remnawaveSquadUuid }
  });
  ctx.session = {};
  await ctx.reply("Category sabt shod.");
}

export async function startAddPlan(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_plan";
  await ctx.reply("Format plan ro befrest:\ncategory_slug | title | volume_gb | duration_days | price_toman\nMesal: vip | 20GB 1M | 20 | 30 | 250000");
}

export async function startAddDiscount(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_discount";
  await ctx.reply("Format discount ro befrest:\nCODE | percent_off | amount_off_toman | max_uses | expire_yyyy-mm-dd\nMesal: OFF20 | 20 | 0 | 100 | 2026-12-31");
}

export async function handleAddDiscountText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [codeRaw, percentRaw, amountRaw, maxUsesRaw, expiresRaw] = splitParts(text, 5);
  const code = codeRaw?.toUpperCase();
  const percentOff = Number(percentRaw ?? 0);
  const amountOffToman = Number(amountRaw ?? 0);
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : undefined;
  const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59.000Z`) : undefined;

  if (
    !code ||
    (!Number.isSafeInteger(percentOff) && !Number.isSafeInteger(amountOffToman)) ||
    (percentOff <= 0 && amountOffToman <= 0) ||
    percentOff > 100 ||
    (maxUses !== undefined && !Number.isSafeInteger(maxUses))
  ) {
    await ctx.reply("Format discount dorost nist.");
    return;
  }

  await prisma.discountCode.upsert({
    where: { code },
    update: {
      percentOff: percentOff > 0 ? percentOff : null,
      amountOffToman: amountOffToman > 0 ? amountOffToman : null,
      maxUses,
      expiresAt,
      isEnabled: true
    },
    create: {
      code,
      percentOff: percentOff > 0 ? percentOff : null,
      amountOffToman: amountOffToman > 0 ? amountOffToman : null,
      maxUses,
      expiresAt
    }
  });
  ctx.session = {};
  await ctx.reply("Discount code sabt shod.");
}

export async function handleAddPlanText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [categorySlug, title, volumeGbRaw, durationDaysRaw, priceRaw] = splitParts(text, 5);
  const volumeGb = Number(volumeGbRaw);
  const durationDays = Number(durationDaysRaw);
  const priceToman = Number(priceRaw);
  const category = await prisma.planCategory.findUnique({ where: { slug: categorySlug } });

  if (!category || !title || !Number.isSafeInteger(volumeGb) || !Number.isSafeInteger(durationDays) || !Number.isSafeInteger(priceToman)) {
    await ctx.reply("Format ya category dorost nist.");
    return;
  }

  await prisma.plan.create({
    data: { categoryId: category.id, title, volumeGb, durationDays, priceToman }
  });
  ctx.session = {};
  await ctx.reply("Plan sabt shod.");
}

export async function startAddContent(ctx: BotContext, kind: "TRAINING" | "SOFTWARE") {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_content";
  ctx.session.contentKind = kind;
  await ctx.reply("Content ro befrest:\ntitle | body-or-link\nYa photo/document befrest ba caption: title | body");
}

export async function handleAddContentText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [title, body] = splitParts(text, 2);
  if (!title) {
    await ctx.reply("Title lazem ast.");
    return;
  }

  await prisma.adminContent.create({
    data: {
      kind: ctx.session.contentKind ?? "TRAINING",
      contentType: body?.startsWith("http") ? "LINK" : "TEXT",
      title,
      body: body ?? title
    }
  });
  ctx.session = {};
  await ctx.reply("Content sabt shod.");
}

export async function handleAddContentFile(ctx: BotContext, fileId: string, fileType: "PHOTO" | "DOCUMENT", caption?: string) {
  if (!ensureAdmin(ctx)) return;
  const [title, body] = splitParts(caption ?? "", 2);
  if (!title) {
    await ctx.reply("Caption ba format title | body lazem ast.");
    return;
  }

  await prisma.adminContent.create({
    data: {
      kind: ctx.session.contentKind ?? "TRAINING",
      contentType: fileType,
      title,
      body,
      telegramFileId: fileId
    }
  });
  ctx.session = {};
  await ctx.reply("File content sabt shod.");
}

function ensureAdmin(ctx: BotContext): boolean {
  if (!isAdmin(ctx.from?.id)) {
    void ctx.reply("Dastresi admin nadari.");
    return false;
  }
  return true;
}

function splitParts(text: string, max: number): string[] {
  return text
    .split("|", max)
    .map((part) => part.trim());
}

async function sendServiceToUser(ctx: BotContext, telegramId: number, serviceId: string) {
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) return;
  const qr = await import("../../remnawave/remnawave-client.js").then(({ remnawaveClient }) =>
    remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid)
  );
  await ctx.telegram.sendPhoto(telegramId, { source: qr }, { caption: `Username: ${service.username}\nLink: ${service.subscriptionUrl}` });
}

async function sendRenewedServiceToUser(ctx: BotContext, telegramId: number, serviceId: string) {
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) return;
  const qr = await import("../../remnawave/remnawave-client.js").then(({ remnawaveClient }) =>
    remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid)
  );
  const daysLeft = Math.max(0, Math.ceil((service.expiresAt.getTime() - Date.now()) / 86_400_000));
  await ctx.telegram.sendPhoto(telegramId, { source: qr }, {
    caption: [
      `Username: ${service.username}`,
      `Link: ${service.subscriptionUrl}`,
      `Hajm jadid: ${service.volumeGb} GB`,
      `Rooz baghimande: ${daysLeft}`
    ].join("\n")
  });
}
