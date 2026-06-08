import type { Context, NarrowedContext } from "telegraf";
import type { Update } from "telegraf/types";

export type SessionState = {
  flow?:
    | "purchase_username"
    | "wallet_amount"
    | "awaiting_receipt"
    | "discount_code"
    | "admin_category"
    | "admin_plan"
    | "admin_content"
    | "admin_discount";
  planId?: string;
  orderId?: string;
  contentKind?: "TRAINING" | "SOFTWARE";
};

export type BotContext = Context & {
  session: SessionState;
};

export type CallbackContext = NarrowedContext<BotContext, Update.CallbackQueryUpdate>;
