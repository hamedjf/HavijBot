export const BOT_TEXT_DEFINITIONS = [
  { key: "main.welcome", title: "Main menu welcome", fallback: "🌟 به ربات هویج‌نت خوش آمدید\nیکی از گزینه‌های زیر را انتخاب کنید:" },
  { key: "main.buy", title: "Main menu buy button", fallback: "🛒 خرید سرویس" },
  { key: "main.myServices", title: "Main menu services button", fallback: "📦 سرویس‌های من" },
  { key: "main.tutorials", title: "Main menu tutorials button", fallback: "📚 آموزش‌ها" },
  { key: "main.apps", title: "Main menu apps button", fallback: "📱 نرم‌افزارها" },
  { key: "main.wallet", title: "Main menu wallet button", fallback: "👛 کیف پول من" },
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
  { key: "buy.usernamePrompt", title: "Username prompt", fallback: "👤 نام کاربری سرویس را ارسال کنید.\n\nقانون: نام کاربری باید انگلیسی باشد و بدون فاصله.\nمثال: ali , mohammad , nazanin , hos265" },
  { key: "buy.invalidUsername", title: "Invalid username", fallback: "❌ نام کاربری نامعتبر است.\nنام کاربری باید انگلیسی و بدون فاصله باشد\nحداقل ۳ و حداکثر ۲۸ کاراکتر." },
  { key: "payment.receiptSent", title: "Receipt sent", fallback: "✅ رسید شما برای ادمین ارسال شد.\nبعد از تایید، نتیجه به شما اعلام می‌شود." },
  { key: "payment.receiptNotSent", title: "Receipt not delivered to admin", fallback: "⚠️ رسید ثبت شد اما برای ادمین ارسال نشد. لطفا به پشتیبانی اطلاع دهید." },
  { key: "services.empty", title: "No services", fallback: "📭 هنوز سرویس فعالی ندارید." },
  { key: "services.listTitle", title: "Services list title", fallback: "📦 سرویس‌های شما:" },
  { key: "support.message", title: "Support message prefix", fallback: "🧑‍💻 پشتیبانی:" }
  ,{ key: "payment.cardZero", title: "Card payment zero amount", fallback: "✅ مبلغ کارت‌به‌کارت صفر است. پرداخت را با کیف پول یا تخفیف ادامه دهید." }
  ,{ key: "payment.cardInstruction", title: "Card payment instruction", fallback: "💳 لطفا مبلغ {{amount}} را کارت‌به‌کارت کنید:\n\n{{cardText}}" }
  ,{ key: "payment.sendReceipt", title: "Send receipt prompt", fallback: "📸 بعد از پرداخت، اسکرین‌شات رسید را همینجا ارسال کنید." }
  ,{ key: "payment.noPending", title: "No pending payment", fallback: "❌ پرداخت در انتظار پیدا نشد. اول از منوی خرید یا شارژ شروع کنید." }
  ,{ key: "wallet.chargePrompt", title: "Wallet charge amount prompt", fallback: "💳 مبلغ شارژ کیف پول را به تومان ارسال کنید.\nمثال: 200000" }
  ,{ key: "wallet.overview", title: "Wallet overview", fallback: "👛 کیف پول شما\n\n💰 موجودی فعلی: {{balance}}\n\nبرای افزایش موجودی، روی دکمه شارژ کیف پول بزنید." }
  ,{ key: "wallet.chargeButton", title: "Wallet charge button", fallback: "💳 شارژ کیف پول" }
  ,{ key: "wallet.invalidAmount", title: "Wallet invalid amount", fallback: "❌ مبلغ درست نیست.\nمثال: 200000" }
  ,{ key: "wallet.chargeInstruction", title: "Wallet charge card instruction", fallback: "💳 برای شارژ {{amount}} کارت‌به‌کارت کنید:\n\n{{cardText}}" }
  ,{ key: "discount.prompt", title: "Discount code prompt", fallback: "🎟️ کد تخفیف را ارسال کنید." }
  ,{ key: "discount.orderMissing", title: "Discount order missing", fallback: "❌ سفارش پیدا نشد. دوباره خرید را شروع کنید." }
  ,{ key: "discount.applied", title: "Discount applied", fallback: "✅ کد تخفیف اعمال شد.\nمبلغ تخفیف: {{amount}}" }
  ,{ key: "services.notFound", title: "Service not found", fallback: "❌ سرویس پیدا نشد." }
  ,{ key: "renew.notFound", title: "Renew service not found", fallback: "❌ سرویس برای تمدید پیدا نشد." }
  ,{ key: "renew.select", title: "Renew select option", fallback: "🔄 حجم تمدید را انتخاب کنید.\nبه هر گزینه زمان هم اضافه می‌شود:" }
  ,{ key: "renew.optionNotFound", title: "Renew option not found", fallback: "❌ گزینه تمدید پیدا نشد." }
  ,{ key: "renew.created", title: "Renew order created", fallback: "✅ تمدید {{volume}} + {{days}} ثبت شد." }
  ,{ key: "referral.message", title: "Referral message", fallback: "🎁 لینک دعوت شما:\n{{link}}\n💰 پاداش هر دعوت: {{reward}}\n👛 موجودی شما: {{balance}}" }
  ,{ key: "content.empty", title: "No content", fallback: "📭 هنوز آیتمی ثبت نشده است." }
  ,{ key: "content.select", title: "Select content", fallback: "👇 یکی را انتخاب کنید:" }
  ,{ key: "content.notFound", title: "Content not found", fallback: "❌ آیتم پیدا نشد." }
  ,{ key: "checkout.discountButton", title: "Checkout discount button", fallback: "🎟️ کد تخفیف دارم" }
  ,{ key: "checkout.walletOffsetButton", title: "Checkout wallet payment button", fallback: "👛 پرداخت با کیف پول" }
  ,{ key: "checkout.cardButton", title: "Checkout card button", fallback: "💳 کارت‌به‌کارت" }
  ,{ key: "checkout.summary", title: "Checkout summary", fallback: "🧾 خلاصه سفارش\n\n💵 مبلغ سرویس: {{amount}}\n🎟️ تخفیف: {{discount}}\n👛 پرداخت از کیف پول: {{wallet}}\n✅ مبلغ نهایی: {{due}}\n\n💰 موجودی کیف پول: {{balance}}" }
] as const;
