# backend/core/views.py

from django.conf import settings
import time
import json
import logging
import uuid
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from decimal import Decimal, ROUND_UP
from datetime import timedelta
from django.utils import timezone
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .services import (
    get_or_create_user, 
    apply_referral, 
    register_purchase, 
    ecg_to_ton,
    fetch_ton_usd_rate,
    ECG_PER_USD,
    register_purchase_usdt,
    register_purchase_bnb,
    reconcile_existing_referral_join_rewards,
    release_matured_purchase_profits,
)
from .referral_utils import normalize_inviter_code
from .models import (
    AppUser, Wallet, AssetBalance, Ledger, Purchase, 
    WithdrawRequest, ReferralLevel,
    PurchaseUSDT, PurchaseBNB
)
from .serializers import WalletSerializer, PurchaseSerializer, UserSerializer
from django.conf import settings
from django.db import transaction, IntegrityError
from django.db.models import Sum
from django.db.utils import OperationalError
from django.core import signing
import os
import requests
import re
import base64
import hashlib
import hmac
from django.conf import settings
import struct

# =======================
# تنظیمات لاگینگ
# =======================
logger = logging.getLogger(__name__)

# TON service config
TON_SERVICE_URL = os.getenv(
    "TON_SERVICE_URL",
    "http://tonservice:3001"
)

service_url = TON_SERVICE_URL


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def _ledger_total(user, ledger_type, asset="ECG"):
    """
    محاسبه مجموع یک نوع خاص از Ledger برای یک کاربر و دارایی مشخص.
    
    Args:
        user: شیء AppUser
        ledger_type: نوع Ledger (مانند DIRECT_REFERRAL_BONUS, SELF_PROFIT_UNLOCK و ...)
        asset: نام دارایی (ECG, USDT, EPL) - پیش‌فرض ECG
    
    Returns:
        Decimal: مجموع مقادیر
    """
    zero = Decimal("0")
    asset = str(asset).upper()
    total = zero

    for row in user.ledgers.filter(typ=ledger_type):
        meta = dict(row.meta or {})
        row_asset = str(
            meta.get("asset")
            or meta.get("profit_asset")
            or meta.get("source_asset")
            or meta.get("output_asset")
            or "ECG"
        ).upper()

        if row_asset == asset:
            total += Decimal(str(row.amount or 0))

    return total


def _ledger_total_for_asset(user, ledger_type, asset="ECG"):
    """
    نسخه جایگزین با نام واضح‌تر - دقیقاً همان کار را انجام می‌دهد.
    """
    return _ledger_total(user, ledger_type, asset)


def _normalize_withdraw_bucket(value):
    """
    Normalize frontend/legacy bucket names to SELF / REFERRAL / ALL.
    """
    bucket = str(value or "").strip().upper()

    if bucket in {"SELF", "ECG_SELF", "USDT_SELF"}:
        return "SELF"

    if bucket in {"REFERRAL", "ECG_REFERRAL", "USDT_REFERRAL"}:
        return "REFERRAL"

    return "ALL"


def _withdraw_reservation_breakdown(user, asset="ECG"):
    """
    Return withdrawal reservations for one source asset.

    New withdrawals carry withdraw_bucket=SELF/REFERRAL. Older USDT
    withdrawals did not store that field, so they are tracked as LEGACY.
    Only rows that actually deducted AssetBalance at request time count.
    """
    zero = Decimal("0")
    asset = str(asset or "ECG").upper()

    totals = {
        "SELF": zero,
        "REFERRAL": zero,
        "LEGACY": zero,
    }

    for row in user.ledgers.filter(typ="WITHDRAW"):
        meta = dict(row.meta or {})

        source_asset = str(
            meta.get("source_asset") or "ECG"
        ).upper()

        if source_asset != asset:
            continue

        row_status = str(
            meta.get("status") or ""
        ).upper()

        if row_status in {"FAILED", "CANCELLED", "CANCELED", "REJECTED"}:
            continue

        if not meta.get("balance_deducted_at_request"):
            continue

        amount = abs(Decimal(str(row.amount or 0)))
        bucket = _normalize_withdraw_bucket(
            meta.get("withdraw_bucket")
        )

        if bucket in {"SELF", "REFERRAL"}:
            totals[bucket] += amount
        else:
            totals["LEGACY"] += amount

    return totals


def _profit_bucket_snapshot(user, asset="ECG", authoritative_available=None):
    """
    Build the current SELF/REFERRAL profit balances from accounting data.

    1) Start from gross earning ledgers.
    2) Subtract bucket-tagged withdrawals.
    3) Subtract legacy unbucketed withdrawals (old USDT endpoint).
       Because the old endpoint discarded the requested bucket, exact historic
       attribution is impossible. Referral is consumed first because it is the
       instantly-withdrawable bucket; SELF is consumed only after referral.
    4) Cap the result to AssetBalance.available, which is the hard accounting
       source of truth and was already debited at request time.
    """
    zero = Decimal("0")
    asset = str(asset or "ECG").upper()

    gross_self = _ledger_total(
        user,
        "SELF_PROFIT_UNLOCK",
        asset,
    )
    gross_referral = (
        _ledger_total(user, "DIRECT_REFERRAL_BONUS", asset)
        + _ledger_total(user, "INDIRECT_REFERRAL_BONUS", asset)
    )

    reserved = _withdraw_reservation_breakdown(user, asset)

    self_available = max(
        zero,
        gross_self - reserved["SELF"],
    )
    referral_available = max(
        zero,
        gross_referral - reserved["REFERRAL"],
    )

    # Legacy USDT withdrawals were deducted from AssetBalance but the old
    # backend did not persist SELF/REFERRAL. Consume referral first.
    legacy_remaining = reserved["LEGACY"]

    take = min(referral_available, legacy_remaining)
    referral_available -= take
    legacy_remaining -= take

    take = min(self_available, legacy_remaining)
    self_available -= take
    legacy_remaining -= take

    # AssetBalance.available is authoritative. If historical rows or migrations
    # leave ledger-derived buckets above that hard balance, trim the difference
    # rather than showing money that cannot actually be withdrawn.
    if authoritative_available is not None:
        hard_available = max(
            zero,
            Decimal(str(authoritative_available or 0)),
        )

        overflow = max(
            zero,
            (self_available + referral_available) - hard_available,
        )

        take = min(referral_available, overflow)
        referral_available -= take
        overflow -= take

        take = min(self_available, overflow)
        self_available -= take
        overflow -= take

    return {
        "SELF": max(zero, self_available),
        "REFERRAL": max(zero, referral_available),
        "GROSS_SELF": max(zero, gross_self),
        "GROSS_REFERRAL": max(zero, gross_referral),
        "RESERVED_SELF": reserved["SELF"],
        "RESERVED_REFERRAL": reserved["REFERRAL"],
        "RESERVED_LEGACY": reserved["LEGACY"],
    }


def _reconcile_profit_asset_available(user, asset="ECG"):
    """
    Rebuild AssetBalance.available from the accounting ledgers.

    This is an idempotent legacy backfill + ongoing consistency check:
      available = unlocked SELF profit + referral profit - reserved withdrawals

    Older deployments could write referral-profit Ledger rows / ReferralLevel
    profit snapshots without crediting AssetBalance.available.  Setting the
    balance to the ledger-derived net amount (instead of adding a delta) makes
    the repair safe to run repeatedly and also respects historical withdrawals.

    ECG/USDT AssetBalance.available is used by this project only for unlocked
    profit; locked principal/profit remains in AssetBalance.locked.
    """
    asset = str(asset or "ECG").upper()
    if asset not in {"ECG", "USDT"}:
        return None

    snapshot = _profit_bucket_snapshot(
        user,
        asset,
        authoritative_available=None,
    )

    expected_available = max(
        Decimal("0"),
        snapshot["SELF"] + snapshot["REFERRAL"],
    )

    with transaction.atomic():
        balance, _ = (
            AssetBalance.objects
            .select_for_update()
            .get_or_create(user=user, asset=asset)
        )

        current_available = Decimal(str(balance.available or 0))

        if current_available != expected_available:
            logger.warning(
                "[PROFIT_BALANCE_RECONCILE] user=%s asset=%s current=%s expected=%s "
                "gross_self=%s gross_referral=%s reserved_self=%s "
                "reserved_referral=%s reserved_legacy=%s",
                user.id,
                asset,
                current_available,
                expected_available,
                snapshot["GROSS_SELF"],
                snapshot["GROSS_REFERRAL"],
                snapshot["RESERVED_SELF"],
                snapshot["RESERVED_REFERRAL"],
                snapshot["RESERVED_LEGACY"],
            )

            balance.available = expected_available
            balance.save(update_fields=["available"])

    return balance

def _withdrawn_total_for_bucket(user, asset="ECG", bucket="SELF"):
    """Backward-compatible helper used by older code paths."""
    bucket = _normalize_withdraw_bucket(bucket)
    if bucket not in {"SELF", "REFERRAL"}:
        return Decimal("0")
    return _withdraw_reservation_breakdown(user, asset)[bucket]


def _available_profit_bucket(user, asset="ECG", bucket="SELF", authoritative_available=None):
    """Return one current profit bucket."""
    bucket = _normalize_withdraw_bucket(bucket)
    if bucket not in {"SELF", "REFERRAL"}:
        return Decimal("0")
    return _profit_bucket_snapshot(
        user,
        asset,
        authoritative_available=authoritative_available,
    )[bucket]


# ============================================================
# TON / GRAM on-chain confirmation helpers
# ============================================================

TONCENTER_API_KEY = os.getenv(
    "TONCENTER_API_KEY",
    "",
).strip()

TONCENTER_MAINNET_URL = os.getenv(
    "TONCENTER_MAINNET_URL",
    "https://toncenter.com",
).rstrip("/")

TONCENTER_TESTNET_URL = os.getenv(
    "TONCENTER_TESTNET_URL",
    "https://testnet.toncenter.com",
).rstrip("/")


def _toncenter_base_url(network: str) -> str:
    """
    TON Connect network id:
      -239 = mainnet
      -3   = testnet
    """
    return (
        TONCENTER_TESTNET_URL
        if str(network) == "-3"
        else TONCENTER_MAINNET_URL
    )


def _toncenter_headers() -> dict:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    if TONCENTER_API_KEY:
        headers["X-API-Key"] = TONCENTER_API_KEY

    return headers


def _ton_address_to_raw(address: str) -> str:
    """
    Convert a TON raw or TEP-2 user-friendly address to canonical raw form:
        workchain:64_hex_chars

    No external Python TON package is required.
    """
    value = str(address or "").strip()

    if not value:
        raise ValueError("Empty TON address")

    raw_match = re.fullmatch(
        r"(-?\d+):([0-9a-fA-F]{64})",
        value,
    )

    if raw_match:
        return (
            f"{int(raw_match.group(1))}:"
            f"{raw_match.group(2).lower()}"
        )

    # User-friendly address is 36 bytes:
    # tag(1) + workchain(1) + account_id(32) + crc16(2)
    normalized = (
        value
        .replace("-", "+")
        .replace("_", "/")
    )

    normalized += "=" * ((-len(normalized)) % 4)

    try:
        decoded = base64.b64decode(
            normalized,
            validate=True,
        )
    except Exception as exc:
        raise ValueError(
            "Invalid TON user-friendly address"
        ) from exc

    if len(decoded) != 36:
        raise ValueError(
            "Invalid TON user-friendly address length"
        )

    workchain = int.from_bytes(
        decoded[1:2],
        byteorder="big",
        signed=True,
    )

    account_id = decoded[2:34].hex()

    return f"{workchain}:{account_id}"


def _get_external_message_hash(
    boc: str,
    network: str,
) -> str:
    """
    TON Connect returns a signed external-message BOC.
    TON Center's sendBocReturnHash returns the message hash that can be
    used to locate the real on-chain wallet transaction.

    Re-broadcasting the same signed external message is safe for lookup:
    it is the same message, not a newly signed payment.
    """
    base_url = _toncenter_base_url(network)

    response = requests.post(
        f"{base_url}/api/v2/sendBocReturnHash",
        headers=_toncenter_headers(),
        json={"boc": boc},
        timeout=20,
    )

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(
            "TON Center returned a non-JSON response while resolving BOC"
        ) from exc

    if (
        response.status_code != 200
        or not data.get("ok")
    ):
        raise RuntimeError(
            data.get("error")
            or (
                "TON Center could not resolve the BOC "
                f"(HTTP {response.status_code})"
            )
        )

    result = data.get("result") or {}

    message_hash = str(
        result.get("hash_norm")
        or result.get("hash")
        or ""
    ).strip()

    if not message_hash:
        raise RuntimeError(
            "TON Center did not return a message hash"
        )

    return message_hash


def _find_verified_gram_payment(
    *,
    message_hash: str,
    wallet_address: str,
    gram_address: str,
    network: str,
):
    """
    Find the wallet transaction created by the external message and verify
    that it produced a real outgoing GRAM payment to our configured merchant.

    Returns:
        None                      -> not indexed/confirmed yet
        {tx_hash, gram_nano,...} -> verified payment
    """
    base_url = _toncenter_base_url(network)

    response = requests.get(
        f"{base_url}/api/v3/transactionsByMessage",
        headers=_toncenter_headers(),
        params={
            "msg_hash": message_hash,
            "direction": "in",
            "limit": 10,
        },
        timeout=20,
    )

    if response.status_code == 429:
        logger.warning(
            "TON Center rate limit reached during confirmation; retrying later."
        )
        return None

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError(
            "TON Center returned a non-JSON transaction response"
        ) from exc

    if response.status_code != 200:
        raise RuntimeError(
            data.get("error")
            or (
                "TON Center transaction lookup failed "
                f"(HTTP {response.status_code})"
            )
        )

    transactions = data.get("transactions") or []

    if not transactions:
        return None

    expected_sender_raw = _ton_address_to_raw(
        wallet_address
    )

    expected_merchant_raw = _ton_address_to_raw(
        gram_address
    )

    for tx in transactions:
        # Indexed API may expose emulated entries. Never accept them as payment.
        if tx.get("emulated") is True:
            continue

        try:
            tx_account_raw = _ton_address_to_raw(
                tx.get("account")
            )
        except ValueError:
            continue

        # The external message must have executed on the connected user's wallet.
        if tx_account_raw != expected_sender_raw:
            continue

        description = tx.get("description") or {}

        if description.get("aborted") is True:
            continue

        tx_hash = str(
            tx.get("hash") or ""
        ).strip()

        if not tx_hash:
            continue

        matching_messages = []

        for message in tx.get("out_msgs") or []:
            destination = message.get("destination")

            if not destination:
                continue

            try:
                destination_raw = _ton_address_to_raw(
                    destination
                )
            except ValueError:
                continue

            if destination_raw != expected_merchant_raw:
                continue

            # A bounced outgoing transfer must not be credited.
            if message.get("bounced") is True:
                continue

            try:
                value_nano = int(
                    str(message.get("value") or "0")
                )
            except (TypeError, ValueError):
                continue

            if value_nano <= 0:
                continue

            matching_messages.append(
                {
                    "hash": str(
                        message.get("hash") or ""
                    ),
                    "value_nano": value_nano,
                    "destination": destination,
                }
            )

        if not matching_messages:
            continue

        # create_ton_transaction creates one merchant message, but summing keeps
        # verification correct even if a wallet produces multiple matching msgs.
        total_gram_nano = sum(
            item["value_nano"]
            for item in matching_messages
        )

        return {
            "tx_hash": tx_hash,
            "wallet_transaction": tx,
            "gram_nano": total_gram_nano,
            "matching_messages": matching_messages,
        }

    return None


@api_view(["POST"])
def connect_wallet(request):
    """
    Bind a TON wallet to the Telegram account.

    Telegram ID is the canonical application identity.
    The wallet is only a payment/withdrawal capability attached to that account.

    Important behaviour:
    - A Telegram-only user may already exist with wallet_address="telegram:<id>".
    - Connecting a real wallet updates THAT SAME AppUser row.
    - The wallet is never used as the primary identity.
    - One real wallet cannot be attached to two different Telegram accounts.
    """
    wallet_address = str(
        request.data.get("wallet_address", "") or ""
    ).strip()

    if not wallet_address:
        return Response(
            {"error": "wallet_address required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        identity = _telegram_identity_from_request(request)
    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    telegram_id = identity["telegram_id"]
    telegram_username = identity.get("telegram_username")
    telegram_photo_url = identity.get("telegram_photo_url")
    inviter_code = identity.get("inviter_code")
    is_telegram = bool(identity.get("is_telegram", True))

    logger.info(
        "[CONNECT_TELEGRAM_FIRST] telegram_id=%s wallet=%s",
        telegram_id,
        wallet_address,
    )

    max_attempts = 5

    for attempt in range(max_attempts):
        try:
            with transaction.atomic():
                user = (
                    AppUser.objects
                    .select_for_update()
                    .filter(telegram_id=telegram_id)
                    .first()
                )

                wallet_owner = (
                    AppUser.objects
                    .select_for_update()
                    .filter(wallet_address=wallet_address)
                    .first()
                )

                # A real wallet must never silently move between two Telegram IDs.
                if (
                    wallet_owner
                    and wallet_owner.telegram_id not in (None, telegram_id)
                    and (not user or wallet_owner.pk != user.pk)
                ):
                    return Response(
                        {
                            "error":
                                "This wallet is already linked to another Telegram account.",
                            "code": "wallet_collision",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                previous_wallet = _public_wallet_address(user) if user else None

                if user:
                    # If another legacy row already owns this wallet, do not merge
                    # financial histories automatically.
                    if wallet_owner and wallet_owner.pk != user.pk:
                        return Response(
                            {
                                "error":
                                    "This wallet belongs to another existing account.",
                                "code": "wallet_collision",
                            },
                            status=status.HTTP_409_CONFLICT,
                        )

                    update_fields = []

                    if user.wallet_address != wallet_address:
                        user.wallet_address = wallet_address
                        update_fields.append("wallet_address")

                    if telegram_username and user.telegram_username != telegram_username:
                        user.telegram_username = telegram_username
                        update_fields.append("telegram_username")

                    if telegram_photo_url and user.telegram_photo_url != telegram_photo_url:
                        user.telegram_photo_url = telegram_photo_url
                        update_fields.append("telegram_photo_url")

                    if not user.is_telegram_user:
                        user.is_telegram_user = True
                        update_fields.append("is_telegram_user")

                    if not user.telegram_verified:
                        user.telegram_verified = True
                        update_fields.append("telegram_verified")

                    if user.wallet_locked:
                        user.wallet_locked = False
                        update_fields.append("wallet_locked")

                    if hasattr(user, "is_active") and not user.is_active:
                        user.is_active = True
                        update_fields.append("is_active")

                    if hasattr(user, "last_active"):
                        user.last_active = timezone.now()
                        update_fields.append("last_active")

                    if update_fields:
                        user.save(
                            update_fields=list(dict.fromkeys(update_fields))
                        )

                elif wallet_owner:
                    # Legacy wallet-only row: attach Telegram identity to it.
                    user = wallet_owner
                    update_fields = []

                    if user.telegram_id != telegram_id:
                        user.telegram_id = telegram_id
                        update_fields.append("telegram_id")

                    if telegram_username and user.telegram_username != telegram_username:
                        user.telegram_username = telegram_username
                        update_fields.append("telegram_username")

                    if telegram_photo_url and user.telegram_photo_url != telegram_photo_url:
                        user.telegram_photo_url = telegram_photo_url
                        update_fields.append("telegram_photo_url")

                    if not user.is_telegram_user:
                        user.is_telegram_user = True
                        update_fields.append("is_telegram_user")

                    if not user.telegram_verified:
                        user.telegram_verified = True
                        update_fields.append("telegram_verified")

                    if user.wallet_locked:
                        user.wallet_locked = False
                        update_fields.append("wallet_locked")

                    if hasattr(user, "is_active") and not user.is_active:
                        user.is_active = True
                        update_fields.append("is_active")

                    if hasattr(user, "last_active"):
                        user.last_active = timezone.now()
                        update_fields.append("last_active")

                    if update_fields:
                        user.save(
                            update_fields=list(dict.fromkeys(update_fields))
                        )

                else:
                    # Brand-new Telegram user connecting the first real wallet.
                    create_kwargs = {
                        "wallet_address": wallet_address,
                        "telegram_id": telegram_id,
                        "telegram_username":
                            telegram_username or f"tg_{telegram_id}",
                        "telegram_photo_url": telegram_photo_url,
                        "is_telegram_user": True,
                        "telegram_verified": True,
                        "wallet_locked": False,
                    }

                    # Current project snapshots contain these fields, but guard
                    # them for compatibility with older local DBs/models.
                    model_field_names = {
                        field.name for field in AppUser._meta.get_fields()
                    }
                    if "is_active" in model_field_names:
                        create_kwargs["is_active"] = True
                    if "last_active" in model_field_names:
                        create_kwargs["last_active"] = timezone.now()

                    user = AppUser.objects.create(**create_kwargs)

                Wallet.objects.get_or_create(user=user)

                # Referral remains one-time and belongs to Telegram identity,
                # not to a particular connected wallet.
                apply_result = None
                if inviter_code and not user.inviter_id:
                    apply_result = apply_referral(inviter_code, user)
                    user.refresh_from_db()
                    if not apply_result.get("ok"):
                        logger.warning(
                            "[CONNECT_TELEGRAM_FIRST] referral failed user=%s reason=%s",
                            user.id,
                            apply_result.get("reason"),
                        )

                current_wallet = _public_wallet_address(user)
                wallet_changed = bool(
                    previous_wallet
                    and current_wallet
                    and previous_wallet != current_wallet
                )

                logger.info(
                    "[CONNECT_TELEGRAM_FIRST] success user=%s telegram_id=%s "
                    "wallet=%s changed=%s",
                    user.id,
                    telegram_id,
                    current_wallet,
                    wallet_changed,
                )

                referral_meta = _referral_response_meta(user, apply_result if inviter_code else None)

                return Response(
                    {
                        "success": True,
                        "wallet_connected": bool(current_wallet),
                        "wallet_changed": wallet_changed,
                        "previous_wallet":
                            previous_wallet if wallet_changed else None,
                        "return_to": "/stake",
                        "user": {
                            **_telegram_user_payload(user),
                            "wallet_locked": False,
                        },
                        **referral_meta,
                    },
                    status=status.HTTP_200_OK,
                )

        except OperationalError as exc:
            is_locked = "database is locked" in str(exc).lower()

            if not is_locked:
                logger.exception(
                    "[CONNECT_TELEGRAM_FIRST] database error"
                )
                return Response(
                    {"error": "Database error"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            if attempt >= max_attempts - 1:
                return Response(
                    {
                        "error": "Database is busy. Please retry.",
                        "code": "database_busy",
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

            time.sleep(0.15 * (2 ** attempt))

        except IntegrityError:
            logger.exception(
                "[CONNECT_TELEGRAM_FIRST] identity uniqueness conflict"
            )
            return Response(
                {
                    "error":
                        "Wallet or Telegram identity is already linked to another account.",
                    "code": "identity_conflict",
                },
                status=status.HTTP_409_CONFLICT,
            )

        except Exception as exc:
            logger.exception(
                "[CONNECT_TELEGRAM_FIRST] unexpected error"
            )
            return Response(
                {
                    "error": "Unable to connect wallet",
                    "detail": str(exc),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


@api_view(["GET"])
def wallet_view(request, wallet_address):
    """
    Return a live wallet snapshot with explicit profit buckets.

    - Own purchase profit: 5% (locked 30 days, then released)
    - Level 1 referral purchase profit: 5% (available immediately)
    - Levels 2-5 referral purchase profit: 1% each (available immediately)

    AssetBalance.available remains the authoritative withdrawable balance.
    Ledger rows are used for the visible 5% / 1% breakdown so principal is
    never mistaken for profit.
    """
    user = (
        AppUser.objects
        .select_related("wallet")
        .filter(wallet_address=wallet_address)
        .first()
    )

    if not user:
        return Response(
            {"error": "User not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    reconcile_existing_referral_join_rewards(user)
    release_matured_purchase_profits(user)

    # Legacy-safe backfill: make AssetBalance.available match the real
    # ledger-derived unlocked profit after historical withdrawals.
    _reconcile_profit_asset_available(user, "ECG")
    _reconcile_profit_asset_available(user, "USDT")

    user.refresh_from_db()
    wallet, _ = Wallet.objects.get_or_create(user=user)

    usdt_balance, _ = AssetBalance.objects.get_or_create(
        user=user,
        asset="USDT",
    )
    ecg_balance, _ = AssetBalance.objects.get_or_create(
        user=user,
        asset="ECG",
    )
    epl_asset_balance, _ = AssetBalance.objects.get_or_create(
        user=user,
        asset="EPL",
    )

    zero = Decimal("0")
    now = timezone.now()

    # Own 5% purchase profit (locked)
    own_locked_ecg = zero
    own_locked_usdt = zero

    for purchase in Purchase.objects.filter(user=user):
        amount = Decimal(str(purchase.self_profit_5 or 0))
        if amount <= 0:
            continue

        unlock_at = purchase.self_profit_unlock_at
        if unlock_at and unlock_at <= now:
            continue

        asset = str(
            getattr(purchase, "profit_asset", None)
            or getattr(purchase, "output_asset", None)
            or "ECG"
        ).upper()

        if asset == "USDT":
            own_locked_usdt += amount
        else:
            own_locked_ecg += amount

    # NOTE: PurchaseUSDT is a purchase PAID WITH USDT that outputs ECG in
    # services.register_purchase_usdt(). Its 5% own profit is ECG, not USDT.
    # Therefore PurchaseUSDT must NOT be added to the Tether Own Profit box.

    # ============================================================
    # Profit bucket values shown in the UI
    #
    # Gross earned profit remains in the earning ledgers.
    # WITHDRAW ledgers reserve/deduct money at request time.
    # Therefore the visible available bucket must be:
    #     gross earned - already reserved/withdrawn
    # ============================================================

    ecg_asset_available = max(
        zero,
        Decimal(str(ecg_balance.available or 0)),
    )
    usdt_asset_available = max(
        zero,
        Decimal(str(usdt_balance.available or 0)),
    )

    ecg_bucket_snapshot = _profit_bucket_snapshot(
        user,
        "ECG",
        authoritative_available=ecg_asset_available,
    )
    usdt_bucket_snapshot = _profit_bucket_snapshot(
        user,
        "USDT",
        authoritative_available=usdt_asset_available,
    )

    own_unlocked_ecg = ecg_bucket_snapshot["SELF"]
    own_unlocked_usdt = usdt_bucket_snapshot["SELF"]

    # Gross referral breakdown is still useful for the Level 1 / Levels 2-5
    # descriptive lines in the UI.
    level1_5_ecg = _ledger_total(
        user,
        "DIRECT_REFERRAL_BONUS",
        "ECG",
    )
    level1_5_usdt = _ledger_total(
        user,
        "DIRECT_REFERRAL_BONUS",
        "USDT",
    )

    levels2_5_1_ecg = _ledger_total(
        user,
        "INDIRECT_REFERRAL_BONUS",
        "ECG",
    )
    levels2_5_1_usdt = _ledger_total(
        user,
        "INDIRECT_REFERRAL_BONUS",
        "USDT",
    )

    referral_ecg_total = ecg_bucket_snapshot["REFERRAL"]
    referral_usdt_total = usdt_bucket_snapshot["REFERRAL"]

    # ============================================================
    # Withdrawable profit after all reservations.
    # The bucket snapshot is already capped to AssetBalance.available.
    # ============================================================
    withdrawable_ecg_profit = max(
        zero,
        own_unlocked_ecg + referral_ecg_total,
    )

    usdt_profit_available = max(
        zero,
        own_unlocked_usdt + referral_usdt_total,
    )
    withdrawable_usdt_profit = usdt_profit_available

    total_ecg_profit = (
        own_locked_ecg
        + own_unlocked_ecg
        + referral_ecg_total
    )
    total_usdt_profit = (
        own_locked_usdt
        + own_unlocked_usdt
        + referral_usdt_total
    )

    # EPL / timer / join-referral values
    daily_qs = user.ledgers.filter(typ="DAILY_UNLOCK")
    total_mined = (
        daily_qs.aggregate(total=Sum("amount"))["total"]
        or zero
    )
    mining_days = daily_qs.count()

    referral_bonus_total = (
        user.ledgers
        .filter(typ="REF_BONUS")
        .aggregate(total=Sum("amount"))["total"]
        or zero
    )

    referral_bonus_current = referral_bonus_total
    daily_reward_unlocked = total_mined
    epl_balance_value = Decimal(str(epl_asset_balance.available or 0))

    total_earned = (
        user.ledgers
        .filter(
            typ__in=[
                "DAILY_UNLOCK",
                "BUY_SELF_PROFIT",
                "SELF_PROFIT_UNLOCK",
                "DIRECT_REFERRAL_BONUS",
                "INDIRECT_REFERRAL_BONUS",
                "DOWNLINE_PROFIT",
                "REF_BONUS",
                "LEVEL5_BONUS",
            ]
        )
        .aggregate(total=Sum("amount"))["total"]
        or zero
    )

    # Legacy principal fields.
    principal_locked = zero
    principal_unlocked = zero
    stake_balance = zero

    # Total withdrawn (from Ledger)
    total_withdrawn = zero
    for ledger in user.ledgers.filter(typ="WITHDRAW"):
        meta = dict(ledger.meta or {})
        source_asset = str(meta.get("source_asset") or "ECG").upper()
        if source_asset == "ECG":
            total_withdrawn += abs(Decimal(str(ledger.amount or 0)))

    payload = {
        # ============================================================
        # موجودی قابل برداشت (از AssetBalance - قبلاً کم شده)
        # ============================================================
        "withdrawable_ecg_profit": str(withdrawable_ecg_profit),
        "withdrawable_usdt_profit": str(withdrawable_usdt_profit),
        "usdt_balance": str(withdrawable_usdt_profit),
        "usdt_asset_available": str(usdt_asset_available),
        "usdt_profit_available": str(usdt_profit_available),
        "usdt_self_gross": str(usdt_bucket_snapshot["GROSS_SELF"]),
        "usdt_referral_gross": str(usdt_bucket_snapshot["GROSS_REFERRAL"]),
        "usdt_reserved_self": str(usdt_bucket_snapshot["RESERVED_SELF"]),
        "usdt_reserved_referral": str(usdt_bucket_snapshot["RESERVED_REFERRAL"]),
        "usdt_reserved_legacy": str(usdt_bucket_snapshot["RESERVED_LEGACY"]),
        "ecg_balance": str(withdrawable_ecg_profit),
        "available_balance": str(withdrawable_ecg_profit),
        "withdrawable_total": str(withdrawable_ecg_profit),

        # ============================================================
        # سود خود خرید (قفل شده و آزاد شده)
        # ============================================================
        "purchase_profit_ecg": str(own_locked_ecg + own_unlocked_ecg),
        "purchase_profit_ecg_locked": str(own_locked_ecg),
        "purchase_profit_ecg_unlocked": str(own_unlocked_ecg),
        "ecg_self_locked": str(own_locked_ecg),
        "ecg_self_unlocked": str(own_unlocked_ecg),
        "self_profit_locked": str(own_locked_ecg),
        "self_profit_unlocked": str(own_unlocked_ecg),

        "purchase_profit_usdt": str(own_locked_usdt + own_unlocked_usdt),
        "purchase_profit_usdt_locked": str(own_locked_usdt),
        "purchase_profit_usdt_unlocked": str(own_unlocked_usdt),
        "self_profit_usdt_unlocked": str(own_unlocked_usdt),
        "usdt_self_locked": str(own_locked_usdt),
        "usdt_self_unlocked": str(own_unlocked_usdt),

        # ============================================================
        # سود referral
        # ============================================================
        "referral_level1_profit_ecg": str(level1_5_ecg),
        "referral_levels2_5_profit_ecg": str(levels2_5_1_ecg),
        "referral_profit_ecg_unlocked": str(referral_ecg_total),
        "ecg_referral_profit": str(referral_ecg_total),

        "referral_level1_profit_usdt": str(level1_5_usdt),
        "referral_levels2_5_profit_usdt": str(levels2_5_1_usdt),
        "referral_profit_usdt_unlocked": str(referral_usdt_total),
        "usdt_referral_profit": str(referral_usdt_total),

        # ============================================================
        # کل سود
        # ============================================================
        "total_ecg_profit": str(total_ecg_profit),
        "total_usdt_profit": str(total_usdt_profit),

        # ============================================================
        # EPL
        # ============================================================
        "epl_balance": str(epl_balance_value),
        "epl_total_earned": str(wallet.epl_total_earned or zero),

        # ============================================================
        # Timer / referral EPL
        # ============================================================
        "hourly_reward_balance": str(daily_reward_unlocked),
        "hourly_reward_total": str(total_mined),
        "hourly_claims": mining_days,
        "daily_reward_unlocked": str(daily_reward_unlocked),
        "referral_bonus": str(referral_bonus_current),
        "referral_bonus_balance": str(referral_bonus_current),
        "referral_bonus_total": str(referral_bonus_total),

        # ============================================================
        # Legacy aliases
        # ============================================================
        "stake_balance": str(stake_balance),
        "principal_locked": str(principal_locked),
        "principal_unlocked": str(principal_unlocked),
        "total_mined": str(total_mined),
        "mining_days": mining_days,
        "total_earned": str(total_earned),
        "total_withdrawn": str(total_withdrawn),
    }

    return Response(payload, status=status.HTTP_200_OK)


@api_view(["POST"])
def create_purchase(request):
    """
    Save the real TON purchase AFTER TonConnect returned a signed BOC.

    Telegram ID is the account identity.
    wallet_address is required only to prove which connected wallet signed
    this payment and must match the wallet currently attached to telegram_id.
    """
    logger.info("=" * 60)
    logger.info("💰 CREATE_PURCHASE / TELEGRAM-FIRST")
    logger.info("📥 Data keys: %s", list(request.data.keys()))

    wallet_address = str(
        request.data.get("wallet_address", "") or ""
    ).strip()

    boc = str(
        request.data.get("boc", "") or ""
    ).strip()

    output_asset = str(
        request.data.get("output_asset", "ECG") or "ECG"
    ).strip().upper()

    network = str(
        request.data.get("network", "-239") or "-239"
    ).strip()

    expected_gram_amount_raw = str(
        request.data.get("expected_gram_amount", "") or ""
    ).strip()

    if not wallet_address:
        return Response(
            {"error": "wallet_address required for TON payment"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not boc:
        return Response(
            {"error": "wallet BOC required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if output_asset not in {"ECG", "USDT"}:
        return Response(
            {"error": "Invalid output asset"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if network not in {"-239", "-3"}:
        return Response(
            {"error": "Invalid TON network"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        identity = _telegram_identity_from_request(request)
    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    telegram_id = identity["telegram_id"]

    try:
        gram_nano = int(expected_gram_amount_raw)
        if gram_nano <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        return Response(
            {
                "error":
                    "expected_gram_amount must be a positive integer in nanoTON"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    gram_address = str(
        getattr(settings, "GRAM_MERCHANT_ADDRESS", "") or ""
    ).strip()

    if not gram_address:
        return Response(
            {"error": "GRAM_MERCHANT_ADDRESS is not configured"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    user = (
        AppUser.objects
        .filter(telegram_id=telegram_id)
        .first()
    )

    if not user:
        return Response(
            {
                "error":
                    "Telegram account not found. Open Wallet and connect your TON wallet first.",
                "code": "telegram_user_not_found",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    connected_wallet = _public_wallet_address(user)

    if not connected_wallet:
        return Response(
            {
                "error": "No TON wallet is connected to this Telegram account.",
                "code": "wallet_not_connected",
            },
            status=status.HTTP_409_CONFLICT,
        )

    if connected_wallet != wallet_address:
        return Response(
            {
                "error":
                    "The payment wallet does not match the wallet connected to this Telegram account.",
                "code": "wallet_mismatch",
                "connected_wallet": connected_wallet,
            },
            status=status.HTTP_409_CONFLICT,
        )

    wallet_receipt_hash = hashlib.sha256(
        boc.encode("utf-8")
    ).hexdigest()

    ton_amount = (
        Decimal(gram_nano)
        / Decimal("1000000000")
    )

    try:
        logger.info(
            "[PURCHASE_TELEGRAM_FIRST] telegram_id=%s user=%s wallet=%s amount=%s receipt=%s",
            telegram_id,
            user.id,
            connected_wallet,
            ton_amount,
            wallet_receipt_hash,
        )

        # Idempotency: one signed BOC can produce only one purchase.
        existing = (
            Purchase.objects
            .filter(ton_tx_hash=wallet_receipt_hash)
            .first()
        )

        if existing:
            if existing.user_id != user.id:
                return Response(
                    {
                        "error":
                            "This wallet receipt is already registered to another user."
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            serialized = dict(
                PurchaseSerializer(existing).data
            )
            serialized["created_at"] = existing.created_at
            serialized["lock_period_days"] = 365
            serialized["payment_status"] = "WALLET_CONFIRMED"
            serialized["blockchain_verified"] = False

            return Response(
                {
                    "status": "confirmed",
                    "confirmation_source": "wallet",
                    "blockchain_verified": False,
                    "already_registered": True,
                    "telegram_id": telegram_id,
                    "ton_tx_hash": wallet_receipt_hash,
                    "wallet_receipt_hash": wallet_receipt_hash,
                    "message_hash": wallet_receipt_hash,
                    "gram_address": gram_address,
                    "gram_amount": str(gram_nano),
                    "ton_amount": str(ton_amount),
                    "invoice": serialized,
                },
                status=status.HTTP_200_OK,
            )

        try:
            purchase = register_purchase(
                user,
                ton_amount,
                wallet_receipt_hash,
                output_asset=output_asset,
            )
        except ValueError as exc:
            if "TX already registered" not in str(exc):
                raise

            purchase = (
                Purchase.objects
                .filter(ton_tx_hash=wallet_receipt_hash)
                .first()
            )

            if not purchase or purchase.user_id != user.id:
                raise

        serialized = dict(
            PurchaseSerializer(purchase).data
        )
        serialized["created_at"] = purchase.created_at
        serialized["lock_period_days"] = 365
        serialized["payment_status"] = "WALLET_CONFIRMED"
        serialized["blockchain_verified"] = False

        logger.info(
            "✅ TELEGRAM-FIRST PURCHASE CREATED invoice=%s user=%s telegram_id=%s",
            purchase.invoice_no,
            user.id,
            telegram_id,
        )

        return Response(
            {
                "status": "confirmed",
                "confirmation_source": "wallet",
                "blockchain_verified": False,
                "already_registered": False,
                "telegram_id": telegram_id,
                "ton_tx_hash": wallet_receipt_hash,
                "wallet_receipt_hash": wallet_receipt_hash,
                "message_hash": wallet_receipt_hash,
                "gram_address": gram_address,
                "gram_amount": str(gram_nano),
                "ton_amount": str(ton_amount),
                "invoice": serialized,
            },
            status=status.HTTP_201_CREATED,
        )

    except OperationalError as exc:
        logger.exception(
            "SQLite/database error during Telegram-first purchase"
        )
        return Response(
            {"error": str(exc)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    except Exception as exc:
        logger.exception(
            "Telegram-first immediate purchase error"
        )
        return Response(
            {"error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
def list_purchases(request):
    """
    Return purchases for the Telegram account.

    Preferred:
        GET /purchase/list/?telegram_id=<id>

    Legacy wallet lookup remains as a fallback only.
    """
    raw_telegram_id = (
        request.query_params.get("telegram_id")
        or request.headers.get("X-Telegram-Id")
    )

    wallet_address = (
        request.query_params.get("wallet")
        or request.query_params.get("wallet_address")
    )

    user = None

    if raw_telegram_id not in (None, ""):
        try:
            telegram_id = int(raw_telegram_id)
        except (TypeError, ValueError):
            return Response(
                {"error": "Invalid telegram_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if telegram_id <= 0:
            return Response(
                {"error": "Invalid telegram_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = AppUser.objects.filter(
            telegram_id=telegram_id
        ).first()

    elif wallet_address:
        # Backward compatibility for old clients.
        user = AppUser.objects.filter(
            wallet_address=wallet_address
        ).first()

    else:
        return Response(
            {"error": "telegram_id required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not user:
        return Response(
            [],
            status=status.HTTP_200_OK,
        )

    qs = user.purchases.order_by("-created_at")
    serialized = list(
        PurchaseSerializer(qs, many=True).data
    )

    for item, purchase in zip(serialized, qs):
        item["created_at"] = purchase.created_at
        item["lock_period_days"] = 365
        item["telegram_id"] = user.telegram_id

    return Response(
        serialized,
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
def request_withdraw(request):
    """Create a manual withdrawal using the fields present on WithdrawRequest."""
    wallet_address = str(request.data.get("wallet_address", "") or "").strip()
    requested_asset = str(request.data.get("asset", "") or "").strip().upper()
    source_asset = str(request.data.get("source_asset", "ECG") or "ECG").strip().upper()

    if source_asset not in {"ECG", "USDT", "EPL"}:
        return Response({"error": "Invalid source_asset."}, status=400)

    is_ton = requested_asset in {"GRAM", "TON"}
    asset = "TON" if is_ton else requested_asset

    try:
        requested_amount = Decimal(str(request.data.get("amount", "0")))
    except Exception:
        return Response({"error": "Invalid amount."}, status=400)

    if not wallet_address or asset not in {"TON", "ECG", "EPL"}:
        return Response(
            {"error": "wallet_address and asset are required."},
            status=400,
        )

    if requested_amount <= 0:
        return Response({"error": "Amount must be greater than zero."}, status=400)

    destination = str(
        request.data.get("destination_wallet", "") or ""
    ).strip()

    if not destination:
        return Response(
            {"error": f"destination_wallet is required for {asset} withdrawal."},
            status=400,
        )

    ton_rate = None
    if asset == "TON":
        try:
            _ton_address_to_raw(destination)
        except ValueError:
            return Response(
                {"error": "destination_wallet is not a valid TON address."},
                status=400,
            )

        ton_rate = fetch_ton_usd_rate()
        if ton_rate <= 0:
            return Response(
                {"error": "Unable to calculate TON conversion rate."},
                status=503,
            )

    telegram_id = request.headers.get("X-Telegram-Id")
    is_telegram = request.headers.get("X-Telegram") == "true"
    user = get_or_create_user(
        wallet_address,
        int(telegram_id) if telegram_id else None,
        is_telegram if telegram_id else False,
    )

    release_matured_purchase_profits(user)

    # Ensure old pre-fix referral profits are available before validating a
    # withdrawal, while already-recorded withdrawals stay deducted.
    if source_asset in {"ECG", "USDT"}:
        _reconcile_profit_asset_available(user, source_asset)

    # ============================================================
    # USDT WITHDRAWAL - reserve/deduct immediately at request time
    # ============================================================
    if source_asset == "USDT":
        source_amount = requested_amount.quantize(Decimal("0.000001"))

        ton_amount = (
            source_amount / ton_rate
        ).quantize(Decimal("0.000000001"))

        withdraw_bucket = _normalize_withdraw_bucket(
            request.data.get("withdraw_bucket")
        )

        with transaction.atomic():
            balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(user=user, asset="USDT")
            )

            total_available = Decimal(
                str(balance.available or 0)
            )

            if withdraw_bucket in {"SELF", "REFERRAL"}:
                bucket_available = _available_profit_bucket(
                    user,
                    "USDT",
                    withdraw_bucket,
                    authoritative_available=total_available,
                )
            else:
                bucket_available = total_available

            usable_available = min(
                total_available,
                bucket_available,
            )

            max_ton = (
                usable_available / ton_rate
            ).quantize(Decimal("0.000000001"))

            if source_amount > usable_available:
                return Response(
                    {
                        "error": "Insufficient unlocked USDT profit.",
                        "available_usdt": str(usable_available),
                        "total_available_usdt": str(total_available),
                        "bucket_available_usdt": str(bucket_available),
                        "withdraw_bucket": withdraw_bucket,
                        "max_ton": str(max_ton),
                    },
                    status=400,
                )

            # IMPORTANT:
            # AssetBalance.available is the TOTAL available USDT balance.
            # Never overwrite it with a bucket-only balance.
            balance.available = total_available - source_amount
            balance.save(update_fields=["available"])

            req = WithdrawRequest.objects.create(
                user=user,
                asset="TON",
                source_asset="USDT",
                amount=source_amount,
                wallet_address=destination,
                status="PENDING",
            )

            Ledger.objects.create(
                user=user,
                typ="WITHDRAW",
                amount=-source_amount,
                meta={
                    "withdraw_id": req.id,
                    "source_asset": "USDT",
                    "asset": "TON",
                    "status": "PENDING",
                    "destination": destination,
                    "withdraw_bucket": withdraw_bucket,
                    "balance_deducted_at_request": True,
                    "deducted_amount": str(source_amount),
                    "requested_ton": str(ton_amount),
                },
            )

    # ============================================================
    # EPL WITHDRAWAL - balance deducted at request time
    # ============================================================
    elif source_asset == "EPL":
        if is_ton:
            return Response(
                {
                    "error":
                    "EPL withdrawal to TON is not supported."
                },
                status=400
            )
        with transaction.atomic():
            epl_balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=user,
                    asset="EPL"
                 )
            )
            available = Decimal(
                str(epl_balance.available or 0)
            )

            if requested_amount > available:
                return Response(
                    {
                        "error":
                        "Insufficient EPL balance.",
                        "available_epl":
                        str(available)
                    },
                    status=400
                )
            
            # ✅ Deduct balance immediately
            epl_balance.available = available - requested_amount
            epl_balance.save(update_fields=["available"])

            req = WithdrawRequest.objects.create(
                user=user,
                asset="EPL",
                amount=requested_amount,
                wallet_address=destination,
                status="PENDING"
            )

            Ledger.objects.create(
                user=user,
                typ="WITHDRAW",
                amount=-requested_amount,
                meta={
                    "withdraw_id": req.id,
                    "source_asset": "EPL",
                    "asset": "EPL",
                    "epl_debited": str(requested_amount),
                    "status": "PENDING",
                    "destination": destination,
                    "balance_deducted_at_request": True,
                    "deducted_amount": str(requested_amount),
                }
            )

    # ============================================================
    # ECG WITHDRAWAL - reserve/deduct immediately at request time
    # ============================================================
    else:  # source_asset == "ECG"
        if is_ton:
            # Frontend sends TON amount when ECG is withdrawn as TON.
            # Convert the requested TON to the real ECG debit.
            ecg_amount = (
                requested_amount * ton_rate * ECG_PER_USD
            ).quantize(Decimal("0.000001"), rounding=ROUND_UP)
            ton_amount = requested_amount
        else:
            # Direct ECG withdrawal: input amount already is ECG.
            ecg_amount = requested_amount.quantize(
                Decimal("0.000001")
            )
            ton_amount = Decimal("0")

        withdraw_bucket = _normalize_withdraw_bucket(
            request.data.get("withdraw_bucket")
        )

        with transaction.atomic():
            ecg_balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=user,
                    asset="ECG"
                )
            )

            total_available = Decimal(
                str(ecg_balance.available or 0)
            )

            if withdraw_bucket in {"SELF", "REFERRAL"}:
                bucket_available = _available_profit_bucket(
                    user,
                    "ECG",
                    withdraw_bucket,
                    authoritative_available=total_available,
                )
            else:
                bucket_available = total_available

            usable_available = min(
                total_available,
                bucket_available,
            )

            if ecg_amount > usable_available:
                return Response(
                    {
                        "error": "Insufficient ECG balance.",
                        "available": str(usable_available),
                        "total_available": str(total_available),
                        "bucket_available": str(bucket_available),
                        "withdraw_bucket": withdraw_bucket,
                    },
                    status=400,
                )

            # IMPORTANT:
            # AssetBalance.available is the TOTAL ECG balance.
            # Deduct from the total; never replace it with bucket_available.
            ecg_balance.available = total_available - ecg_amount
            ecg_balance.save(update_fields=["available"])

            req = WithdrawRequest.objects.create(
                user=user,
                asset=asset,
                source_asset="ECG",
                amount=ecg_amount,
                wallet_address=destination,
                status="PENDING",
            )

            Ledger.objects.create(
                user=user,
                typ="WITHDRAW",
                amount=-ecg_amount,
                meta={
                    "withdraw_id": req.id,
                    "source_asset": "ECG",
                    "asset": asset,
                    "ecg_debited": str(ecg_amount),
                    "requested_ton": str(ton_amount),
                    "withdraw_bucket": withdraw_bucket,
                    "destination": destination,
                    "status": "PENDING",
                    "balance_deducted_at_request": True,
                    "deducted_amount": str(ecg_amount),
                },
            )

    payload = serialize_withdraw(req)
    payload.update({
        "message": "Withdrawal request submitted. Please wait for admin approval.",
        "approval_required": True,
    })
    return Response(payload, status=201)


def _withdraw_ledger(item):
    return (
        Ledger.objects
        .filter(user=item.user, typ="WITHDRAW", meta__withdraw_id=item.id)
        .order_by("-id")
        .first()
    )


def serialize_withdraw(item):
    ledger = _withdraw_ledger(item)
    meta = dict(ledger.meta or {}) if ledger else {}

    raw_status = str(item.status or "").upper()
    display_status = (
        "COMPLETE"
        if raw_status in {"PAID", "SUCCESS", "COMPLETE", "COMPLETED"}
        else raw_status
    )

    source_asset = str(meta.get("source_asset") or "ECG").upper()
    is_usdt_source = source_asset == "USDT"
    is_ton = str(item.asset or "").upper() == "TON"

    requested_ton = meta.get("requested_ton")

    if not requested_ton and str(item.asset).upper() == "TON":
        try:
            source_asset = str(item.source_asset or "").upper()

            if source_asset == "ECG":
                ton_rate = fetch_ton_usd_rate()

                usd_value = (
                    Decimal(str(item.amount))
                    / Decimal(str(ECG_PER_USD))
                )

                requested_ton = (
                    usd_value / Decimal(str(ton_rate))
                ).quantize(Decimal("0.000000001"))

            elif source_asset == "USDT":
                ton_rate = fetch_ton_usd_rate()

                requested_ton = (
                    Decimal(str(item.amount))
                    / Decimal(str(ton_rate))
                ).quantize(Decimal("0.000000001"))

        except Exception:
            requested_ton = "0"

    requested_ton = str(requested_ton or "0")
    requested_amount = (
        requested_ton
        if is_ton
        else str(meta.get("requested_amount") or item.amount)
    )

    completed_at = (
        item.updated_at
        if raw_status in {"PAID", "SUCCESS", "COMPLETE", "COMPLETED"}
        else None
    )

    return {
        "id": item.id,
        "asset": "TON" if is_ton else item.asset,
        "raw_asset": item.asset,
        "source_asset": source_asset,
        "amount": str(item.amount),
        "ecg_debited": str(meta.get("ecg_debited") or ("0" if is_usdt_source else item.amount)),
        "usdt_debited": str(meta.get("usdt_debited") or (item.amount if is_usdt_source else "0")),
        "ton_amount": requested_ton,
        "requested_amount": requested_amount,
        "requested_asset": "TON" if is_ton else "ECG",
        "destination_wallet": item.wallet_address,
        "wallet_address": item.wallet_address,
        "status": item.status,
        "display_status": display_status,
        "tx_hash": item.tx_hash,
        "created_at": item.created_at,
        "completed_at": completed_at,
        "balance_deducted_at_request": meta.get("balance_deducted_at_request", False),
        "withdraw_bucket": _normalize_withdraw_bucket(meta.get("withdraw_bucket")),
    }


@api_view(["GET"])
def withdraw_history(request):
    wallet_address = request.query_params.get("wallet_address")
    if not wallet_address:
        return Response({"error": "wallet_address required"}, status=400)

    user = AppUser.objects.filter(wallet_address=wallet_address).first()
    if not user:
        return Response([], status=200)

    rows = user.withdraw_requests.order_by("-created_at")[:50]
    return Response([serialize_withdraw(row) for row in rows])


# ============================================================
# MANUAL WITHDRAWAL ADMIN APPROVAL
# ============================================================


def _admin_totp_secret():
    """Use the same Google Authenticator secret for admin-only write actions."""
    candidates = [
        getattr(settings, "ADMIN_2FA_SECRET", None),
        os.getenv("ADMIN_2FA_SECRET"),
        getattr(settings, "ADMIN_TOTP_SECRET", None),
        getattr(settings, "ADMIN_OTP_SECRET", None),
        getattr(settings, "GOOGLE_AUTH_SECRET", None),
        os.getenv("ADMIN_TOTP_SECRET"),
        os.getenv("ADMIN_OTP_SECRET"),
        os.getenv("GOOGLE_AUTH_SECRET"),
    ]
    return next((str(value).strip() for value in candidates if value), "")


def _totp_code(secret: str, counter: int) -> str:
    normalized = secret.replace(" ", "").upper()
    normalized += "=" * ((-len(normalized)) % 8)
    key = base64.b32decode(normalized, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{binary % 1_000_000:06d}"


def _verify_admin_totp(request) -> bool:
    provided = str(request.headers.get("X-Admin-OTP", "") or "").strip()
    secret = _admin_totp_secret()
    if not secret or not re.fullmatch(r"\d{6}", provided):
        return False

    current_counter = int(time.time() // 30)
    try:
        return any(
            hmac.compare_digest(provided, _totp_code(secret, current_counter + drift))
            for drift in (-1, 0, 1)
        )
    except Exception:
        logger.exception("Could not verify admin TOTP")
        return False


ADMIN_SESSION_SALT = "core.admin-session.v1"


def _admin_session_max_age() -> int:
    try:
        value = int(os.getenv("ADMIN_SESSION_MAX_AGE", "43200"))
    except (TypeError, ValueError):
        value = 43200
    return max(300, value)


def _create_admin_session_token() -> str:
    return signing.dumps(
        {
            "role": "admin",
            "v": 1,
            "issued_at": int(time.time()),
        },
        salt=ADMIN_SESSION_SALT,
        compress=True,
    )


def _verify_admin_session(request) -> bool:
    token = str(
        request.headers.get("X-Admin-Session", "") or ""
    ).strip()

    if not token:
        return False

    try:
        payload = signing.loads(
            token,
            salt=ADMIN_SESSION_SALT,
            max_age=_admin_session_max_age(),
        )
    except signing.SignatureExpired:
        return False
    except signing.BadSignature:
        return False
    except Exception:
        logger.exception("Could not verify admin session")
        return False

    return (
        isinstance(payload, dict)
        and payload.get("role") == "admin"
        and payload.get("v") == 1
    )


@api_view(["POST"])
def admin_create_session(request):
    """
    Exchange one fresh Google Authenticator code for a signed admin session.
    """
    if not _verify_admin_totp(request):
        return Response(
            {
                "error": (
                    "Invalid Google Authenticator code. "
                    "Enter the current 6-digit code and try again."
                )
            },
            status=403,
        )

    max_age = _admin_session_max_age()
    return Response({
        "success": True,
        "admin_session": _create_admin_session_token(),
        "expires_in": max_age,
    })


@api_view(["POST"])
def admin_complete_withdraw(request, withdraw_id):
    """
    Mark a pending withdrawal as paid.
    IMPORTANT: Balance was already deducted at request time (for ECG, USDT, EPL).
    So here we ONLY update status and metadata, NO balance deduction.
    """
    if not _verify_admin_session(request):
        return Response(
            {
                "error": (
                    "Admin session is missing or expired. "
                    "Sign in to the admin dashboard again."
                )
            },
            status=403,
        )

    tx_hash = str(request.data.get("tx_hash", "") or "").strip()

    with transaction.atomic():
        req = (
            WithdrawRequest.objects
            .select_for_update()
            .select_related("user")
            .filter(pk=withdraw_id)
            .first()
        )

        if not req:
            return Response({"error": "Withdrawal request not found."}, status=404)

        current_status = str(req.status or "").upper()

        if current_status in {"PAID", "SUCCESS", "COMPLETE", "COMPLETED"}:
            return Response({
                "success": True,
                "already_completed": True,
                "withdrawal": serialize_withdraw(req),
            })

        if current_status != "PENDING":
            return Response(
                {"error": f"Only PENDING withdrawals can be completed (current: {req.status})."},
                status=409,
            )

        completed_at = timezone.now()
        req.status = "PAID"
        if tx_hash:
            req.tx_hash = tx_hash

        update_fields = ["status", "updated_at"]
        if tx_hash:
            update_fields.append("tx_hash")
        req.save(update_fields=update_fields)

        # ============================================================
        # ONLY update ledger metadata
        # NO balance deduction because it was already deducted at request time
        # ============================================================
        ledger = _withdraw_ledger(req)
        if ledger:
            meta = dict(ledger.meta or {})
            meta.update({
                "status": "PAID",
                "display_status": "COMPLETE",
                "admin_completed_at": completed_at.isoformat(),
                "balance_deducted_at_request": True,
            })
            if tx_hash:
                meta["tx_hash"] = tx_hash
            ledger.meta = meta
            ledger.save(update_fields=["meta"])

    req.refresh_from_db()
    return Response({
        "success": True,
        "message": "Withdrawal marked complete.",
        "withdrawal": serialize_withdraw(req),
    })


# ============================================================
# TELEGRAM-FIRST IDENTITY HELPERS
# ============================================================

TELEGRAM_PLACEHOLDER_PREFIX = "telegram:"


def _is_telegram_placeholder_wallet(value):
    """Return True when wallet_address is only an internal Telegram placeholder."""
    return str(value or "").startswith(TELEGRAM_PLACEHOLDER_PREFIX)


def _request_payload_value(request, key, default=None):
    """Read a value from query params, JSON/form body, or selected headers."""
    value = request.query_params.get(key)
    if value not in (None, ""):
        return value

    data = getattr(request, "data", None)
    if data is not None:
        try:
            value = data.get(key)
        except Exception:
            value = None
        if value not in (None, ""):
            return value

    header_map = {
        "telegram_id": "X-Telegram-Id",
        "telegram_username": "X-Telegram-Username",
        "telegram_photo_url": "X-Telegram-Photo-Url",
        "is_telegram": "X-Telegram",
        "inviter_code": "X-Inviter-Code",
    }
    header_name = header_map.get(key)
    if header_name:
        value = request.headers.get(header_name)
        if value not in (None, ""):
            return value

    return default


def _parse_request_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _telegram_identity_from_request(request):
    """
    Parse the Telegram identity sent by the Mini App.

    Telegram ID is the primary application identity for Timer/EPL.
    wallet_address is deliberately NOT required here.
    """
    raw_telegram_id = _request_payload_value(request, "telegram_id")

    if raw_telegram_id in (None, ""):
        raise ValueError("telegram_id required")

    try:
        telegram_id = int(raw_telegram_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid telegram_id") from exc

    if telegram_id <= 0:
        raise ValueError("Invalid telegram_id")

    username = _request_payload_value(request, "telegram_username")
    if username:
        username = str(username).strip().lstrip("@") or None

    photo_url = _request_payload_value(request, "telegram_photo_url")
    if photo_url:
        photo_url = str(photo_url).strip() or None

    return {
        "telegram_id": telegram_id,
        "telegram_username": username,
        "telegram_photo_url": photo_url,
        "is_telegram": _parse_request_bool(
            _request_payload_value(request, "is_telegram", True),
            default=True,
        ),
        "inviter_code": normalize_inviter_code(
            _request_payload_value(request, "inviter_code")
        ),
    }


def _referral_response_meta(user, apply_result=None):
    """Build referral status fields for API responses."""
    meta = {
        "referral_applied": bool(user.inviter_id),
        "referral_error": None,
        "referral_apply_reason": None,
    }

    if apply_result:
        meta["referral_apply_reason"] = apply_result.get("reason")
        if not apply_result.get("ok") and not user.inviter_id:
            meta["referral_error"] = apply_result.get("message")

    return meta


# ============================================================
# ✅ تابع اصلاح شده _get_or_create_telegram_user
# ============================================================

def _get_or_create_telegram_user(request):
    """
    Resolve the application user by Telegram ID.

    AppUser.wallet_address is currently a required unique CharField in this
    project. Until that schema is migrated to allow NULL/blank, Telegram-only
    users receive a deterministic internal placeholder such as:

        telegram:123456789

    When the user later connects a real wallet, the existing /connect/ flow
    resolves the same AppUser by telegram_id and replaces this placeholder.
    """
    identity = _telegram_identity_from_request(request)
    telegram_id = identity["telegram_id"]
    placeholder_wallet = f"{TELEGRAM_PLACEHOLDER_PREFIX}{telegram_id}"

    defaults = {
        "wallet_address": placeholder_wallet,
        "telegram_username": (
            identity["telegram_username"]
            or f"tg_{telegram_id}"
        ),
        "telegram_photo_url": identity["telegram_photo_url"],
        "is_telegram_user": True,
        "telegram_verified": True,
        "wallet_locked": False,
    }

    with transaction.atomic():
        user, created = AppUser.objects.get_or_create(
            telegram_id=telegram_id,
            defaults=defaults,
        )

        update_fields = []
        apply_result = None

        if identity["telegram_username"]:
            clean_username = identity["telegram_username"]
            if user.telegram_username != clean_username:
                user.telegram_username = clean_username
                update_fields.append("telegram_username")

        if identity["telegram_photo_url"]:
            clean_photo = identity["telegram_photo_url"]
            if user.telegram_photo_url != clean_photo:
                user.telegram_photo_url = clean_photo
                update_fields.append("telegram_photo_url")

        if not user.is_telegram_user:
            user.is_telegram_user = True
            update_fields.append("is_telegram_user")

        if not user.telegram_verified:
            user.telegram_verified = True
            update_fields.append("telegram_verified")

        if user.wallet_locked and _is_telegram_placeholder_wallet(user.wallet_address):
            user.wallet_locked = False
            update_fields.append("wallet_locked")

        if hasattr(user, "is_active") and not user.is_active:
            user.is_active = True
            update_fields.append("is_active")

        if hasattr(user, "last_active"):
            user.last_active = timezone.now()
            update_fields.append("last_active")

        if update_fields:
            user.save(update_fields=list(dict.fromkeys(update_fields)))

        Wallet.objects.get_or_create(user=user)

        apply_result = None
        inviter_code = identity.get("inviter_code")

        if inviter_code and not user.inviter_id:
            try:
                logger.info(
                    "[TELEGRAM_IDENTITY] Applying referral: user=%s code=%s",
                    user.id,
                    inviter_code,
                )
                apply_result = apply_referral(inviter_code, user)
                user.refresh_from_db()

                if apply_result.get("ok"):
                    logger.info(
                        "[TELEGRAM_IDENTITY] Referral result user=%s reason=%s",
                        user.id,
                        apply_result.get("reason"),
                    )
                else:
                    logger.warning(
                        "[TELEGRAM_IDENTITY] Referral failed user=%s reason=%s",
                        user.id,
                        apply_result.get("reason"),
                    )
            except Exception as exc:
                logger.exception(
                    "[TELEGRAM_IDENTITY] Could not apply inviter code user=%s code=%s: %s",
                    user.id,
                    inviter_code,
                    str(exc),
                )
                apply_result = {
                    "ok": False,
                    "reason": "error",
                    "message": "Unable to apply referral code.",
                }

    logger.info(
        "[TELEGRAM_IDENTITY] user=%s telegram_id=%s created=%s wallet=%s",
        user.id,
        telegram_id,
        created,
        user.wallet_address,
    )

    referral_meta = _referral_response_meta(user, apply_result)
    return user, identity, referral_meta


def _public_wallet_address(user):
    """Hide internal Telegram placeholder values from API clients."""
    value = str(getattr(user, "wallet_address", "") or "").strip()
    if not value or _is_telegram_placeholder_wallet(value):
        return None
    return value


def _telegram_user_payload(user):
    public_wallet = _public_wallet_address(user)
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "telegram_username": user.telegram_username,
        "telegram_photo_url": user.telegram_photo_url,
        "is_telegram": bool(user.is_telegram_user),
        "telegram_verified": bool(user.telegram_verified),
        "referral_code": user.referral_code,
        "wallet_address": public_wallet,
        "wallet_connected": bool(public_wallet),
    }


@api_view(["GET"])
def referral_count(request):
    """
    Return direct referral count and referral identity using Telegram ID.

    Telegram ID is the only account lookup key for this endpoint.
    A TON wallet is not required. If the Telegram user does not exist yet,
    create the Telegram-only AppUser with the deterministic internal
    telegram:<id> placeholder handled by _get_or_create_telegram_user().
    """
    try:
        user, _identity, referral_meta = _get_or_create_telegram_user(request)

        return Response(
            {
                "count": user.invitees.count(),
                "telegram_id": user.telegram_id,
                "telegram_username": user.telegram_username,
                "telegram_photo_url": user.telegram_photo_url,
                "referral_code": user.referral_code,
                "wallet_connected": bool(_public_wallet_address(user)),
                "user": _telegram_user_payload(user),
                **referral_meta,
            },
            status=status.HTTP_200_OK,
        )

    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    except Exception as exc:
        logger.exception(
            "[REFERRAL_COUNT] Telegram-first lookup failed"
        )
        return Response(
            {
                "error": "Unable to load referral account",
                "detail": str(exc),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# =======================
# Timer endpoints — Telegram ID is the primary identity
# =======================

HOURLY_REWARD = Decimal("100")
COOLDOWN = timedelta(hours=1)


def _hourly_reward_stats(user):
    """Return EPL hourly/referral statistics for one AppUser."""
    daily_qs = user.ledgers.filter(typ="DAILY_UNLOCK")

    total_rewards = (
        daily_qs.aggregate(total=Sum("amount"))["total"]
        or Decimal("0")
    )

    referral_points = (
        user.ledgers
        .filter(typ="REF_BONUS")
        .aggregate(total=Sum("amount"))["total"]
        or Decimal("0")
    )

    return {
        "total_rewards": str(total_rewards),
        "referral_points": str(referral_points),
        "rewards_count": daily_qs.count(),
    }


def _timer_payload(user, *, now=None, referral_meta=None):
    """Build the canonical Timer/EPL payload for Telegram-first clients."""
    now = now or timezone.now()

    Wallet.objects.get_or_create(user=user)
    epl_balance, _ = AssetBalance.objects.get_or_create(
        user=user,
        asset="EPL",
    )

    next_at = user.next_daily_claim_at
    max_next_at = now + COOLDOWN

    # A brand-new user begins a fresh one-hour mining cycle.
    # Also clamp legacy/corrupt timestamps that are farther than one cycle away.
    if not next_at or next_at > max_next_at:
        next_at = max_next_at
        user.next_daily_claim_at = next_at
        user.save(update_fields=["next_daily_claim_at"])

    seconds_remaining = max(
        0,
        int((next_at - now).total_seconds()),
    )

    stats = _hourly_reward_stats(user)
    epl_available = Decimal(str(epl_balance.available or 0))
    epl_total_earned = Decimal(str(epl_balance.total_earned or 0))
    referral_value = stats["referral_points"]

    payload = {
        "status": "ok",
        "seconds_remaining": seconds_remaining,
        "next_claim_at": next_at,
        "reward_amount": str(HOURLY_REWARD),
        "cooldown_seconds": int(COOLDOWN.total_seconds()),

        # Timer values
        "total_rewards": stats["total_rewards"],
        "referral_points": referral_value,
        "rewards_count": stats["rewards_count"],

        # EPL aliases expected by the Timer UI
        "hourly_reward_balance": stats["total_rewards"],
        "hourly_reward_total": stats["total_rewards"],
        "hourly_claims": stats["rewards_count"],
        "daily_reward_unlocked": stats["total_rewards"],
        "referral_bonus": referral_value,
        "referral_bonus_balance": referral_value,
        "referral_bonus_total": referral_value,
        "epl_balance": str(epl_available),
        "withdrawable_epl": str(epl_available),
        "epl_total": str(epl_available),
        "epl_total_earned": str(epl_total_earned),
        "mining_days": stats["rewards_count"],
        "stake_balance": "0",

        # Identity — Telegram is canonical; wallet is optional.
        "telegram_id": user.telegram_id,
        "telegram_username": user.telegram_username,
        "telegram_photo_url": user.telegram_photo_url,
        "referral_code": user.referral_code,
        "wallet_address": _public_wallet_address(user),
        "wallet_connected": bool(_public_wallet_address(user)),
        "user": _telegram_user_payload(user),
        "referral_applied": bool(user.inviter_id),
    }

    if referral_meta:
        payload.update(referral_meta)

    return payload


@api_view(["GET"])
def reward_status(request):
    """
    Return Timer/EPL status by telegram_id.

    Example:
        GET /api/wallet/reward_status/?telegram_id=123456789

    A real TON wallet is NOT required.
    """
    try:
        user, _identity, referral_meta = _get_or_create_telegram_user(request)
        
        # ساخت پاسخ
        response_data = _timer_payload(user, referral_meta=referral_meta)
        
        return Response(
            response_data,
            status=status.HTTP_200_OK,
        )

    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        logger.exception("[REWARD_STATUS] Telegram-first status error")
        return Response(
            {"error": "Unable to load timer status", "detail": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
def tick(request):
    """Claim the hourly EPL reward using telegram_id as the user identity."""
    try:
        user, _identity, referral_meta = _get_or_create_telegram_user(request)

        with transaction.atomic():
            locked_user = (
                AppUser.objects
                .select_for_update()
                .get(pk=user.pk)
            )

            Wallet.objects.select_for_update().get_or_create(
                user=locked_user
            )

            epl_balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=locked_user,
                    asset="EPL",
                )
            )

            now = timezone.now()
            next_at = locked_user.next_daily_claim_at
            max_next_at = now + COOLDOWN

            if not next_at or next_at > max_next_at:
                next_at = max_next_at
                locked_user.next_daily_claim_at = next_at
                locked_user.save(update_fields=["next_daily_claim_at"])

            if next_at > now:
                seconds_remaining = max(
                    0,
                    int((next_at - now).total_seconds()),
                )
                stats = _hourly_reward_stats(locked_user)

                # HTTP 200 intentionally: the frontend treats too_early as a
                # normal Timer state, not as a transport/server failure.
                return Response(
                    {
                        "status": "too_early",
                        "message": f"Please wait {seconds_remaining} seconds",
                        "seconds_remaining": seconds_remaining,
                        "next_claim_at": next_at,
                        "reward_amount": str(HOURLY_REWARD),
                        "cooldown_seconds": int(COOLDOWN.total_seconds()),
                        "total_rewards": stats["total_rewards"],
                        "referral_points": stats["referral_points"],
                        "referral_bonus": stats["referral_points"],
                        "rewards_count": stats["rewards_count"],
                        "hourly_reward_balance": stats["total_rewards"],
                        "epl_balance": str(epl_balance.available or Decimal("0")),
                        "epl_total_earned": str(epl_balance.total_earned or Decimal("0")),
                        "referral_code": locked_user.referral_code,
                        "telegram_id": locked_user.telegram_id,
                        "wallet_address": _public_wallet_address(locked_user),
                        "wallet_connected": bool(_public_wallet_address(locked_user)),
                        "user": _telegram_user_payload(locked_user),
                    },
                    status=status.HTTP_200_OK,
                )

            epl_balance.available = (
                Decimal(str(epl_balance.available or 0))
                + HOURLY_REWARD
            )
            epl_balance.total_earned = (
                Decimal(str(epl_balance.total_earned or 0))
                + HOURLY_REWARD
            )
            epl_balance.save(
                update_fields=["available", "total_earned"]
            )

            Ledger.objects.create(
                user=locked_user,
                typ="DAILY_UNLOCK",
                amount=HOURLY_REWARD,
                meta={
                    "source": "timer",
                    "asset": "EPL",
                    "telegram_id": locked_user.telegram_id,
                },
            )

            locked_user.next_daily_claim_at = now + COOLDOWN
            locked_user.save(update_fields=["next_daily_claim_at"])

        user = AppUser.objects.get(pk=user.pk)
        epl_balance = AssetBalance.objects.get(user=user, asset="EPL")
        stats = _hourly_reward_stats(user)

        return Response(
            {
                "status": "rewarded",
                "message": f"{HOURLY_REWARD} EPL added to your Hourly Reward balance",
                "hourly_reward_balance": stats["total_rewards"],
                "epl_balance": str(epl_balance.available or Decimal("0")),
                "epl_total_earned": str(epl_balance.total_earned or Decimal("0")),
                "reward_amount": str(HOURLY_REWARD),
                "cooldown_seconds": int(COOLDOWN.total_seconds()),
                "total_rewards": stats["total_rewards"],
                "referral_points": stats["referral_points"],
                "referral_bonus": stats["referral_points"],
                "rewards_count": stats["rewards_count"],
                "seconds_remaining": int(COOLDOWN.total_seconds()),
                "next_claim_at": user.next_daily_claim_at,
                "referral_code": user.referral_code,
                "telegram_id": user.telegram_id,
                "wallet_address": _public_wallet_address(user),
                "wallet_connected": bool(_public_wallet_address(user)),
                "user": _telegram_user_payload(user),
            },
            status=status.HTTP_200_OK,
        )

    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        logger.exception("Error in Telegram-first tick")
        return Response(
            {"error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# =======================
# Test Endpoint
# =======================

@api_view(["GET", "POST"])
def test_tick(request):
    """
    تست ساده برای بررسی ارتباط — فقط در حالت DEBUG فعال است.
    """
    if not settings.DEBUG:
        return Response(
            {"error": "Not found"},
            status=status.HTTP_404_NOT_FOUND,
        )

    logger.info("TEST_TICK called method=%s", request.method)

    return Response({
        "status": "ok",
        "message": "Test endpoint working!",
        "method": request.method,
        "data": request.data
    }, status=status.HTTP_200_OK)


# =======================
# Referral Levels API
# =======================

@api_view(["GET"])
def get_referral_levels(request):
    """
    Return the 5-level referral tree using Telegram ID as the account identity.

    Wallet connection is optional and is never required to open the referral
    dashboard or resolve the referral tree.
    """
    try:
        user, _identity, referral_meta = _get_or_create_telegram_user(request)
    except ValueError as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        logger.exception(
            "[REFERRAL_LEVELS] Telegram-first user lookup failed"
        )
        return Response(
            {
                "error": "Unable to load referral levels",
                "detail": str(exc),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    _ = referral_meta

    reconcile_existing_referral_join_rewards(user)

    level_obj = ReferralLevel.objects.filter(user=user).first()

    if not level_obj:
        empty_levels = {
            f"level_{level_number}": {"count": 0, "users": []}
            for level_number in range(1, 6)
        }
        return Response(
            {
                "levels": empty_levels,
                "total_referrals": 0,
                "is_test": False,
                "telegram_id": user.telegram_id,
                "telegram_username": user.telegram_username,
                "referral_code": user.referral_code,
                "wallet_connected": bool(_public_wallet_address(user)),
            },
            status=status.HTTP_200_OK,
        )

    # Build an authoritative purchase-profit index from Ledger once.
    # ReferralLevel JSON is only a display snapshot and can be stale for legacy
    # rows; Ledger is the accounting source of truth.
    ledger_profit_index = {}

    for ledger_row in user.ledgers.filter(
        typ__in=[
            "DIRECT_REFERRAL_BONUS",
            "INDIRECT_REFERRAL_BONUS",
        ]
    ):
        meta = dict(ledger_row.meta or {})

        buyer_wallet = str(meta.get("buyer") or "").strip()
        buyer_user_id = meta.get("buyer_user_id")
        buyer_telegram_id = meta.get("buyer_telegram_id")

        if ledger_row.typ == "DIRECT_REFERRAL_BONUS":
            ledger_level = 1
        else:
            raw_level = str(meta.get("level") or "").lower()
            try:
                ledger_level = int(raw_level.replace("level_", ""))
            except (TypeError, ValueError):
                continue

        if ledger_level < 1 or ledger_level > 5:
            continue

        ledger_asset = str(meta.get("asset") or "ECG").upper()
        if ledger_asset not in {"ECG", "USDT"}:
            ledger_asset = "ECG"

        amount = Decimal(str(ledger_row.amount or 0))
        if amount <= 0:
            continue

        identity_keys = []
        if buyer_user_id is not None:
            identity_keys.append(("user", str(buyer_user_id)))
        if buyer_telegram_id is not None:
            identity_keys.append(("telegram", str(buyer_telegram_id)))
        if buyer_wallet:
            identity_keys.append(("wallet", buyer_wallet))

        for identity_key in identity_keys:
            key = (ledger_level, identity_key)
            bucket = ledger_profit_index.setdefault(
                key,
                {"ECG": Decimal("0"), "USDT": Decimal("0")},
            )
            bucket[ledger_asset] += amount

    def serialize_level_users(stored_users, level_number):
        stored_users = stored_users or []
        stored_users = stored_users[:20]

        wallets = [
            item.get("wallet")
            for item in stored_users
            if isinstance(item, dict) and item.get("wallet")
        ]

        telegram_ids = [
            item.get("telegram_id")
            for item in stored_users
            if isinstance(item, dict) and item.get("telegram_id")
        ]

        users_by_wallet = {
            app_user.wallet_address: app_user
            for app_user in AppUser.objects.filter(
                wallet_address__in=wallets
            )
        }

        users_by_telegram_id = {
            app_user.telegram_id: app_user
            for app_user in AppUser.objects.filter(
                telegram_id__in=telegram_ids
            )
        }

        result = []

        for raw_item in stored_users:
            if isinstance(raw_item, str):
                item = {
                    "wallet": raw_item,
                    "investment": 0,
                    "profit": 0,
                    "profit_ecg": 0,
                    "profit_usdt": 0,
                    "referral_bonus": 0,
                }
            elif isinstance(raw_item, dict):
                item = dict(raw_item)
            else:
                continue

            wallet = str(item.get("wallet") or "").strip()
            telegram_id = item.get("telegram_id")

            app_user = (
                users_by_wallet.get(wallet)
                or users_by_telegram_id.get(telegram_id)
            )

            username = item.get("telegram_username")
            photo_url = item.get("telegram_photo_url")

            if app_user:
                wallet = app_user.wallet_address or wallet
                username = app_user.telegram_username or username
                photo_url = app_user.telegram_photo_url or photo_url
                telegram_id = app_user.telegram_id or telegram_id

            legacy_profit = Decimal(str(item.get("profit", 0) or 0))
            stored_asset = str(item.get("profit_asset", "ECG") or "ECG").upper()

            stored_ecg = item.get("profit_ecg")
            if stored_ecg is None:
                stored_ecg = Decimal("0") if stored_asset == "USDT" else legacy_profit
            else:
                stored_ecg = Decimal(str(stored_ecg or 0))

            stored_usdt = item.get("profit_usdt")
            if stored_usdt is None:
                stored_usdt = legacy_profit if stored_asset == "USDT" else Decimal("0")
            else:
                stored_usdt = Decimal(str(stored_usdt or 0))

            # Prefer authoritative Ledger totals whenever matching accounting
            # rows exist.  Fall back to the snapshot for legacy data that has
            # no corresponding Ledger rows.
            ledger_totals = None
            identity_candidates = []
            if app_user:
                identity_candidates.append(("user", str(app_user.id)))
                if app_user.telegram_id is not None:
                    identity_candidates.append(("telegram", str(app_user.telegram_id)))
            elif telegram_id is not None:
                identity_candidates.append(("telegram", str(telegram_id)))

            if wallet:
                identity_candidates.append(("wallet", wallet))
            original_wallet = str(item.get("wallet") or "").strip()
            if original_wallet and original_wallet != wallet:
                identity_candidates.append(("wallet", original_wallet))

            for identity_key in identity_candidates:
                match = ledger_profit_index.get((level_number, identity_key))
                if match is not None:
                    ledger_totals = match
                    break

            if ledger_totals is not None:
                profit_ecg = ledger_totals["ECG"]
                profit_usdt = ledger_totals["USDT"]
            else:
                profit_ecg = stored_ecg
                profit_usdt = stored_usdt

            profit_asset = (
                "MIXED"
                if profit_ecg > 0 and profit_usdt > 0
                else "USDT"
                if profit_usdt > 0
                else "ECG"
            )

            public_row_wallet = (
                _public_wallet_address(app_user)
                if app_user
                else (
                    wallet
                    if wallet and not _is_telegram_placeholder_wallet(wallet)
                    else None
                )
            )

            result.append({
                "telegram_id": telegram_id,
                "telegram_username": username,
                "telegram_photo_url": photo_url,
                "wallet": public_row_wallet,
                "investment": item.get("investment", 0),
                # Legacy field stays ECG-only.
                "profit": float(profit_ecg),
                "profit_ecg": float(profit_ecg),
                "profit_usdt": float(profit_usdt),
                "profit_asset": profit_asset,
                "referral_bonus": item.get("referral_bonus", 0),
            })

        return result

    levels = {}

    total_referrals = 0

    for level_number in range(1, 6):
        count = getattr(
            level_obj,
            f"level_{level_number}_count"
        )

        stored_users = getattr(
            level_obj,
            f"level_{level_number}_users"
        )

        levels[f"level_{level_number}"] = {
            "count": count,
            "users": serialize_level_users(stored_users, level_number)
        }

        total_referrals += count

    return Response(
        {
            "levels": levels,
            "total_referrals": total_referrals,
            "is_test": False,
            "telegram_id": user.telegram_id,
            "telegram_username": user.telegram_username,
            "referral_code": user.referral_code,
            "wallet_connected": bool(_public_wallet_address(user)),
        },
        status=status.HTTP_200_OK
    )


def generate_test_data_with_columns():
    import random
    
    def generate_user(level):
        telegram_id = random.randint(100000000, 999999999)
        wallet = "0x" + ''.join(random.choices('0123456789abcdef', k=40))
        investment = round(random.uniform(1, 100), 2)
        profit = round(random.uniform(0.01, 5), 4)
        
        usernames = ['alex', 'john_doe', 'crypto_master', 'ton_fan', 'blockchain_dev', 'defi_expert', 'nft_collector']
        telegram_username = random.choice(usernames) + str(random.randint(1, 999))
        
        return {
            "telegram_id": telegram_id,
            "telegram_username": telegram_username,
            "wallet": wallet,
            "investment": investment,
            "profit": profit,
            "referral_bonus": 1000 if level == 1 else 500,
        }
    
    level_counts = {
        "level_1": 3,
        "level_2": 7,
        "level_3": 15,
        "level_4": 31,
        "level_5": 63
    }
    
    return {
        "level_1": {
            "count": level_counts["level_1"],
            "users": [generate_user(1) for _ in range(level_counts["level_1"])]
        },
        "level_2": {
            "count": level_counts["level_2"],
            "users": [generate_user(2) for _ in range(level_counts["level_2"])]
        },
        "level_3": {
            "count": level_counts["level_3"],
            "users": [generate_user(3) for _ in range(level_counts["level_3"])]
        },
        "level_4": {
            "count": level_counts["level_4"],
            "users": [generate_user(4) for _ in range(level_counts["level_4"])]
        },
        "level_5": {
            "count": level_counts["level_5"],
            "users": [generate_user(5) for _ in range(level_counts["level_5"])]
        }
    }


# =======================
# USDT Purchase Endpoints
# =======================

@api_view(["POST"])
def create_purchase_usdt(request):
    logger.info("=" * 60)
    logger.info("💰 CREATE_PURCHASE_USDT CALLED")
    logger.info(f"📥 Data: {request.data}")
    
    wallet_address = request.data.get("wallet_address")
    usdt_amount = request.data.get("usdt_amount")
    usdt_tx_hash = request.data.get("usdt_tx_hash")

    if not wallet_address or not usdt_amount or not usdt_tx_hash:
        logger.error("❌ Missing fields")
        return Response({"error": "missing fields"}, status=400)

    try:
        usdt_amount = Decimal(str(usdt_amount))
        if usdt_amount <= 0:
            raise ValueError()
    except:
        logger.error("❌ Invalid usdt_amount")
        return Response({"error": "invalid usdt_amount"}, status=400)

    user = get_or_create_user(wallet_address, None, False)

    try:
        p = register_purchase_usdt(user, usdt_amount, str(usdt_tx_hash))
        logger.info(f"✅ USDT Purchase created: {p.invoice_no}")
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return Response({"error": str(e)}, status=400)

    return Response({
        "id": p.id,
        "invoice_no": p.invoice_no,
        "usdt_amount": str(p.usdt_amount),
        "ecg_value": str(p.ecg_value),
        "self_profit_5": str(p.self_profit_5),
        "principal_unlock_at": p.principal_unlock_at,
        "self_profit_unlock_at": p.self_profit_unlock_at,
    }, status=201)


@api_view(["GET"])
def list_purchases_usdt(request):
    wallet_address = request.query_params.get("wallet")

    if not wallet_address:
        return Response({"error": "wallet param required"}, status=400)

    user = AppUser.objects.filter(wallet_address=wallet_address).first()
    if not user:
        return Response([], status=status.HTTP_200_OK)

    qs = user.purchases_usdt.all().order_by("-created_at")

    return Response([{
        "id": p.id,
        "invoice_no": p.invoice_no,
        "usdt_amount": str(p.usdt_amount),
        "ecg_value": str(p.ecg_value),
        "self_profit_5": str(p.self_profit_5),
        "principal_unlock_at": p.principal_unlock_at,
        "self_profit_unlock_at": p.self_profit_unlock_at,
        "usdt_tx_hash": p.usdt_tx_hash,
    } for p in qs])


# =======================
# BNB Purchase Endpoints
# =======================

@api_view(["POST"])
def create_purchase_bnb(request):
    logger.info("=" * 60)
    logger.info("💰 CREATE_PURCHASE_BNB CALLED")
    logger.info(f"📥 Data: {request.data}")
    
    wallet_address = request.data.get("wallet_address")
    bnb_amount = request.data.get("bnb_amount")
    bnb_tx_hash = request.data.get("bnb_tx_hash")

    if not wallet_address or not bnb_amount or not bnb_tx_hash:
        logger.error("❌ Missing fields")
        return Response({"error": "missing fields"}, status=400)

    try:
        bnb_amount = Decimal(str(bnb_amount))
        if bnb_amount <= 0:
            raise ValueError()
    except:
        logger.error("❌ Invalid bnb_amount")
        return Response({"error": "invalid bnb_amount"}, status=400)

    user = get_or_create_user(wallet_address, None, False)

    try:
        p = register_purchase_bnb(user, bnb_amount, str(bnb_tx_hash))
        logger.info(f"✅ BNB Purchase created: {p.invoice_no}")
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return Response({"error": str(e)}, status=400)

    return Response({
        "id": p.id,
        "invoice_no": p.invoice_no,
        "bnb_amount": str(p.bnb_amount),
        "usd_value": str(p.usd_value),
        "ecg_value": str(p.ecg_value),
        "self_profit_5": str(p.self_profit_5),
        "principal_unlock_at": p.principal_unlock_at,
        "self_profit_unlock_at": p.self_profit_unlock_at,
    }, status=201)


@api_view(["GET"])
def list_purchases_bnb(request):
    wallet_address = request.query_params.get("wallet")

    if not wallet_address:
        return Response({"error": "wallet param required"}, status=400)

    user = AppUser.objects.filter(wallet_address=wallet_address).first()
    if not user:
        return Response([], status=status.HTTP_200_OK)

    qs = user.purchases_bnb.all().order_by("-created_at")

    return Response([{
        "id": p.id,
        "invoice_no": p.invoice_no,
        "bnb_amount": str(p.bnb_amount),
        "usd_value": str(p.usd_value),
        "ecg_value": str(p.ecg_value),
        "self_profit_5": str(p.self_profit_5),
        "principal_unlock_at": p.principal_unlock_at,
        "self_profit_unlock_at": p.self_profit_unlock_at,
        "bnb_tx_hash": p.bnb_tx_hash,
    } for p in qs])


@csrf_exempt
def create_ton_transaction(request):
    """
    Build the TON Connect transaction payload only.

    IMPORTANT:
    This endpoint MUST NOT create a Purchase row.
    A Purchase is created later by create_purchase() only after TonConnect
    returns a signed BOC.

    Telegram ID is the application identity; wallet_address must match the
    wallet already connected to that Telegram account.
    """
    if request.method != "POST":
        return JsonResponse(
            {
                "status": "error",
                "message": "POST required",
            },
            status=405,
        )

    try:
        body = json.loads(request.body or b"{}")

        logger.info("=" * 60)
        logger.info("🚀 CREATE TON TRANSACTION / TELEGRAM-FIRST")
        logger.info("DATA KEYS: %s", list(body.keys()))
        logger.info("=" * 60)

        wallet_address = str(
            body.get("wallet_address", "") or ""
        ).strip()

        raw_telegram_id = (
            body.get("telegram_id")
            or request.headers.get("X-Telegram-Id")
        )

        amount_raw = body.get("amount")
        network = str(
            body.get("network", "-239") or "-239"
        ).strip()

        if not wallet_address:
            return JsonResponse(
                {
                    "status": "error",
                    "message": "wallet_address required",
                    "code": "wallet_required",
                },
                status=400,
            )

        if raw_telegram_id in (None, ""):
            return JsonResponse(
                {
                    "status": "error",
                    "message": "telegram_id required",
                    "code": "telegram_id_required",
                },
                status=400,
            )

        try:
            telegram_id = int(raw_telegram_id)
            if telegram_id <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            return JsonResponse(
                {
                    "status": "error",
                    "message": "Invalid telegram_id",
                },
                status=400,
            )

        try:
            amount = int(str(amount_raw))
            if amount <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            return JsonResponse(
                {
                    "status": "error",
                    "message": "amount must be a positive nanoTON integer",
                },
                status=400,
            )

        if network not in {"-239", "-3"}:
            return JsonResponse(
                {
                    "status": "error",
                    "message": "Invalid TON network",
                },
                status=400,
            )

        gram_address = str(
            getattr(settings, "GRAM_MERCHANT_ADDRESS", "") or ""
        ).strip()

        if not gram_address:
            return JsonResponse(
                {
                    "status": "error",
                    "message": "GRAM_MERCHANT_ADDRESS is not configured",
                },
                status=500,
            )

        user = AppUser.objects.filter(
            telegram_id=telegram_id
        ).first()

        if not user:
            return JsonResponse(
                {
                    "status": "error",
                    "message":
                        "Telegram account not found. Connect your wallet first.",
                    "code": "telegram_user_not_found",
                },
                status=404,
            )

        connected_wallet = _public_wallet_address(user)

        if not connected_wallet:
            return JsonResponse(
                {
                    "status": "error",
                    "message":
                        "No TON wallet is connected to this Telegram account.",
                    "code": "wallet_not_connected",
                },
                status=409,
            )

        if connected_wallet != wallet_address:
            return JsonResponse(
                {
                    "status": "error",
                    "message":
                        "Connected wallet does not match this Telegram account.",
                    "code": "wallet_mismatch",
                },
                status=409,
            )

        logger.info(
            "[CREATE_TX] telegram_id=%s user=%s wallet=%s amount=%s network=%s",
            telegram_id,
            user.id,
            wallet_address,
            amount,
            network,
        )

        # No Purchase row is created here.
        return JsonResponse(
            {
                "status": "ok",
                "telegram_id": telegram_id,
                "wallet_address": wallet_address,
                "gram_address": gram_address,
                "gram_amount": str(amount),
                "transaction": {
                    "validUntil": int(time.time()) + 300,
                    "messages": [
                        {
                            "address": gram_address,
                            "amount": str(amount),
                        }
                    ],
                },
            },
            status=200,
        )

    except json.JSONDecodeError:
        return JsonResponse(
            {
                "status": "error",
                "message": "Invalid JSON body",
            },
            status=400,
        )

    except Exception as exc:
        logger.exception(
            "❌ CREATE TON TRANSACTION TELEGRAM-FIRST ERROR"
        )
        return JsonResponse(
            {
                "status": "error",
                "message": str(exc),
            },
            status=500,
        )