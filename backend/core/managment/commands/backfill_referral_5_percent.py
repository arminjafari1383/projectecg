# backend/core/management/commands/backfill_referral_5_percent.py

from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Ledger, ReferralLevel


def to_decimal(value) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


class Command(BaseCommand):
    help = (
        "Rebuild historical Level-1 referral profit display from existing "
        "DOWNLINE_PROFIT ledger entries. This command DOES NOT credit wallets "
        "and DOES NOT create new Ledger rows."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--wallet",
            dest="wallet",
            default="",
            help=(
                "Optional upline wallet address. "
                "If omitted, all referral owners are rebuilt."
            ),
        )

        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show changes without saving ReferralLevel rows.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        wallet_filter = str(
            options.get("wallet") or ""
        ).strip()

        dry_run = bool(
            options.get("dry_run")
        )

        qs = (
            ReferralLevel.objects
            .select_related("user")
            .all()
            .order_by("id")
        )

        if wallet_filter:
            qs = qs.filter(
                user__wallet_address=wallet_filter
            )

        owners_seen = 0
        rows_changed = 0
        users_changed = 0
        ledger_rows_seen = 0

        self.stdout.write(
            self.style.NOTICE(
                "Starting historical Level-1 referral profit rebuild..."
            )
        )

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    "DRY RUN: database will not be changed."
                )
            )

        for level_obj in qs.iterator():
            owners_seen += 1

            owner = level_obj.user

            # Source of truth:
            # old/new 5% payouts already recorded in Ledger as DOWNLINE_PROFIT.
            # We only rebuild the JSON shown in Referral Tree.
            profit_by_downline = {}

            ledger_qs = (
                Ledger.objects
                .filter(
                    user=owner,
                    typ="DOWNLINE_PROFIT",
                )
                .values(
                    "amount",
                    "meta",
                )
            )

            for row in ledger_qs.iterator():
                ledger_rows_seen += 1

                meta = row.get("meta") or {}

                if not isinstance(meta, dict):
                    continue

                from_wallet = str(
                    meta.get("from") or ""
                ).strip()

                if not from_wallet:
                    continue

                amount = to_decimal(
                    row.get("amount")
                )

                profit_by_downline[
                    from_wallet
                ] = (
                    profit_by_downline.get(
                        from_wallet,
                        Decimal("0"),
                    )
                    + amount
                )

            level_1_users = list(
                level_obj.level_1_users
                or []
            )

            changed = False

            for index, item in enumerate(
                level_1_users
            ):
                if not isinstance(item, dict):
                    continue

                downline_wallet = str(
                    item.get("wallet") or ""
                ).strip()

                if not downline_wallet:
                    continue

                historical_profit = (
                    profit_by_downline.get(
                        downline_wallet,
                        Decimal("0"),
                    )
                )

                old_profit = to_decimal(
                    item.get("profit")
                )

                if old_profit == historical_profit:
                    continue

                updated_item = {
                    **item,
                    "profit": float(
                        historical_profit
                    ),
                }

                level_1_users[
                    index
                ] = updated_item

                changed = True
                users_changed += 1

                self.stdout.write(
                    (
                        f"[BACKFILL] owner={owner.wallet_address} "
                        f"downline={downline_wallet} "
                        f"old_profit={old_profit} "
                        f"new_profit={historical_profit}"
                    )
                )

            if changed:
                rows_changed += 1

                if not dry_run:
                    level_obj.level_1_users = (
                        level_1_users
                    )

                    level_obj.save(
                        update_fields=[
                            "level_1_users"
                        ]
                    )

        if dry_run:
            transaction.set_rollback(True)

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                (
                    "Historical referral profit rebuild finished. "
                    f"owners_seen={owners_seen}, "
                    f"referral_rows_changed={rows_changed}, "
                    f"users_changed={users_changed}, "
                    f"ledger_rows_seen={ledger_rows_seen}, "
                    f"dry_run={dry_run}"
                )
            )
        )

        self.stdout.write(
            self.style.SUCCESS(
                "No wallet balance was credited and no new Ledger entry was created."
            )
        )
