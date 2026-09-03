from celery import shared_task
from django.utils import timezone
from django.db.models import F
from decimal import Decimal

from .models import Wallet, Purchase, Ledger

@shared_task
def daily_reward_add():
    # every day +1 token to locked daily pool
    Wallet.objects.update(daily_reward_locked=F("daily_reward_locked") + Decimal("1"))
    # ledger bulk is heavy; skip for MVP

@shared_task
def unlock_self_profit_and_principal():
    now = timezone.now()

    # unlock self profit after 30 days
    for p in Purchase.objects.filter(self_profit_unlock_at__lte=now):
        w = p.user.wallet
        if p.self_profit_5 > 0:
            # move only once: mark by setting value to 0 after move? safer add flag, but MVP:
            # We'll use a meta ledger check to prevent duplicates.
            if not Ledger.objects.filter(user=p.user, typ="SELF_PROFIT_UNLOCK", meta__invoice=p.invoice_no).exists():
                w.self_profit_locked = F("self_profit_locked") - p.self_profit_5
                w.self_profit_unlocked = F("self_profit_unlocked") + p.self_profit_5
                w.save(update_fields=["self_profit_locked", "self_profit_unlocked"])
                Ledger.objects.create(user=p.user, typ="SELF_PROFIT_UNLOCK", amount=p.self_profit_5, meta={"invoice": p.invoice_no})

    # unlock principal after 365 days
    for p in Purchase.objects.filter(principal_unlock_at__lte=now):
        w = p.user.wallet
        if p.ecg_value > 0:
            if not Ledger.objects.filter(user=p.user, typ="PRINCIPAL_UNLOCK", meta__invoice=p.invoice_no).exists():
                w.principal_locked = F("principal_locked") - p.ecg_value
                w.principal_unlocked = F("principal_unlocked") + p.ecg_value
                w.save(update_fields=["principal_locked", "principal_unlocked"])
                Ledger.objects.create(user=p.user, typ="PRINCIPAL_UNLOCK", amount=p.ecg_value, meta={"invoice": p.invoice_no})

@shared_task
def end_of_month_unlock_daily():
    # at month end: move locked daily -> unlocked
    Wallet.objects.update(
        daily_reward_unlocked=F("daily_reward_unlocked") + F("daily_reward_locked"),
        daily_reward_locked=Decimal("0"),
    )