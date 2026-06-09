import type { BotContext } from "./context.js";
import { config } from "../config.js";
import { getText } from "../services/text-service.js";
import { mainMenu, membershipKeyboard } from "./keyboards.js";
import { isAdmin } from "./membership.js";

export async function replyMainMenu(ctx: BotContext) {
  await ctx.reply(await getText("main.welcome"), await mainMenu(isAdmin(ctx.from?.id)));
}

export async function replyJoinRequired(ctx: BotContext) {
  await ctx.reply(await getText("membership.required"), await membershipKeyboard(config.MAIN_CHANNEL_ID));
}
