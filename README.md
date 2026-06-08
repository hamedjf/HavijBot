# HavijBot

Telegram bot baraye modiriate client haye VPN rooye Remnawave.

## Features

- Forced join check baraye channel asli.
- Kharid service ba plan/category.
- Pardakht card-to-card ba receipt va approval admin.
- Kife pool ledger-based.
- Referral link ba wallet reward baraye inviter.
- Discount code va partial wallet payment dar checkout.
- Provision automatic user dar Remnawave.
- Daryaft subscription link, QR, usage va expiry.
- Tamdid service az “Service haye man” ba add volume + add days.
- Admin-managed amoozesh/narm-afzar content.
- Remnawave client ba least-privilege app boundary: user create/read/subscription/usage va extend traffic/expiry.

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Webhook path:

```text
/telegram/webhook
```

## Admin formats

Category:

```text
title | slug | remnawave_squad_uuid
```

Plan:

```text
category_slug | title | volume_gb | duration_days | price_toman
```

Discount:

```text
CODE | percent_off | amount_off_toman | max_uses | expire_yyyy-mm-dd
```

Example:

```text
OFF20 | 20 | 0 | 100 | 2026-12-31
```

Content:

```text
title | body-or-link
```

Photo/document content caption:

```text
title | body
```

## Renewal options

Tamdid options az env miad:

```text
RENEWAL_OPTIONS=20:30:100000,30:30:140000,50:30:220000
```

## Referral

User az menu `Link davat` link migire. Agar user jadid bot ro ba payload `ref_CODE` start kone, reward be wallet referrer ezafe mishe. Mablagh reward az env miad:

```text
REFERRAL_REWARD_TOMAN=30000
```

Checkout support mikone:

- discount code
- full wallet payment
- partial wallet offset + card-to-card remainder

Format har item:

```text
volume_gb:duration_days:price_toman
```

## Security boundary

Bot hich endpoint raw ya generic passthrough baraye Remnawave nadare. Class `RemnawaveClient` faghat in method ha ro expose mikone:

- `createUser`
- `extendUserTrafficAndExpiry`
- `getUser`
- `getUserUsage`
- `getSubscriptionUrl`
- `getSubscriptionQr`

Token Remnawave faghat az env load mishe va dar DB/admin UI/log full token zakhire nemishe. Agar Remnawave permission-scoped token support kone, token ro faghat baraye user create/read/subscription/usage mahdood kon.
