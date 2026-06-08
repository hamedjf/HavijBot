import { Markup } from "telegraf";

export function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback("Kharid service", "buy")],
    [Markup.button.callback("Service haye man", "my_services")],
    [Markup.button.callback("Amoozesh ha", "content:TRAINING"), Markup.button.callback("Narm afzar ha", "content:SOFTWARE")],
    [Markup.button.callback("Charge kife pool", "wallet_charge")],
    [Markup.button.callback("Link davat", "referral")],
    [Markup.button.callback("Ertebat ba poshtibani", "support")]
  ];

  if (isAdmin) {
    rows.push([Markup.button.callback("Admin", "admin")]);
  }

  return Markup.inlineKeyboard(rows);
}

export function membershipKeyboard(channelId: string) {
  const channelUrl = channelId.startsWith("@") ? `https://t.me/${channelId.slice(1)}` : undefined;
  const rows = channelUrl
    ? [[Markup.button.url("Join channel", channelUrl)], [Markup.button.callback("Check membership", "check_membership")]]
    : [[Markup.button.callback("Check membership", "check_membership")]];

  return Markup.inlineKeyboard(rows);
}

export function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Pending payments", "admin:payments")],
    [Markup.button.callback("Add category", "admin:add_category")],
    [Markup.button.callback("Add plan", "admin:add_plan")],
    [Markup.button.callback("Add discount", "admin:add_discount")],
    [Markup.button.callback("Add amoozesh", "admin:add_content:TRAINING")],
    [Markup.button.callback("Add narm afzar", "admin:add_content:SOFTWARE")]
  ]);
}
