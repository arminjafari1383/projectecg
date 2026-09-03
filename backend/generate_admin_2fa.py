import pyotp
import qrcode
from urllib.parse import quote

# =========================
# تنظیمات
# =========================

ISSUER = "AI POLIFY"
ACCOUNT_NAME = "admin"

# =========================
# ساخت Secret جدید
# =========================

secret = pyotp.random_base32()

print("=" * 60)
print("ADMIN 2FA SECRET")
print("=" * 60)
print()
print(f"ADMIN_2FA_SECRET={secret}")
print()

# =========================
# ساخت آدرس Google Authenticator
# =========================

totp = pyotp.TOTP(secret)

otpauth_uri = totp.provisioning_uri(
    name=ACCOUNT_NAME,
    issuer_name=ISSUER,
)

print("OTP AUTH URI:")
print(otpauth_uri)
print()

# =========================
# ساخت QR Code
# =========================

qr = qrcode.make(otpauth_uri)

output_file = "admin_google_authenticator_qr.png"

qr.save(output_file)

print(f"QR saved: {output_file}")
print()
print("=" * 60)

# =========================
# تست کد فعلی
# =========================

current_code = totp.now()

print(f"Current OTP: {current_code}")
print("=" * 60)