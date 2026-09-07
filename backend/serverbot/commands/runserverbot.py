import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import psutil
import pyotp
import requests
from dotenv import load_dotenv

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, close_old_connections


# =========================================================
# ENV
# =========================================================

load_dotenv(Path(settings.BASE_DIR) / ".env")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TOTP_SECRET = os.getenv("TELEGRAM_TOTP_SECRET", "").strip()

ALLOWED_IDS = {
    int(x.strip())
    for x in os.getenv("TELEGRAM_ADMIN_IDS", "").split(",")
    if x.strip().isdigit()
}

SESSION_MINUTES = int(
    os.getenv("TELEGRAM_AUTH_SESSION_MINUTES", "15")
)

POLL_TIMEOUT = int(
    os.getenv("TELEGRAM_POLL_TIMEOUT", "25")
)

MAX_BACKUP_MB = int(
    os.getenv("TELEGRAM_BACKUP_MAX_MB", "45")
)


if BOT_TOKEN:
    BASE_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"
else:
    BASE_URL = ""


# =========================================================
# AUTH SESSIONS
# =========================================================

# user_id -> expire timestamp
AUTH_SESSIONS = {}

# برای جلوگیری از استفاده دوباره از یک OTP
LAST_USED_TOTP_COUNTER = {}


# =========================================================
# TELEGRAM API
# =========================================================

def telegram_api(
    method,
    data=None,
    files=None,
    timeout=(10, 60),
):
    response = requests.post(
        f"{BASE_URL}/{method}",
        data=data or {},
        files=files,
        timeout=timeout,
    )

    response.raise_for_status()

    result = response.json()

    if not result.get("ok"):
        raise RuntimeError(
            result.get(
                "description",
                "Telegram API error"
            )
        )

    return result.get("result")


def send_message(chat_id, text):
    telegram_api(
        "sendMessage",
        data={
            "chat_id": chat_id,
            "text": text[:4096],
        },
    )


# =========================================================
# AUTHENTICATION
# =========================================================

def telegram_user_allowed(user_id):
    return user_id in ALLOWED_IDS


def session_authenticated(user_id):
    expires = AUTH_SESSIONS.get(user_id)

    if not expires:
        return False

    if time.time() >= expires:
        AUTH_SESSIONS.pop(user_id, None)
        return False

    return True


def verify_totp(user_id, code, prevent_reuse=True):
    if not TOTP_SECRET:
        return False

    if not code:
        return False

    code = code.strip()

    if not code.isdigit():
        return False

    if len(code) != 6:
        return False

    totp = pyotp.TOTP(TOTP_SECRET)

    now = int(time.time())

    # valid_window=1 را خودمان کنترل می‌کنیم
    # یعنی یک بازه قبل، فعلی و یک بازه بعد
    for offset in (-1, 0, 1):
        timestamp = now + (offset * 30)

        expected = totp.at(timestamp)

        if expected == code:
            counter = timestamp // 30

            if prevent_reuse:
                previous_counter = LAST_USED_TOTP_COUNTER.get(user_id)

                if previous_counter == counter:
                    return False

                LAST_USED_TOTP_COUNTER[user_id] = counter

            return True

    return False


def login_user(user_id, code):
    if not telegram_user_allowed(user_id):
        return False

    if not verify_totp(user_id, code):
        return False

    AUTH_SESSIONS[user_id] = (
        time.time()
        + SESSION_MINUTES * 60
    )

    return True


def logout_user(user_id):
    AUTH_SESSIONS.pop(user_id, None)


# =========================================================
# HELPERS
# =========================================================

def human_bytes(value):
    value = float(value)

    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if value < 1024:
            return f"{value:.1f} {unit}"

        value /= 1024

    return f"{value:.1f} PB"


def human_uptime(seconds):
    seconds = int(seconds)

    days = seconds // 86400
    seconds %= 86400

    hours = seconds // 3600
    seconds %= 3600

    minutes = seconds // 60

    result = []

    if days:
        result.append(f"{days}d")

    if hours:
        result.append(f"{hours}h")

    result.append(f"{minutes}m")

    return " ".join(result)


def model_count(model_name):
    try:
        model = apps.get_model(
            "core",
            model_name
        )

        return model.objects.count()

    except Exception:
        return "?"


# =========================================================
# SERVER STATUS
# =========================================================

def get_server_status():
    close_old_connections()

    # -----------------------------
    # CPU
    # -----------------------------

    try:
        cpu_percent = psutil.cpu_percent(
            interval=0.3
        )
    except Exception:
        cpu_percent = "?"

    # -----------------------------
    # RAM
    # -----------------------------

    try:
        ram = psutil.virtual_memory()

        ram_text = (
            f"{ram.percent}% "
            f"({human_bytes(ram.used)} / "
            f"{human_bytes(ram.total)})"
        )

    except Exception:
        ram_text = "?"

    # -----------------------------
    # DISK
    # -----------------------------

    try:
        disk = psutil.disk_usage("/")

        disk_text = (
            f"{disk.percent}% "
            f"({human_bytes(disk.used)} / "
            f"{human_bytes(disk.total)})"
        )

    except Exception:
        disk_text = "?"

    # -----------------------------
    # UPTIME
    # -----------------------------

    try:
        uptime = human_uptime(
            time.time() - psutil.boot_time()
        )

    except Exception:
        uptime = "?"

    # -----------------------------
    # DATABASE
    # -----------------------------

    db_status = "❌ Disconnected"
    db_size = "?"

    try:
        connection.ensure_connection()

        db_status = "✅ Connected"

        if connection.vendor == "postgresql":

            with connection.cursor() as cursor:

                cursor.execute(
                    """
                    SELECT pg_size_pretty(
                        pg_database_size(
                            current_database()
                        )
                    )
                    """
                )

                row = cursor.fetchone()

                if row:
                    db_size = row[0]

    except Exception as exc:
        db_status = (
            f"❌ {type(exc).__name__}"
        )

    # -----------------------------
    # DJANGO CHECK
    # -----------------------------

    django_status = "✅ Running"

    try:
        from django.core.checks import run_checks

        errors = run_checks()

        if errors:
            django_status = (
                f"⚠️ {len(errors)} check warning(s)"
            )

    except Exception:
        django_status = "❌ Check failed"

    return (
        "🖥 ProjectECG Server Status\n\n"

        f"Host: {socket.gethostname()}\n"
        f"Uptime: {uptime}\n\n"

        f"CPU: {cpu_percent}%\n"
        f"RAM: {ram_text}\n"
        f"Disk: {disk_text}\n\n"

        f"Django: {django_status}\n"
        f"Database: {db_status}\n"
        f"DB Engine: {connection.vendor}\n"
        f"DB Name: "
        f"{connection.settings_dict.get('NAME')}\n"
        f"DB Host: "
        f"{connection.settings_dict.get('HOST')}\n"
        f"DB Size: {db_size}\n\n"

        f"👤 Users: "
        f"{model_count('AppUser')}\n"

        f"💰 Asset Balances: "
        f"{model_count('AssetBalance')}\n"

        f"👛 Wallets: "
        f"{model_count('Wallet')}\n"

        f"💸 Withdraw Requests: "
        f"{model_count('WithdrawRequest')}"
    )


# =========================================================
# DATABASE BACKUP
# =========================================================

def create_database_backup():
    close_old_connections()

    db = connection.settings_dict

    db_name = str(db.get("NAME") or "")
    db_user = str(db.get("USER") or "")
    db_password = str(db.get("PASSWORD") or "")
    db_host = str(db.get("HOST") or "db")
    db_port = str(db.get("PORT") or "5432")

    if connection.vendor != "postgresql":
        raise RuntimeError(
            "Database is not PostgreSQL"
        )

    timestamp = time.strftime(
        "%Y%m%d_%H%M%S"
    )

    backup_path = (
        Path(tempfile.gettempdir())
        / f"projectecg_{timestamp}.dump"
    )

    env = os.environ.copy()

    env["PGPASSWORD"] = db_password

    command = [
        "pg_dump",
        "-h",
        db_host,
        "-p",
        db_port,
        "-U",
        db_user,
        "-d",
        db_name,
        "-Fc",
        "-f",
        str(backup_path),
    ]

    result = subprocess.run(
        command,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        raise RuntimeError(
            "pg_dump failed:\n"
            + result.stderr[-2000:]
        )

    if not backup_path.exists():
        raise RuntimeError(
            "Backup file was not created"
        )

    if backup_path.stat().st_size <= 0:
        raise RuntimeError(
            "Backup file is empty"
        )

    return backup_path


def send_backup(chat_id):
    backup_path = None

    try:
        send_message(
            chat_id,
            "⏳ Creating fresh PostgreSQL backup..."
        )

        backup_path = create_database_backup()

        size_bytes = (
            backup_path.stat().st_size
        )

        size_mb = (
            size_bytes / 1024 / 1024
        )

        if size_mb > MAX_BACKUP_MB:
            send_message(
                chat_id,
                (
                    "❌ Backup was created but "
                    "is too large to send.\n\n"
                    f"Size: {size_mb:.2f} MB\n"
                    f"Limit: {MAX_BACKUP_MB} MB"
                )
            )

            return

        with open(
            backup_path,
            "rb"
        ) as backup_file:

            telegram_api(
                "sendDocument",
                data={
                    "chat_id": chat_id,
                    "caption": (
                        "✅ ProjectECG Database Backup\n\n"
                        f"Database: "
                        f"{connection.settings_dict.get('NAME')}\n"
                        f"Size: {size_mb:.2f} MB\n"
                        f"Created: "
                        f"{time.strftime('%Y-%m-%d %H:%M:%S')}"
                    ),
                },
                files={
                    "document": (
                        backup_path.name,
                        backup_file,
                        "application/octet-stream",
                    )
                },
                timeout=(15, 180),
            )

        send_message(
            chat_id,
            "✅ Backup sent successfully."
        )

    finally:
        if backup_path:
            try:
                backup_path.unlink(
                    missing_ok=True
                )
            except Exception:
                pass


# =========================================================
# DJANGO COMMAND
# =========================================================

class Command(BaseCommand):
    help = (
        "Run ProjectECG secure Telegram "
        "administration bot"
    )

    def handle(
        self,
        *args,
        **options,
    ):

        # -------------------------
        # Startup validation
        # -------------------------

        if not BOT_TOKEN:
            raise RuntimeError(
                "TELEGRAM_BOT_TOKEN "
                "is not configured"
            )

        if not TOTP_SECRET:
            raise RuntimeError(
                "TELEGRAM_TOTP_SECRET "
                "is not configured"
            )

        if not ALLOWED_IDS:
            raise RuntimeError(
                "TELEGRAM_ADMIN_IDS "
                "is empty"
            )

        # تست معتبر بودن secret
        try:
            pyotp.TOTP(
                TOTP_SECRET
            ).now()

        except Exception as exc:
            raise RuntimeError(
                "TELEGRAM_TOTP_SECRET "
                "is not valid Base32"
            ) from exc

        self.stdout.write(
            self.style.SUCCESS(
                "Secure Telegram Admin Bot started"
            )
        )

        offset = None

        # =================================================
        # POLLING LOOP
        # =================================================

        while True:

            try:
                close_old_connections()

                params = {
                    "timeout": POLL_TIMEOUT
                }

                if offset is not None:
                    params["offset"] = offset

                response = requests.get(
                    f"{BASE_URL}/getUpdates",
                    params=params,
                    timeout=POLL_TIMEOUT + 10,
                )

                response.raise_for_status()

                response_data = response.json()

                if not response_data.get("ok"):
                    raise RuntimeError(
                        response_data.get(
                            "description",
                            "Telegram error"
                        )
                    )

                updates = response_data.get(
                    "result",
                    []
                )

                # =========================================
                # PROCESS MESSAGES
                # =========================================

                for update in updates:

                    offset = (
                        update["update_id"]
                        + 1
                    )

                    message = update.get(
                        "message"
                    )

                    if not message:
                        continue

                    chat = message.get(
                        "chat",
                        {}
                    )

                    user = message.get(
                        "from",
                        {}
                    )

                    chat_id = chat.get(
                        "id"
                    )

                    user_id = user.get(
                        "id"
                    )

                    chat_type = chat.get(
                        "type"
                    )

                    text = (
                        message
                        .get(
                            "text",
                            ""
                        )
                        .strip()
                    )

                    if not chat_id:
                        continue

                    if not user_id:
                        continue

                    # =====================================
                    # /id
                    # =====================================

                    if text.startswith("/id"):

                        send_message(
                            chat_id,
                            (
                                "🆔 Telegram User ID:\n"
                                f"{user_id}"
                            )
                        )

                        continue

                    # =====================================
                    # USER ALLOWLIST
                    # =====================================

                    if not telegram_user_allowed(
                        user_id
                    ):

                        send_message(
                            chat_id,
                            "⛔ Access denied."
                        )

                        continue

                    # =====================================
                    # PRIVATE CHAT ONLY
                    # =====================================

                    if chat_type != "private":

                        send_message(
                            chat_id,
                            (
                                "⛔ Admin commands are "
                                "only available in "
                                "private chat."
                            )
                        )

                        continue

                    # =====================================
                    # /start
                    # =====================================

                    if text.startswith("/start"):

                        send_message(
                            chat_id,
                            (
                                "🔐 ProjectECG Admin Bot\n\n"

                                "Step 1:\n"
                                "/login 123456\n\n"

                                "Commands after login:\n"
                                "/status\n"
                                "/logout\n\n"

                                "Database backup requires "
                                "a fresh Authenticator code:\n"
                                "/backup 123456"
                            )
                        )

                        continue

                    # =====================================
                    # /login
                    # =====================================

                    if text.startswith("/login"):

                        parts = text.split()

                        if len(parts) != 2:

                            send_message(
                                chat_id,
                                (
                                    "Usage:\n"
                                    "/login 123456"
                                )
                            )

                            continue

                        code = parts[1]

                        if login_user(
                            user_id,
                            code
                        ):

                            send_message(
                                chat_id,
                                (
                                    "✅ Authentication successful.\n\n"
                                    f"Session expires in "
                                    f"{SESSION_MINUTES} minutes."
                                )
                            )

                        else:

                            send_message(
                                chat_id,
                                (
                                    "❌ Invalid, expired, "
                                    "or already-used "
                                    "Authenticator code."
                                )
                            )

                        continue

                    # =====================================
                    # /logout
                    # =====================================

                    if text.startswith("/logout"):

                        logout_user(
                            user_id
                        )

                        send_message(
                            chat_id,
                            "🔒 Session closed."
                        )

                        continue

                    # =====================================
                    # /backup
                    #
                    # intentionally requires a FRESH TOTP
                    # every time
                    # =====================================

                    if text.startswith("/backup"):

                        parts = text.split()

                        if len(parts) != 2:

                            send_message(
                                chat_id,
                                (
                                    "🔐 Fresh Authenticator "
                                    "code required.\n\n"
                                    "Usage:\n"
                                    "/backup 123456"
                                )
                            )

                            continue

                        code = parts[1]

                        if not verify_totp(
                            user_id,
                            code,
                            prevent_reuse=True,
                        ):

                            send_message(
                                chat_id,
                                (
                                    "❌ Invalid, expired, "
                                    "or already-used "
                                    "Authenticator code."
                                )
                            )

                            continue

                        try:
                            send_backup(
                                chat_id
                            )

                        except Exception as exc:

                            send_message(
                                chat_id,
                                (
                                    "❌ Backup failed:\n"
                                    f"{str(exc)[:3000]}"
                                )
                            )

                        continue

                    # =====================================
                    # EVERYTHING BELOW NEEDS SESSION
                    # =====================================

                    if not session_authenticated(
                        user_id
                    ):

                        send_message(
                            chat_id,
                            (
                                "🔐 Authentication required.\n\n"
                                "Open Google Authenticator "
                                "and send:\n"
                                "/login 123456"
                            )
                        )

                        continue

                    # =====================================
                    # /status
                    # =====================================

                    if text.startswith("/status"):

                        try:
                            status = (
                                get_server_status()
                            )

                            send_message(
                                chat_id,
                                status
                            )

                        except Exception as exc:

                            send_message(
                                chat_id,
                                (
                                    "❌ Status failed:\n"
                                    f"{str(exc)[:3000]}"
                                )
                            )

                        continue

                    # =====================================
                    # UNKNOWN
                    # =====================================

                    send_message(
                        chat_id,
                        (
                            "Unknown command.\n\n"
                            "/status\n"
                            "/backup 123456\n"
                            "/logout"
                        )
                    )

            except KeyboardInterrupt:
                self.stdout.write(
                    "Bot stopped."
                )

                break

            except Exception as exc:

                self.stderr.write(
                    f"Bot error: {exc}"
                )

                time.sleep(5)