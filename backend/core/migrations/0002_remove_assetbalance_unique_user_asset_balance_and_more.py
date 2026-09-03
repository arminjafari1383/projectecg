from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='assetbalance',
            name='unique_user_asset_balance',
        ),
        migrations.RemoveField(
            model_name='assetbalance',
            name='principal_locked',
        ),
        migrations.RemoveField(
            model_name='assetbalance',
            name='principal_unlocked',
        ),
        migrations.RemoveField(
            model_name='assetbalance',
            name='profit_locked',
        ),
        migrations.RemoveField(
            model_name='assetbalance',
            name='profit_unlocked',
        ),
        migrations.RemoveField(
            model_name='assetbalance',
            name='updated_at',
        ),
        migrations.AddField(
            model_name='assetbalance',
            name='available',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=24),
        ),
        migrations.AddField(
            model_name='assetbalance',
            name='locked',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=24),
        ),
        migrations.AddField(
            model_name='assetbalance',
            name='total_earned',
            field=models.DecimalField(decimal_places=8, default=0, max_digits=24),
        ),
        migrations.AddField(
            model_name='withdrawrequest',
            name='source_asset',
            field=models.CharField(choices=[('TON', 'TON'), ('ECG', 'ECG'), ('EPL', 'EPL'), ('USDT', 'USDT')], default='ECG', max_length=10),
        ),
        migrations.AlterField(
            model_name='assetbalance',
            name='asset',
            field=models.CharField(choices=[('ECG', 'ECG'), ('EPL', 'EPL'), ('USDT', 'USDT')], max_length=8),
        ),
        migrations.AlterField(
            model_name='withdrawrequest',
            name='asset',
            field=models.CharField(choices=[('TON', 'TON'), ('ECG', 'ECG'), ('EPL', 'EPL'), ('USDT', 'USDT')], default='ECG', max_length=10),
        ),
        migrations.AddConstraint(
            model_name='assetbalance',
            constraint=models.UniqueConstraint(fields=('user', 'asset'), name='unique_user_asset'),
        ),
    ]
