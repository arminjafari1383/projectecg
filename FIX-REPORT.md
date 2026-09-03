# گزارش فنی — رفع باگ Invite / Referral

**پروژه:** AI PolyNet (Telegram Mini App)  
**وضعیت:** رفع شده و تست‌شده ✅

---

## خلاصه

سیستم دعوت کار نمی‌کرد: کاربر با لینک invite وارد می‌شد ولی پاداش 1000 EPL به inviter داده نمی‌شد.

علت یک باگ تکی نبود؛ چند مشکل هم‌زمان در Frontend و Backend باعث fail بی‌صدا می‌شد.

---

## علت ریشه‌ای

1. **Frontend** فقط `?startapp=` از URL را می‌خواند؛ در Mini App مقدار واقعی در `Telegram.WebApp.initDataUnsafe.start_param` است.
2. کلیدهای localStorage پراکنده بود (`inviter_code` / `referral_code` / `pending_referral`).
3. مقدار خام `ref_XXXX` بدون حذف prefix ذخیره می‌شد.
4. Backend کد را normalize نمی‌کرد و lookup حساس به حروف بزرگ/کوچک بود.
5. مسیر API اشتباه در Timer: `/api/wallet/referral_count/` به‌جای مسیر درست referrals.
6. صفحه Referrals هویت Telegram را درست نمی‌خواند.

---

## راه‌حل

### Backend
- `core/referral_utils.py` → `normalize_inviter_code()`
- `apply_referral()` → پاسخ `{ok, reason, message}` + lookup بدون حساسیت به case
- APIها → فیلدهای `referral_applied` / `referral_error`
- تست‌های referral در `core/tests.py`

### Frontend
- `utils/referral.js` یکپارچه (اولویت: Telegram start_param → URL → hash → storage)
- `utils/userStorage.js` برای هویت و داده کاربر
- اصلاح Timer / Wallet / Referrals / useTgStartRedirect
- `ErrorBoundary` برای جلوگیری از crash کل اپ
- `api.js` با base URL نسبی نسبت به دامنه

---

## جریان درست بعد از fix

```
لینک: https://t.me/BOT/app?startapp=ref_CODE
  → capture + normalize
  → API اول با inviter_code
  → apply_referral
  → +1000 EPL برای inviter در UI
```

نکته: پیام Telegram برای referral در این نسخه پیاده‌سازی نشده؛ پاداش فقط EPL در اپ است.

---

## توصیه‌های فاز بعد (امنیت)

| اولویت | موضوع |
|--------|--------|
| P0 | HMAC verification برای Telegram initData |
| P0 | تأیید کامل تراکنش blockchain قبل از credit |
| P1 | Auth قوی‌تر روی wallet / withdraw |

---

## درس فنی

- در Telegram Mini App منبع deep-link معمولاً `start_param` است، نه query string مرورگر.
- referral state باید Single Source of Truth داشته باشد.
- Backend باید ورودی را normalize کند و خطا را واضح برگرداند، نه silent fail.
