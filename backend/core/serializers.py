from rest_framework import serializers

from .models import AppUser, Wallet, Purchase, WithdrawRequest,AssetBalance


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppUser
        fields = ["id", "wallet_address", "referral_code", "inviter"]


class WalletSerializer(serializers.ModelSerializer):
    ecg_balance = serializers.SerializerMethodField()
    epl_balance = serializers.SerializerMethodField()
    usdt_balance = serializers.SerializerMethodField()
    withdrawable_total = serializers.SerializerMethodField()

    class Meta:
        model = Wallet
        fields = [
            "ecg_balance",
            "epl_balance",
            "usdt_balance",
            "withdrawable_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "created_at",
            "updated_at",
        ]

    def get_asset_balance(self,obj,asset):
        balance = AssetBalance.objects.filter(
            user=obj.user,
            asset=asset
        ).first()

        if not balance:
            return "0"

        return str(balance.available or 0)

    def get_ecg_balance(self,obj):
        return self.get_asset_balance(obj,"ECG")

    def get_epl_balance(self,obj):
        return self.get_asset_balance(obj,"EPL")

    def get_usdt_balance(self,obj):
        return self.get_asset_balance(obj,"USDT")

    def get_withdrawable_total(self,obj):
        balance = AssetBalance.objects.filter(
            user=obj.user,
            asset="ECG"
        ).first()

        if not balance:
            return "0"

        return str(balance.available or 0)


class PurchaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Purchase
        fields = "__all__"


class WithdrawSerializer(serializers.ModelSerializer):
    destination_wallet = serializers.CharField(source="wallet_address", read_only=True)
    completed_at = serializers.SerializerMethodField()

    class Meta:
        model = WithdrawRequest
        fields = [
            "id",
            "asset",
            "source_asset"
            "amount",
            "wallet_address",
            "destination_wallet",
            "tx_hash",
            "status",
            "created_at",
            "updated_at",
            "completed_at",
        ]
        read_only_fields = [
            "id",
            "tx_hash",
            "status",
            "created_at",
            "updated_at",
            "completed_at",
            "source_asset",
        ]

    def get_completed_at(self, obj):
        status_value = str(obj.status or "").upper()
        if status_value in {"PAID", "SUCCESS", "COMPLETE", "COMPLETED"}:
            return obj.updated_at
        return None