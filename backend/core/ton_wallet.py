import os


PRIVATE_KEY = os.getenv(
    "TON_PRIVATE_KEY"
)


def send_ton(
    destination,
    amount
):

    # اینجا TON SDK قرار می‌گیرد
    # ساخت و امضای تراکنش

    return tx_hash