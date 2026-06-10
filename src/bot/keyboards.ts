import { Markup } from "telegraf";
import { getText } from "../services/text-service.js";
import { normalizeChannelId } from "./membership.js";

export async function mainMenu(isAdmin = false) {
  const rows = [
    [await getText("main.buy"), await getText("main.freeTrial")],
    [await getText("main.myServices"), await getText("main.tutorials")],
    [await getText("main.apps")],
    [await getText("main.wallet"), await getText("main.referral")],
    [await getText("main.support")]
  ];

  if (isAdmin) {
    rows.push([await getText("main.admin")]);
  }

  return Markup.keyboard(rows).resize();
}

export async function membershipKeyboard(channelId: string) {
  const normalized = normalizeChannelId(channelId);
  const channelUrl = typeof normalized === "string" && normalized.startsWith("@") ? `https://t.me/${normalized.slice(1)}` : undefined;
  const rows = channelUrl
    ? [[Markup.button.url(await getText("membership.joinButton"), channelUrl)], [Markup.button.callback(await getText("membership.checkButton"), "check_membership")]]
    : [[Markup.button.callback(await getText("membership.checkButton"), "check_membership")]];

  return Markup.inlineKeyboard(rows);
}

export function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🧾 پرداخت‌های در انتظار", "admin:payments")],
    [Markup.button.callback("📣 پیام همگانی", "admin:broadcast")],
    [Markup.button.callback("💳 متن کارت‌به‌کارت", "admin:card_text")],
    [Markup.button.callback("🗂 دسته‌بندی‌ها", "admin:categories"), Markup.button.callback("📦 پلن‌ها", "admin:plans")],
    [Markup.button.callback("➕ افزودن دسته‌بندی", "admin:add_category"), Markup.button.callback("➕ افزودن پلن", "admin:add_plan")],
    [Markup.button.callback("🔗 اختصاص سرویس موجود", "admin:import_service")],
    [Markup.button.callback("🎟 افزودن کد تخفیف", "admin:add_discount")],
    [Markup.button.callback("🎟 کدهای تخفیف", "admin:discounts")],
    [Markup.button.callback("✏️ متن‌های ربات", "admin:texts")],
    [Markup.button.callback("📚 افزودن آموزش", "admin:add_content:TRAINING")],
    [Markup.button.callback("📱 افزودن نرم‌افزار", "admin:add_content:SOFTWARE")]
  ]);
}

export function userNavKeyboard(backAction?: string) {
  const rows = [];
  if (backAction) {
    rows.push([Markup.button.callback("⬅️ بازگشت", backAction)]);
  }
  rows.push([Markup.button.callback("🏠 صفحه اصلی", "nav:main")]);
  return rows;
}
