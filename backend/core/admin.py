# backend/core/admin.py

from django.contrib import admin
from .models import AppUser, Wallet, Ledger, Purchase, PurchaseUSDT, PurchaseBNB, WithdrawRequest, ReferralLevel,AssetBalance

# ==========================================
# AppUser Admin
# ==========================================
@admin.register(AppUser)
class AppUserAdmin(admin.ModelAdmin):
    list_display = (
        "id", 
        "wallet_address", 
        "telegram_id",
        "referral_code", 
        "inviter", 
        "is_telegram_user",
        "telegram_verified",
        "wallet_locked",
        "created_at"
    )
    list_filter = (
        "is_telegram_user", 
        "telegram_verified", 
        "wallet_locked",
        "created_at"
    )
    search_fields = (
        "wallet_address", 
        "referral_code", 
        "telegram_id",
        "inviter__wallet_address"
    )
    readonly_fields = ("created_at", "referral_code")
    ordering = ("-created_at",)
    
    fieldsets = (
        ("اطلاعات اصلی", {
            "fields": ("wallet_address", "telegram_id", "created_at")
        }),
        ("سیستم رفرال", {
            "fields": ("referral_code", "inviter", "next_daily_claim_at")
        }),
        ("وضعیت کاربر", {
            "fields": ("is_telegram_user", "telegram_verified", "wallet_locked")
        }),
    )

# ==========================================
# Wallet Admin
# ==========================================
# ==========================================
# Wallet Admin
# ==========================================

# ==========================================
# Wallet Admin (Legacy)
# ==========================================

@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "user",
        "created_at",
        "updated_at",
    )

    search_fields = (
        "user__wallet_address",
        "user__telegram_id",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    fieldsets = (
        ("User", {
            "fields": (
                "user",
            )
        }),

        ("Legacy Wallet", {
            "fields": (
                "created_at",
                "updated_at",
            )
        }),
    )


# ==========================================
# AssetBalance Admin
# ==========================================

@admin.register(AssetBalance)
class AssetBalanceAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "user",
        "asset",
        "available",
        "locked",
        "total_earned",
    )

    list_filter = (
        "asset",
    )

    search_fields = (
        "user__wallet_address",
        "user__telegram_id",
    )

    fieldsets = (
        ("User", {
            "fields": (
                "user",
            )
        }),

        ("Asset", {
            "fields": (
                "asset",
            )
        }),

        ("Balance", {
            "fields": (
                "available",
                "locked",
                "total_earned",
            )
        }),
    )

# ==========================================
# Ledger Admin
# ==========================================
@admin.register(Ledger)
class LedgerAdmin(admin.ModelAdmin):
    list_display = (
        "id", 
        "user", 
        "typ", 
        "amount", 
        "created_at"
    )
    list_filter = (
        "typ", 
        "created_at"
    )
    search_fields = (
        "user__wallet_address", 
        "user__telegram_id"
    )
    readonly_fields = ("created_at",)
    
    fieldsets = (
        ("اطلاعات تراکنش", {
            "fields": ("user", "typ", "amount", "meta")
        }),
        ("زمان", {
            "fields": ("created_at",)
        }),
    )

# ==========================================
# Purchase Admin (TON)
# ==========================================
@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = (
        "id", 
        "invoice_no", 
        "user", 
        "ton_amount", 
        "usd_value", 
        "ecg_value", 
        "created_at"
    )
    list_filter = ("created_at",)
    search_fields = (
        "invoice_no", 
        "ton_tx_hash", 
        "user__wallet_address"
    )
    readonly_fields = ("created_at",)
    
    fieldsets = (
        ("کاربر و فاکتور", {
            "fields": ("user", "invoice_no")
        }),
        ("مبالغ TON", {
            "fields": ("ton_amount", "ton_tx_hash", "ton_usd_rate")
        }),
        ("مبالغ USD", {
            "fields": ("usd_value",)
        }),
        ("مبالغ ECG", {
            "fields": ("ecg_value", "self_profit_5")
        }),
        ("زمان قفل", {
            "fields": ("principal_unlock_at", "self_profit_unlock_at")
        }),
        ("زمان ثبت", {
            "fields": ("created_at",)
        }),
    )

# ==========================================
# Purchase USDT Admin
# ==========================================
@admin.register(PurchaseUSDT)
class PurchaseUSDTAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "invoice_no",
        "user",
        "usdt_amount",
        "usd_value",
        "ecg_value",
    )

    search_fields = (
        "invoice_no",
        "usdt_tx_hash",
        "user__wallet_address",
    )

    fieldsets = (
        ("کاربر و فاکتور", {
            "fields": (
                "user",
                "invoice_no",
            )
        }),

        ("مبالغ USDT", {
            "fields": (
                "usdt_amount",
                "usdt_tx_hash",
                "usdt_usd_rate",
            )
        }),

        ("مبالغ USD", {
            "fields": (
                "usd_value",
            )
        }),

        ("مبالغ ECG", {
            "fields": (
                "ecg_value",
                "self_profit_5",
            )
        }),

        ("زمان قفل", {
            "fields": (
                "principal_unlock_at",
                "self_profit_unlock_at",
            )
        }),
    )

# ==========================================
# Purchase BNB Admin
# ==========================================
@admin.register(PurchaseBNB)
class PurchaseBNBAdmin(admin.ModelAdmin):
    list_display = (
        "id", 
        "invoice_no", 
        "user", 
        "bnb_amount", 
        "usd_value", 
        "ecg_value", 
        "created_at"
    )
    list_filter = ("created_at",)
    search_fields = (
        "invoice_no", 
        "bnb_tx_hash", 
        "user__wallet_address"
    )
    readonly_fields = ("created_at",)
    
    fieldsets = (
        ("کاربر و فاکتور", {
            "fields": ("user", "invoice_no")
        }),
        ("مبالغ BNB", {
            "fields": ("bnb_amount", "bnb_tx_hash", "bnb_usd_rate")
        }),
        ("مبالغ USD", {
            "fields": ("usd_value",)
        }),
        ("مبالغ ECG", {
            "fields": ("ecg_value", "self_profit_5")
        }),
        ("زمان قفل", {
            "fields": ("principal_unlock_at", "self_profit_unlock_at")
        }),
        ("زمان ثبت", {
            "fields": ("created_at",)
        }),
    )

# ==========================================
# WithdrawRequest Admin
# ==========================================

@admin.register(WithdrawRequest)
class WithdrawRequestAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "user",
        "source_asset",
        "asset",
        "amount",
        "wallet_address",
        "status",
        "created_at",
    )

    list_filter = (
        "status",
        "source_asset",
        "asset",
        "created_at",
    )

    search_fields = (
        "user__wallet_address",
        "wallet_address",
        "tx_hash",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )
# ==========================================
# ReferralLevel Admin
# ==========================================
# ==========================================
# ReferralLevel Admin
# ==========================================

# ==========================================
# ReferralLevel Admin
# ==========================================

@admin.register(ReferralLevel)
class ReferralLevelAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "user",
        "level_1_count",
        "level_2_count",
        "level_3_count",
        "level_4_count",
        "level_5_count",
        "updated_at",
    )

    list_filter = (
        "updated_at",
    )

    search_fields = (
        "user__wallet_address",
        "user__telegram_id",
    )

    readonly_fields = (
        "updated_at",
    )

    fieldsets = (

        ("User", {
            "fields": (
                "user",
            )
        }),

        ("Level Counts", {
            "fields": (
                "level_1_count",
                "level_2_count",
                "level_3_count",
                "level_4_count",
                "level_5_count",
            )
        }),

        ("Level Users", {
            "fields": (
                "level_1_users",
                "level_2_users",
                "level_3_users",
                "level_4_users",
                "level_5_users",
            ),
            "classes": (
                "collapse",
            )
        }),

        ("Dates", {
            "fields": (
                "updated_at",
            )
        }),
    )