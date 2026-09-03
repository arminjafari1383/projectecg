
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_remove_assetbalance_unique_user_asset_balance_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchase',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='ecg_value',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=30),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='invoice_no',
            field=models.CharField(max_length=50, unique=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='output_amount',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=30),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='output_asset',
            field=models.CharField(choices=[('ECG', 'ECG'), ('USDT', 'USDT')], default='ECG', max_length=10),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='principal_unlock_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='profit_asset',
            field=models.CharField(choices=[('ECG', 'ECG'), ('USDT', 'USDT')], default='ECG', max_length=10),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='self_profit_5',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=30),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='self_profit_unlock_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='ton_amount',
            field=models.DecimalField(decimal_places=8, max_digits=30),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='ton_tx_hash',
            field=models.CharField(max_length=255, unique=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='ton_usd_rate',
            field=models.DecimalField(decimal_places=8, max_digits=20),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='usd_value',
            field=models.DecimalField(decimal_places=8, max_digits=30),
        ),
    ]
