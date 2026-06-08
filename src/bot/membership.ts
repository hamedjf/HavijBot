import type { BotContext } from "./context.js";
import { config } from "../config.js";

export async function isChannelMember(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) {
    return false;
  }

  try {
    const member = await ctx.telegram.getChatMember(config.MAIN_CHANNEL_ID, ctx.from.id);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch {
    return false;
  }
}

export function isAdmin(telegramId?: number): boolean {
  return Boolean(telegramId && config.ADMIN_IDS.includes(telegramId));
}

