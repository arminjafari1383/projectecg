import os

import pyotp
import qrcode
from dotenv import load_dotenv


# خواندن backend/.env
load_dotenv(".env")

secret = os.getenv("TELEGRAM_TOTP_SECRET", "").strip()

if not secret:
    raise RuntimeError(
        "TELEGRAM_TOTP_SECRET داخل فایل .env تنظیم نشده"
    )

totp = pyotp.TOTP(secret)

uri = totp.provisioning_uri(
    name="ProjectECG Admin",
    issuer_name="ProjectECG",
)

output = "projectecg_authenticator.png"

image = qrcode.make(uri)
image.save(output)

print("QR created successfully:")
print(output)

print("Current Authenticator code:")
print(totp.now())