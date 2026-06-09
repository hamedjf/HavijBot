import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { prisma } from "../../db.js";
import { formatDays, formatGb, formatToman } from "../../domain/format.js";
import { logger } from "../../logger.js";
import { approvePayment, rejectPayment } from "../../services/order-service.js";
import { getCardToCardText, setCardToCardText } from "../../services/settings-service.js";
import { getTextDefinition, resetText, setText, TEXT_DEFINITIONS } from "../../services/text-service.js";
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

export async function startBroadcast(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session = { flow: "admin_broadcast" };
  await ctx.reply("Matne PM hamegani ro befrest. Bot be hame user haye sabt-shode mifreste.");
}

export async function handleBroadcastText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const users = await prisma.telegramUser.findMany({
    where: { isBlocked: false },
    select: { id: true, telegramId: true },
    orderBy: { createdAt: "asc" }
  });

  let sent = 0;
  let failed = 0;
  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(Number(user.telegramId), text);
      sent += 1;
      await sleep(35);
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, telegramId: user.telegramId.toString() }, "Broadcast delivery failed");
      await prisma.telegramUser.update({ where: { id: user.id }, data: { isBlocked: true } }).catch(() => null);
    }
  }

  ctx.session = {};
  await ctx.reply(`Broadcast tamam shod.\nSent: ${sent}\nFailed/blocked: ${failed}`);
  await handleAdmin(ctx);
}

export async function handleCardText(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const cardText = await getCardToCardText();
  await ctx.reply(
    ["Card-to-card text/current:", "", cardText].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Edit card text", "admin:card_text_edit")],
      [Markup.button.callback("Back", "admin")]
    ])
  );
}

export async function startEditCardText(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session = { flow: "admin_card_text" };
  await ctx.reply("Matne jadid shomare cart ro befrest.\nMesal:\n6037991234567890\nBe name Hamed");
}

export async function handleEditCardText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  await setCardToCardText(text);
  ctx.session = {};
  await ctx.reply("Card-to-card text update shod.");
  await handleCardText(ctx);
}

export async function handleCategories(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const categories = await prisma.planCategory.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { plans: true } } }
  });

  if (categories.length === 0) {
    await ctx.reply("Category nadari. Az Add category estefade kon.", Markup.inlineKeyboard([[Markup.button.callback("Add category", "admin:add_category")]]));
    return;
  }

  await ctx.reply(
    "Category ha:",
    Markup.inlineKeyboard([
      ...categories.map((category) => [
        Markup.button.callback(
          `${category.isEnabled ? "ON" : "OFF"} ${category.title} (${category.slug}) - ${category._count.plans} plan`,
          `admin:category:${category.id}`
        )
      ]),
      [Markup.button.callback("Add category", "admin:add_category")]
    ])
  );
}

export async function handleCategoryDetail(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { plans: true } } }
  });
  if (!category) {
    await ctx.reply("Category peyda nashod.");
    return;
  }

  await ctx.reply(
    [
      `Title: ${category.title}`,
        `Slug: ${category.slug}`,
      `Squads: ${category.remnawaveSquadUuids.length > 0 ? category.remnawaveSquadUuids.join(", ") : category.remnawaveSquadUuid}`,
      `Status: ${category.isEnabled ? "enabled" : "disabled"}`,
      `Plans: ${category._count.plans}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback(category.isEnabled ? "Disable" : "Enable", `admin:category_toggle:${category.id}`)],
      [Markup.button.callback("Remove category", `admin:category_delete:${category.id}`)],
      [Markup.button.callback("Back", "admin:categories")]
    ])
  );
}

export async function handleToggleCategory(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    await ctx.reply("Category peyda nashod.");
    return;
  }
  await prisma.planCategory.update({ where: { id: categoryId }, data: { isEnabled: !category.isEnabled } });
  await ctx.reply("Category update shod.");
  await handleCategories(ctx);
}

export async function handleDeleteCategory(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const planCount = await prisma.plan.count({ where: { categoryId } });
  if (planCount > 0) {
    await ctx.reply("In category plan dare. Aval plan ha ro remove/disable kon.");
    return;
  }
  await prisma.planCategory.delete({ where: { id: categoryId } });
  await ctx.reply("Category remove shod.");
  await handleCategories(ctx);
}

export async function handlePlans(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const plans = await prisma.plan.findMany({
    orderBy: [{ category: { title: "asc" } }, { volumeGb: "asc" }],
    include: { category: true }
  });

  if (plans.length === 0) {
    await ctx.reply("Plan nadari. Az Add plan estefade kon.", Markup.inlineKeyboard([[Markup.button.callback("Add plan", "admin:add_plan")]]));
    return;
  }

  await ctx.reply(
    "Plan ha:",
    Markup.inlineKeyboard([
      ...plans.map((plan) => [
        Markup.button.callback(
          `${plan.isEnabled ? "ON" : "OFF"} ${plan.category.title} / ${plan.title} / ${formatGb(plan.volumeGb)} / ${formatToman(plan.priceToman)}`,
          `admin:plan:${plan.id}`
        )
      ]),
      [Markup.button.callback("Add plan", "admin:add_plan")]
    ])
  );
}

export async function handleDiscounts(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const discounts = await prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } });

  if (discounts.length === 0) {
    await ctx.reply("Discount code nadari.", Markup.inlineKeyboard([[Markup.button.callback("Add discount", "admin:add_discount")]]));
    return;
  }

  await ctx.reply(
    "Discount code ha:",
    Markup.inlineKeyboard([
      ...discounts.map((discount) => [
        Markup.button.callback(
          `${discount.isEnabled ? "ON" : "OFF"} ${discount.code} - ${discount.percentOff ? `${discount.percentOff}%` : formatToman(discount.amountOffToman ?? 0)}`,
          `admin:discount:${discount.id}`
        )
      ]),
      [Markup.button.callback("Add discount", "admin:add_discount")]
    ])
  );
}

export async function handleTexts(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply(
    "Text haye user-facing:",
    Markup.inlineKeyboard(TEXT_DEFINITIONS.map((definition) => [Markup.button.callback(definition.title, `admin:text:${definition.key}`)]))
  );
}

export async function handleTextDetail(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  const definition = getTextDefinition(key);
  if (!definition) {
    await ctx.reply("Text key peyda nashod.");
    return;
  }
  const custom = await prisma.botText.findUnique({ where: { key } });
  await ctx.reply(
    [
      `Key: ${definition.key}`,
      `Title: ${definition.title}`,
      "",
      "Current:",
      custom?.value ?? definition.fallback,
      "",
      custom ? "Mode: custom" : "Mode: default"
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Edit", `admin:text_edit:${definition.key}`)],
      [Markup.button.callback("Reset default", `admin:text_reset:${definition.key}`)],
      [Markup.button.callback("Back", "admin:texts")]
    ])
  );
}

export async function startEditText(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  const definition = getTextDefinition(key);
  if (!definition) {
    await ctx.reply("Text key peyda nashod.");
    return;
  }
  ctx.session = { flow: "admin_text_value", adminTextKey: key };
  await ctx.reply(`Matn jadid ro baraye "${definition.title}" befrest.\nBaraye line jadid az Enter estefade kon.`);
}

export async function handleEditTextValue(ctx: BotContext, value: string) {
  if (!ensureAdmin(ctx)) return;
  const key = ctx.session.adminTextKey;
  if (!key || !getTextDefinition(key)) {
    await ctx.reply("Text key peyda nashod. Dobare az Texts shoroo kon.");
    ctx.session = {};
    return;
  }
  await setText(key, value);
  ctx.session = {};
  await ctx.reply("Text update shod.");
  await handleTextDetail(ctx, key);
}

export async function handleResetText(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  if (!getTextDefinition(key)) {
    await ctx.reply("Text key peyda nashod.");
    return;
  }
  await resetText(key);
  await ctx.reply("Text reset shod.");
  await handleTextDetail(ctx, key);
}

export async function handleDiscountDetail(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const discount = await prisma.discountCode.findUnique({ where: { id: discountId } });
  if (!discount) {
    await ctx.reply("Discount peyda nashod.");
    return;
  }

  await ctx.reply(
    [
      `Code: ${discount.code}`,
      `Percent: ${discount.percentOff ?? "-"}`,
      `Amount: ${discount.amountOffToman ? formatToman(discount.amountOffToman) : "-"}`,
      `Uses: ${discount.usedCount}${discount.maxUses ? ` / ${discount.maxUses}` : ""}`,
      `Expires: ${discount.expiresAt?.toISOString().slice(0, 10) ?? "-"}`,
      `Status: ${discount.isEnabled ? "enabled" : "disabled"}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback(discount.isEnabled ? "Disable" : "Enable", `admin:discount_toggle:${discount.id}`)],
      [Markup.button.callback("Remove discount", `admin:discount_delete:${discount.id}`)],
      [Markup.button.callback("Back", "admin:discounts")]
    ])
  );
}

export async function handleToggleDiscount(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const discount = await prisma.discountCode.findUnique({ where: { id: discountId } });
  if (!discount) {
    await ctx.reply("Discount peyda nashod.");
    return;
  }
  await prisma.discountCode.update({ where: { id: discountId }, data: { isEnabled: !discount.isEnabled } });
  await ctx.reply("Discount update shod.");
  await handleDiscounts(ctx);
}

export async function handleDeleteDiscount(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const orderCount = await prisma.order.count({ where: { discountCodeId: discountId } });
  if (orderCount > 0) {
    await prisma.discountCode.update({ where: { id: discountId }, data: { isEnabled: false } });
    await ctx.reply("In discount order dare, delete nashod; disable shod.");
  } else {
    await prisma.discountCode.delete({ where: { id: discountId } });
    await ctx.reply("Discount remove shod.");
  }
  await handleDiscounts(ctx);
}

export async function handlePlanDetail(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { category: true } });
  if (!plan) {
    await ctx.reply("Plan peyda nashod.");
    return;
  }

  await ctx.reply(
    [
      `Category: ${plan.category.title}`,
      `Title: ${plan.title}`,
      `Volume: ${formatGb(plan.volumeGb)}`,
      `Duration: ${formatDays(plan.durationDays)}`,
      `Price: ${formatToman(plan.priceToman)}`,
      `Squads: ${plan.remnawaveSquadUuids.length > 0 ? plan.remnawaveSquadUuids.join(", ") : "category default"}`,
      `Status: ${plan.isEnabled ? "enabled" : "disabled"}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback(plan.isEnabled ? "Disable" : "Enable", `admin:plan_toggle:${plan.id}`)],
      [Markup.button.callback("Remove plan", `admin:plan_delete:${plan.id}`)],
      [Markup.button.callback("Back", "admin:plans")]
    ])
  );
}

export async function handleTogglePlan(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    await ctx.reply("Plan peyda nashod.");
    return;
  }
  await prisma.plan.update({ where: { id: planId }, data: { isEnabled: !plan.isEnabled } });
  await ctx.reply("Plan update shod.");
  await handlePlans(ctx);
}

export async function handleDeletePlan(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const orderCount = await prisma.order.count({ where: { planId } });
  if (orderCount > 0) {
    await prisma.plan.update({ where: { id: planId }, data: { isEnabled: false } });
    await ctx.reply("In plan order dare, delete nashod; disable shod.");
  } else {
    await prisma.plan.delete({ where: { id: planId } });
    await ctx.reply("Plan remove shod.");
  }
  await handlePlans(ctx);
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
    logger.error({ err: error, receiptId }, "Admin payment approval failed");
    const receipt = await prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
      include: { order: true }
    });
    const failureReason = receipt?.order.failureReason;
    await ctx.reply(
      [
        "Taeed payment namovafagh bood.",
        failureReason ? `Reason: ${failureReason}` : error instanceof Error ? `Reason: ${error.message}` : undefined,
        "Payment receipt approve shode bashe momkene order failed shode bashe; log Render ro check kon."
      ]
        .filter(Boolean)
        .join("\n")
    );
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
  ctx.session = { flow: "admin_category_title" };
  await ctx.reply("Esme category ro befrest. Mesal: VIP");
}

export async function handleAddCategoryTitle(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = text.trim();
  if (!title) {
    await ctx.reply("Title khali nabashe.");
    return;
  }
  ctx.session.adminCategoryTitle = title;
  ctx.session.flow = "admin_category_squad";
  await ctx.reply("Remnawave squad UUID ro befrest.");
}

export async function handleAddCategorySquad(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = ctx.session.adminCategoryTitle;
  const remnawaveSquadUuid = text.trim();
  if (!title || !remnawaveSquadUuid) {
    await ctx.reply("Data category kamel nist. Dobare Add category ro bezan.");
    ctx.session = {};
    return;
  }
  const slug = slugify(title);
  await prisma.planCategory.upsert({
    where: { slug },
    update: { title, remnawaveSquadUuid: parseSquadUuids(remnawaveSquadUuid)[0] ?? remnawaveSquadUuid, remnawaveSquadUuids: parseSquadUuids(remnawaveSquadUuid), isEnabled: true },
    create: { title, slug, remnawaveSquadUuid: parseSquadUuids(remnawaveSquadUuid)[0] ?? remnawaveSquadUuid, remnawaveSquadUuids: parseSquadUuids(remnawaveSquadUuid) }
  });
  ctx.session = {};
  await ctx.reply(`Category sabt shod: ${title}`);
  await handleCategories(ctx);
}

export async function startAddPlan(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const categories = await prisma.planCategory.findMany({ where: { isEnabled: true }, orderBy: { title: "asc" } });
  if (categories.length === 0) {
    await ctx.reply("Aval yek category besaz.");
    return;
  }
  ctx.session = {};
  await ctx.reply(
    "Category plan ro entekhab kon:",
    Markup.inlineKeyboard(categories.map((category) => [Markup.button.callback(category.title, `admin:plan_category:${category.id}`)]))
  );
}

export async function handlePlanCategorySelected(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    await ctx.reply("Category peyda nashod.");
    return;
  }
  ctx.session = { flow: "admin_plan_title", adminPlanCategoryId: categoryId };
  await ctx.reply(`Category: ${category.title}\nEsme plan ro befrest. Mesal: VIP 20GB 1M`);
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

export async function handleAddPlanTitle(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = text.trim();
  if (!ctx.session.adminPlanCategoryId || !title) {
    await ctx.reply("Data plan kamel nist. Dobare Add plan ro bezan.");
    ctx.session = {};
    return;
  }
  ctx.session.adminPlanTitle = title;
  ctx.session.flow = "admin_plan_volume";
  await ctx.reply("Hajm plan ro be GB befrest. Mesal: 20");
}

export async function handleAddPlanVolume(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const volumeGb = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(volumeGb) || volumeGb <= 0) {
    await ctx.reply("Hajm dorost nist. Mesal: 20");
    return;
  }
  ctx.session.adminPlanVolumeGb = volumeGb;
  ctx.session.flow = "admin_plan_duration";
  await ctx.reply("Moddat plan ro be rooz befrest. Mesal: 30");
}

export async function handleAddPlanDuration(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const durationDays = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(durationDays) || durationDays <= 0) {
    await ctx.reply("Moddat dorost nist. Mesal: 30");
    return;
  }
  ctx.session.adminPlanDurationDays = durationDays;
  ctx.session.flow = "admin_plan_price";
  await ctx.reply("Gheymat plan ro be toman befrest. Mesal: 250000");
}

export async function handleAddPlanPrice(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const priceToman = Number(text.replace(/[^\d]/g, ""));
  const categoryId = ctx.session.adminPlanCategoryId;
  const title = ctx.session.adminPlanTitle;
  const volumeGb = ctx.session.adminPlanVolumeGb;
  const durationDays = ctx.session.adminPlanDurationDays;
  if (!categoryId || !title || !volumeGb || !durationDays || !Number.isSafeInteger(priceToman) || priceToman <= 0) {
    await ctx.reply("Data plan kamel nist. Dobare Add plan ro bezan.");
    ctx.session = {};
    return;
  }
  ctx.session.adminPlanPriceToman = priceToman;
  ctx.session.flow = "admin_plan_squads";
  await ctx.reply("Agar in plan squad UUID khas dare, comma-separated befrest.\nMesal: uuid1,uuid2\nAgar az category estefade kone, - befrest.");
}

export async function handleAddPlanSquads(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const categoryId = ctx.session.adminPlanCategoryId;
  const title = ctx.session.adminPlanTitle;
  const volumeGb = ctx.session.adminPlanVolumeGb;
  const durationDays = ctx.session.adminPlanDurationDays;
  const priceTomanText = ctx.session.adminPlanPriceToman;
  const priceToman = typeof priceTomanText === "number" ? priceTomanText : undefined;
  if (!categoryId || !title || !volumeGb || !durationDays || !priceToman) {
    await ctx.reply("Data plan kamel nist. Dobare Add plan ro bezan.");
    ctx.session = {};
    return;
  }
  const squadUuids = text.trim() === "-" ? [] : parseSquadUuids(text);
  await prisma.plan.create({
    data: { categoryId, title, volumeGb, durationDays, priceToman, remnawaveSquadUuids: squadUuids }
  });
  ctx.session = {};
  await ctx.reply(`Plan sabt shod: ${title} / ${formatGb(volumeGb)} / ${formatToman(priceToman)}`);
  await handlePlans(ctx);
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

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `category-${Date.now()}`;
}

function parseSquadUuids(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendServiceToUser(ctx: BotContext, telegramId: number, serviceId: string) {
  const service = await prisma.purchasedService.findUnique({ where: { id: serviceId } });
  if (!service) return;
  const qr = await import("../../remnawave/remnawave-client.js").then(({ remnawaveClient }) =>
    remnawaveClient.getSubscriptionQr(service.remnawaveUserUuid)
  );
  await ctx.telegram.sendPhoto(telegramId, { source: qr }, {
    caption: `Username: ${service.username}\nLink: ${service.subscriptionUrl}`,
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)]]).reply_markup
  });
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
    ].join("\n"),
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)]]).reply_markup
  });
}
