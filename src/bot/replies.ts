import type { BotContext } from "./context.js";
import { config } from "../config.js";
import { mainMenu, membershipKeyboard } from "./keyboards.js";
import { isAdmin } from "./membership.js";

export async function replyMainMenu(ctx: BotContext) {
  await ctx.reply("Menu asli:", mainMenu(isAdmin(ctx.from?.id)));
}

export async function replyJoinRequired(ctx: BotContext) {
  await ctx.reply("Baraye estefade az bot, aval join channel asli sho.", membershipKeyboard(config.MAIN_CHANNEL_ID));
}

