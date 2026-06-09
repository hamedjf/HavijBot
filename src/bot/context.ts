import type { Context, NarrowedContext } from "telegraf";
import type { Update } from "telegraf/types";

export type SessionState = {
  flow?:
    | "purchase_username"
    | "wallet_amount"
    | "awaiting_receipt"
    | "discount_code"
    | "admin_category_title"
    | "admin_category_squad"
    | "admin_plan_title"
    | "admin_plan_volume"
    | "admin_plan_duration"
    | "admin_plan_price"
    | "admin_plan_squads"
    | "admin_content"
    | "admin_discount"
    | "admin_text_value"
    | "admin_broadcast"
    | "admin_card_text";
  planId?: string;
  orderId?: string;
  contentKind?: "TRAINING" | "SOFTWARE";
  adminCategoryTitle?: string;
  adminPlanCategoryId?: string;
  adminPlanTitle?: string;
  adminPlanVolumeGb?: number;
  adminPlanDurationDays?: number;
  adminPlanPriceToman?: number;
  adminTextKey?: string;
};

export type BotContext = Context & {
  session: SessionState;
};

export type CallbackContext = NarrowedContext<BotContext, Update.CallbackQueryUpdate>;
