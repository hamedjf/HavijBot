import { Markup } from "telegraf";
import { getText } from "../services/text-service.js";
import { normalizeChannelId } from "./membership.js";

export async function mainMenu(isAdmin = false) {
  const rows = [
    [await getText("main.buy"), await getText("main.myServices")],
    [await getText("main.tutorials"), await getText("main.apps")],
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
    [Markup.button.callback("Pending payments", "admin:payments")],
    [Markup.button.callback("Broadcast PM", "admin:broadcast")],
    [Markup.button.callback("Card number/text", "admin:card_text")],
    [Markup.button.callback("Categories", "admin:categories"), Markup.button.callback("Plans", "admin:plans")],
    [Markup.button.callback("Add category", "admin:add_category"), Markup.button.callback("Add plan", "admin:add_plan")],
    [Markup.button.callback("Add discount", "admin:add_discount")],
    [Markup.button.callback("Discounts", "admin:discounts")],
    [Markup.button.callback("Texts", "admin:texts")],
    [Markup.button.callback("Add amoozesh", "admin:add_content:TRAINING")],
    [Markup.button.callback("Add narm afzar", "admin:add_content:SOFTWARE")]
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
