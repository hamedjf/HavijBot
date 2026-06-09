import { Markup } from "telegraf";
import { getText } from "../services/text-service.js";
import { normalizeChannelId } from "./membership.js";

export async function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback(await getText("main.buy"), "buy")],
    [Markup.button.callback(await getText("main.myServices"), "my_services")],
    [Markup.button.callback(await getText("main.tutorials"), "content:TRAINING"), Markup.button.callback(await getText("main.apps"), "content:SOFTWARE")],
    [Markup.button.callback(await getText("main.wallet"), "wallet_charge")],
    [Markup.button.callback(await getText("main.referral"), "referral")],
    [Markup.button.callback(await getText("main.support"), "support")]
  ];

  if (isAdmin) {
    rows.push([Markup.button.callback(await getText("main.admin"), "admin")]);
  }

  return Markup.inlineKeyboard(rows);
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
    [Markup.button.callback("Categories", "admin:categories"), Markup.button.callback("Plans", "admin:plans")],
    [Markup.button.callback("Add category", "admin:add_category"), Markup.button.callback("Add plan", "admin:add_plan")],
    [Markup.button.callback("Add discount", "admin:add_discount")],
    [Markup.button.callback("Discounts", "admin:discounts")],
    [Markup.button.callback("Texts", "admin:texts")],
    [Markup.button.callback("Add amoozesh", "admin:add_content:TRAINING")],
    [Markup.button.callback("Add narm afzar", "admin:add_content:SOFTWARE")]
  ]);
}
