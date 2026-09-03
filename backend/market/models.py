from django.db import models

class DogePrice(models.Model):
    symbol = models.CharField(max_length=20,default="DOGEUSDT")
    price = models.DecimalField(max_digits=20,decimal_places=10)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.symbol} - {self.price}"