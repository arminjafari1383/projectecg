# backend/core/models.py
from decimal import Decimal
from django.db import models
from django.utils import timezone
from django.db.models import F
import uuid

class AppUser(models.Model):
    telegram_id = models.BigIntegerField(unique=True, null=True, blank=True)
    telegram_username = models.CharField(max_length=100, null=True, blank=True, help_text="یوزرنیم تلگرام کاربر")
    telegram_photo_url = models.URLField(
        max_length=1000,
        null=True,
        blank=True,
        help_text="آدرس آواتار تلگرام کاربر"
    )
    wallet_address = models.CharField(max_length=128, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # referral
    referral_code = models.CharField(max_length=32, unique=True, blank=True)
    inviter = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="invitees")
    next_daily_claim_at = models.DateTimeField(null=True, blank=True)

    is_telegram_user = models.BooleanField(default=False)
    telegram_verified = models.BooleanField(default=False)
    wallet_locked = models.BooleanField(default=False)
    
    # ==========================================
    # ✅ فیلدهای جدید
    # ==========================================
    is_admin = models.BooleanField(default=False, help_text="آیا کاربر ادمین است؟")
    is_active = models.BooleanField(default=True, help_text="آیا کاربر فعال است؟")
    last_active = models.DateTimeField(null=True, blank=True, help_text="آخرین فعالیت کاربر")
    total_investment = models.DecimalField(max_digits=24, decimal_places=6, default=0, help_text="کل سرمایه‌گذاری")
    total_earned = models.DecimalField(max_digits=24, decimal_places=6, default=0, help_text="کل سود کسب شده")
    
    def save(self, *args, **kwargs):
        if not self.referral_code:
            self.referral_code = uuid.uuid4().hex[:10].upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.telegram_id} - {self.wallet_address[:8]}..."
    
class Wallet(models.Model):

    user = models.OneToOneField(
        "AppUser",
        on_delete=models.CASCADE,
        related_name="wallet"
    )


    # ==================================
    # ECG BALANCE
    # ==================================

    # سود خرید خود کاربر - قفل 30 روزه
    ecg_self_locked = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )

    # سود خرید خود کاربر - آزاد شده
    ecg_self_unlocked = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )

    # سود بالاسری ECG (لحظه ای)
    ecg_referral_profit = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    # ==================================
    # USDT BALANCE
    # ==================================

    # سود خرید خود کاربر - قفل 30 روزه
    usdt_self_locked = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    # سود خرید خود کاربر - آزاد شده
    usdt_self_unlocked = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    # # سود بالاسری USDT
    usdt_referral_profit = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    # ==================================
    # EPL TIMER ONLY
    # ==================================

    # موجودی Timer
    epl_balance = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    # کل EPL گرفته شده
    epl_total_earned = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=Decimal("0")
    )


    created_at = models.DateTimeField(
        auto_now_add=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )


    def __str__(self):
        return f"{self.user} wallet"



    # فقط ECG قابل برداشت
    def available_ecg(self):

        return (
            self.ecg_self_unlocked
            +
            self.ecg_referral_profit
        )



    # فقط USDT قابل برداشت
    def available_usdt(self):

        return (
            self.usdt_self_unlocked
            +
            self.usdt_referral_profit
        )
class AssetBalance(models.Model):
    ASSET_CHOICES = [
        ("ECG","ECG"),
        ("EPL","EPL"),
        ("USDT", "USDT"),
    ]

    user = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        related_name="asset_balances",
    )

    asset = models.CharField(
        max_length=8,
        choices=ASSET_CHOICES,
    )

    available = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=0
    )

    locked = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=0
    )

    total_earned = models.DecimalField(
        max_digits=24,
        decimal_places=8,
        default=0
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "asset"],
                name="unique_user_asset",
            )
        ]

class Ledger(models.Model):
    TYPE_CHOICES = [
        ("REF_BONUS", "Referral bonus"),
        ("DAILY_ADD", "Daily add locked"),
        ("DAILY_UNLOCK", "Daily unlock"),
        ("BUY_PRINCIPAL", "Buy principal locked"),
        ("BUY_SELF_PROFIT", "Buy self profit locked"),
        ("SELF_PROFIT_UNLOCK", "Self profit unlock"),
        ("PRINCIPAL_UNLOCK", "Principal unlock"),
        ("DOWNLINE_PROFIT", "Downline instant profit"),
        ("WITHDRAW", "Withdraw"),
        ("LEVEL5_BONUS", "Level 5 bonus"),
    ]
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, related_name="ledgers")
    typ = models.CharField(max_length=32, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=24, decimal_places=6)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.typ} - {self.amount}"


class Purchase(models.Model):

    ASSET_CHOICES = (
        ("ECG", "ECG"),
        ("USDT", "USDT"),
    )


    user = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        related_name="purchases"
    )


    invoice_no = models.CharField(
        max_length=50,
        unique=True
    )


    # پرداخت ورودی
    ton_amount = models.DecimalField(
        max_digits=30,
        decimal_places=8
    )

    ton_tx_hash = models.CharField(
        max_length=255,
        unique=True
    )

    ton_usd_rate = models.DecimalField(
        max_digits=20,
        decimal_places=8
    )


    # ارزش دلاری خرید
    usd_value = models.DecimalField(
        max_digits=30,
        decimal_places=8
    )


    # مقدار ECG محاسباتی قدیمی (برای سازگاری)
    ecg_value = models.DecimalField(
        max_digits=30,
        decimal_places=8,
        default=0
    )


    # ============================
    # Asset Purchased
    # ============================

    output_asset = models.CharField(
        max_length=10,
        choices=ASSET_CHOICES,
        default="ECG"
    )


    output_amount = models.DecimalField(
        max_digits=30,
        decimal_places=8,
        default=0
    )


    # سود مربوط به همان ارز خریداری شده

    profit_asset = models.CharField(
        max_length=10,
        choices=ASSET_CHOICES,
        default="ECG"
    )


    self_profit_5 = models.DecimalField(
        max_digits=30,
        decimal_places=8,
        default=0
    )


    # زمان‌ها

    principal_unlock_at = models.DateTimeField(
        null=True,
        blank=True
    )


    self_profit_unlock_at = models.DateTimeField(
        null=True,
        blank=True
    )


    created_at = models.DateTimeField(
        auto_now_add=True
    )


    updated_at = models.DateTimeField(
        auto_now=True
    )


    def __str__(self):
        return (
            f"{self.user.wallet_address} "
            f"{self.output_asset} "
            f"{self.output_amount}"
        )

class PurchaseUSDT(models.Model):
    """خرید ECG با USDT (BEP-20)"""
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, related_name="purchases_usdt")
    invoice_no = models.CharField(max_length=32, unique=True)

    usdt_amount = models.DecimalField(max_digits=24, decimal_places=6)
    usdt_tx_hash = models.CharField(max_length=256, unique=True)

    usdt_usd_rate = models.DecimalField(max_digits=24, decimal_places=6, default=1)
    usd_value = models.DecimalField(max_digits=24, decimal_places=6)

    ecg_value = models.DecimalField(max_digits=24, decimal_places=6)
    self_profit_5 = models.DecimalField(max_digits=24, decimal_places=6)

    principal_unlock_at = models.DateTimeField()
    self_profit_unlock_at = models.DateTimeField()

class PurchaseBNB(models.Model):
    """
    خرید با BNB (BEP-20)
    """

    user = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        related_name="purchases_bnb"
    )

    invoice_no = models.CharField(
        max_length=32,
        unique=True
    )

    bnb_amount = models.DecimalField(
        max_digits=24,
        decimal_places=8
    )

    bnb_tx_hash = models.CharField(
        max_length=256,
        unique=True
    )

    bnb_usd_rate = models.DecimalField(
        max_digits=24,
        decimal_places=6,
        default=0
    )

    usd_value = models.DecimalField(
        max_digits=24,
        decimal_places=6
    )

    ecg_value = models.DecimalField(
        max_digits=24,
        decimal_places=6,
        default=0
    )

    self_profit_5 = models.DecimalField(
        max_digits=24,
        decimal_places=6,
        default=0
    )

    principal_unlock_at = models.DateTimeField()

    self_profit_unlock_at = models.DateTimeField()

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return f"BNB: {self.invoice_no} - {self.bnb_amount} BNB"


class WithdrawRequest(models.Model):
    """
    درخواست برداشت کاربر
    """

    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("APPROVED", "Approved"),
        ("REJECTED", "Rejected"),
        ("PAID", "Paid"),
    ]

    ASSET_CHOICES = [
        ("TON","TON"),
        ("ECG","ECG"),
        ("EPL","EPL"),
        ("USDT","USDT"),
    ]
    

    user = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        related_name="withdraw_requests"
    )
    
    asset = models.CharField(
        max_length=10,
        choices=ASSET_CHOICES,
        default="ECG"
    )

    source_asset = models.CharField(
        max_length=10,
        choices=ASSET_CHOICES,
        default="ECG"
    )

    amount = models.DecimalField(
        max_digits=24,
        decimal_places=8
    )

    wallet_address = models.CharField(
        max_length=128
    )

    tx_hash = models.CharField(
        max_length=256,
        null=True,
        blank=True
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="PENDING"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )


    def __str__(self):
        return f"{self.user.wallet_address[:8]} - {self.amount} {self.source_asset}"

class ReferralLevel(models.Model):

    user = models.OneToOneField(
        AppUser,
        on_delete=models.CASCADE,
        related_name="referral_level"
    )

    level_1_count = models.PositiveIntegerField(default=0)
    level_2_count = models.PositiveIntegerField(default=0)
    level_3_count = models.PositiveIntegerField(default=0)
    level_4_count = models.PositiveIntegerField(default=0)
    level_5_count = models.PositiveIntegerField(default=0)

    level_1_users = models.JSONField(default=list, blank=True)
    level_2_users = models.JSONField(default=list, blank=True)
    level_3_users = models.JSONField(default=list, blank=True)
    level_4_users = models.JSONField(default=list, blank=True)
    level_5_users = models.JSONField(default=list, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.wallet_address} referral"