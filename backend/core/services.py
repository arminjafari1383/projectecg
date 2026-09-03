from decimal import Decimal, ROUND_DOWN
from django.utils import timezone
from django.db import transaction
from django.db.models import F, Sum
import requests
import uuid
import logging
from datetime import timedelta

from .models import (
    AppUser,
    Wallet,
    AssetBalance,
    Ledger,
    Purchase,
    ReferralLevel,
    PurchaseUSDT,
    PurchaseBNB,
)


logger = logging.getLogger(__name__)


# ============================================================
# Constants
# ============================================================

ECG_PER_USD = Decimal("312")

SELF_BONUS_RATE = Decimal("0.05")
UPLINE_RATE = Decimal("0.05")
INDIRECT_UPLINE_RATE = Decimal("0.01")

DIRECT_REFERRAL_REWARD = Decimal("1000")
INDIRECT_REFERRAL_REWARD = Decimal("500")

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=the-open-network&vs_currencies=usd"
)
LOCK_DAYS = 30

# ============================================================
# Wallet helper
# ============================================================

def ensure_user_has_wallet(user: AppUser) -> Wallet:
    """Return the user wallet, creating it only when it is genuinely missing."""

    wallet, created = Wallet.objects.get_or_create(user=user)

    if created:
        logger.info(
            "✅ Wallet created for user %s",
            user.wallet_address,
        )

    return wallet


# ============================================================
# Get/Create user
# ============================================================

USER_ACTIVITY_WRITE_INTERVAL = timezone.timedelta(minutes=5)


def _activity_fields(user: AppUser):
    """
    Avoid turning every GET request into a SQLite WRITE.
    last_active is persisted at most once every five minutes.
    """
    now = timezone.now()
    fields = []

    if not user.is_active:
        user.is_active = True
        fields.append("is_active")

    if (
        user.last_active is None
        or now - user.last_active >= USER_ACTIVITY_WRITE_INTERVAL
    ):
        user.last_active = now
        fields.append("last_active")

    return fields


def _sync_replaced_wallet_in_referral_tree(
    user: AppUser,
    old_wallet: str,
    new_wallet: str,
):
    """
    Keep ReferralLevel JSON snapshots in sync when the same AppUser replaces
    their connected wallet address.

    The real relational data (Wallet, Purchase, Ledger, inviter, etc.) stays
    attached to the same AppUser primary key and is not recreated.
    """
    old_wallet = str(old_wallet or "").strip()
    new_wallet = str(new_wallet or "").strip()

    if not old_wallet or not new_wallet or old_wallet == new_wallet:
        return

    current = user.inviter
    level = 1

    while current and level <= 5:
        level_obj = (
            ReferralLevel.objects
            .select_for_update()
            .filter(user=current)
            .first()
        )

        if level_obj:
            level_field = f"level_{level}_users"
            stored_users = list(getattr(level_obj, level_field) or [])
            changed = False

            for index, item in enumerate(stored_users):
                # Legacy representation: the entry itself is a wallet string.
                if isinstance(item, str):
                    if item == old_wallet:
                        stored_users[index] = new_wallet
                        changed = True
                    continue

                if not isinstance(item, dict):
                    continue

                item_wallet = item.get("wallet")
                item_telegram_id = item.get("telegram_id")

                same_old_wallet = item_wallet == old_wallet
                same_telegram_user = (
                    user.telegram_id is not None
                    and item_telegram_id is not None
                    and str(item_telegram_id) == str(user.telegram_id)
                )

                if not (same_old_wallet or same_telegram_user):
                    continue

                updated_item = dict(item)
                updated_item["wallet"] = new_wallet
                updated_item["telegram_id"] = user.telegram_id
                updated_item["telegram_username"] = user.telegram_username
                updated_item["telegram_photo_url"] = user.telegram_photo_url
                stored_users[index] = updated_item
                changed = True

            if changed:
                setattr(level_obj, level_field, stored_users)
                # Count does not change: this is the same referral identity.
                level_obj.save(update_fields=[level_field])

                logger.info(
                    "[WALLET_REPLACE] referral snapshot updated "
                    "user_id=%s owner_id=%s level=%s old=%s new=%s",
                    user.id,
                    current.id,
                    level,
                    old_wallet,
                    new_wallet,
                )

        current = current.inviter
        level += 1


def get_or_create_user(
    wallet_address: str,
    telegram_id: int = None,
    is_telegram: bool = False,
) -> AppUser:
    """
    Telegram ID is the primary identity.

    Wallet locking/replacement restrictions are disabled:
    - the same Telegram user may connect a different wallet at any time;
    - no replace_wallet / previous_wallet flag is required;
    - wallet_locked is always kept False;
    - the same AppUser row is preserved, therefore balances, purchases,
      ledgers, inviter and other FK-related data remain attached to the user.

    We still reject a wallet that is already attached to a DIFFERENT AppUser.
    That collision guard prevents two user rows from sharing/stealing the same
    wallet identity and also avoids DB unique-constraint failures if the model
    defines wallet_address as unique.
    """
    wallet_address = str(wallet_address or "").strip()

    if telegram_id is not None:
        telegram_id = int(telegram_id)

    logger.info(
        "[USER_CONNECT_UNLOCKED] wallet=%s telegram_id=%s is_telegram=%s",
        wallet_address,
        telegram_id,
        is_telegram,
    )

    if not wallet_address:
        raise ValueError("wallet_address required")

    # ------------------------------------------------------------------
    # No Telegram identity: keep browser-wallet behavior.
    # ------------------------------------------------------------------
    if not telegram_id:
        user = (
            AppUser.objects
            .filter(wallet_address=wallet_address)
            .first()
        )

        if user:
            update_fields = _activity_fields(user)

            if user.wallet_locked:
                user.wallet_locked = False
                update_fields.append("wallet_locked")

            if (
                not user.telegram_username
                or user.telegram_username.startswith("browser_")
            ):
                user.telegram_username = f"user_{wallet_address[:8]}"
                update_fields.append("telegram_username")

            if update_fields:
                user.save(update_fields=list(dict.fromkeys(update_fields)))

            ensure_user_has_wallet(user)
            return user

        user = AppUser.objects.create(
            wallet_address=wallet_address,
            telegram_id=None,
            is_telegram_user=False,
            telegram_verified=False,
            wallet_locked=False,
            is_active=True,
            is_admin=False,
            telegram_username=f"user_{wallet_address[:8]}",
        )

        ensure_user_has_wallet(user)
        return user

    # ------------------------------------------------------------------
    # Telegram identity is the main account identity.
    # ------------------------------------------------------------------
    existing_user_by_telegram = (
        AppUser.objects
        .filter(telegram_id=telegram_id)
        .first()
    )

    if existing_user_by_telegram:
        with transaction.atomic():
            user = (
                AppUser.objects
                .select_for_update()
                .get(pk=existing_user_by_telegram.pk)
            )

            old_wallet = str(user.wallet_address or "").strip()

            # Collision guard only. This is NOT a replacement/lock restriction.
            wallet_owner = (
                AppUser.objects
                .select_for_update()
                .filter(wallet_address=wallet_address)
                .exclude(pk=user.pk)
                .first()
            )

            if wallet_owner:
                raise ValueError(
                    "This wallet is already used by another account."
                )

            update_fields = _activity_fields(user)

            if old_wallet != wallet_address:
                user.wallet_address = wallet_address
                update_fields.append("wallet_address")

            # Wallet locking is disabled completely.
            if user.wallet_locked:
                user.wallet_locked = False
                update_fields.append("wallet_locked")

            if is_telegram:
                if not user.is_telegram_user:
                    user.is_telegram_user = True
                    update_fields.append("is_telegram_user")

                if not user.telegram_verified:
                    user.telegram_verified = True
                    update_fields.append("telegram_verified")

            if (
                not user.telegram_username
                or user.telegram_username.startswith("browser_")
            ):
                user.telegram_username = (
                    str(telegram_id)
                    if is_telegram
                    else f"user_{wallet_address[:8]}"
                )
                update_fields.append("telegram_username")

            if update_fields:
                user.save(update_fields=list(dict.fromkeys(update_fields)))

            ensure_user_has_wallet(user)

            if old_wallet and old_wallet != wallet_address:
                _sync_replaced_wallet_in_referral_tree(
                    user=user,
                    old_wallet=old_wallet,
                    new_wallet=wallet_address,
                )

                logger.warning(
                    "[WALLET_AUTO_CHANGED] user_id=%s telegram_id=%s old=%s new=%s",
                    user.id,
                    telegram_id,
                    old_wallet,
                    wallet_address,
                )

            return user

    # ------------------------------------------------------------------
    # Telegram user does not exist yet. The wallet may be a browser-created
    # row. Claim that row only if it has no different Telegram identity.
    # ------------------------------------------------------------------
    existing_user_by_wallet = (
        AppUser.objects
        .filter(wallet_address=wallet_address)
        .first()
    )

    if existing_user_by_wallet:
        if (
            existing_user_by_wallet.telegram_id
            and existing_user_by_wallet.telegram_id != telegram_id
        ):
            raise ValueError(
                "This wallet is already used by another account."
            )

        user = existing_user_by_wallet
        update_fields = _activity_fields(user)

        user.telegram_id = telegram_id
        user.is_telegram_user = True
        user.telegram_verified = True
        user.wallet_locked = False

        update_fields.extend([
            "telegram_id",
            "is_telegram_user",
            "telegram_verified",
            "wallet_locked",
        ])

        if (
            not user.telegram_username
            or user.telegram_username.startswith("browser_")
        ):
            user.telegram_username = (
                str(telegram_id)
                if is_telegram
                else f"user_{wallet_address[:8]}"
            )
            update_fields.append("telegram_username")

        user.save(update_fields=list(dict.fromkeys(update_fields)))
        ensure_user_has_wallet(user)
        return user

    # ------------------------------------------------------------------
    # Completely new Telegram user.
    # ------------------------------------------------------------------
    user = AppUser.objects.create(
        wallet_address=wallet_address,
        telegram_id=telegram_id,
        is_telegram_user=True,
        telegram_verified=True,
        wallet_locked=False,
        is_active=True,
        is_admin=False,
        telegram_username=(
            str(telegram_id)
            if is_telegram
            else f"user_{wallet_address[:8]}"
        ),
    )

    ensure_user_has_wallet(user)
    return user


# ============================================================
# Referral
# ============================================================

def apply_referral(
    inviter_code: str,
    user: AppUser,
):
    """
    Attach an inviter once and update the referral tree atomically.

    Returns a dict:
        {"ok": bool, "reason": str, "message": str}
    """
    from .referral_utils import normalize_inviter_code

    normalized_code = normalize_inviter_code(inviter_code)
    if not normalized_code:
        logger.warning("[REF] invalid inviter_code format raw=%s", inviter_code)
        return {
            "ok": False,
            "reason": "invalid_code",
            "message": "Invalid referral code format.",
        }

    logger.info(
        "[REF] apply inviter_code=%s user=%s",
        normalized_code,
        user.wallet_address,
    )

    if user.inviter_id:
        logger.info("[REF] skipped: inviter already set user=%s", user.id)
        return {
            "ok": True,
            "reason": "already_set",
            "message": "Referral already linked to this account.",
        }

    inviter = (
        AppUser.objects
        .filter(referral_code__iexact=normalized_code)
        .first()
    )

    if not inviter:
        logger.warning("[REF] invalid inviter_code=%s", normalized_code)
        return {
            "ok": False,
            "reason": "invalid_code",
            "message": "Referral code not found.",
        }

    if inviter.id == user.id:
        logger.warning("[REF] self referral blocked user_id=%s", user.id)
        return {
            "ok": False,
            "reason": "self_referral",
            "message": "You cannot use your own referral code.",
        }

    with transaction.atomic():
        attached = (
            AppUser.objects
            .filter(pk=user.pk, inviter__isnull=True)
            .update(inviter=inviter)
        )

        if not attached:
            logger.info(
                "[REF] skipped: inviter already set user=%s",
                user.id,
            )
            return {
                "ok": True,
                "reason": "already_set",
                "message": "Referral already linked to this account.",
            }

        user.inviter = inviter

        update_referral_levels(user, inviter)
        give_referral_bonus(inviter, user)

        logger.info(
            "[REF] success user=%s inviter=%s",
            user.id,
            inviter.id,
        )

    return {
        "ok": True,
        "reason": "applied",
        "message": "Referral applied successfully.",
    }


# ============================================================
# Direct referral reward
# ============================================================

@transaction.atomic
def give_referral_bonus(
    inviter: AppUser,
    new_user: AppUser,
):
    """
    Credit the referral join reward through the upline chain.

    Level 1 (direct inviter): 1000 EPL
    Levels 2-5 (indirect uplines): 500 EPL each

    Each (upline, invitee, referral_level) reward is idempotent.
    """

    current = inviter
    level = 1

    while current and level <= 5:
        reward = (
            DIRECT_REFERRAL_REWARD
            if level == 1
            else INDIRECT_REFERRAL_REWARD
        )

        ensure_user_has_wallet(current)

        wallet = (
            Wallet.objects
            .select_for_update()
            .get(user=current)
        )

        # Legacy direct REF_BONUS rows did not contain referral_level.
        # For level 1, matching by invitee alone prevents an old 3 EPL reward
        # from being duplicated if the same relationship is processed again.
        ledger_filter = {
            "user": current,
            "typ": "REF_BONUS",
            "meta__invitee": new_user.wallet_address,
        }

        if level > 1:
            ledger_filter["meta__referral_level"] = level

        already_rewarded = (
            Ledger.objects
            .filter(**ledger_filter)
            .exists()
        )

        if already_rewarded:
            logger.warning(
                "[REF] duplicate bonus blocked "
                "upline=%s invitee=%s level=%s",
                current.id,
                new_user.id,
                level,
            )
        else:
            epl_balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=current,
                    asset="EPL"
                )
            )

            epl_balance.available = (
                Decimal(str(epl_balance.available or 0))
                + reward
            )

            epl_balance.total_earned = (
                Decimal(str(epl_balance.total_earned or 0))
                + reward
            )

            epl_balance.save(
                update_fields=[
                    "available",
                    "total_earned",
                ]
            )

            Ledger.objects.create(
                user=current,
                typ="REF_BONUS",
                amount=reward,
                meta={
                    "invitee": new_user.wallet_address,
                    "referral_level": level,
                    "reward_kind": (
                        "direct"
                        if level == 1
                        else "indirect"
                    ),
                    "asset": "EPL",
                },
            )

            update_referral_join_bonus(
                user=current,
                level=level,
                from_wallet=new_user.wallet_address,
                bonus=reward,
            )

            logger.info(
                "[REF] upline rewarded %s ECG "
                "for invitee=%s level=%s",
                reward,
                new_user.wallet_address,
                level,
            )

        current = current.inviter
        level += 1


# ============================================================
# Referral levels
# ============================================================

def update_referral_levels(
    new_user: AppUser,
    direct_inviter: AppUser,
):
    """
    بروزرسانی Level 1 تا Level 5.

    این نسخه:
    - duplicate user اضافه نمی‌کند
    - count را بدون duplicate نگه می‌دارد
    - برای همزمانی ReferralLevel را lock می‌کند
    """

    current = direct_inviter
    level = 1

    while current and level <= 5:

        # ----------------------------------------------------
        # Ensure ReferralLevel exists
        # ----------------------------------------------------

        level_obj, _ = (
            ReferralLevel.objects
            .get_or_create(user=current)
        )

        # ----------------------------------------------------
        # User data
        # ----------------------------------------------------

        user_data = {
            "telegram_id": new_user.telegram_id,
            "telegram_username": new_user.telegram_username,
            "telegram_photo_url": new_user.telegram_photo_url,
            "wallet": new_user.wallet_address,
            "investment": 0,
            # Legacy ECG-only referral-profit field.
            "profit": 0,
            "profit_ecg": 0,
            "profit_usdt": 0,
            "profit_asset": "ECG",
            "referral_bonus": 0,
        }

        level_field = (
            f"level_{level}_users"
        )

        count_field = (
            f"level_{level}_count"
        )

        stored_users = (
            getattr(level_obj, level_field)
            or []
        )

        # ----------------------------------------------------
        # Detect existing wallet
        # ----------------------------------------------------

        existing_wallets = set()

        for stored_user in stored_users:

            if isinstance(stored_user, dict):

                wallet = stored_user.get(
                    "wallet"
                )

                if wallet:
                    existing_wallets.add(wallet)

            elif isinstance(stored_user, str):

                existing_wallets.add(
                    stored_user
                )

        # ----------------------------------------------------
        # Add only if not already present
        # ----------------------------------------------------

        if (
            new_user.wallet_address
            not in existing_wallets
        ):

            stored_users.append(
                user_data
            )

            setattr(
                level_obj,
                level_field,
                stored_users,
            )

            # count should reflect unique referrals
            unique_wallets = set()

            for item in stored_users:

                if isinstance(item, dict):

                    wallet = item.get("wallet")

                    if wallet:
                        unique_wallets.add(wallet)

                elif isinstance(item, str):

                    unique_wallets.add(item)

            setattr(
                level_obj,
                count_field,
                len(unique_wallets),
            )

            level_obj.save(
                update_fields=[
                    level_field,
                    count_field,
                ]
            )

            logger.info(
                "[LEVEL] Added user=%s "
                "to owner=%s level=%s count=%s",
                new_user.wallet_address,
                current.wallet_address,
                level,
                len(unique_wallets),
            )

        else:

            logger.info(
                "[LEVEL] duplicate blocked "
                "user=%s owner=%s level=%s",
                new_user.wallet_address,
                current.wallet_address,
                level,
            )

        current = current.inviter
        level += 1


# ============================================================
# Update referral join bonus in Referral Tree
# ============================================================

def update_referral_join_bonus(
    user: AppUser,
    level: int,
    from_wallet: str,
    bonus: Decimal,
):
    """
    Store the join/referral bonus on the exact Referral Tree row.
    This is separate from purchase profit.
    """

    level_obj = (
        ReferralLevel.objects
        .filter(user=user)
        .first()
    )

    if not level_obj:
        return

    level_field = f"level_{level}_users"
    users = list(
        getattr(level_obj, level_field)
        or []
    )

    changed = False

    for index, item in enumerate(users):
        if isinstance(item, str):
            if item != from_wallet:
                continue

            users[index] = {
                "wallet": item,
                "investment": 0,
                "profit": 0,
                "referral_bonus": float(bonus),
            }
            changed = True
            break

        if not isinstance(item, dict):
            continue

        if item.get("wallet") != from_wallet:
            continue

        current_bonus = Decimal(
            str(item.get("referral_bonus", 0) or 0)
        )

        updated_item = dict(item)
        updated_item["referral_bonus"] = float(
            current_bonus + Decimal(str(bonus))
        )
        users[index] = updated_item
        changed = True
        break

    if changed:
        setattr(
            level_obj,
            level_field,
            users,
        )
        level_obj.save(
            update_fields=[level_field]
        )


# ============================================================
# Reconcile legacy referral join rewards
# ============================================================

@transaction.atomic
def reconcile_existing_referral_join_rewards(owner: AppUser):
    """
    Bring referrals created under the old 3 EPL rule up to the new join-reward
    schedule without duplicating already-correct rewards.

    Level 1 target: 1000 EPL per referral row.
    Levels 2-5 target: 500 EPL per referral row.

    The top-up is real accounting: Wallet.referral_bonus and Ledger are updated,
    then ReferralLevel JSON is synchronized to the actual credited total.
    """

    level_obj = (
        ReferralLevel.objects
        .select_for_update()
        .filter(user=owner)
        .first()
    )

    if not level_obj:
        return False

    ensure_user_has_wallet(owner)
    wallet = (
        Wallet.objects
        .select_for_update()
        .get(user=owner)
    )

    wallet_changed = False
    changed_fields = []

    for level in range(1, 6):
        target = (
            DIRECT_REFERRAL_REWARD
            if level == 1
            else INDIRECT_REFERRAL_REWARD
        )

        level_field = f"level_{level}_users"
        users = list(getattr(level_obj, level_field) or [])
        level_changed = False

        for index, item in enumerate(users):
            if isinstance(item, str):
                from_wallet = item
                row = {
                    "wallet": item,
                    "investment": 0,
                    "profit": 0,
                    "referral_bonus": 0,
                }
            elif isinstance(item, dict):
                from_wallet = str(item.get("wallet") or "").strip()
                row = dict(item)
            else:
                continue

            if not from_wallet:
                continue

            credited = (
                Ledger.objects
                .filter(
                    user=owner,
                    typ="REF_BONUS",
                    meta__invitee=from_wallet,
                )
                .aggregate(total=Sum("amount"))["total"]
                or Decimal("0")
            )

            if credited < target:
                top_up = target - credited

                wallet.referral_bonus = (
                    (wallet.referral_bonus or Decimal("0"))
                    + top_up
                )
                wallet_changed = True

                Ledger.objects.create(
                    user=owner,
                    typ="REF_BONUS",
                    amount=top_up,
                    meta={
                        "invitee": from_wallet,
                        "referral_level": level,
                        "reward_kind": "legacy_reconcile",
                        "target_total": str(target),
                        "asset": "EPL",
                    },
                )

                credited = target

                logger.info(
                    "[REF_RECONCILE] owner=%s invitee=%s level=%s top_up=%s target=%s",
                    owner.id,
                    from_wallet,
                    level,
                    top_up,
                    target,
                )

            # Keep the tree row aligned with the actual join bonus credited for
            # this owner/downline relationship. For a legacy direct referral
            # that had 3 EPL, this becomes exactly 1000 after the 997 top-up.
            shown_bonus = max(
                Decimal(str(row.get("referral_bonus", 0) or 0)),
                credited,
            )

            if Decimal(str(row.get("referral_bonus", 0) or 0)) != shown_bonus:
                row["referral_bonus"] = float(shown_bonus)
                users[index] = row
                level_changed = True

        if level_changed:
            setattr(level_obj, level_field, users)
            changed_fields.append(level_field)

    if wallet_changed:
        wallet.save(
            update_fields=[
                "referral_bonus",
                "updated_at",
            ]
        )

    if changed_fields:
        level_obj.save(update_fields=changed_fields)

    return wallet_changed or bool(changed_fields)


# ============================================================
# Update referral investment
# ============================================================

def update_user_investment(
    user: AppUser,
    amount: Decimal,
):
    """
    بروزرسانی investment کاربر در referral levels.
    """

    current = user.inviter
    level = 1

    while current and level <= 5:

        level_obj = (
            ReferralLevel.objects
            .filter(user=current)
            .first()
        )

        if level_obj:

            level_field = (
                f"level_{level}_users"
            )

            users = (
                getattr(level_obj, level_field)
                or []
            )

            for i, item in enumerate(users):

                if not isinstance(item, dict):
                    continue

                if (
                    item.get("wallet")
                    == user.wallet_address
                ):

                    current_investment = Decimal(
                        str(
                            users[i].get(
                                "investment",
                                0,
                            )
                        )
                    )

                    # Referral Tree shows the user's cumulative investment.
                    users[i]["investment"] = float(
                        current_investment + Decimal(str(amount))
                    )

                    if (
                        user.telegram_username
                        and not user.telegram_username.startswith(
                            "browser_"
                        )
                    ):

                        users[i][
                            "telegram_username"
                        ] = user.telegram_username

                    users[i][
                        "telegram_id"
                    ] = user.telegram_id

                    users[i][
                        "telegram_photo_url"
                    ] = user.telegram_photo_url

                    break

            setattr(
                level_obj,
                level_field,
                users,
            )

            level_obj.save(
                update_fields=[level_field]
            )

        current = current.inviter
        level += 1


# ============================================================
# Update referral level profit
# ============================================================

def update_level_profit(
    user: AppUser,
    level: int,
    from_wallet: str,
    profit: Decimal,
    asset: str = "ECG",
):
    """
    Keep ReferralLevel JSON in sync with the real upline profit credit.

    The accounting truth remains AssetBalance + Ledger.  This helper only
    updates the referral-tree display snapshot.  It deliberately supports
    legacy string rows and wallet replacement so a successful upline credit
    does not disappear from the visible ``profit_ecg`` / ``profit_usdt``
    fields.
    """
    asset = str(asset or "ECG").upper()
    if asset not in {"ECG", "USDT"}:
        asset = "ECG"

    profit = Decimal(str(profit or 0))
    if profit <= 0:
        return

    try:
        level = int(level)
    except (TypeError, ValueError):
        return

    if level < 1 or level > 5:
        return

    from_wallet = str(from_wallet or "").strip()
    if not from_wallet:
        return

    source_user = (
        AppUser.objects
        .filter(wallet_address=from_wallet)
        .first()
    )
    source_telegram_id = source_user.telegram_id if source_user else None

    level_obj, _ = ReferralLevel.objects.get_or_create(user=user)
    level_field = f"level_{level}_users"
    count_field = f"level_{level}_count"
    users = list(getattr(level_obj, level_field) or [])

    matched_index = None

    for i, raw_item in enumerate(users):
        if isinstance(raw_item, str):
            if raw_item != from_wallet:
                continue
            item = {
                "wallet": from_wallet,
                "telegram_id": source_telegram_id,
                "telegram_username": (
                    source_user.telegram_username if source_user else None
                ),
                "telegram_photo_url": (
                    source_user.telegram_photo_url if source_user else None
                ),
                "investment": 0,
                "profit": 0,
                "profit_ecg": 0,
                "profit_usdt": 0,
                "profit_asset": asset,
                "referral_bonus": 0,
            }
            users[i] = item
            matched_index = i
            break

        if not isinstance(raw_item, dict):
            continue

        item_wallet = str(raw_item.get("wallet") or "").strip()
        item_telegram_id = raw_item.get("telegram_id")

        same_wallet = item_wallet == from_wallet
        same_identity = (
            source_telegram_id is not None
            and item_telegram_id is not None
            and str(item_telegram_id) == str(source_telegram_id)
        )

        if same_wallet or same_identity:
            matched_index = i
            break

    if matched_index is None:
        users.append({
            "wallet": from_wallet,
            "telegram_id": source_telegram_id,
            "telegram_username": (
                source_user.telegram_username if source_user else None
            ),
            "telegram_photo_url": (
                source_user.telegram_photo_url if source_user else None
            ),
            "investment": 0,
            "profit": 0,
            "profit_ecg": 0,
            "profit_usdt": 0,
            "profit_asset": asset,
            "referral_bonus": 0,
        })
        matched_index = len(users) - 1

    item = dict(users[matched_index])

    # Keep identity metadata current after wallet replacement.
    item["wallet"] = from_wallet
    if source_user:
        item["telegram_id"] = source_user.telegram_id
        item["telegram_username"] = source_user.telegram_username
        item["telegram_photo_url"] = source_user.telegram_photo_url

    legacy_ecg = Decimal(str(item.get("profit", 0) or 0))
    current_ecg = Decimal(str(item.get("profit_ecg", legacy_ecg) or 0))
    current_usdt = Decimal(str(item.get("profit_usdt", 0) or 0))

    if asset == "USDT":
        current_usdt += profit
    else:
        current_ecg += profit

    item["profit_ecg"] = float(current_ecg)
    item["profit_usdt"] = float(current_usdt)
    # Legacy ``profit`` remains ECG-only to avoid mixing units.
    item["profit"] = float(current_ecg)
    item["profit_asset"] = (
        "MIXED"
        if current_ecg > 0 and current_usdt > 0
        else "USDT"
        if current_usdt > 0
        else "ECG"
    )

    users[matched_index] = item
    setattr(level_obj, level_field, users)

    # Keep count aligned when a legacy/missing display row had to be restored.
    unique_identities = set()
    for row in users:
        if isinstance(row, str):
            unique_identities.add(("wallet", row))
        elif isinstance(row, dict):
            if row.get("telegram_id") is not None:
                unique_identities.add(("telegram", str(row.get("telegram_id"))))
            elif row.get("wallet"):
                unique_identities.add(("wallet", str(row.get("wallet"))))

    setattr(level_obj, count_field, len(unique_identities))
    level_obj.save(update_fields=[level_field, count_field])


@transaction.atomic
def release_matured_purchase_profits(user: AppUser):

    now = timezone.now()

    released = {
        "ECG": Decimal("0"),
        "USDT": Decimal("0")
    }

    purchases = (
        Purchase.objects
        .select_for_update()
        .filter(
            user=user,
            self_profit_unlock_at__isnull=False,
            self_profit_unlock_at__lte=now
        )
    )


    ecg_balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(
            user=user,
            asset="ECG"
        )
    )


    usdt_balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(
            user=user,
            asset="USDT"
        )
    )


    for purchase in purchases:

        invoice = str(purchase.invoice_no)


        if Ledger.objects.filter(
            user=user,
            typ="SELF_PROFIT_UNLOCK",
            meta__invoice=invoice
        ).exists():
            continue


        amount = Decimal(
            str(purchase.self_profit_5 or 0)
        )


        if amount <= 0:
            continue


        asset = str(
            purchase.profit_asset or "ECG"
        ).upper()


        if asset == "USDT":

            usdt_balance.locked = (
                Decimal(str(usdt_balance.locked or 0))
                - amount
            )

            usdt_balance.available = (
                Decimal(str(usdt_balance.available or 0))
                + amount
            )

            usdt_balance.save(
                update_fields=[
                    "locked",
                    "available",
                ]
            )

            released["USDT"] += amount


        else:

            ecg_balance.locked = (
                Decimal(str(ecg_balance.locked or 0))
                - amount
            )

            ecg_balance.available = (
                Decimal(str(ecg_balance.available or 0))
                + amount
            )

            ecg_balance.save(
                update_fields=[
                    "locked",
                    "available",
                ]
            )

            released["ECG"] += amount



        Ledger.objects.create(
            user=user,
            typ="SELF_PROFIT_UNLOCK",
            amount=amount,
            meta={
                "invoice": invoice,
                "asset": asset,
                "unlock_at":
                    purchase.self_profit_unlock_at.isoformat()
            }
        )


    return {
        "ECG": str(released["ECG"]),
        "USDT": str(released["USDT"])
    }
@transaction.atomic
def credit_direct_upline_purchase_bonus(
    buyer: AppUser,
    bonus: Decimal,
    invoice_no: str,
    tx_hash: str,
    currency: str,
    is_test: bool = False,
    asset: str = "ECG",
):
    """
    Level 1 purchase reward.

    The buyer receives their own 5% through BUY_SELF_PROFIT.
    The buyer's direct inviter receives 5% of the purchase output amount
    immediately in the same asset (ECG or USDT).
    """

    if not buyer.inviter:
        return Decimal("0")

    asset = str(asset or "ECG").upper()
    if asset not in {"ECG", "USDT"}:
        asset = "ECG"

    reward = Decimal(str(bonus or 0))
    if reward <= 0:
        return Decimal("0")

    inviter = (
        AppUser.objects
        .select_for_update()
        .get(id=buyer.inviter.id)
    )

    balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(
            user=inviter,
            asset=asset,
        )
    )

    balance.available = (
        Decimal(str(balance.available or 0))
        + reward
    )
    balance.total_earned = (
        Decimal(str(balance.total_earned or 0))
        + reward
    )
    balance.save(
        update_fields=[
            "available",
            "total_earned",
        ]
    )

    Ledger.objects.create(
        user=inviter,
        typ="DIRECT_REFERRAL_BONUS",
        amount=reward,
        meta={
            "buyer": buyer.wallet_address,
            "buyer_user_id": buyer.id,
            "buyer_telegram_id": buyer.telegram_id,
            "invoice": invoice_no,
            "tx": tx_hash,
            "currency": currency,
            "asset": asset,
            "level": "level_1",
            "percent": "5",
            "is_test": is_test,
        },
    )

    # Keep the Referral Tree row in sync with the real credited amount.
    update_level_profit(
        inviter,
        1,
        buyer.wallet_address,
        reward,
        asset=asset,
    )

    logger.info(
        "[UPLINE] level=1 percent=5 buyer=%s inviter=%s amount=%s asset=%s invoice=%s",
        buyer.wallet_address,
        inviter.wallet_address,
        reward,
        asset,
        invoice_no,
    )

    return reward


# ============================================================
# Indirect uplines: Levels 2 -> 5 = 1% each
# ============================================================

@transaction.atomic
def credit_indirect_upline_purchase_bonuses(
    buyer: AppUser,
    purchase_ecg_value: Decimal,
    invoice_no: str,
    tx_hash: str,
    currency: str,
    is_test: bool = False,
    asset: str = "ECG",
):
    """
    Credit 1% of the buyer's purchase output amount to Levels 2, 3, 4 and 5.

    Level 1 is intentionally skipped here because it is credited separately
    at 5% by credit_direct_upline_purchase_bonus().
    """

    results = []

    asset = str(asset or "ECG").upper()
    if asset not in {"ECG", "USDT"}:
        asset = "ECG"

    purchase_value = Decimal(str(purchase_ecg_value or 0))
    if purchase_value <= 0:
        return results

    # buyer.inviter is Level 1. Start above it so this function begins at Level 2.
    current = buyer.inviter

    for level in range(2, 6):
        if not current or not current.inviter:
            break

        inviter = (
            AppUser.objects
            .select_for_update()
            .get(id=current.inviter.id)
        )

        reward = (
            purchase_value
            * INDIRECT_UPLINE_RATE
        )

        if reward > 0:
            balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=inviter,
                    asset=asset,
                )
            )

            balance.available = (
                Decimal(str(balance.available or 0))
                + reward
            )
            balance.total_earned = (
                Decimal(str(balance.total_earned or 0))
                + reward
            )
            balance.save(
                update_fields=[
                    "available",
                    "total_earned",
                ]
            )

            Ledger.objects.create(
                user=inviter,
                typ="INDIRECT_REFERRAL_BONUS",
                amount=reward,
                meta={
                    "buyer": buyer.wallet_address,
                    "buyer_user_id": buyer.id,
                    "buyer_telegram_id": buyer.telegram_id,
                    "invoice": invoice_no,
                    "tx": tx_hash,
                    "currency": currency,
                    "asset": asset,
                    "level": f"level_{level}",
                    "percent": "1",
                    "is_test": is_test,
                },
            )

            update_level_profit(
                inviter,
                level,
                buyer.wallet_address,
                reward,
                asset=asset,
            )

            results.append(
                {
                    "level": f"level_{level}",
                    "user": inviter.wallet_address,
                    "amount": str(reward),
                    "asset": asset,
                    "percent": "1",
                }
            )

            logger.info(
                "[UPLINE] level=%s percent=1 buyer=%s inviter=%s amount=%s asset=%s invoice=%s",
                level,
                buyer.wallet_address,
                inviter.wallet_address,
                reward,
                asset,
                invoice_no,
            )

        current = inviter

    return results

# ============================================================
# TON price
# ============================================================

def fetch_ton_usd_rate() -> Decimal:
    """
    دریافت قیمت TON/USD.
    """

    try:

        response = requests.get(
            COINGECKO_URL,
            timeout=10,
        )

        response.raise_for_status()

        data = response.json()

        rate = data[
            "the-open-network"
        ]["usd"]

        return Decimal(
            str(rate)
        )

    except Exception as exc:

        logger.error(
            "Failed to fetch TON rate: %s",
            exc,
        )

        return Decimal("2.5")


# ============================================================
# BNB price
# ============================================================

def fetch_bnb_usd_rate() -> Decimal:
    """
    دریافت قیمت BNB/USD.
    """

    try:

        response = requests.get(
            (
                "https://api.coingecko.com/api/v3/simple/price"
                "?ids=binancecoin&vs_currencies=usd"
            ),
            timeout=10,
        )

        response.raise_for_status()

        data = response.json()

        rate = data[
            "binancecoin"
        ]["usd"]

        return Decimal(
            str(rate)
        )

    except Exception as exc:

        logger.error(
            "Failed to fetch BNB rate: %s",
            exc,
        )

        return Decimal("600")


# ============================================================
# Register TON purchase
# ============================================================

@transaction.atomic
def register_purchase(
    user: AppUser,
    ton_amount: Decimal,
    ton_tx_hash: str,
    output_asset: str = "ECG",
    is_test: bool = False,
) -> Purchase:

    logger.info(
        "[BUY] start user=%s user_id=%s inviter_id=%s ton_amount=%s tx=%s",
        user.wallet_address,
        user.id,
        user.inviter_id,
        ton_amount,
        ton_tx_hash,
    )


    # --------------------------------------------------------
    # Duplicate TX protection
    # --------------------------------------------------------

    if (
        Purchase.objects
        .filter(
            ton_tx_hash=ton_tx_hash
        )
        .exists()
    ):
        raise ValueError(
            "TX already registered"
        )


    # --------------------------------------------------------
    # Calculate
    # --------------------------------------------------------

    rate = fetch_ton_usd_rate()

    usd_value = (
        ton_amount * rate
    )

    output_asset = (
        str(output_asset)
        .upper()
    )


    if output_asset not in {
        "ECG",
        "USDT",
    }:
        raise ValueError(
            "Invalid output asset"
        )


    ecg_value = (
        usd_value * ECG_PER_USD
    )


    if output_asset == "ECG":

        output_amount = ecg_value

    else:

        output_amount = usd_value


    self_bonus = (
        output_amount
        * SELF_BONUS_RATE
    )


    upline_bonus = (
        output_amount
        * UPLINE_RATE
    )


    now = timezone.now()


    invoice_no = (
        uuid.uuid4()
        .hex[:12]
        .upper()
    )


    principal_unlock_at = (
        now
        + timezone.timedelta(
            days=365
        )
    )


    self_profit_unlock_at = (
        now
        + timezone.timedelta(
            days=30
        )
    )


    # --------------------------------------------------------
    # Purchase
    # --------------------------------------------------------

    purchase = Purchase.objects.create(

        user=user,

        invoice_no=invoice_no,

        ton_amount=ton_amount,

        ton_tx_hash=ton_tx_hash,

        ton_usd_rate=rate,

        usd_value=usd_value,

        ecg_value=ecg_value,

        output_asset=output_asset,

        output_amount=output_amount,

        profit_asset=output_asset,

        self_profit_5=self_bonus,

        principal_unlock_at=principal_unlock_at,

        self_profit_unlock_at=self_profit_unlock_at,
    )


    ensure_user_has_wallet(user)


    # --------------------------------------------------------
    # Add principal + profit to AssetBalance
    # --------------------------------------------------------

    asset_balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(

            user=user,

            asset=output_asset,
        )
    )


    asset_balance.locked = (
        Decimal(
            str(asset_balance.locked or 0)
        )
        + output_amount
        + self_bonus
    )


    asset_balance.total_earned = (
        Decimal(
            str(asset_balance.total_earned or 0)
        )
        + self_bonus
    )


    asset_balance.save(
        update_fields=[
            "locked",
            "total_earned",
        ]
    )


    # --------------------------------------------------------
    # Ledger
    # --------------------------------------------------------

    Ledger.objects.create(

        user=user,

        typ="BUY_PRINCIPAL",

        amount=output_amount,

        meta={
            "invoice": invoice_no,
            "tx": ton_tx_hash,
            "currency": "TON",
            "asset": output_asset,
            "is_test": is_test,
        },
    )


    Ledger.objects.create(

        user=user,

        typ="BUY_SELF_PROFIT",

        amount=self_bonus,

        meta={
            "invoice": invoice_no,
            "tx": ton_tx_hash,
            "currency": "TON",
            "asset": output_asset,
            "is_test": is_test,
        },
    )


    # --------------------------------------------------------
    # Direct upline bonus
    # --------------------------------------------------------

    upline_result = credit_direct_upline_purchase_bonus(

        buyer=user,

        bonus=upline_bonus,

        invoice_no=invoice_no,

        tx_hash=ton_tx_hash,

        currency="TON",

        is_test=is_test,

        asset=output_asset,
    )


    logger.info(
        "[BUY] upline result: %s",
        upline_result,
    )


    update_user_investment(
        user,
        ton_amount,
    )


    # --------------------------------------------------------
    # Indirect referral bonus
    # --------------------------------------------------------

    indirect_results = (
        credit_indirect_upline_purchase_bonuses(

            buyer=user,

            purchase_ecg_value=output_amount,

            invoice_no=invoice_no,

            tx_hash=ton_tx_hash,

            currency="TON",

            is_test=is_test,

            asset=output_asset,
        )
    )


    logger.info(
        "[BUY] indirect results: %s",
        indirect_results,
    )


    update_user_total_investment(
        user
    )


    return purchase


# ============================================================
# Register USDT purchase
# ============================================================

@transaction.atomic
def register_purchase_usdt(
    user: AppUser,
    usdt_amount: Decimal,
    usdt_tx_hash: str,
    is_test: bool = False,
) -> PurchaseUSDT:

    logger.info(
        "[BUY_USDT] start user=%s amount=%s tx=%s",
        user.wallet_address,
        usdt_amount,
        usdt_tx_hash,
    )


    if (
        PurchaseUSDT.objects
        .filter(
            usdt_tx_hash=usdt_tx_hash
        )
        .exists()
    ):
        raise ValueError(
            "TX already registered"
        )


    rate = Decimal("1")

    usd_value = (
        usdt_amount * rate
    )


    ecg_value = (
        usd_value * ECG_PER_USD
    )


    self_bonus = (
        ecg_value
        * SELF_BONUS_RATE
    )


    upline_bonus = (
        ecg_value
        * UPLINE_RATE
    )


    now = timezone.now()


    invoice_no = (
        uuid.uuid4()
        .hex[:12]
        .upper()
    )


    principal_unlock_at = (
        now
        + timezone.timedelta(
            days=365
        )
    )


    self_profit_unlock_at = (
        now
        + timezone.timedelta(
            days=30
        )
    )


    purchase = PurchaseUSDT.objects.create(

        user=user,

        invoice_no=invoice_no,

        usdt_amount=usdt_amount,

        usdt_tx_hash=usdt_tx_hash,

        usdt_usd_rate=rate,

        usd_value=usd_value,

        ecg_value=ecg_value,

        self_profit_5=self_bonus,

        principal_unlock_at=principal_unlock_at,

        self_profit_unlock_at=self_profit_unlock_at,
    )


    ensure_user_has_wallet(user)


    # ==========================================
    # Asset Balance
    # ==========================================

    asset_balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(
            user=user,
            asset="ECG"
        )
    )


    asset_balance.locked = (
        Decimal(str(asset_balance.locked or 0))
        + ecg_value
        + self_bonus
    )


    asset_balance.total_earned = (
        Decimal(str(asset_balance.total_earned or 0))
        + self_bonus
    )


    asset_balance.save(
        update_fields=[
            "locked",
            "total_earned",
        ]
    )


    Ledger.objects.create(
        user=user,
        typ="BUY_PRINCIPAL",
        amount=ecg_value,
        meta={
            "invoice": invoice_no,
            "tx": usdt_tx_hash,
            "currency": "USDT",
            "asset": "ECG",
            "is_test": is_test,
        },
    )


    Ledger.objects.create(
        user=user,
        typ="BUY_SELF_PROFIT",
        amount=self_bonus,
        meta={
            "invoice": invoice_no,
            "tx": usdt_tx_hash,
            "currency": "USDT",
            "asset": "ECG",
            "is_test": is_test,
        },
    )


    credit_direct_upline_purchase_bonus(
        buyer=user,
        bonus=upline_bonus,
        invoice_no=invoice_no,
        tx_hash=usdt_tx_hash,
        currency="USDT",
        is_test=is_test,
        asset="ECG",
    )


    update_user_investment(
        user,
        usdt_amount,
    )


    credit_indirect_upline_purchase_bonuses(
        buyer=user,
        purchase_ecg_value=ecg_value,
        invoice_no=invoice_no,
        tx_hash=usdt_tx_hash,
        currency="USDT",
        is_test=is_test,
        asset="ECG",
    )


    update_user_total_investment(
        user
    )


    return purchase
# ============================================================
# Register BNB purchase
# ============================================================

@transaction.atomic
def register_purchase_bnb(
    user: AppUser,
    bnb_amount: Decimal,
    bnb_tx_hash: str,
    is_test: bool = False,
) -> PurchaseBNB:


    logger.info(
        "[BUY_BNB] start user=%s amount=%s tx=%s",
        user.wallet_address,
        bnb_amount,
        bnb_tx_hash,
    )


    if (
        PurchaseBNB.objects
        .filter(
            bnb_tx_hash=bnb_tx_hash
        )
        .exists()
    ):
        raise ValueError(
            "TX already registered"
        )


    rate = fetch_bnb_usd_rate()


    usd_value = (
        bnb_amount * rate
    )


    ecg_value = (
        usd_value * ECG_PER_USD
    )


    self_bonus = (
        ecg_value
        * SELF_BONUS_RATE
    )


    upline_bonus = (
        ecg_value
        * UPLINE_RATE
    )


    now = timezone.now()


    invoice_no = (
        uuid.uuid4()
        .hex[:12]
        .upper()
    )


    principal_unlock_at = (
        now
        + timezone.timedelta(
            days=365
        )
    )


    self_profit_unlock_at = (
        now
        + timezone.timedelta(
            days=30
        )
    )


    purchase = PurchaseBNB.objects.create(

        user=user,

        invoice_no=invoice_no,

        bnb_amount=bnb_amount,

        bnb_tx_hash=bnb_tx_hash,

        bnb_usd_rate=rate,

        usd_value=usd_value,

        ecg_value=ecg_value,

        self_profit_5=self_bonus,

        principal_unlock_at=principal_unlock_at,

        self_profit_unlock_at=self_profit_unlock_at,
    )


    ensure_user_has_wallet(user)


    # ==========================================
    # Asset Balance ECG
    # ==========================================

    asset_balance, _ = (
        AssetBalance.objects
        .select_for_update()
        .get_or_create(
            user=user,
            asset="ECG"
        )
    )


    asset_balance.locked = (
        Decimal(str(asset_balance.locked or 0))
        + ecg_value
        + self_bonus
    )


    asset_balance.total_earned = (
        Decimal(str(asset_balance.total_earned or 0))
        + self_bonus
    )


    asset_balance.save(
        update_fields=[
            "locked",
            "total_earned",
        ]
    )


    Ledger.objects.create(
        user=user,
        typ="BUY_PRINCIPAL",
        amount=ecg_value,
        meta={
            "invoice": invoice_no,
            "tx": bnb_tx_hash,
            "currency": "BNB",
            "asset": "ECG",
            "is_test": is_test,
        },
    )


    Ledger.objects.create(
        user=user,
        typ="BUY_SELF_PROFIT",
        amount=self_bonus,
        meta={
            "invoice": invoice_no,
            "tx": bnb_tx_hash,
            "currency": "BNB",
            "asset": "ECG",
            "is_test": is_test,
        },
    )


    credit_direct_upline_purchase_bonus(
        buyer=user,
        bonus=upline_bonus,
        invoice_no=invoice_no,
        tx_hash=bnb_tx_hash,
        currency="BNB",
        is_test=is_test,
        asset="ECG",
    )


    update_user_investment(
        user,
        bnb_amount,
    )


    credit_indirect_upline_purchase_bonuses(
        buyer=user,
        purchase_ecg_value=ecg_value,
        invoice_no=invoice_no,
        tx_hash=bnb_tx_hash,
        currency="BNB",
        is_test=is_test,
        asset="ECG",
    )


    update_user_total_investment(
        user
    )


    return purchase
# ============================================================
# ECG -> TON
# ============================================================

def ecg_to_ton(
    ecg_amount: Decimal,
) -> Decimal:

    rate = fetch_ton_usd_rate()

    ecg_per_ton = (
        rate * ECG_PER_USD
    )

    return (
        ecg_amount
        / ecg_per_ton
    ).quantize(
        Decimal("0.000000001"),
        rounding=ROUND_DOWN,
    )


# ============================================================
# Level 5 purchase distribution
# ============================================================

def distribute_level_5_purchase(
    user: AppUser,
    purchase_amount: Decimal,
):
    """
    پرداخت 0.01 ECG به چهار upline در شرایط Level 5.
    """

    logger.info(
        "[LEVEL5] Distributing purchase for user %s",
        user.wallet_address,
    )

    level_obj = (
        ReferralLevel.objects
        .filter(user=user)
        .first()
    )

    if (
        not level_obj
        or level_obj.level_5_count == 0
    ):

        logger.info(
            "[LEVEL5] User %s is not level 5",
            user.wallet_address,
        )

        return

    current = user.inviter
    level = 1

    bonus = Decimal("0.01")

    while (
        current
        and level <= 4
    ):

        with transaction.atomic():

            ensure_user_has_wallet(
                current
            )

            epl_balance, _ = (
                AssetBalance.objects
                .select_for_update()
                .get_or_create(
                    user=current,
                    asset="EPL"
                )
            )

            epl_balance.available = (
                Decimal(str(epl_balance.available or 0))
                + bonus
            )

            epl_balance.total_earned = (
                Decimal(str(epl_balance.total_earned or 0))
                + bonus
            )

            epl_balance.save(
                update_fields=[
                    "available",
                    "total_earned",
                ]
            )

            Ledger.objects.create(
                user=current,
                typ="LEVEL5_BONUS",
                amount=bonus,
                meta={
                    "from": user.wallet_address,
                    "level": level,
                    "purchase_amount": str(
                        purchase_amount
                    ),
                    "timestamp": str(
                        timezone.now()
                    ),
                },
            )

            update_level_profit(
                current,
                level,
                user.wallet_address,
                bonus,
            )

            logger.info(
                "[LEVEL5] Bonus %s given to "
                "level %s user %s",
                bonus,
                level,
                current.wallet_address,
            )

        current = current.inviter
        level += 1

    if level <= 4:

        logger.info(
            "[LEVEL5] Only %s upline levels found",
            level - 1,
        )


# ============================================================
# Total investment
# ============================================================

def update_user_total_investment(
    user: AppUser,
):

    total_purchase_ton = (
        Purchase.objects
        .filter(user=user)
        .aggregate(
            total=Sum("ecg_value")
        )["total"]
        or Decimal("0")
    )

    total_purchase_usdt = (
        PurchaseUSDT.objects
        .filter(user=user)
        .aggregate(
            total=Sum("ecg_value")
        )["total"]
        or Decimal("0")
    )

    total_purchase_bnb = (
        PurchaseBNB.objects
        .filter(user=user)
        .aggregate(
            total=Sum("ecg_value")
        )["total"]
        or Decimal("0")
    )

    total_investment = (
        total_purchase_ton
        + total_purchase_usdt
        + total_purchase_bnb
    )

    user.total_investment = (
        total_investment
    )

    user.save(
        update_fields=[
            "total_investment"
        ]
    )

    logger.info(
        "✅ Updated total_investment for %s: %s",
        user.wallet_address,
        total_investment,
    )

    return total_investment


# ============================================================
# Total earned
# ============================================================

def update_user_total_earned(
    user: AppUser,
):

    total_earned = (
        Ledger.objects
        .filter(
            user=user,
            typ__in=[
                "DAILY_UNLOCK",
                "SELF_PROFIT_UNLOCK",
                "DOWNLINE_PROFIT",
                "REF_BONUS",
                "LEVEL5_BONUS",
            ],
        )
        .aggregate(
            total=Sum("amount")
        )["total"]
        or Decimal("0")
    )

    user.total_earned = (
        total_earned
    )

    user.save(
        update_fields=[
            "total_earned"
        ]
    )

    logger.info(
        "✅ Updated total_earned for %s: %s",
        user.wallet_address,
        total_earned,
    )

    return total_earned