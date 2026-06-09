import type { BotContext } from "./context.js";
import { config } from "../config.js";
import { mainMenu, membershipKeyboard } from "./keyboards.js";
import { isAdmin } from "./membership.js";

export async function replyMainMenu(ctx: BotContext) {
  await ctx.reply("🌟 به ربات مدیریت سرویس خوش آمدید.\nیکی از گزینه‌های زیر را انتخاب کنید:", mainMenu(isAdmin(ctx.from?.id)));
}

export async function replyJoinRequired(ctx: BotContext) {
  await ctx.reply("🔒 برای استفاده از ربات، ابتدا عضو کانال اصلی شوید.\nبعد از عضویت روی «عضو شدم» بزنید.", membershipKeyboard(config.MAIN_CHANNEL_ID));
}
