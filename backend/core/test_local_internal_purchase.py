from decimal import Decimal
from uuid import uuid4
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from core.models import AppUser, Wallet, LocalPurchaseInvoice, WalletTransaction


class LocalInternalPurchaseTests(TestCase):
    def setUp(self):
        self.client = APIClient(HTTP_HOST="localhost:8000")
        self.address = "UQAnSyNFHfwJqSsmWefsaBvzIv3LLfsfP4qxf3DjEMVLsztU"
        self.user = AppUser.objects.create(wallet_address=self.address)
        self.wallet = Wallet.objects.create(user=self.user, ton_balance=Decimal("10"))
        self.url = "/api/purchase/local-internal-test/"

    def payload(self, amount="4", key=None):
        return {"wallet_address": self.address, "amount": amount,
                "output_asset": "ECG", "request_key": str(key or uuid4())}

    @override_settings(DEBUG=True)
    def test_success_then_idempotent_retry(self):
        payload = self.payload()
        first = self.client.post(self.url, payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        again = self.client.post(self.url, payload, format="json")
        self.assertEqual(again.status_code, 200)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.ton_balance, Decimal("6"))
        self.assertEqual(LocalPurchaseInvoice.objects.count(), 1)
        self.assertEqual(WalletTransaction.objects.filter(transaction_type="purchase").count(), 1)

    @override_settings(DEBUG=True)
    def test_insufficient_balance(self):
        response = self.client.post(self.url, self.payload("11"), format="json")
        self.assertEqual(response.status_code, 409)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.ton_balance, Decimal("10"))
        self.assertFalse(LocalPurchaseInvoice.objects.exists())

    @override_settings(DEBUG=False)
    def test_disabled_in_production(self):
        response = self.client.post(self.url, self.payload("1"), format="json")
        self.assertEqual(response.status_code, 404)
