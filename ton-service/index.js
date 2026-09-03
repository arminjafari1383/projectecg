import express from "express";
import { TonClient, WalletContractV4, internal } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { getHttpEndpoint } from "@orbs-network/ton-access";

const app = express();
app.use(express.json());

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

app.post("/send-ton", async (req, res) => {
  try {
    const { destination, amountTon, comment } = req.body;

    if (!destination || !amountTon) {
      return res.status(400).json({ error: "destination and amountTon required" });
    }

    const MNEMONIC = mustEnv("TREASURY_MNEMONIC"); // "w1 w2 ... w24"
    const network = process.env.TON_NETWORK || "mainnet";

    const endpoint = await getHttpEndpoint({ network });
    const client = new TonClient({ endpoint });

    const keyPair = await mnemonicToPrivateKey(MNEMONIC.split(" "));
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = client.open(wallet);

    // مقدار TON را به nanoTON تبدیل کن
    const nano = BigInt(Math.floor(Number(amountTon) * 1e9));

    const seqno = await walletContract.getSeqno();

    await walletContract.sendTransfer({
      secretKey: keyPair.secretKey,
      seqno,
      messages: [
        internal({
          to: destination,
          value: nano,
          bounce: false,
          body: comment ? comment : undefined
        }),
      ],
    });

    // اینجا tx_hash مستقیم نداریم، ولی می‌تونیم یک receipt-id برگردونیم (seqno+time)
    // در تولید بهتره با تون‌سنتر/تون‌اپی وضعیت tx رو بعداً چک کنی.
    return res.json({ ok: true, sent_seqno: seqno });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log("ton-service listening on", port));
