# AI PolyNet — راهنمای نصب روی VPS

نسخهٔ **fix** شده (Referral / Invite).  
اجرا با Docker روی پورت **80**.

---

## پیش‌نیاز

روی سرور Ubuntu:

```bash
docker --version
docker-compose --version
# یا: docker compose version
```

اگر Docker ندارید:

```bash
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose
```

---

## ۱) آپلود پروژه

فایل zip را روی سرور باز کنید، مثلاً:

```bash
cd /root
unzip finalproject-fix.zip
# مسیر نهایی معمولاً یکی از این‌هاست:
cd /root/finalproject-fix/finalproject-main
# یا بعد از استخراج مستقیم:
# cd /root/finalproject-main
```

مطمئن شوید داخل پوشه این فایل‌ها هست:

- `docker-compose.yaml`
- `backend/`
- `frontend/`
- `nginx/`
- `ton-service/`

---

## ۲) ساخت فایل‌های env (اجباری)

### الف) Backend

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

حداقل این‌ها را پر کنید:

| متغیر | توضیح |
|--------|--------|
| `DJANGO_SECRET_KEY` | یک رشته تصادفی بلند |
| `DJANGO_ALLOWED_HOSTS` | دامنه + IP سرور |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://your-domain.com` |
| `CORS_ALLOWED_ORIGINS` | همان دامنه با https |
| `POSTGRES_HOST` | باید `db` باشد |
| `TON_PRIVATE_KEY` | کلید واقعی پروژه شما |
| `GRAM_MERCHANT_ADDRESS` | آدرس merchant |
| `ADMIN_2FA_SECRET` | secret ادمین ۲FA |

### ب) ریشه پروژه (برای TON treasury)

```bash
cp .env.example .env
nano .env
```

`TREASURY_MNEMONIC` را با ۲۴ کلمهٔ والت treasury خودتان پر کنید.

### ج) Frontend

```bash
cp frontend/.env.example frontend/.env
nano frontend/.env
```

```env
VITE_BOT_USERNAME=Aipolynetbot
VITE_MINI_APP_SHORT_NAME=app
```

نام bot و short name مینی‌اپ را مطابق BotFather تنظیم کنید.

---

## ۳) خاموش کردن نسخهٔ قبلی (اگر روی پورت 80 است)

```bash
# اگر پروژه قدیمی دارید:
cd /root/finalproject
docker-compose down
```

---

## ۴) Build و Run

```bash
cd /path/to/finalproject-main

docker-compose build --no-cache
docker-compose up -d
docker-compose ps
```

همه سرویس‌ها باید `Up` باشند:

- `django-backend`
- `nginx-server` (پورت 80)
- `postgres-db`
- `react-frontend`
- `ton-service`

تست سریع:

```bash
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/api/wallet/reward_status/
```

انتظار: `HTTP/1.1 200` برای صفحه اصلی.

---

## ۵) دامنه و Cloudflare

اگر دامنه پشت Cloudflare است:

1. DNS را به IP سرور بگیرید (Proxied یا DNS only)
2. بعد از deploy، اگر UI قدیمی دیدید → **Purge Cache**
3. Mini App تلگرام را کامل ببندید و دوباره باز کنید

---

## ۶) دستورات روزمره

```bash
# وضعیت
docker-compose ps

# لاگ بک‌اند
docker-compose logs backend --tail 100

# ریستارت
docker-compose restart

# خاموش
docker-compose down

# خاموش + پاک کردن دیتابیس (خطرناک)
docker-compose down -v
```

---

## ۷) تست Invite / Referral

1. از اکانت A لینک دعوت بسازید (صفحه Timer / Referrals)
2. با اکانت B لینک را باز کنید (`https://t.me/BOT/app?startapp=ref_CODE`)
3. اکانت A باید **1000 EPL Referral Bonus** بگیرد

پاداش فقط در UI (EPL) ثبت می‌شود؛ پیام تلگرام جداگانه برای referral ارسال نمی‌شود.

---

## ساختار پروژه

```
finalproject-main/
├── backend/          # Django API
├── frontend/         # React Mini App (Vite)
├── nginx/            # Reverse proxy
├── ton-service/      # سرویس TON
├── docker-compose.yaml
├── .env.example
├── README.md         # همین فایل
└── FIX-REPORT.md     # گزارش فنی باگ referral
```

---

## نکات امنیتی مهم

1. فایل `backend/.env` و `.env` ریشه را **هرگز** عمومی نکنید.
2. `DJANGO_DEBUG=false` در production بماند.
3. توصیهٔ فاز بعد: اعتبارسنجی HMAC برای Telegram `initData` و تأیید کامل تراکنش‌های بلاکچین.

---

## مشکل رایج

| علامت | کار |
|--------|-----|
| پورت 80 اشغال | نسخه قبلی را `docker-compose down` کنید |
| `POSTGRES_HOST` خالی | در `backend/.env` مقدار `db` بگذارید |
| UI قدیمی | Purge Cloudflare + بستن کامل Mini App |
| ton-service خطا | `TREASURY_MNEMONIC` در `.env` ریشه را چک کنید |
| API 502 | `docker-compose logs backend --tail 50` |

---

اگر بعد از `docker-compose up -d` سرویس‌ها Up شدند و `curl -I http://127.0.0.1/` برابر 200 بود، پروژه روی VPS آماده است.
