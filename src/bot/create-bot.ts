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
  handleAddPlanTitle,
  handleAddPlanVolume,
  handleAdmin,
  handleApprove,
  handleCategories,
  handleCategoryDetail,
  handleDeleteCategory,
  handleDeletePlan,
  handlePendingPayments,
  handlePlanCategorySelected,
  handlePlanDetail,
  handlePlans,
  handleReject,
  handleToggleCategory,
  handleTogglePlan,
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
  handlePayWallet,
  handleApplyWallet,
  handleDiscountCode,
  handleDiscountStart,
  handlePlan,
  handleReceiptPhoto,
  handleReferral,
  handleRenewOption,
  handleRenewService,
  handleServiceDetail,
  handleStart,
  handleSupport,
  handleUsernameMessage,
  handleWalletAmount,
  handleWalletCharge
} from "./handlers/user-handlers.js";
import { getRawMembershipStatus, isAdmin, isChannelMember } from "./membership.js";
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
      await ctx.reply("Bot error dad. Lotfan chand saniye bad tekrar kon ya be admin etela bede.");
    }
  });

  bot.start(handleStart);

  bot.command("whoami", async (ctx) => {
    await ctx.reply(
      [
        `telegramId=${ctx.from?.id ?? "unknown"}`,
        `username=${ctx.from?.username ?? "none"}`,
        `admin=${isAdmin(ctx.from?.id) ? "yes" : "no"}`,
        `configuredAdmins=${config.ADMIN_IDS.join(",") || "none"}`
      ].join("\n")
    );
  });

  bot.command("admin", handleAdmin);
  bot.command("debug_membership", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Dastresi admin nadari.");
      return;
    }

    try {
      await ctx.reply(await getRawMembershipStatus(ctx));
    } catch (error) {
      logger.error({ err: error, mainChannelId: config.MAIN_CHANNEL_ID, telegramId: ctx.from?.id }, "Membership debug failed");
      await ctx.reply(error instanceof Error ? error.message : "Membership debug failed.");
    }
  });
  bot.command("menu", async (ctx) => {
    if (!(await isChannelMember(ctx))) {
      await replyJoinRequired(ctx);
      return;
    }
    await replyMainMenu(ctx);
  });

  bot.action("check_membership", async (ctx) => {
    await ctx.answerCbQuery();
    if (await isChannelMember(ctx)) {
      await replyMainMenu(ctx);
    } else {
      await replyJoinRequired(ctx);
    }
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
  bot.action(/^pay_wallet:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePayWallet(ctx, ctx.match[1]);
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
  bot.action("my_services", async (ctx) => {
    await ctx.answerCbQuery();
    await handleMyServices(ctx);
  });
  bot.action(/^svc:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleServiceDetail(ctx, ctx.match[1]);
  });
  bot.action(/^renew:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRenewService(ctx, ctx.match[1]);
  });
  bot.action(/^renew_opt:(.+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleRenewOption(ctx, ctx.match[1], Number(ctx.match[2]));
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
  bot.action(/^admin:category_delete:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleDeleteCategory(ctx, ctx.match[1]);
  });
  bot.action("admin:plans", async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlans(ctx);
  });
  bot.action(/^admin:plan:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handlePlanDetail(ctx, ctx.match[1]);
  });
  bot.action(/^admin:plan_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await handleTogglePlan(ctx, ctx.match[1]);
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
    await ctx.reply("Lotfan screenshot resid ro be soorate photo befrest.");
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
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
      case "admin_discount":
        await handleAddDiscountText(ctx, text);
        break;
      case "admin_content":
        await handleAddContentText(ctx, text);
        break;
      default:
        await replyMainMenu(ctx);
    }
  });

  return bot;
}
