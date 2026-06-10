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
    logger.info(
      {
        mainChannelId: config.MAIN_CHANNEL_ID,
        normalizedMainChannelId: channelId,
        telegramId: ctx.from.id,
        membershipStatus: member.status
      },
      "Channel membership checked"
    );
    return !["left", "kicked"].includes(member.status);
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

export async function getMembershipDiagnostics(ctx: BotContext): Promise<string> {
  if (!ctx.from) {
    return "کاربر تلگرام در پیام پیدا نشد.";
  }

  const channelId = normalizeChannelId(config.MAIN_CHANNEL_ID);
  const lines = [
    "🔎 تست عضویت کانال",
    "",
    `MAIN_CHANNEL_ID: ${config.MAIN_CHANNEL_ID}`,
    `شناسه نرمال‌شده: ${String(channelId)}`
  ];

  if (/t\.me\/\+/i.test(config.MAIN_CHANNEL_ID) || String(channelId).startsWith("@+")) {
    lines.push("", "⚠️ لینک دعوت خصوصی برای بررسی عضویت کافی نیست. برای کانال خصوصی باید شناسه عددی با فرمت -100... را در MAIN_CHANNEL_ID بگذارید.");
  }

  try {
    const chat = await ctx.telegram.getChat(channelId);
    lines.push(`کانال: ${"title" in chat ? chat.title : chat.id}`);
  } catch (error) {
    lines.push(`خطای دسترسی به کانال: ${formatTelegramError(error)}`);
  }

  try {
    const botInfo = await ctx.telegram.getMe();
    const botMember = await ctx.telegram.getChatMember(channelId, botInfo.id);
    lines.push(`وضعیت bot در کانال: ${botMember.status}`);
  } catch (error) {
    lines.push(`خطای بررسی وضعیت bot: ${formatTelegramError(error)}`);
  }

  try {
    const userMember = await ctx.telegram.getChatMember(channelId, ctx.from.id);
    lines.push(`وضعیت شما در کانال: ${userMember.status}`);
  } catch (error) {
    lines.push(`خطای بررسی وضعیت شما: ${formatTelegramError(error)}`);
  }

  lines.push("", "اگر bot نتواند وضعیت شما را بخواند، معمولا باید bot را admin کانال کنید یا MAIN_CHANNEL_ID را اصلاح کنید.");
  return lines.join("\n");
}

function formatTelegramError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "خطای نامشخص";
}
