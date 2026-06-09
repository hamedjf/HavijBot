import type { BotContext } from "./context.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export async function isChannelMember(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) {
    return false;
  }

  if (isAdmin(ctx.from.id)) {
    return true;
  }

  try {
    const member = await ctx.telegram.getChatMember(config.MAIN_CHANNEL_ID, ctx.from.id);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch (error) {
    logger.warn(
      {
        err: error,
        mainChannelId: config.MAIN_CHANNEL_ID,
        telegramId: ctx.from.id
      },
      "Channel membership check failed"
    );
    return false;
  }
}

export function isAdmin(telegramId?: number): boolean {
  return Boolean(telegramId && config.ADMIN_IDS.includes(telegramId));
}
