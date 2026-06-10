import { Telegraf, session } from "telegraf";
import type { Message } from "telegraf/types";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { BotContext } from "./context.js";
import {
  handleAddContentFile,
  handleAddContentText,
  handleAddDiscountText,
  handleAddCategorySquad,
  handleAddCategoryTitle,
  handleAddPlanDuration,
  handleAddPlanPrice,
  handleAddPlanSquads,
  handleAddPlanTitle,
  handleAddPlanVolume,
  handleAdmin,
  handleApprove,
  handleBroadcastText,
  handleCardText,
  handleCategories,
  handleCategoryDetail,
  handleDeleteCategory,
  handleDeleteDiscount,
  handleDeletePlan,
  handleDiscountDetail,
  handleDiscounts,
  handleEditCardText,
  handleEditCategoryText,
  handleEditPlanText,
  handleEditTextValue,
  handlePendingPayments,
  handlePlanCategorySelected,
  handlePlanDetail,
  handlePlans,
  handleReject,
  handleToggleCategory,
  handleToggleDiscount,
  handleTogglePlan,
  handleResetText,
  handleTextDetail,
  handleTexts,
  startBroadcast,
  startEditCategory,
  startEditPlan,
  startEditText,
  startEditCardText,
  startAddCategory,
  startAddDiscount,
  startAddContent,
  startAddPlan
} from "./handlers/admin-handlers.js";
import {
  handleBuy,
  handleCategory,
  handleContent,
  handleContentItem,
  handleMyServices,
  handlePayCard,
  handleApplyWallet,
  handleDiscountCode,
  handleDiscountStart,
  handlePlan,
  handleReceiptPhoto,
  handleReferral,
  handleRenewPlan,
  handleRenewService,
  handleServiceConfigs,
  handleServiceDetail,
  handleStart,
  handleSupport,
  handleUsernameMessage,
  handleWalletAmount,
  handleWalletCharge,
  handleWalletOverview
} from "./handlers/user-handlers.js";
import { getText } from "../services/text-service.js";
import { isAdmin, isChannelMember } from "./membership.js";
import { replyJoinRequired, replyMainMenu } from "./replies.js";

export function createBot() {
  const bot = new Telegraf<BotContext>(config.BOT_TOKEN);

  bot.use(session({ defaultSession: () => ({}) }));
  bot.use(async (ctx, next) => {
    logger.info(
      {
        updateId: ctx.update.update_id,
        updateType: ctx.updateType,
        telegramId: ctx.from?.id,
        username: ctx.from?.username,
        chatId: ctx.chat?.id
      },
      "Telegram update received"
    );
    await next();
  });

  bot.catch(async (error, ctx) => {
    logger.error(
      {
        err: error,
        updateId: ctx.update.update_id,
        updateType: ctx.updateType,
        telegramId: ctx.from?.id,
        chatId: ctx.chat?.id
      },
      "Telegram handler failed"
    );

    if (ctx.chat?.type === "private") {
      await ctx.reply("⚠️ مشکلی پیش آمد. لطفا چند لحظه بعد دوباره تلاش کنید.");
    }
  });

  bot.start(handleStart);

  bot.action("check_membership", async (ctx) => {
    await ctx.answerCbQuery();
    if (await isChannelMember(ctx)) {
      await replyMainMenu(ctx);
    } else {
      await replyJoinRequired(ctx);
    }
  });
  bot.action("nav:main", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session = {};
    await replyMainMenu(ctx);
  });

  bot.action("buy", async (ctx) => {
    await ctx.answerCbQuery();
    await handleBuy(ctx);
  });
  bot.action(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleCategory(ctx, ctx.match[1]);
  });
  bot.action(/^plan:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlan(ctx, ctx.match[1]);
  });
  bot.action(/^pay_card:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePayCard(ctx, ctx.match[1]);
  });
  bot.action(/^apply_wallet:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleApplyWallet(ctx, ctx.match[1]);
  });
  bot.action(/^discount:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDiscountStart(ctx, ctx.match[1]);
  });
  bot.action("wallet_charge", async (ctx) => {
    await ctx.answerCbQuery();
    await handleWalletCharge(ctx);
  });
  bot.action("wallet", async (ctx) => {
    await ctx.answerCbQuery();
    await handleWalletOverview(ctx);
  });
  bot.action("my_services", async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyServices(ctx);
  });
  bot.action(/^svc:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleServiceDetail(ctx, ctx.match[1]);
  });
  bot.action(/^configs:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleServiceConfigs(ctx, ctx.match[1]);
  });
  bot.action(/^renew:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRenewService(ctx, ctx.match[1]);
  });
  bot.action(/^renew_plan:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRenewPlan(ctx, ctx.match[1]);
  });
  bot.action(/^content:(TRAINING|SOFTWARE)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleContent(ctx, ctx.match[1] as "TRAINING" | "SOFTWARE");
  });
  bot.action(/^content_item:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleContentItem(ctx, ctx.match[1]);
  });
  bot.action("support", async (ctx) => {
    await ctx.answerCbQuery();
    await handleSupport(ctx);
  });
  bot.action("referral", async (ctx) => {
    await ctx.answerCbQuery();
    await handleReferral(ctx);
  });

  bot.action("admin", async (ctx) => {
    await ctx.answerCbQuery();
    await handleAdmin(ctx);
  });
  bot.action("admin:payments", async (ctx) => {
    await ctx.answerCbQuery();
    await handlePendingPayments(ctx);
  });
  bot.action("admin:broadcast", async (ctx) => {
    await ctx.answerCbQuery();
    await startBroadcast(ctx);
  });
  bot.action("admin:card_text", async (ctx) => {
    await ctx.answerCbQuery();
    await handleCardText(ctx);
  });
  bot.action("admin:card_text_edit", async (ctx) => {
    await ctx.answerCbQuery();
    await startEditCardText(ctx);
  });
  bot.action("admin:categories", async (ctx) => {
    await ctx.answerCbQuery();
    await handleCategories(ctx);
  });
  bot.action(/^admin:category:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleCategoryDetail(ctx, ctx.match[1]);
  });
  bot.action(/^admin:category_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleToggleCategory(ctx, ctx.match[1]);
  });
  bot.action(/^admin:category_edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await startEditCategory(ctx, ctx.match[1]);
  });
  bot.action(/^admin:category_delete:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDeleteCategory(ctx, ctx.match[1]);
  });
  bot.action("admin:plans", async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlans(ctx);
  });
  bot.action("admin:discounts", async (ctx) => {
    await ctx.answerCbQuery();
    await handleDiscounts(ctx);
  });
  bot.action(/^admin:discount:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDiscountDetail(ctx, ctx.match[1]);
  });
  bot.action(/^admin:discount_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleToggleDiscount(ctx, ctx.match[1]);
  });
  bot.action(/^admin:discount_delete:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDeleteDiscount(ctx, ctx.match[1]);
  });
  bot.action("admin:texts", async (ctx) => {
    await ctx.answerCbQuery();
    await handleTexts(ctx);
  });
  bot.action(/^admin:text:([A-Za-z0-9_.-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleTextDetail(ctx, ctx.match[1]);
  });
  bot.action(/^admin:text_edit:([A-Za-z0-9_.-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await startEditText(ctx, ctx.match[1]);
  });
  bot.action(/^admin:text_reset:([A-Za-z0-9_.-]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleResetText(ctx, ctx.match[1]);
  });
  bot.action(/^admin:plan:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlanDetail(ctx, ctx.match[1]);
  });
  bot.action(/^admin:plan_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleTogglePlan(ctx, ctx.match[1]);
  });
  bot.action(/^admin:plan_edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await startEditPlan(ctx, ctx.match[1]);
  });
  bot.action(/^admin:plan_delete:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDeletePlan(ctx, ctx.match[1]);
  });
  bot.action("admin:add_category", async (ctx) => {
    await ctx.answerCbQuery();
    await startAddCategory(ctx);
  });
  bot.action("admin:add_plan", async (ctx) => {
    await ctx.answerCbQuery();
    await startAddPlan(ctx);
  });
  bot.action(/^admin:plan_category:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlanCategorySelected(ctx, ctx.match[1]);
  });
  bot.action("admin:add_discount", async (ctx) => {
    await ctx.answerCbQuery();
    await startAddDiscount(ctx);
  });
  bot.action(/^admin:add_content:(TRAINING|SOFTWARE)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await startAddContent(ctx, ctx.match[1] as "TRAINING" | "SOFTWARE");
  });
  bot.action(/^admin:approve:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleApprove(ctx, ctx.match[1]);
  });
  bot.action(/^admin:reject:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleReject(ctx, ctx.match[1]);
  });

  bot.on("photo", async (ctx) => {
    const message = ctx.message as Message.PhotoMessage;
    const fileId = message.photo[message.photo.length - 1]?.file_id;
    if (!fileId) return;

    if (ctx.session.flow === "admin_content") {
      await handleAddContentFile(ctx, fileId, "PHOTO", message.caption);
      return;
    }

    await handleReceiptPhoto(ctx, fileId);
  });

  bot.on("document", async (ctx) => {
    const message = ctx.message as Message.DocumentMessage;
    if (ctx.session.flow === "admin_content") {
      await handleAddContentFile(ctx, message.document.file_id, "DOCUMENT", message.caption);
      return;
    }
    await ctx.reply("📸 لطفا اسکرین‌شات رسید را به‌صورت عکس ارسال کنید.");
  });

  bot.on("video", async (ctx) => {
    const message = ctx.message as Message.VideoMessage;
    if (ctx.session.flow === "admin_content") {
      await handleAddContentFile(ctx, message.video.file_id, "VIDEO", message.caption);
      return;
    }
    await replyMainMenu(ctx);
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (await handleMainKeyboardText(ctx, text)) {
      return;
    }

    switch (ctx.session.flow) {
      case "purchase_username":
        await handleUsernameMessage(ctx, text);
        break;
      case "wallet_amount":
        await handleWalletAmount(ctx, text);
        break;
      case "discount_code":
        await handleDiscountCode(ctx, text);
        break;
      case "admin_category_title":
        await handleAddCategoryTitle(ctx, text);
        break;
      case "admin_category_squad":
        await handleAddCategorySquad(ctx, text);
        break;
      case "admin_category_edit":
        await handleEditCategoryText(ctx, text);
        break;
      case "admin_plan_title":
        await handleAddPlanTitle(ctx, text);
        break;
      case "admin_plan_volume":
        await handleAddPlanVolume(ctx, text);
        break;
      case "admin_plan_duration":
        await handleAddPlanDuration(ctx, text);
        break;
      case "admin_plan_price":
        await handleAddPlanPrice(ctx, text);
        break;
      case "admin_plan_squads":
        await handleAddPlanSquads(ctx, text);
        break;
      case "admin_plan_edit":
        await handleEditPlanText(ctx, text);
        break;
      case "admin_discount":
        await handleAddDiscountText(ctx, text);
        break;
      case "admin_content":
        await handleAddContentText(ctx, text);
        break;
      case "admin_text_value":
        await handleEditTextValue(ctx, text);
        break;
      case "admin_broadcast":
        await handleBroadcastText(ctx, text);
        break;
      case "admin_card_text":
        await handleEditCardText(ctx, text);
        break;
      default:
        await replyMainMenu(ctx);
    }
  });

  return bot;
}

async function handleMainKeyboardText(ctx: BotContext, text: string): Promise<boolean> {
  const entries: Array<[string, () => Promise<void>]> = [
    [await getText("main.buy"), async () => handleBuy(ctx)],
    [await getText("main.myServices"), async () => handleMyServices(ctx)],
    [await getText("main.tutorials"), async () => handleContent(ctx, "TRAINING")],
    [await getText("main.apps"), async () => handleContent(ctx, "SOFTWARE")],
    [await getText("main.wallet"), async () => handleWalletOverview(ctx)],
    [await getText("main.referral"), async () => handleReferral(ctx)],
    [await getText("main.support"), async () => handleSupport(ctx)]
  ];

  if (isAdmin(ctx.from?.id)) {
    entries.push([await getText("main.admin"), async () => handleAdmin(ctx)]);
  }

  const matched = entries.find(([label]) => label === text);
  if (!matched) {
    return false;
  }

  ctx.session = {};
  await matched[1]();
  return true;
}
