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
    const channelId = normalizeChannelId(config.MAIN_CHANNEL_ID);
    const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch (error) {
    logger.warn(
      {
        err: error,
        mainChannelId: config.MAIN_CHANNEL_ID,
        normalizedMainChannelId: normalizeChannelId(config.MAIN_CHANNEL_ID),
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

export function normalizeChannelId(channelId: string): string | number {
  const value = channelId.trim();
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  const telegramUrlMatch = value.match(/^(?:https?:\/\/)?t\.me\/(?:c\/)?([^/?#]+)/i);
  if (telegramUrlMatch?.[1]) {
    const slug = telegramUrlMatch[1];
    return slug.startsWith("@") ? slug : `@${slug}`;
  }

  return value.startsWith("@") ? value : `@${value}`;
}

export async function getRawMembershipStatus(ctx: BotContext): Promise<string> {
  if (!ctx.from) {
    return "No Telegram user in context.";
  }

  const channelId = normalizeChannelId(config.MAIN_CHANNEL_ID);
  const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
  return `channel=${String(channelId)} user=${ctx.from.id} status=${member.status}`;
}
