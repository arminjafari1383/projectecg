import django.db.models.deletion
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='AppUser',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('telegram_id', models.BigIntegerField(blank=True, null=True, unique=True)),
                ('telegram_username', models.CharField(blank=True, help_text='یوزرنیم تلگرام کاربر', max_length=100, null=True)),
                ('telegram_photo_url', models.URLField(blank=True, help_text='آدرس آواتار تلگرام کاربر', max_length=1000, null=True)),
                ('wallet_address', models.CharField(max_length=128, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('referral_code', models.CharField(blank=True, max_length=32, unique=True)),
                ('next_daily_claim_at', models.DateTimeField(blank=True, null=True)),
                ('is_telegram_user', models.BooleanField(default=False)),
                ('telegram_verified', models.BooleanField(default=False)),
                ('wallet_locked', models.BooleanField(default=False)),
                ('is_admin', models.BooleanField(default=False, help_text='آیا کاربر ادمین است؟')),
                ('is_active', models.BooleanField(default=True, help_text='آیا کاربر فعال است؟')),
                ('last_active', models.DateTimeField(blank=True, help_text='آخرین فعالیت کاربر', null=True)),
                ('total_investment', models.DecimalField(decimal_places=6, default=0, help_text='کل سرمایه\u200cگذاری', max_digits=24)),
                ('total_earned', models.DecimalField(decimal_places=6, default=0, help_text='کل سود کسب شده', max_digits=24)),
                ('inviter', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='invitees', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='Ledger',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('typ', models.CharField(choices=[('REF_BONUS', 'Referral bonus'), ('DAILY_ADD', 'Daily add locked'), ('DAILY_UNLOCK', 'Daily unlock'), ('BUY_PRINCIPAL', 'Buy principal locked'), ('BUY_SELF_PROFIT', 'Buy self profit locked'), ('SELF_PROFIT_UNLOCK', 'Self profit unlock'), ('PRINCIPAL_UNLOCK', 'Principal unlock'), ('DOWNLINE_PROFIT', 'Downline instant profit'), ('WITHDRAW', 'Withdraw'), ('LEVEL5_BONUS', 'Level 5 bonus')], max_length=32)),
                ('amount', models.DecimalField(decimal_places=6, max_digits=24)),
                ('meta', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ledgers', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='Purchase',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('invoice_no', models.CharField(max_length=32, unique=True)),
                ('ton_amount', models.DecimalField(decimal_places=6, max_digits=24)),
                ('ton_tx_hash', models.CharField(max_length=256, unique=True)),
                ('ton_usd_rate', models.DecimalField(decimal_places=6, max_digits=24)),
                ('usd_value', models.DecimalField(decimal_places=6, max_digits=24)),
                ('ecg_value', models.DecimalField(decimal_places=6, max_digits=24)),
                ('self_profit_5', models.DecimalField(decimal_places=6, max_digits=24)),
                ('principal_unlock_at', models.DateTimeField()),
                ('self_profit_unlock_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('output_asset', models.CharField(choices=[('ECG', 'ECG'), ('USDT', 'USDT')], default='ECG', max_length=8)),
                ('output_amount', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('profit_asset', models.CharField(choices=[('ECG', 'ECG'), ('USDT', 'USDT')], default='ECG', max_length=8)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='purchases', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='PurchaseBNB',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('invoice_no', models.CharField(max_length=32, unique=True)),
                ('bnb_amount', models.DecimalField(decimal_places=8, max_digits=24)),
                ('bnb_tx_hash', models.CharField(max_length=256, unique=True)),
                ('bnb_usd_rate', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('usd_value', models.DecimalField(decimal_places=6, max_digits=24)),
                ('ecg_value', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('self_profit_5', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('principal_unlock_at', models.DateTimeField()),
                ('self_profit_unlock_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='purchases_bnb', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='PurchaseUSDT',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('invoice_no', models.CharField(max_length=32, unique=True)),
                ('usdt_amount', models.DecimalField(decimal_places=6, max_digits=24)),
                ('usdt_tx_hash', models.CharField(max_length=256, unique=True)),
                ('usdt_usd_rate', models.DecimalField(decimal_places=6, default=1, max_digits=24)),
                ('usd_value', models.DecimalField(decimal_places=6, max_digits=24)),
                ('ecg_value', models.DecimalField(decimal_places=6, max_digits=24)),
                ('self_profit_5', models.DecimalField(decimal_places=6, max_digits=24)),
                ('principal_unlock_at', models.DateTimeField()),
                ('self_profit_unlock_at', models.DateTimeField()),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='purchases_usdt', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='ReferralLevel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('level_1_count', models.PositiveIntegerField(default=0)),
                ('level_2_count', models.PositiveIntegerField(default=0)),
                ('level_3_count', models.PositiveIntegerField(default=0)),
                ('level_4_count', models.PositiveIntegerField(default=0)),
                ('level_5_count', models.PositiveIntegerField(default=0)),
                ('level_1_users', models.JSONField(blank=True, default=list)),
                ('level_2_users', models.JSONField(blank=True, default=list)),
                ('level_3_users', models.JSONField(blank=True, default=list)),
                ('level_4_users', models.JSONField(blank=True, default=list)),
                ('level_5_users', models.JSONField(blank=True, default=list)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='referral_level', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='Wallet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ecg_self_locked', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('ecg_self_unlocked', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('ecg_referral_profit', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('usdt_self_locked', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('usdt_self_unlocked', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('usdt_referral_profit', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('epl_balance', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('epl_total_earned', models.DecimalField(decimal_places=8, default=Decimal('0'), max_digits=24)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='wallet', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='WithdrawRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('asset', models.CharField(default='USDT', max_length=10)),
                ('amount', models.DecimalField(decimal_places=8, max_digits=24)),
                ('wallet_address', models.CharField(max_length=128)),
                ('tx_hash', models.CharField(blank=True, max_length=256, null=True)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('APPROVED', 'Approved'), ('REJECTED', 'Rejected'), ('PAID', 'Paid')], default='PENDING', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='withdraw_requests', to='core.appuser')),
            ],
        ),
        migrations.CreateModel(
            name='AssetBalance',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('asset', models.CharField(choices=[('USDT', 'USDT')], max_length=8)),
                ('principal_locked', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('principal_unlocked', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('profit_locked', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('profit_unlocked', models.DecimalField(decimal_places=6, default=0, max_digits=24)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='asset_balances', to='core.appuser')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('user', 'asset'), name='unique_user_asset_balance')],
            },
        ),
    ]
