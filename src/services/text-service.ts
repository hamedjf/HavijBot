import { prisma } from "../db.js";

export const TEXT_DEFINITIONS = [
  { key: "main.welcome", title: "Main menu welcome", fallback: "🌟 به ربات مدیریت سرویس خوش آمدید.\nیکی از گزینه‌های زیر را انتخاب کنید:" },
  { key: "main.buy", title: "Main menu buy button", fallback: "🛒 خرید سرویس" },
  { key: "main.myServices", title: "Main menu services button", fallback: "📦 سرویس‌های من" },
  { key: "main.tutorials", title: "Main menu tutorials button", fallback: "📚 آموزش‌ها" },
  { key: "main.apps", title: "Main menu apps button", fallback: "📱 نرم‌افزارها" },
  { key: "main.wallet", title: "Main menu wallet button", fallback: "💳 شارژ کیف پول" },
  { key: "main.referral", title: "Main menu referral button", fallback: "🎁 لینک دعوت" },
  { key: "main.support", title: "Main menu support button", fallback: "🧑‍💻 پشتیبانی" },
  { key: "main.admin", title: "Main menu admin button", fallback: "⚙️ مدیریت" },
  { key: "membership.required", title: "Join channel required", fallback: "🔒 برای استفاده از ربات، ابتدا عضو کانال اصلی شوید.\nبعد از عضویت روی «عضو شدم» بزنید." },
  { key: "membership.joinButton", title: "Join channel button", fallback: "📣 عضویت در کانال" },
  { key: "membership.checkButton", title: "Check membership button", fallback: "✅ عضو شدم" },
  { key: "buy.noPlans", title: "No active plans", fallback: "⏳ فعلا پلن فعالی برای خرید وجود ندارد." },
  { key: "buy.selectCategory", title: "Select category", fallback: "🛍️ نوع سرویس را انتخاب کنید:" },
  { key: "buy.noCategoryPlans", title: "No plans in category", fallback: "⏳ برای این دسته‌بندی فعلا پلن فعالی وجود ندارد." },
  { key: "buy.selectPlan", title: "Select plan", fallback: "📋 پلن مورد نظر را انتخاب کنید:" },
  { key: "buy.usernamePrompt", title: "Username prompt", fallback: "👤 نام کاربری سرویس را ارسال کنید.\n\nقانون: Username can only contain letters, numbers, underscores and dashes\nمثال: Hamed_20" },
  { key: "buy.invalidUsername", title: "Invalid username", fallback: "❌ نام کاربری نامعتبر است.\nUsername can only contain letters, numbers, underscores and dashes\nحداقل ۳ و حداکثر ۲۸ کاراکتر." },
  { key: "payment.receiptSent", title: "Receipt sent", fallback: "✅ رسید شما بلافاصله برای ادمین ارسال شد.\nبعد از تایید، نتیجه به شما اعلام می‌شود." },
  { key: "payment.receiptNotSent", title: "Receipt not delivered to admin", fallback: "⚠️ رسید ثبت شد اما برای ادمین ارسال نشد. لطفا به پشتیبانی اطلاع دهید." },
  { key: "services.empty", title: "No services", fallback: "📭 هنوز سرویس فعالی ندارید." },
  { key: "services.listTitle", title: "Services list title", fallback: "📦 سرویس‌های شما:" },
  { key: "support.message", title: "Support message prefix", fallback: "🧑‍💻 پشتیبانی:" }
] as const;

const fallbackMap = new Map(TEXT_DEFINITIONS.map((definition) => [definition.key, definition.fallback]));

export type TextKey = (typeof TEXT_DEFINITIONS)[number]["key"];

export async function getText(key: TextKey, variables: Record<string, string | number> = {}): Promise<string> {
  const row = await prisma.botText.findUnique({ where: { key } });
  return renderTemplate(row?.value ?? fallbackMap.get(key) ?? key, variables);
}

export async function getTextSyncFallback(key: TextKey): Promise<string> {
  return getText(key);
}

export async function setText(key: string, value: string) {
  return prisma.botText.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
}

export async function resetText(key: string) {
  return prisma.botText.delete({ where: { key } }).catch(() => null);
}

export function getTextDefinition(key: string) {
  return TEXT_DEFINITIONS.find((definition) => definition.key === key);
}

function renderTemplate(template: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)), template);
}
