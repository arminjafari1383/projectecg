from rest_framework import serializers
from .models import (
    AppUser,Wallet,Purchase,WithdrawRequest,
    ReferralLevel,AdminActionLog,DailyStats,SystemSettings
)
from decimal import Decimal

class UserAdminSerializer(serializers.ModelSerializer):

    wallet_balance = serializers.SerializerMethodField()
    total_investment = serializers.SerializerMethodField()
    referral_count = serializers.SerializerMethodField()
    total_team = serializers.SerializerMethodField()

    class Meta:
        model = AppUser
        fields = [
            'id','telegram_id','wallet_address','created_at',
            'is_active','is_admin','last_active',
            'referral_code','inviter',
            'wallet_balance','total_investment','total_earned',
            'referral_count','total_team'
        ]

    def get_wallet_balance(self,obj):
        if hasattr(obj,'wallet'):
            return {
                'total':str(obj.wallet.get_total_balance()),
                'withdrawable':str(obj.wallet.withdrawable_total()),
                'locked':str(obj.wallet.principal_locked + obj.wallet.self_profit_locked + obj)
            }
