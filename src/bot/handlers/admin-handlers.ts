import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { prisma } from "../../db.js";
import { bytesToGb, formatDays, formatGb, formatToman } from "../../domain/format.js";
import { expirationFromNow } from "../../domain/plans.js";
import { logger } from "../../logger.js";
import { remnawaveClient } from "../../remnawave/remnawave-client.js";
import { approvePayment, rejectPayment } from "../../services/order-service.js";
import { getCardToCardText, setCardToCardText } from "../../services/settings-service.js";
import { getTextDefinition, resetText, setText, TEXT_DEFINITIONS } from "../../services/text-service.js";
import { adminMenu } from "../keyboards.js";
import { isAdmin } from "../membership.js";

export async function handleAdmin(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply("⚙️ پنل مدیریت", adminMenu());
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
    await ctx.reply("✅ پرداخت در انتظاری وجود ندارد.");
    return;
  }

  for (const receipt of receipts) {
    await ctx.reply(
      [
        "🧾 پرداخت در انتظار بررسی",
        "",
        `شناسه رسید: ${receipt.id}`,
        `شناسه سفارش: ${receipt.orderId}`,
        `نوع سفارش: ${receipt.order.type}`,
        `مبلغ اصلی: ${formatToman(receipt.order.amountToman)}`,
        receipt.order.discountAmountToman ? `تخفیف: ${formatToman(receipt.order.discountAmountToman)}` : undefined,
        receipt.order.walletAppliedToman ? `پرداخت از کیف پول: ${formatToman(receipt.order.walletAppliedToman)}` : undefined,
        receipt.order.cardAmountToman ? `کارت‌به‌کارت: ${formatToman(receipt.order.cardAmountToman)}` : undefined,
        `کاربر: ${receipt.order.user.username ? `@${receipt.order.user.username}` : receipt.order.user.telegramId.toString()}`,
        receipt.order.plan ? `پلن: ${receipt.order.plan.category.title} / ${receipt.order.plan.title}` : undefined
      ]
        .filter(Boolean)
        .join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ تایید", `admin:approve:${receipt.id}`), Markup.button.callback("❌ رد", `admin:reject:${receipt.id}`)]
      ])
    );
  }
}

export async function startBroadcast(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session = { flow: "admin_broadcast" };
  await ctx.reply("📣 متن پیام همگانی را ارسال کنید.\n\nاین پیام برای همه کاربران ثبت‌شده ارسال می‌شود.");
}

export async function startImportService(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const plans = await prisma.plan.findMany({
    where: { isEnabled: true },
    include: { category: true },
    orderBy: [{ category: { title: "asc" } }, { volumeGb: "asc" }],
    take: 20
  });
  ctx.session = { flow: "admin_import_service" };
  await ctx.reply(
    [
      "🔗 اختصاص سرویس موجود Remnawave",
      "",
      "فرمت را اینطور ارسال کنید:",
      "telegram_id | remnawave_username_or_uuid | plan_id",
      "",
      "مثال:",
      "123456789 | hooshang_vip | plan_uuid",
      "",
      "کاربر باید حداقل یکبار bot را start کرده باشد.",
      "",
      plans.length > 0 ? "پلن‌های فعال:" : "پلن فعالی پیدا نشد؛ اول یک پلن بسازید.",
      ...plans.map((plan) => `${plan.category.title} / ${plan.title} / ${formatGb(plan.volumeGb)} / ${formatToman(plan.priceToman)}\n${plan.id}`)
    ].join("\n")
  );
}

export async function handleImportServiceText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [telegramIdRaw, remnawaveIdRaw, planIdRaw] = splitParts(text, 3);
  const telegramIdText = telegramIdRaw?.replace(/[^\d]/g, "");
  const telegramId = telegramIdText ? BigInt(telegramIdText) : null;
  const remnawaveIdentifier = remnawaveIdRaw?.trim();
  const planId = planIdRaw?.trim();

  if (!telegramId || !remnawaveIdentifier || !planId) {
    await ctx.reply("❌ فرمت درست نیست.\ntelegram_id | remnawave_username_or_uuid | plan_id");
    return;
  }

  const user = await prisma.telegramUser.findUnique({ where: { telegramId } });
  if (!user) {
    await ctx.reply("❌ این کاربر هنوز bot را start نکرده و در دیتابیس نیست.");
    return;
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { category: true } });
  if (!plan) {
    await ctx.reply("❌ پلن پیدا نشد.");
    return;
  }

  try {
    const remoteUser = await remnawaveClient.getUser(remnawaveIdentifier);
    if (!remoteUser) {
      await ctx.reply("❌ پروفایل در Remnawave پیدا نشد.");
      return;
    }

    const existingService = await prisma.purchasedService.findFirst({ where: { remnawaveUserUuid: remoteUser.uuid } });
    if (existingService) {
      await ctx.reply("⚠️ این پروفایل قبلا به یک کاربر bot اختصاص داده شده است.");
      return;
    }

    const subscriptionUrl = await remnawaveClient.getSubscriptionUrl(remoteUser.uuid);
    const volumeGb = remoteUser.trafficLimitBytes ? Math.ceil(bytesToGb(remoteUser.trafficLimitBytes)) : plan.volumeGb;
    const expiresAt = remoteUser.expiresAt ?? expirationFromNow(plan.durationDays);

    const service = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId: user.id,
          type: "SERVICE_PURCHASE",
          status: "PROVISIONED",
          paymentMethod: "CARD_TO_CARD",
          amountToman: 0,
          cardAmountToman: 0,
          planId: plan.id,
          requestedUsername: remoteUser.username,
          finalUsername: remoteUser.username
        }
      });

      const importedService = await tx.purchasedService.create({
        data: {
          userId: user.id,
          orderId: order.id,
          planId: plan.id,
          remnawaveUserUuid: remoteUser.uuid,
          remnawaveShortUuid: remoteUser.shortUuid,
          username: remoteUser.username,
          subscriptionUrl,
          volumeGb,
          expiresAt
        }
      });

      await tx.auditLog.create({
        data: {
          actorTelegramId: BigInt(ctx.from!.id),
          action: "remnawave.user.import",
          entityType: "purchased_service",
          entityId: importedService.id,
          metadata: {
            remnawaveUserUuid: remoteUser.uuid,
            telegramId: user.telegramId.toString(),
            planId: plan.id
          }
        }
      });

      return importedService;
    });

    ctx.session = {};
    await ctx.reply(
      [
        "✅ سرویس موجود با موفقیت به کاربر اختصاص داده شد.",
        "",
        `کاربر: ${user.username ? `@${user.username}` : user.telegramId.toString()}`,
        `پروفایل: ${service.username}`,
        `پلن: ${plan.category.title} / ${plan.title}`
      ].join("\n")
    );
    await sendServiceToUser(ctx, Number(user.telegramId), service.id);
    await handleAdmin(ctx);
  } catch (error) {
    logger.error({ err: error, remnawaveIdentifier, telegramId: telegramId.toString(), planId }, "Existing Remnawave service import failed");
    await ctx.reply(error instanceof Error ? `❌ اختصاص سرویس ناموفق بود.\n${error.message}` : "❌ اختصاص سرویس ناموفق بود.");
  }
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
  await ctx.reply(`✅ ارسال همگانی تمام شد.\n\nارسال موفق: ${sent}\nناموفق/بلاک‌شده: ${failed}`);
  await handleAdmin(ctx);
}

export async function handleCardText(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const cardText = await getCardToCardText();
  await ctx.reply(
    ["💳 متن فعلی کارت‌به‌کارت:", "", cardText].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("✏️ ویرایش متن کارت", "admin:card_text_edit")],
      [Markup.button.callback("⬅️ بازگشت", "admin")]
    ])
  );
}

export async function startEditCardText(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session = { flow: "admin_card_text" };
  await ctx.reply("💳 متن جدید کارت‌به‌کارت را ارسال کنید.\n\nمثال:\n6037991234567890\nبه نام هویج‌نت");
}

export async function handleEditCardText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  await setCardToCardText(text);
  ctx.session = {};
  await ctx.reply("✅ متن کارت‌به‌کارت به‌روزرسانی شد.");
  await handleCardText(ctx);
}

export async function handleCategories(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const categories = await prisma.planCategory.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { plans: true } } }
  });

  if (categories.length === 0) {
    await ctx.reply("هنوز دسته‌بندی ثبت نشده است.", Markup.inlineKeyboard([[Markup.button.callback("➕ افزودن دسته‌بندی", "admin:add_category")]]));
    return;
  }

  await ctx.reply(
    "🗂 دسته‌بندی‌ها:",
    Markup.inlineKeyboard([
      ...categories.map((category) => [
        Markup.button.callback(
          `${category.isEnabled ? "✅" : "⛔"} ${category.title} (${category.slug}) - ${category._count.plans} پلن`,
          `admin:category:${category.id}`
        )
      ]),
      [Markup.button.callback("➕ افزودن دسته‌بندی", "admin:add_category")]
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
    await ctx.reply("❌ دسته‌بندی پیدا نشد.");
    return;
  }

  await ctx.reply(
    [
      `عنوان: ${category.title}`,
      `اسلاگ: ${category.slug}`,
      `Squad ها: ${category.remnawaveSquadUuids.length > 0 ? category.remnawaveSquadUuids.join(", ") : category.remnawaveSquadUuid}`,
      `وضعیت: ${category.isEnabled ? "فعال" : "غیرفعال"}`,
      `تعداد پلن‌ها: ${category._count.plans}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("✏️ ویرایش دسته‌بندی", `admin:category_edit:${category.id}`)],
      [Markup.button.callback(category.isEnabled ? "⛔ غیرفعال کردن" : "✅ فعال کردن", `admin:category_toggle:${category.id}`)],
      [Markup.button.callback("🗑 حذف دسته‌بندی", `admin:category_delete:${category.id}`)],
      [Markup.button.callback("⬅️ بازگشت", "admin:categories")]
    ])
  );
}

export async function handleToggleCategory(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    await ctx.reply("❌ دسته‌بندی پیدا نشد.");
    return;
  }
  await prisma.planCategory.update({ where: { id: categoryId }, data: { isEnabled: !category.isEnabled } });
  await ctx.reply("✅ دسته‌بندی به‌روزرسانی شد.");
  await handleCategories(ctx);
}

export async function handleDeleteCategory(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const planCount = await prisma.plan.count({ where: { categoryId } });
  if (planCount > 0) {
    await ctx.reply("⚠️ این دسته‌بندی پلن دارد. ابتدا پلن‌های آن را حذف یا غیرفعال کنید.");
    return;
  }
  await prisma.planCategory.delete({ where: { id: categoryId } });
  await ctx.reply("✅ دسته‌بندی حذف شد.");
  await handleCategories(ctx);
}

export async function handlePlans(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const plans = await prisma.plan.findMany({
    orderBy: [{ category: { title: "asc" } }, { volumeGb: "asc" }],
    include: { category: true }
  });

  if (plans.length === 0) {
    await ctx.reply("هنوز پلنی ثبت نشده است.", Markup.inlineKeyboard([[Markup.button.callback("➕ افزودن پلن", "admin:add_plan")]]));
    return;
  }

  await ctx.reply(
    "📦 پلن‌ها:",
    Markup.inlineKeyboard([
      ...plans.map((plan) => [
        Markup.button.callback(
          `${plan.isEnabled ? "✅" : "⛔"} ${plan.category.title} / ${plan.title} / ${formatGb(plan.volumeGb)} / ${formatToman(plan.priceToman)}`,
          `admin:plan:${plan.id}`
        )
      ]),
      [Markup.button.callback("➕ افزودن پلن", "admin:add_plan")]
    ])
  );
}

export async function handleDiscounts(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const discounts = await prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } });

  if (discounts.length === 0) {
    await ctx.reply("هنوز کد تخفیفی ثبت نشده است.", Markup.inlineKeyboard([[Markup.button.callback("🎟 افزودن کد تخفیف", "admin:add_discount")]]));
    return;
  }

  await ctx.reply(
    "🎟 کدهای تخفیف:",
    Markup.inlineKeyboard([
      ...discounts.map((discount) => [
        Markup.button.callback(
          `${discount.isEnabled ? "✅" : "⛔"} ${discount.code} - ${discount.percentOff ? `${discount.percentOff}%` : formatToman(discount.amountOffToman ?? 0)}`,
          `admin:discount:${discount.id}`
        )
      ]),
      [Markup.button.callback("🎟 افزودن کد تخفیف", "admin:add_discount")]
    ])
  );
}

export async function handleTexts(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  await ctx.reply(
    "✏️ متن‌های قابل ویرایش ربات:",
    Markup.inlineKeyboard(TEXT_DEFINITIONS.map((definition) => [Markup.button.callback(definition.title, `admin:text:${definition.key}`)]))
  );
}

export async function handleTextDetail(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  const definition = getTextDefinition(key);
  if (!definition) {
    await ctx.reply("❌ کلید متن پیدا نشد.");
    return;
  }
  const custom = await prisma.botText.findUnique({ where: { key } });
  await ctx.reply(
    [
      `کلید: ${definition.key}`,
      `عنوان: ${definition.title}`,
      "",
      "متن فعلی:",
      custom?.value ?? definition.fallback,
      "",
      custom ? "حالت: سفارشی" : "حالت: پیش‌فرض"
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("✏️ ویرایش", `admin:text_edit:${definition.key}`)],
      [Markup.button.callback("↩️ بازگشت به پیش‌فرض", `admin:text_reset:${definition.key}`)],
      [Markup.button.callback("⬅️ بازگشت", "admin:texts")]
    ])
  );
}

export async function startEditText(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  const definition = getTextDefinition(key);
  if (!definition) {
    await ctx.reply("❌ کلید متن پیدا نشد.");
    return;
  }
  ctx.session = { flow: "admin_text_value", adminTextKey: key };
  await ctx.reply(`✏️ متن جدید را برای «${definition.title}» ارسال کنید.\nبرای خط جدید از Enter استفاده کنید.`);
}

export async function handleEditTextValue(ctx: BotContext, value: string) {
  if (!ensureAdmin(ctx)) return;
  const key = ctx.session.adminTextKey;
  if (!key || !getTextDefinition(key)) {
    await ctx.reply("❌ کلید متن پیدا نشد. لطفا دوباره از بخش متن‌ها شروع کنید.");
    ctx.session = {};
    return;
  }
  await setText(key, value);
  ctx.session = {};
  await ctx.reply("✅ متن به‌روزرسانی شد.");
  await handleTextDetail(ctx, key);
}

export async function handleResetText(ctx: BotContext, key: string) {
  if (!ensureAdmin(ctx)) return;
  if (!getTextDefinition(key)) {
    await ctx.reply("❌ کلید متن پیدا نشد.");
    return;
  }
  await resetText(key);
  await ctx.reply("✅ متن به حالت پیش‌فرض برگشت.");
  await handleTextDetail(ctx, key);
}

export async function handleDiscountDetail(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const discount = await prisma.discountCode.findUnique({ where: { id: discountId } });
  if (!discount) {
    await ctx.reply("❌ کد تخفیف پیدا نشد.");
    return;
  }

  await ctx.reply(
    [
      `کد: ${discount.code}`,
      `درصد تخفیف: ${discount.percentOff ?? "-"}`,
      `مبلغ تخفیف: ${discount.amountOffToman ? formatToman(discount.amountOffToman) : "-"}`,
      `تعداد استفاده: ${discount.usedCount}${discount.maxUses ? ` / ${discount.maxUses}` : ""}`,
      `انقضا: ${discount.expiresAt?.toISOString().slice(0, 10) ?? "-"}`,
      `هر کاربر یکبار: ${discount.oneUsePerUser ? "بله" : "خیر"}`,
      `وضعیت: ${discount.isEnabled ? "فعال" : "غیرفعال"}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback(discount.isEnabled ? "⛔ غیرفعال کردن" : "✅ فعال کردن", `admin:discount_toggle:${discount.id}`)],
      [Markup.button.callback("🗑 حذف کد تخفیف", `admin:discount_delete:${discount.id}`)],
      [Markup.button.callback("⬅️ بازگشت", "admin:discounts")]
    ])
  );
}

export async function handleToggleDiscount(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const discount = await prisma.discountCode.findUnique({ where: { id: discountId } });
  if (!discount) {
    await ctx.reply("❌ کد تخفیف پیدا نشد.");
    return;
  }
  await prisma.discountCode.update({ where: { id: discountId }, data: { isEnabled: !discount.isEnabled } });
  await ctx.reply("✅ کد تخفیف به‌روزرسانی شد.");
  await handleDiscounts(ctx);
}

export async function handleDeleteDiscount(ctx: BotContext, discountId: string) {
  if (!ensureAdmin(ctx)) return;
  const orderCount = await prisma.order.count({ where: { discountCodeId: discountId } });
  if (orderCount > 0) {
    await prisma.discountCode.update({ where: { id: discountId }, data: { isEnabled: false } });
    await ctx.reply("⚠️ این کد تخفیف در سفارش‌ها استفاده شده؛ حذف نشد و فقط غیرفعال شد.");
  } else {
    await prisma.discountCode.delete({ where: { id: discountId } });
    await ctx.reply("✅ کد تخفیف حذف شد.");
  }
  await handleDiscounts(ctx);
}

export async function handlePlanDetail(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { category: true } });
  if (!plan) {
    await ctx.reply("❌ پلن پیدا نشد.");
    return;
  }

  await ctx.reply(
    [
      `دسته‌بندی: ${plan.category.title}`,
      `شناسه پلن: ${plan.id}`,
      `عنوان: ${plan.title}`,
      `حجم: ${formatGb(plan.volumeGb)}`,
      `مدت: ${formatDays(plan.durationDays)}`,
      `قیمت: ${formatToman(plan.priceToman)}`,
      `Squad ها: ${plan.remnawaveSquadUuids.length > 0 ? plan.remnawaveSquadUuids.join(", ") : "پیش‌فرض دسته‌بندی"}`,
      `وضعیت: ${plan.isEnabled ? "فعال" : "غیرفعال"}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("✏️ ویرایش پلن", `admin:plan_edit:${plan.id}`)],
      [Markup.button.callback(plan.isEnabled ? "⛔ غیرفعال کردن" : "✅ فعال کردن", `admin:plan_toggle:${plan.id}`)],
      [Markup.button.callback("🗑 حذف پلن", `admin:plan_delete:${plan.id}`)],
      [Markup.button.callback("⬅️ بازگشت", "admin:plans")]
    ])
  );
}

export async function handleTogglePlan(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    await ctx.reply("❌ پلن پیدا نشد.");
    return;
  }
  await prisma.plan.update({ where: { id: planId }, data: { isEnabled: !plan.isEnabled } });
  await ctx.reply("✅ پلن به‌روزرسانی شد.");
  await handlePlans(ctx);
}

export async function handleDeletePlan(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const serviceCount = await prisma.purchasedService.count({ where: { planId } });
  if (serviceCount > 0) {
    await prisma.plan.update({ where: { id: planId }, data: { isEnabled: false } });
    await ctx.reply("⚠️ این پلن روی سرویس‌های خریداری‌شده استفاده شده؛ برای حفظ تاریخچه حذف نشد و فقط غیرفعال شد.");
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { planId }, data: { planId: null } });
      await tx.plan.delete({ where: { id: planId } });
    });
    await ctx.reply("✅ پلن حذف شد.");
  }
  await handlePlans(ctx);
}

export async function startEditCategory(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    await ctx.reply("❌ دسته‌بندی پیدا نشد.");
    return;
  }
  ctx.session = { flow: "admin_category_edit", adminCategoryId: category.id };
  await ctx.reply(
    [
      "✏️ اطلاعات جدید دسته‌بندی را با این فرمت ارسال کنید:",
      "",
      "title | squad_uuid1,squad_uuid2",
      "",
      "مثال:",
      `${category.title} | ${category.remnawaveSquadUuids.length > 0 ? category.remnawaveSquadUuids.join(",") : category.remnawaveSquadUuid}`
    ].join("\n")
  );
}

export async function handleEditCategoryText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const categoryId = ctx.session.adminCategoryId;
  const [titleRaw, squadsRaw] = splitParts(text, 2);
  const title = titleRaw?.trim();
  const squadUuids = parseSquadUuids(squadsRaw ?? "");
  if (!categoryId || !title || squadUuids.length === 0) {
    await ctx.reply("❌ فرمت ویرایش دسته‌بندی درست نیست.");
    return;
  }

  await prisma.planCategory.update({
    where: { id: categoryId },
    data: {
      title,
      remnawaveSquadUuid: squadUuids[0]!,
      remnawaveSquadUuids: squadUuids
    }
  });
  ctx.session = {};
  await ctx.reply("✅ دسته‌بندی ویرایش شد.");
  await handleCategoryDetail(ctx, categoryId);
}

export async function startEditPlan(ctx: BotContext, planId: string) {
  if (!ensureAdmin(ctx)) return;
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    await ctx.reply("❌ پلن پیدا نشد.");
    return;
  }
  ctx.session = { flow: "admin_plan_edit", adminPlanId: plan.id };
  await ctx.reply(
    [
      "✏️ اطلاعات جدید پلن را با این فرمت ارسال کنید:",
      "",
      "title | volume_gb | duration_days | price_toman | squad_uuid1,squad_uuid2",
      "",
      "اگر پلن از Squad دسته‌بندی استفاده می‌کند، بخش آخر را - بگذارید.",
      "",
      "مثال:",
      `${plan.title} | ${plan.volumeGb} | ${plan.durationDays} | ${plan.priceToman} | ${plan.remnawaveSquadUuids.length > 0 ? plan.remnawaveSquadUuids.join(",") : "-"}`
    ].join("\n")
  );
}

export async function handleEditPlanText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const planId = ctx.session.adminPlanId;
  const [titleRaw, volumeRaw, durationRaw, priceRaw, squadsRaw] = splitParts(text, 5);
  const title = titleRaw?.trim();
  const volumeGb = Number(volumeRaw?.replace(/[^\d]/g, ""));
  const durationDays = Number(durationRaw?.replace(/[^\d]/g, ""));
  const priceToman = Number(priceRaw?.replace(/[^\d]/g, ""));
  const squadUuids = squadsRaw?.trim() === "-" ? [] : parseSquadUuids(squadsRaw ?? "");
  if (
    !planId ||
    !title ||
    !Number.isSafeInteger(volumeGb) ||
    volumeGb <= 0 ||
    !Number.isSafeInteger(durationDays) ||
    durationDays <= 0 ||
    !Number.isSafeInteger(priceToman) ||
    priceToman <= 0
  ) {
    await ctx.reply("❌ فرمت ویرایش پلن درست نیست.");
    return;
  }

  await prisma.plan.update({
    where: { id: planId },
    data: { title, volumeGb, durationDays, priceToman, remnawaveSquadUuids: squadUuids }
  });
  ctx.session = {};
  await ctx.reply("✅ پلن ویرایش شد.");
  await handlePlanDetail(ctx, planId);
}

export async function handleApprove(ctx: BotContext, receiptId: string) {
  if (!ensureAdmin(ctx)) return;
  try {
    const result = await approvePayment(receiptId, ctx.from!.id);
    await ctx.reply("✅ پرداخت تایید شد.");

    const order = await prisma.order.findUnique({
      where: { id: result.id },
      include: { user: true, service: true, targetService: true }
    });

    if (!order) return;

    if (order.type === "WALLET_TOPUP") {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "✅ شارژ کیف پول شما تایید شد.");
    } else if (order.service) {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "✅ پرداخت شما تایید شد.\nسرویس شما آماده است.");
      await sendServiceToUser(ctx, Number(order.user.telegramId), order.service.id);
    } else if (order.type === "SERVICE_RENEWAL" && order.targetService) {
      await ctx.telegram.sendMessage(Number(order.user.telegramId), "✅ پرداخت شما تایید شد.\nسرویس شما تمدید شد.");
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
        "❌ تایید پرداخت ناموفق بود.",
        failureReason ? `دلیل: ${failureReason}` : error instanceof Error ? `دلیل: ${error.message}` : undefined,
        "اگر رسید تایید شده اما سفارش ناموفق شده، لاگ Render را بررسی کنید."
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

export async function handleReject(ctx: BotContext, receiptId: string) {
  if (!ensureAdmin(ctx)) return;
  const receipt = await rejectPayment(receiptId, ctx.from!.id);
  await ctx.reply("❌ پرداخت رد شد.");
  const order = await prisma.order.findUnique({ where: { id: receipt.orderId }, include: { user: true } });
  if (order) {
    await ctx.telegram.sendMessage(Number(order.user.telegramId), "❌ تراکنش شما تایید نشد.\nدر صورت نیاز، با پشتیبانی در ارتباط باشید.");
  }
}

export async function startAddCategory(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session = { flow: "admin_category_title" };
  await ctx.reply("🗂 نام دسته‌بندی را ارسال کنید.\nمثال: VIP");
}

export async function handleAddCategoryTitle(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = text.trim();
  if (!title) {
    await ctx.reply("❌ عنوان نباید خالی باشد.");
    return;
  }
  ctx.session.adminCategoryTitle = title;
  ctx.session.flow = "admin_category_squad";
  await ctx.reply("شناسه Squad در Remnawave را ارسال کنید.");
}

export async function handleAddCategorySquad(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = ctx.session.adminCategoryTitle;
  const remnawaveSquadUuid = text.trim();
  if (!title || !remnawaveSquadUuid) {
    await ctx.reply("❌ اطلاعات دسته‌بندی کامل نیست. دوباره از افزودن دسته‌بندی شروع کنید.");
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
  await ctx.reply(`✅ دسته‌بندی ثبت شد: ${title}`);
  await handleCategories(ctx);
}

export async function startAddPlan(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  const categories = await prisma.planCategory.findMany({ where: { isEnabled: true }, orderBy: { title: "asc" } });
  if (categories.length === 0) {
    await ctx.reply("ابتدا یک دسته‌بندی بسازید.");
    return;
  }
  ctx.session = {};
  await ctx.reply(
    "🗂 دسته‌بندی پلن را انتخاب کنید:",
    Markup.inlineKeyboard(categories.map((category) => [Markup.button.callback(category.title, `admin:plan_category:${category.id}`)]))
  );
}

export async function handlePlanCategorySelected(ctx: BotContext, categoryId: string) {
  if (!ensureAdmin(ctx)) return;
  const category = await prisma.planCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    await ctx.reply("❌ دسته‌بندی پیدا نشد.");
    return;
  }
  ctx.session = { flow: "admin_plan_title", adminPlanCategoryId: categoryId };
  await ctx.reply(`دسته‌بندی: ${category.title}\nنام پلن را ارسال کنید.\nمثال: VIP 20GB 1M`);
}

export async function startAddDiscount(ctx: BotContext) {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_discount";
  await ctx.reply(
    [
      "🎟 کد تخفیف را با این فرمت ارسال کنید:",
      "",
      "CODE | percent_off | amount_off_toman | max_uses | expire_yyyy-mm-dd | one_use_per_user",
      "",
      "مثال:",
      "OFF20 | 20 | 0 | 100 | 2026-12-31 | yes",
      "",
      "برای بدون محدودیت زمانی، بخش تاریخ را خالی بگذارید.",
      "برای استفاده چندباره توسط هر کاربر، مقدار آخر را no بگذارید."
    ].join("\n")
  );
}

export async function handleAddDiscountText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [codeRaw, percentRaw, amountRaw, maxUsesRaw, expiresRaw, oneUseRaw] = splitParts(text, 6);
  const code = codeRaw?.toUpperCase();
  const percentOff = Number(percentRaw ?? 0);
  const amountOffToman = Number(amountRaw ?? 0);
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : undefined;
  const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59.000Z`) : undefined;
  const oneUsePerUser = parseBooleanFlag(oneUseRaw);

  if (
    !code ||
    (!Number.isSafeInteger(percentOff) && !Number.isSafeInteger(amountOffToman)) ||
    (percentOff <= 0 && amountOffToman <= 0) ||
    percentOff > 100 ||
    (maxUses !== undefined && !Number.isSafeInteger(maxUses)) ||
    (expiresRaw && Number.isNaN(expiresAt?.getTime())) ||
    oneUsePerUser === null
  ) {
    await ctx.reply("❌ فرمت کد تخفیف درست نیست.");
    return;
  }

  await prisma.discountCode.upsert({
    where: { code },
    update: {
      percentOff: percentOff > 0 ? percentOff : null,
      amountOffToman: amountOffToman > 0 ? amountOffToman : null,
      maxUses,
      expiresAt,
      oneUsePerUser,
      isEnabled: true
    },
    create: {
      code,
      percentOff: percentOff > 0 ? percentOff : null,
      amountOffToman: amountOffToman > 0 ? amountOffToman : null,
      maxUses,
      expiresAt,
      oneUsePerUser
    }
  });
  ctx.session = {};
  await ctx.reply("✅ کد تخفیف ثبت شد.");
}

export async function handleAddPlanTitle(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const title = text.trim();
  if (!ctx.session.adminPlanCategoryId || !title) {
    await ctx.reply("❌ اطلاعات پلن کامل نیست. دوباره از افزودن پلن شروع کنید.");
    ctx.session = {};
    return;
  }
  ctx.session.adminPlanTitle = title;
  ctx.session.flow = "admin_plan_volume";
  await ctx.reply("حجم پلن را به گیگابایت ارسال کنید.\nمثال: 20");
}

export async function handleAddPlanVolume(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const volumeGb = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(volumeGb) || volumeGb <= 0) {
    await ctx.reply("❌ حجم درست نیست. مثال: 20");
    return;
  }
  ctx.session.adminPlanVolumeGb = volumeGb;
  ctx.session.flow = "admin_plan_duration";
  await ctx.reply("مدت پلن را به روز ارسال کنید.\nمثال: 30");
}

export async function handleAddPlanDuration(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const durationDays = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isSafeInteger(durationDays) || durationDays <= 0) {
    await ctx.reply("❌ مدت درست نیست. مثال: 30");
    return;
  }
  ctx.session.adminPlanDurationDays = durationDays;
  ctx.session.flow = "admin_plan_price";
  await ctx.reply("قیمت پلن را به تومان ارسال کنید.\nمثال: 250000");
}

export async function handleAddPlanPrice(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const priceToman = Number(text.replace(/[^\d]/g, ""));
  const categoryId = ctx.session.adminPlanCategoryId;
  const title = ctx.session.adminPlanTitle;
  const volumeGb = ctx.session.adminPlanVolumeGb;
  const durationDays = ctx.session.adminPlanDurationDays;
  if (!categoryId || !title || !volumeGb || !durationDays || !Number.isSafeInteger(priceToman) || priceToman <= 0) {
    await ctx.reply("❌ اطلاعات پلن کامل نیست. دوباره از افزودن پلن شروع کنید.");
    ctx.session = {};
    return;
  }
  ctx.session.adminPlanPriceToman = priceToman;
  ctx.session.flow = "admin_plan_squads";
  await ctx.reply("اگر این پلن Squad مخصوص دارد، UUID ها را با کاما جدا کنید.\nمثال: uuid1,uuid2\n\nاگر از Squad دسته‌بندی استفاده می‌کند، فقط - ارسال کنید.");
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
    await ctx.reply("❌ اطلاعات پلن کامل نیست. دوباره از افزودن پلن شروع کنید.");
    ctx.session = {};
    return;
  }
  const squadUuids = text.trim() === "-" ? [] : parseSquadUuids(text);
  await prisma.plan.create({
    data: { categoryId, title, volumeGb, durationDays, priceToman, remnawaveSquadUuids: squadUuids }
  });
  ctx.session = {};
  await ctx.reply(`✅ پلن ثبت شد: ${title} / ${formatGb(volumeGb)} / ${formatToman(priceToman)}`);
  await handlePlans(ctx);
}

export async function startAddContent(ctx: BotContext, kind: "TRAINING" | "SOFTWARE") {
  if (!ensureAdmin(ctx)) return;
  ctx.session.flow = "admin_content";
  ctx.session.contentKind = kind;
  await ctx.reply(
    [
      "محتوا را با این فرمت ارسال کنید:",
      "",
      "عنوان | متن یا لینک",
      "",
      "برای فایل، عکس یا ویدیو هم همان فایل را بفرستید و کپشن را همین فرمت بگذارید.",
      "کاربر عنوان را به صورت دکمه می‌بیند و با زدن آن، محتوا برایش ارسال می‌شود."
    ].join("\n")
  );
}

export async function handleAddContentText(ctx: BotContext, text: string) {
  if (!ensureAdmin(ctx)) return;
  const [title, body] = splitParts(text, 2);
  if (!title) {
    await ctx.reply("❌ عنوان لازم است.");
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
  await ctx.reply("✅ محتوا ثبت شد.");
}

export async function handleAddContentFile(ctx: BotContext, fileId: string, fileType: "PHOTO" | "DOCUMENT" | "VIDEO", caption?: string) {
  if (!ensureAdmin(ctx)) return;
  const [title, body] = splitParts(caption ?? "", 2);
  if (!title) {
    await ctx.reply("❌ کپشن باید با فرمت عنوان | متن باشد.");
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
  await ctx.reply("✅ فایل محتوا ثبت شد.");
}

function ensureAdmin(ctx: BotContext): boolean {
  if (!isAdmin(ctx.from?.id)) {
    void ctx.reply("❌ شما دسترسی مدیریت ندارید.");
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

function parseBooleanFlag(input?: string): boolean | null {
  if (!input) return false;
  const normalized = input.trim().toLowerCase();
  if (["yes", "true", "1", "y", "بله"].includes(normalized)) return true;
  if (["no", "false", "0", "n", "خیر"].includes(normalized)) return false;
  return null;
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
      [Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)]
    ]).reply_markup
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
      `📦 حجم جدید: ${service.volumeGb} GB`,
      `⏳ روز باقی‌مانده: ${daysLeft}`
    ].join("\n"),
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.url("🔗 باز کردن لینک ساب", service.subscriptionUrl)],
      [Markup.button.callback("📋 دریافت دستی کانفیگ‌ها", `configs:${service.id}`)]
    ]).reply_markup
  });
}

