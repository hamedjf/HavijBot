import { Markup } from "telegraf";
import { normalizeChannelId } from "./membership.js";

export function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback("🛒 خرید سرویس", "buy")],
    [Markup.button.callback("📦 سرویس‌های من", "my_services")],
    [Markup.button.callback("📚 آموزش‌ها", "content:TRAINING"), Markup.button.callback("📱 نرم‌افزارها", "content:SOFTWARE")],
    [Markup.button.callback("💳 شارژ کیف پول", "wallet_charge")],
    [Markup.button.callback("🎁 لینک دعوت", "referral")],
    [Markup.button.callback("🧑‍💻 پشتیبانی", "support")]
  ];

  if (isAdmin) {
    rows.push([Markup.button.callback("⚙️ مدیریت", "admin")]);
  }

  return Markup.inlineKeyboard(rows);
}

export function membershipKeyboard(channelId: string) {
  const normalized = normalizeChannelId(channelId);
  const channelUrl = typeof normalized === "string" && normalized.startsWith("@") ? `https://t.me/${normalized.slice(1)}` : undefined;
  const rows = channelUrl
    ? [[Markup.button.url("📣 عضویت در کانال", channelUrl)], [Markup.button.callback("✅ عضو شدم", "check_membership")]]
    : [[Markup.button.callback("✅ بررسی عضویت", "check_membership")]];

  return Markup.inlineKeyboard(rows);
}

export function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Pending payments", "admin:payments")],
    [Markup.button.callback("Categories", "admin:categories"), Markup.button.callback("Plans", "admin:plans")],
    [Markup.button.callback("Add category", "admin:add_category"), Markup.button.callback("Add plan", "admin:add_plan")],
    [Markup.button.callback("Add discount", "admin:add_discount")],
    [Markup.button.callback("Discounts", "admin:discounts")],
    [Markup.button.callback("Add amoozesh", "admin:add_content:TRAINING")],
    [Markup.button.callback("Add narm afzar", "admin:add_content:SOFTWARE")]
  ]);
}
