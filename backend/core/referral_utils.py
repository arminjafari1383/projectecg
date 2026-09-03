"""Shared referral-code normalization helpers."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import unquote

REFERRAL_PREFIXES = (
    "ref_",
    "r_",
    "invite_",
    "inv_",
    "referral_",
)


def normalize_inviter_code(raw: Optional[str]) -> Optional[str]:
    """
    Normalize invite/referral codes from Telegram start_param, URLs, or API payloads.

    Examples:
        ref_ABC123 -> ABC123
        REF_abc123 -> ABC123
    """
    if raw is None:
        return None

    code = str(raw).strip()
    if not code:
        return None

    try:
        code = unquote(code)
    except Exception:
        pass

    code = code.strip()
    lower = code.lower()

    for prefix in REFERRAL_PREFIXES:
        if lower.startswith(prefix):
            code = code[len(prefix):]
            break

    code = re.sub(r"[^a-zA-Z0-9]", "", code)
    if not code or len(code) > 32:
        return None

    return code.upper()
