from django.urls import path

from . import views
from .admin_dashboard import admin_system_dashboard


urlpatterns = [

    # ========================================================
    # CONNECT WALLET
    # ========================================================

    path(
        "connect/",
        views.connect_wallet,
        name="connect_wallet",
    ),


    # ========================================================
    # WALLET
    # مسیرهای ثابت باید قبل از مسیر داینامیک باشند
    # ========================================================

    path(
        "wallet/reward_status/",
        views.reward_status,
        name="reward_status",
    ),

    path(
        "wallet/tick/",
        views.tick,
        name="tick",
    ),


    # ========================================================
    # WALLET DYNAMIC
    # ========================================================

    path(
        "wallet/<str:wallet_address>/",
        views.wallet_view,
        name="wallet_view",
    ),


    # ========================================================
    # PURCHASE ECG WITH TON
    # ========================================================

    path(
        "purchase/create/",
        views.create_purchase,
        name="create_purchase",
    ),

    path(
        "purchase/list/",
        views.list_purchases,
        name="list_purchases",
    ),


    # ========================================================
    # PURCHASE ECG WITH USDT
    # ========================================================

    path(
        "purchase/usdt/create/",
        views.create_purchase_usdt,
        name="create_purchase_usdt",
    ),

    path(
        "purchase/usdt/list/",
        views.list_purchases_usdt,
        name="list_purchases_usdt",
    ),


    # ========================================================
    # PURCHASE ECG WITH BNB
    # ========================================================

    path(
        "purchase/bnb/create/",
        views.create_purchase_bnb,
        name="create_purchase_bnb",
    ),

    path(
        "purchase/bnb/list/",
        views.list_purchases_bnb,
        name="list_purchases_bnb",
    ),


    # ========================================================
    # TON TRANSACTION
    # ========================================================

    path(
        "purchase/create-transaction/",
        views.create_ton_transaction,
        name="create_ton_transaction",
    ),


    # ========================================================
    # WITHDRAWAL
    #
    # ECG و TON هر دو ابتدا PENDING
    # ========================================================

    path(
        "withdraw/request/",
        views.request_withdraw,
        name="request_withdraw",
    ),

    path(
        "withdraw/history/",
        views.withdraw_history,
        name="withdraw_history",
    ),


    # ========================================================
    # ADMIN DASHBOARD
    #
    # GET /api/admin/system-dashboard/
    # ========================================================

    path(
        "admin/system-dashboard/",
        admin_system_dashboard,
        name="admin-system-dashboard",
    ),


    # ========================================================
    # ADMIN LOGIN SESSION
    #
    # POST /api/admin/session/
    #
    # Header:
    # X-Admin-OTP: 123456
    #
    # Response:
    # {
    #     "admin_session": "..."
    # }
    # ========================================================

    path(
        "admin/session/",
        views.admin_create_session,
        name="admin-create-session",
    ),


    # ========================================================
    # COMPLETE WITHDRAW
    #
    # POST:
    # /api/admin/withdrawals/1/complete/
    #
    # Header:
    # X-Admin-Session: ...
    #
    # Body:
    # {
    #     "tx_hash": "..."
    # }
    #
    # PENDING -> SUCCESS
    # UI = Complete
    # ========================================================

    path(
        "admin/withdrawals/<int:withdraw_id>/complete/",
        views.admin_complete_withdraw,
        name="admin-complete-withdraw",
    ),


    # ========================================================
    # REFERRAL
    # ========================================================

    path(
        "referrals/count/",
        views.referral_count,
        name="referral_count",
    ),

    path(
        "referral/levels/",
        views.get_referral_levels,
        name="referral_levels",
    ),


    # ========================================================
    # TEST
    # ========================================================

    path(
        "test/",
        views.test_tick,
        name="test_tick",
    ),
]