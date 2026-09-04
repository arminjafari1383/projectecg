# backend/core/admin_dashboard.py

import os
from decimal import Decimal

import pyotp

from django.core import signing
from django.db.models import Count, Sum
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import (
    AppUser,
    Wallet,
    AssetBalance,
    Purchase,
    WithdrawRequest,
    Ledger,
)


ADMIN_SESSION_SALT = "core.admin-session.v1"


def _money(value):
    return str(value if value is not None else Decimal("0"))


def _session_max_age():
    try:
        return max(300, int(os.getenv("ADMIN_SESSION_MAX_AGE", "43200")))
    except (TypeError, ValueError):
        return 43200


def _admin_session_allowed(request):
    """Accept the signed session created by /api/admin/session/."""
    token = str(request.headers.get("X-Admin-Session", "") or "").strip()
    if not token:
        return False

    try:
        payload = signing.loads(
            token,
            salt=ADMIN_SESSION_SALT,
            max_age=_session_max_age(),
        )
    except Exception:
        return False

    return (
        isinstance(payload, dict)
        and payload.get("role") == "admin"
        and payload.get("v") == 1
    )


def _admin_otp_allowed(request):
    """Keep OTP access as a backwards-compatible fallback."""
    otp = str(request.headers.get("X-Admin-OTP", "") or "").strip()
    secret = str(os.getenv("ADMIN_2FA_SECRET", "") or "").strip()

    if not otp or not secret:
        return False

    try:
        return pyotp.TOTP(secret).verify(otp, valid_window=1)
    except Exception:
        return False


def _admin_allowed(request):
    return _admin_session_allowed(request) or _admin_otp_allowed(request)


def _treasury_balance():
    # Existing project does not currently query the TON chain here.
    return {
        "address": os.getenv("TREASURY_TON_ADDRESS", ""),
        "balance_ton": None,
        "minimum_ton": "100",
        "low_balance": None,
        "error": "",
    }


def _ledger_sum(user, typ):
    return (
        user.ledgers.filter(typ=typ).aggregate(total=Sum("amount"))["total"]
        or Decimal("0")
    )


def _withdraw_meta(item):
    ledger = (
        Ledger.objects
        .filter(user=item.user, typ="WITHDRAW", meta__withdraw_id=item.id)
        .order_by("-id")
        .first()
    )
    return dict(ledger.meta or {}) if ledger else {}


@api_view(["GET"])
def admin_system_dashboard(request):
    """
    Admin dashboard payload matched to the React AdminDashboard.

    Authentication:
      - X-Admin-Session: signed token returned by /api/admin/session/
      - X-Admin-OTP: legacy fallback
    """

    if not _admin_allowed(request):
        return Response(
            {"error": "Admin session is missing, expired, or invalid."},
            status=status.HTTP_403_FORBIDDEN,
        )

    users_qs = (
        AppUser.objects
        .select_related("wallet", "inviter")
        .prefetch_related("asset_balances", "ledgers")
        .annotate(referral_count=Count("invitees", distinct=True))
        .order_by("-created_at")
    )

    users = []

    for user in users_qs[:500]:
        wallet = getattr(user, "wallet", None)

        assets = {
            row.asset: row
            for row in user.asset_balances.all()
        }

        ecg = assets.get("ECG")
        epl = assets.get("EPL")
        usdt = assets.get("USDT")

        users.append({
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.telegram_username or "",
            "wallet_address": user.wallet_address or "",
            "referral_code": user.referral_code,
            "referral_count": user.referral_count,
            "is_active": user.is_active,
            "last_active": user.last_active,
            "created_at": user.created_at,

            "total_investment": _money(user.total_investment),
            "total_earned": _money(user.total_earned),

            # Current wallet accounting fields.
            "ecg_self_locked": _money(wallet.ecg_self_locked if wallet else 0),
            "ecg_self_unlocked": _money(wallet.ecg_self_unlocked if wallet else 0),
            "ecg_referral_profit": _money(wallet.ecg_referral_profit if wallet else 0),
            "usdt_self_locked": _money(wallet.usdt_self_locked if wallet else 0),
            "usdt_self_unlocked": _money(wallet.usdt_self_unlocked if wallet else 0),
            "usdt_referral_profit": _money(wallet.usdt_referral_profit if wallet else 0),

            # Authoritative AssetBalance values used by the app APIs.
            "ecg_available": _money(ecg.available if ecg else 0),
            "ecg_locked": _money(ecg.locked if ecg else 0),
            "usdt_available": _money(usdt.available if usdt else 0),
            "usdt_locked": _money(usdt.locked if usdt else 0),
            "epl_balance": _money(epl.available if epl else 0),
            "epl_locked": _money(epl.locked if epl else 0),
            "epl_total_earned": _money(epl.total_earned if epl else 0),

            # EPL sources shown separately in the dashboard.
            "timer_reward_total": _money(_ledger_sum(user, "DAILY_UNLOCK")),
            "referral_epl_total": _money(_ledger_sum(user, "REF_BONUS")),
        })

    purchases = []
    purchase_qs = (
        Purchase.objects
        .select_related("user")
        .order_by("-created_at")[:500]
    )

    for item in purchase_qs:
        purchases.append({
            "id": item.id,
            "invoice_no": item.invoice_no,
            "username": item.user.telegram_username or "",
            "wallet_address": item.user.wallet_address or "",
            "ton_amount": _money(item.ton_amount),
            "ton_usd_rate": _money(item.ton_usd_rate),
            "usd_value": _money(item.usd_value),
            "ecg_value": _money(item.ecg_value),
            "output_amount": _money(item.output_amount),
            "output_asset": item.output_asset,
            "self_profit_5": _money(item.self_profit_5),
            "profit_asset": item.profit_asset,
            "tx_hash": item.ton_tx_hash,
            "created_at": item.created_at,
        })

    withdrawals = []
    withdrawal_qs = (
        WithdrawRequest.objects
        .select_related("user")
        .order_by("-created_at")[:500]
    )

    for item in withdrawal_qs:
        meta = _withdraw_meta(item)
        raw_status = str(item.status or "").upper()
        completed = raw_status in {"PAID", "SUCCESS", "COMPLETE", "COMPLETED"}
        asset = str(item.asset or "").upper()

        requested_ton = str(meta.get("requested_ton") or "0")
        requested_amount = (
            requested_ton
            if asset in {"TON", "GRAM"}
            else str(meta.get("requested_amount") or item.amount)
        )

        withdrawals.append({
            "id": item.id,
            "username": item.user.telegram_username or "",
            # Connected account wallet.
            "wallet_address": item.user.wallet_address or "",
            # Destination entered for this withdrawal.
            "destination_wallet": item.wallet_address or "",
            "source_asset": item.source_asset,
            "asset": item.asset,
            "amount": _money(item.amount),
            "ton_amount": requested_ton,
            "requested_amount": requested_amount,
            "status": item.status,
            "display_status": "COMPLETE" if completed else raw_status,
            "tx_hash": item.tx_hash or "",
            "created_at": item.created_at,
            "completed_at": item.updated_at if completed else None,
        })

    wallet_total = Wallet.objects.aggregate(
        ecg_self_locked=Sum("ecg_self_locked"),
        ecg_self_unlocked=Sum("ecg_self_unlocked"),
        ecg_referral_profit=Sum("ecg_referral_profit"),
        usdt_self_locked=Sum("usdt_self_locked"),
        usdt_self_unlocked=Sum("usdt_self_unlocked"),
        usdt_referral_profit=Sum("usdt_referral_profit"),
    )

    epl_total = AssetBalance.objects.filter(asset="EPL").aggregate(
        available=Sum("available"),
        total_earned=Sum("total_earned"),
    )

    ecg_total = AssetBalance.objects.filter(asset="ECG").aggregate(
        available=Sum("available"),
    )

    usdt_total = AssetBalance.objects.filter(asset="USDT").aggregate(
        available=Sum("available"),
    )

    purchase_total = Purchase.objects.aggregate(
        ton=Sum("ton_amount"),
        usd=Sum("usd_value"),
    )

    referral_epl = Ledger.objects.filter(typ="REF_BONUS").aggregate(total=Sum("amount"))
    timer_epl = Ledger.objects.filter(typ="DAILY_UNLOCK").aggregate(total=Sum("amount"))

    return Response({
        "summary": {
            "total_users": users_qs.count(),
            "active_users": users_qs.filter(is_active=True).count(),
            "total_purchases": Purchase.objects.count(),
            "total_ton_received": _money(purchase_total["ton"]),
            "total_usd_value": _money(purchase_total["usd"]),

            "ecg_self_locked": _money(wallet_total["ecg_self_locked"]),
            "ecg_self_unlocked": _money(wallet_total["ecg_self_unlocked"]),
            "ecg_referral_profit": _money(wallet_total["ecg_referral_profit"]),
            "usdt_self_locked": _money(wallet_total["usdt_self_locked"]),
            "usdt_self_unlocked": _money(wallet_total["usdt_self_unlocked"]),
            "usdt_referral_profit": _money(wallet_total["usdt_referral_profit"]),

            "ecg_available": _money(ecg_total["available"]),
            "usdt_available": _money(usdt_total["available"]),
            "epl_available": _money(epl_total["available"]),
            "epl_total_earned": _money(epl_total["total_earned"]),
            "referral_epl_total": _money(referral_epl["total"]),
            "timer_epl_total": _money(timer_epl["total"]),

            "pending_withdrawals": WithdrawRequest.objects.filter(status="PENDING").count(),
            "treasury": _treasury_balance(),
        },
        "users": users,
        "purchases": purchases,
        "withdrawals": withdrawals,
    })
