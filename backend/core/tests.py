from django.test import TestCase

from core.models import AppUser, Wallet
from core.referral_utils import normalize_inviter_code
from core.services import apply_referral


class ReferralFlowTests(TestCase):
    def setUp(self):
        self.inviter = AppUser.objects.create(
            wallet_address="inviter-wallet-1",
            telegram_id=111111111,
            referral_code="ABC123XYZ0",
        )
        Wallet.objects.create(user=self.inviter)

        self.invitee = AppUser.objects.create(
            wallet_address="telegram:222222222",
            telegram_id=222222222,
        )
        Wallet.objects.create(user=self.invitee)

    def test_normalize_inviter_code_strips_ref_prefix(self):
        self.assertEqual(normalize_inviter_code("ref_ABC123XYZ0"), "ABC123XYZ0")
        self.assertEqual(normalize_inviter_code("REF_abc123xyz0"), "ABC123XYZ0")

    def test_apply_referral_links_invitee_to_inviter(self):
        result = apply_referral("ref_ABC123XYZ0", self.invitee)

        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "applied")

        self.invitee.refresh_from_db()
        self.assertEqual(self.invitee.inviter_id, self.inviter.id)

    def test_apply_referral_rejects_invalid_code(self):
        result = apply_referral("ref_NOTFOUND1", self.invitee)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "invalid_code")

        self.invitee.refresh_from_db()
        self.assertIsNone(self.invitee.inviter_id)

    def test_apply_referral_blocks_self_referral(self):
        result = apply_referral(self.inviter.referral_code, self.inviter)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "self_referral")

    def test_apply_referral_is_idempotent(self):
        first = apply_referral("ABC123XYZ0", self.invitee)
        second = apply_referral("ABC123XYZ0", self.invitee)

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(second["reason"], "already_set")
