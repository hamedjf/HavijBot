export const BOT_TEXT_DEFINITIONS = [
  {
    key: "main.welcome",
    title: "متن خوش‌آمدگویی منوی اصلی",
    fallback: "🌿 به ربات هویج‌نت خوش آمدید\n\nاز منوی زیر، بخش موردنظرتان را انتخاب کنید."
  },
  { key: "main.buy", title: "دکمه خرید سرویس", fallback: "🛒 خرید سرویس" },
  { key: "main.myServices", title: "دکمه سرویس‌های من", fallback: "📦 سرویس‌های من" },
  { key: "main.tutorials", title: "دکمه آموزش‌ها", fallback: "📚 آموزش‌ها" },
  { key: "main.apps", title: "دکمه نرم‌افزارها", fallback: "📱 نرم‌افزارها" },
  { key: "main.wallet", title: "دکمه کیف پول من", fallback: "👛 کیف پول من" },
  { key: "main.referral", title: "دکمه لینک دعوت", fallback: "🎁 لینک دعوت" },
  { key: "main.support", title: "دکمه پشتیبانی", fallback: "👨‍💻 پشتیبانی" },
  { key: "main.admin", title: "دکمه مدیریت", fallback: "⚙️ مدیریت" },

  {
    key: "membership.required",
    title: "پیام اجبار عضویت در کانال",
    fallback: "🔒 برای استفاده از ربات، ابتدا عضو کانال اصلی شوید.\n\nبعد از عضویت، روی دکمه «عضو شدم» بزنید."
  },
  { key: "membership.joinButton", title: "دکمه عضویت در کانال", fallback: "📣 عضویت در کانال" },
  { key: "membership.checkButton", title: "دکمه بررسی عضویت", fallback: "✅ عضو شدم" },

  { key: "buy.noPlans", title: "پیام نبودن پلن فعال", fallback: "⏳ در حال حاضر پلن فعالی برای خرید وجود ندارد." },
  { key: "buy.selectCategory", title: "پیام انتخاب دسته‌بندی", fallback: "🛍 نوع سرویس را انتخاب کنید:" },
  { key: "buy.noCategoryPlans", title: "پیام نبودن پلن در دسته‌بندی", fallback: "⏳ برای این دسته‌بندی هنوز پلن فعالی ثبت نشده است." },
  { key: "buy.selectPlan", title: "پیام انتخاب پلن", fallback: "📋 پلن موردنظرتان را انتخاب کنید:" },
  {
    key: "buy.usernamePrompt",
    title: "پیام دریافت نام کاربری",
    fallback: "👤 نام کاربری سرویس را وارد کنید.\n\nقانون نام کاربری:\n• فقط حروف انگلیسی، عدد، خط تیره و آندرلاین\n• بدون فاصله\n\nمثال: hamed_vip"
  },
  {
    key: "buy.invalidUsername",
    title: "پیام نام کاربری نامعتبر",
    fallback: "❌ نام کاربری معتبر نیست.\n\nUsername can only contain letters, numbers, underscores and dashes"
  },

  {
    key: "payment.receiptSent",
    title: "پیام ارسال رسید",
    fallback: "✅ رسید شما با موفقیت برای ادمین ارسال شد.\n\nبعد از بررسی پرداخت، نتیجه همینجا به شما اعلام می‌شود."
  },
  {
    key: "payment.receiptNotSent",
    title: "پیام خطای ارسال رسید برای ادمین",
    fallback: "⚠️ رسید ثبت شد، اما ارسال آن برای ادمین موفق نبود.\nلطفا موضوع را به پشتیبانی اطلاع دهید."
  },
  {
    key: "payment.cardZero",
    title: "پیام مبلغ کارت‌به‌کارت صفر",
    fallback: "✅ مبلغ کارت‌به‌کارت صفر است.\nپرداخت را با کیف پول یا کد تخفیف ادامه دهید."
  },
  {
    key: "payment.cardInstruction",
    title: "راهنمای پرداخت کارت‌به‌کارت",
    fallback: "💳 پرداخت کارت‌به‌کارت\n\nمبلغ قابل پرداخت: {{amount}}\nمبلغ به ریال: {{rialAmount}}\n\nاطلاعات کارت:\n{{cardText}}"
  },
  {
    key: "payment.sendReceipt",
    title: "درخواست ارسال رسید",
    fallback: "📸 بعد از پرداخت، اسکرین‌شات رسید را همینجا ارسال کنید."
  },
  {
    key: "payment.noPending",
    title: "پیام نبودن پرداخت در انتظار",
    fallback: "❌ پرداخت در انتظار پیدا نشد.\nلطفا دوباره از منوی خرید یا شارژ کیف پول شروع کنید."
  },

  { key: "services.empty", title: "پیام نبودن سرویس", fallback: "📭 هنوز سرویس فعالی ندارید." },
  { key: "services.listTitle", title: "عنوان لیست سرویس‌ها", fallback: "📦 سرویس‌های شما:" },
  { key: "services.notFound", title: "پیام پیدا نشدن سرویس", fallback: "❌ سرویس پیدا نشد." },

  { key: "support.message", title: "پیام پشتیبانی", fallback: "👨‍💻 پشتیبانی:" },

  {
    key: "wallet.chargePrompt",
    title: "درخواست مبلغ شارژ کیف پول",
    fallback: "💳 مبلغ شارژ کیف پول را به تومان وارد کنید.\n\nمثال: 200000"
  },
  {
    key: "wallet.overview",
    title: "نمایش کیف پول",
    fallback: "👛 کیف پول شما\n\n💰 موجودی فعلی: {{balance}}\n\nبرای افزایش موجودی، روی دکمه شارژ کیف پول بزنید."
  },
  { key: "wallet.chargeButton", title: "دکمه شارژ کیف پول", fallback: "💳 شارژ کیف پول" },
  { key: "wallet.invalidAmount", title: "پیام مبلغ نامعتبر کیف پول", fallback: "❌ مبلغ وارد شده درست نیست.\nمثال: 200000" },
  {
    key: "wallet.chargeInstruction",
    title: "راهنمای کارت‌به‌کارت شارژ کیف پول",
    fallback: "💳 شارژ کیف پول\n\nمبلغ شارژ: {{amount}}\nمبلغ به ریال: {{rialAmount}}\n\nاطلاعات کارت:\n{{cardText}}"
  },

  { key: "discount.prompt", title: "درخواست کد تخفیف", fallback: "🎟 کد تخفیف را وارد کنید:" },
  { key: "discount.orderMissing", title: "پیام نبودن سفارش برای تخفیف", fallback: "❌ سفارش پیدا نشد.\nلطفا دوباره خرید را شروع کنید." },
  {
    key: "discount.applied",
    title: "پیام اعمال کد تخفیف",
    fallback: "✅ کد تخفیف اعمال شد.\n\nمبلغ تخفیف: {{amount}}"
  },

  { key: "renew.notFound", title: "پیام پیدا نشدن سرویس برای تمدید", fallback: "❌ سرویس برای تمدید پیدا نشد." },
  {
    key: "renew.created",
    title: "پیام ثبت سفارش تمدید",
    fallback: "✅ تمدید با پلن فعلی ثبت شد.\n\n📦 حجم: {{volume}}\n⏳ مدت: {{days}}\n💵 مبلغ: {{price}}"
  },

  {
    key: "referral.message",
    title: "پیام لینک دعوت",
    fallback: "🎁 لینک دعوت شما:\n{{link}}\n\n💰 پاداش هر دعوت: {{reward}}\n👛 موجودی فعلی: {{balance}}"
  },

  { key: "content.empty", title: "پیام نبودن محتوا", fallback: "📭 هنوز آیتمی ثبت نشده است." },
  { key: "content.select", title: "پیام انتخاب محتوا", fallback: "👇 یکی از موارد زیر را انتخاب کنید:" },
  { key: "content.notFound", title: "پیام پیدا نشدن محتوا", fallback: "❌ آیتم پیدا نشد." },

  { key: "checkout.discountButton", title: "دکمه کد تخفیف در پرداخت", fallback: "🎟 کد تخفیف دارم" },
  { key: "checkout.walletOffsetButton", title: "دکمه پرداخت با کیف پول", fallback: "👛 پرداخت با کیف پول" },
  { key: "checkout.cardButton", title: "دکمه کارت‌به‌کارت", fallback: "💳 کارت‌به‌کارت" },
  {
    key: "checkout.summary",
    title: "خلاصه سفارش",
    fallback: "🧾 خلاصه سفارش\n\n💵 مبلغ سرویس: {{amount}}\n🎟 تخفیف: {{discount}}\n👛 پرداخت از کیف پول: {{wallet}}\n✅ مبلغ نهایی: {{due}}\n\n💰 موجودی کیف پول: {{balance}}"
  }
] as const;
