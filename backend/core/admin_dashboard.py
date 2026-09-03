# backend/core/admin_dashboard.py

import os
from decimal import Decimal

import pyotp
import requests

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


def _money(value):
    return str(value if value is not None else Decimal("0"))


def _admin_allowed(request):
    otp = request.headers.get("X-Admin-OTP", "").strip()
    secret = os.getenv("ADMIN_2FA_SECRET", "").strip()

    if not otp or not secret:
        return False

    try:
        return pyotp.TOTP(secret).verify(
            otp,
            valid_window=1
        )
    except Exception:
        return False


def _treasury_balance():
    return {
        "address": os.getenv("TREASURY_TON_ADDRESS", ""),
        "balance_ton": None,
        "minimum_ton": "100",
        "low_balance": None,
        "error": ""
    }


@api_view(["GET"])
def admin_system_dashboard(request):

    if not _admin_allowed(request):
        return Response(
            {"error": "Admin access denied."},
            status=status.HTTP_403_FORBIDDEN
        )

    users = []

    users_qs = (
        AppUser.objects
        .select_related("wallet", "inviter")
        .prefetch_related("asset_balances")
        .annotate(
            referral_count=Count(
                "invitees",
                distinct=True
            )
        )
        .order_by("-created_at")
    )

    for user in users_qs[:500]:

        wallet = getattr(user, "wallet", None)

        usdt = None
        ecg = None

        for asset in user.asset_balances.all():
            if asset.asset == "USDT":
                usdt = asset
            if asset.asset == "ECG":
                ecg = asset

        users.append({
            "id": user.id,
            "telegram_id": user.telegram_id,
            "username": user.telegram_username,
            "wallet_address": user.wallet_address,
            "referral_code": user.referral_code,

            "is_active": user.is_active,
            "created_at": user.created_at,

            "total_investment": _money(
                user.total_investment
            ),
            "total_earned": _money(
                user.total_earned
            ),

            "ecg_self_locked": _money(
                wallet.ecg_self_locked if wallet else 0
            ),
            "ecg_self_unlocked": _money(
                wallet.ecg_self_unlocked if wallet else 0
            ),
            "ecg_referral_profit": _money(
                wallet.ecg_referral_profit if wallet else 0
            ),

            "usdt_self_locked": _money(
                wallet.usdt_self_locked if wallet else 0
            ),
            "usdt_self_unlocked": _money(
                wallet.usdt_self_unlocked if wallet else 0
            ),
            "usdt_referral_profit": _money(
                wallet.usdt_referral_profit if wallet else 0
            ),

            "ecg_available": _money(
                ecg.available if ecg else 0
            ),
            "usdt_available": _money(
                usdt.available if usdt else 0
            ),
        })


    withdrawals = []

    for item in WithdrawRequest.objects.select_related("user").order_by("-created_at")[:500]:
        withdrawals.append({
            "id": item.id,
            "username": item.user.telegram_username,
            "wallet_address": item.user.wallet_address,
            "source_asset": item.source_asset,
            "asset": item.asset,
            "amount": _money(item.amount),
            "wallet": item.wallet_address,
            "status": item.status,
            "tx_hash": item.tx_hash,
            "created_at": item.created_at,
        })


    purchases = []

    for item in Purchase.objects.select_related("user").order_by("-created_at")[:500]:
        purchases.append({
            "id": item.id,
            "invoice_no": item.invoice_no,
            "username": item.user.telegram_username,
            "output_asset": item.output_asset,
            "output_amount": _money(item.output_amount),
            "ton_amount": _money(item.ton_amount),
            "usd_value": _money(item.usd_value),
            "created_at": item.created_at,
        })


    wallet_total = Wallet.objects.aggregate(
        ecg_self_locked=Sum("ecg_self_locked"),
        ecg_self_unlocked=Sum("ecg_self_unlocked"),
        ecg_referral_profit=Sum("ecg_referral_profit"),
        usdt_self_locked=Sum("usdt_self_locked"),
        usdt_self_unlocked=Sum("usdt_self_unlocked"),
        usdt_referral_profit=Sum("usdt_referral_profit"),
    )


    return Response({
        "summary": {
            "total_users": users_qs.count(),

            "ecg_self_locked": _money(
                wallet_total["ecg_self_locked"]
            ),
            "ecg_self_unlocked": _money(
                wallet_total["ecg_self_unlocked"]
            ),
            "ecg_referral_profit": _money(
                wallet_total["ecg_referral_profit"]
            ),

            "usdt_self_locked": _money(
                wallet_total["usdt_self_locked"]
            ),
            "usdt_self_unlocked": _money(
                wallet_total["usdt_self_unlocked"]
            ),
            "usdt_referral_profit": _money(
                wallet_total["usdt_referral_profit"]
            ),

            "treasury": _treasury_balance(),
        },

        "users": users,
        "purchases": purchases,
        "withdrawals": withdrawals,
    })
