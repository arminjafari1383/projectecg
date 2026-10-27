import { useEffect, useMemo, useRef, useState } from "react";

import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

import { useNavigate } from "react-router-dom";

import { api } from "../api";

import "./Purchase.css";

import ecgLogo from "../assets/ecg-logo.png";

import usdtLogo from "../assets/usdt-logo.png";

const USER_DATA_KEY = "my_app_user_data";

const WALLET_RETURN_TO_KEY = "wallet_return_to";

const STAKE_DRAFT_KEY = "stake_draft";

function readStakeDraft() {

  try {

    const raw = sessionStorage.getItem(STAKE_DRAFT_KEY);

    const parsed = raw ? JSON.parse(raw) : null;

    return {

      tonAmount: String(parsed?.tonAmount ?? "0"),

      selectedOutput: parsed?.selectedOutput === "USDT" ? "USDT" : "ECG",

    };

  } catch {

    return { tonAmount: "0", selectedOutput: "ECG" };

  }

}

function readTelegramIdentity() {

  try {

    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || null;

    const raw = localStorage.getItem(USER_DATA_KEY);

    const stored = raw ? JSON.parse(raw) : {};

    const telegramId = Number(

      tgUser?.id ??

        stored?.telegramId ??

        localStorage.getItem("telegram_id") ??

        0

    );

    if (!Number.isFinite(telegramId) || telegramId <= 0) {

      return null;

    }

    const identity = {

      telegram_id: telegramId,

      telegram_username:

        tgUser?.username || stored?.telegramUsername || null,

      telegram_photo_url:

        tgUser?.photo_url || stored?.telegramPhotoUrl || null,

      first_name:

        tgUser?.first_name || stored?.telegramFirstName || null,

      last_name:

        tgUser?.last_name || stored?.telegramLastName || null,

      is_telegram: Boolean(tgUser?.id || stored?.isTelegram),

    };

    localStorage.setItem("telegram_id", String(telegramId));

    localStorage.setItem(

      USER_DATA_KEY,

      JSON.stringify({

        ...stored,

        telegramId,

        telegramUsername: identity.telegram_username,

        telegramPhotoUrl: identity.telegram_photo_url,

        telegramFirstName: identity.first_name,

        telegramLastName: identity.last_name,

        isTelegram: identity.is_telegram,

      })

    );

    return identity;

  } catch (error) {

    console.error("[Purchase] Telegram identity read error:", error);

    return null;

  }

}

export default function Purchase() {

  const navigate = useNavigate();

  const tonWallet = useTonWallet();

  const walletAddress = useMemo(

    () => tonWallet?.account?.address,

    [tonWallet]

  );

  const [tonConnectUI] = useTonConnectUI();

  const [telegramIdentity, setTelegramIdentity] = useState(() =>

    readTelegramIdentity()

  );

  const telegramId = telegramIdentity?.telegram_id || null;

  const telegramUsername = telegramIdentity?.telegram_username || null;

  const telegramPhotoUrl = telegramIdentity?.telegram_photo_url || null;

  const initialStakeDraft = useMemo(() => readStakeDraft(), []);

  const [tonAmount, setTonAmount] = useState(initialStakeDraft.tonAmount);

  const [selectedOutput, setSelectedOutput] = useState(initialStakeDraft.selectedOutput);

  const [invoices, setInvoices] = useState([]);

  const [purchaseRequests, setPurchaseRequests] = useState([]);

  const [successMessage, setSuccessMessage] = useState("");

  const [loading, setLoading] = useState(false);

  const [tonPrice, setTonPrice] = useState(null);

  const [selectedChart, setSelectedChart] = useState("USDT");

  const [priceError, setPriceError] = useState("");

  // On-chain balance of the connected TON wallet (used for the current sendTransaction flow).

  const [walletBalance, setWalletBalance] = useState(null);

  const [balanceLoading, setBalanceLoading] = useState(false);

  const [balanceError, setBalanceError] = useState("");

  // Internal TON balance shown on the app's Wallet page (Django wallet ledger).

  const [internalTonBalance, setInternalTonBalance] = useState(null);

  const [internalBalanceLoading, setInternalBalanceLoading] = useState(false);

  const [internalBalanceError, setInternalBalanceError] = useState("");
  const [internalBuyLoading, setInternalBuyLoading] = useState(false);
  const [internalBuyError, setInternalBuyError] = useState("");
  const localDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const localWalletAddress = walletAddress || (
    localDev ? "UQAnSyNFHfwJqSsmWefsaBvzIv3LLfsfP4qxf3DjEMVLsztU" : null
  );


  const [gramAddress, setGramAddress] = useState("");

  const [gramAmount, setGramAmount] = useState("");

  const [pendingInvoice, setPendingInvoice] = useState(null);

  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const confirmationRunningRef = useRef(false);

  const ECG_PER_USDT = 312;

  const PENDING_PAYMENT_PREFIX = "gram_pending_payment:";

  function getErrorDetails(error) {

    return {

      message: error?.message || String(error),

      name: error?.name,

      code: error?.code,

      status: error?.response?.status,

      responseData: error?.response?.data,

      requestUrl: error?.config?.url,

      requestMethod: error?.config?.method,

      stack: error?.stack,

    };

  }

  function showSuccess(msg) {

    setSuccessMessage(msg);

    setTimeout(() => {

      setSuccessMessage("");

    }, 4000);

  }

  // =========================

  // TELEGRAM IDENTITY

  // =========================

  useEffect(() => {

    const tg = window.Telegram?.WebApp;

    try {

      tg?.ready?.();

      tg?.expand?.();

    } catch (error) {

      console.warn("[Purchase] Telegram WebApp init warning:", error);

    }

    setTelegramIdentity(readTelegramIdentity());

  }, []);

  // =========================

  // TON PRICE

  // =========================

  useEffect(() => {

    let cancelled = false;

    async function fetchPrices() {

      try {

        const res = await fetch(

          "https\://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd"

        );

        const data = await res.json();

        if (!cancelled) {

          setTonPrice(data?.["the-open-network"]?.usd ?? null);

        }

      } catch (error) {

        if (!cancelled) {

          setPriceError("Failed to fetch TON price.");

        }

      }

    }

    fetchPrices();

    return () => {

      cancelled = true;

    };

  }, []);

  // =========================

  // LOAD CONNECTED WALLET BALANCE

  // Requires Django GET /wallet/balance/ returning { balance_nano: "1234567890" }.

  useEffect(() => {

    let active = true;

    async function loadWalletBalance() {

      if (!walletAddress) {

        setWalletBalance(null);

        setBalanceError("");

        return;

      }

      setBalanceLoading(true);

      setBalanceError("");

      try {

        const response = await api.get("/wallet/balance/", {

          params: {

            wallet_address: walletAddress,

            network: String(tonWallet?.account?.chain || "-239"),

          },

        });

        const balanceNano = response?.data?.balance_nano;

        if (balanceNano == null || !/^\d+$/.test(String(balanceNano))) {

          throw new Error("Backend response must include numeric balance_nano.");

        }

        if (active) setWalletBalance(Number(balanceNano) / 1e9);

      } catch (error) {

        console.error("Wallet balance error:", error);

        if (active) {

          setWalletBalance(null);

          setBalanceError(error?.response?.data?.detail || error?.response?.data?.error || "Could not verify TON wallet balance.");

        }

      } finally {

        if (active) setBalanceLoading(false);

      }

    }

    loadWalletBalance();

    return () => { active = false; };

  }, [walletAddress, tonWallet?.account?.chain]);

  // =========================

  // LOAD INTERNAL TON BALANCE FROM THE APP WALLET

  // Same endpoint used by Wallet.jsx: GET /wallet/:address/

  // =========================

  useEffect(() => {

    let active = true;

    async function loadInternalTonBalance() {

      if (!localWalletAddress) {

        setInternalTonBalance(null);

        setInternalBalanceError("");

        return;

      }

      setInternalBalanceLoading(true);

      setInternalBalanceError("");

      try {

        const response = await api.get(

          `/wallet/${encodeURIComponent(localWalletAddress)}/`

        );

        const rawBalance = response?.data?.ton_balance;

        const parsedBalance = Number(rawBalance);

        if (rawBalance == null || !Number.isFinite(parsedBalance) || parsedBalance < 0) {

          throw new Error("Wallet response did not contain a valid ton_balance.");

        }

        if (active) setInternalTonBalance(parsedBalance);

      } catch (error) {

        console.error("Internal TON balance load error:", error);

        if (active) {

          setInternalTonBalance(null);

          setInternalBalanceError(

            error?.response?.data?.detail ||

            error?.response?.data?.error ||

            error?.message ||

            "Could not load the app Wallet TON balance."

          );

        }

      } finally {

        if (active) setInternalBalanceLoading(false);

      }

    }

    loadInternalTonBalance();

    return () => { active = false; };

  }, [localWalletAddress]);

  // LOAD INVOICES

  // =========================

  async function loadInvoices() {

    if (!telegramId) {

      setInvoices([]);

      return;

    }

    try {

      setLoading(true);

      const res = await api.get("/purchase/list/", {

        params: {

          telegram_id: telegramId,

        },

        headers: {

          "X-Telegram-Id": String(telegramId),

          "X-Telegram": "true",

        },

      });

      setInvoices(Array.isArray(res.data) ? res.data : []);

      try {

        const reqRes = await api.get("/purchase/requests/",{

          params:{ telegram_id:telegramId },

          headers: {

            "X-Telegram-Id":String(telegramId),

            "X-Telegram":"true",

          },

        });

        setPurchaseRequests(Array.isArray(reqRes.data) ? reqRes.data :[]);

      }catch(requestError) {

        console.warn("load purchase requests error",requestError);

      }

    } catch (error) {

      console.error("load invoices error", error);

    } finally {

      setLoading(false);

    }

  }

  useEffect(() => {

    loadInvoices();

  }, [telegramId]);

  // =========================

  // CALCULATIONS

  // =========================

  const outputValue = useMemo(() => {

    const amt = Number(tonAmount);

    if (!tonPrice || !amt || amt <= 0) {

      return "0.00";

    }

    const usdValue = amt * tonPrice;

    const ecgValue = usdValue * ECG_PER_USDT;

    if (selectedOutput === "ECG") {

      return ecgValue.toFixed(2);

    }

    return usdValue.toFixed(2);

  }, [tonAmount, tonPrice, selectedOutput]);

  const ecgProfit = useMemo(() => {

    const amt = Number(tonAmount);

    if (!tonPrice || !amt || amt <= 0) {

      return "0.00";

    }

    const usdValue = amt * tonPrice;

    const ecgValue = usdValue * ECG_PER_USDT;

    return (ecgValue * 0.05).toFixed(2);

  }, [tonAmount, tonPrice]);

  const usdtProfit = useMemo(() => {

    const amt = Number(tonAmount);

    if (!tonPrice || !amt || amt <= 0) {

      return "0.00";

    }

    const usdValue = amt * tonPrice;

    return (usdValue * 0.05).toFixed(2);

  }, [tonAmount, tonPrice]);

  const usdValue = useMemo(() => {

    const amt = Number(tonAmount);

    if (!tonPrice || !amt || amt <= 0) {

      return "0.00";

    }

    return (amt * tonPrice).toFixed(2);

  }, [tonAmount, tonPrice]);

  const outputLabel = selectedOutput === "ECG" ? "ECG" : "USDT";

  // =========================

  // PAYMENT

  // =========================

  function pendingPaymentKey(address) {

    return `${PENDING_PAYMENT_PREFIX}${address || "unknown"}`;

  }

  function readPendingPayment() {

    if (!walletAddress) return null;

    try {

      const raw = localStorage.getItem(pendingPaymentKey(walletAddress));

      return raw ? JSON.parse(raw) : null;

    } catch {

      return null;

    }

  }

  function savePendingPayment(payment) {

    if (!payment?.wallet_address) return;

    try {

      localStorage.setItem(

        pendingPaymentKey(payment.wallet_address),

        JSON.stringify(payment)

      );

    } catch (error) {

      console.warn("Could not save pending payment:", error);

    }

  }

  function clearPendingPayment(address = walletAddress) {

    if (!address) return;

    try {

      localStorage.removeItem(pendingPaymentKey(address));

    } catch {

      // ignore localStorage cleanup error

    }

  }

  function sleep(ms) {

    return new Promise((resolve) => {

      setTimeout(resolve, ms);

    });

  }

  async function confirmPendingPayment(initialPayment, { resumed = false } = {}) {

    if (!initialPayment?.wallet_address || !initialPayment?.boc) {

      return null;

    }

    if (confirmationRunningRef.current) {

      return null;

    }

    confirmationRunningRef.current = true;

    setConfirmingPayment(true);

    const payment = {

      ...initialPayment,

    };

    const confirmPayload = {

      wallet_address: payment.wallet_address,

      telegram_id: payment.telegram_id || telegramId,

      telegram_username: payment.telegram_username || telegramUsername,

      telegram_photo_url: payment.telegram_photo_url || telegramPhotoUrl,

      is_telegram: true,

      output_asset: payment.output_asset || "ECG",

      output_amount: String(

        payment.output_amount ||

        (payment.output_asset === "USDT"

          ? (Number(payment.ton_amount || 0) * Number(payment.ton_price || 0))

          : (Number(payment.ton_amount || 0) * Number(payment.ton_price || 0) * ECG_PER_USDT)

        )

      ),

      network: payment.network || "-239",

      expected_gram_amount: String(payment.gram_amount || ""),

      boc: payment.boc,

    };

    try {

      const response = await api.post("/purchase/create/", confirmPayload, {

        params: {

          telegram_id: telegramId || undefined,

          is_telegram: telegramId ? "true" : undefined,

        },

        headers: telegramId

          ? {

              "X-Telegram-Id": String(telegramId),

              "X-Telegram": "true",

            }

          : undefined,

      });

      const data = response?.data || {};

      const isPending = data?.status === "pending" && data?.request;

      const isApproved = data?.status === "approved" && data?.invoice;

      if (!isPending && !isApproved) {

        throw new Error(data?.error || "Backend did not save the purchase request");

      }

      clearPendingPayment(payment.walletAddress)

      setPendingInvoice(null);

      if (isPending) {

        setPurchaseRequests((prev) => [

          data.request,

          ...prev.filter((item) => item?.id !== data.request?.id),

        ]);

        showSuccess("✅ Payment sent. Your purchase is waiting for admin review. Balance and profit are added after approval.");

        loadInvoices().catch((error) => {

          console.warn("Purchase list sync failed:", error);

        });

        return data;

      }

      const realInvoice = {

        ...data.invoice,

        ton_tx_hash:

          data.invoice?.ton_tx_hash ||

          String(data?.ton_tx_hash || data?.wallet_receipt_hash || ""),

        currency: "TON",

        __pending: false,

        __status: "PAID",

      };

      setInvoices((prev) => {

        const withoutSame = prev.filter(

          (item) =>

            item?.id !== realInvoice?.id &&

            item?.invoice_no !== realInvoice?.invoice_no

        );

        return [realInvoice, ...withoutSame];

      });

      showSuccess(`✅ Purchase approved. Invoice #${realInvoice.invoice_no || ""}.`);

      loadInvoices().catch((error) => {

        console.warn("Invoice list sync failed:", error);

      });

      return data;

    } catch (error) {

      console.error("Immediate invoice save error:", error);

      savePendingPayment(payment);

      throw error;

    } finally {

      confirmationRunningRef.current = false;

      setConfirmingPayment(false);

    }

  }

  useEffect(() => {

    if (!walletAddress) {

      return;

    }

    const saved = readPendingPayment();

    if (!saved || saved.wallet_address !== walletAddress) {

      return;

    }

    const localInvoice = null;

    setPendingInvoice(null);

    setGramAddress(String(saved.gram_address || ""));

    setGramAmount(String(saved.gram_amount || ""));

    confirmPendingPayment(

      {

        ...saved,

        pending_invoice: localInvoice,

      },

      {

        resumed: true,

      }

    ).catch((error) => {

      console.error("Resume confirmation error:", error);

    });

  }, [walletAddress]);

  async function buyWithWalletBalance() {
    setInternalBuyError("");

    if (!walletAddress) {
      try {
        sessionStorage.setItem(
          STAKE_DRAFT_KEY,
          JSON.stringify({ tonAmount, selectedOutput })
        );
        sessionStorage.setItem(WALLET_RETURN_TO_KEY, "/stake");
      } catch (error) {
        console.warn("Could not save Stake return state:", error);
      }
      navigate("/wallet", {
        state: { returnTo: "/stake", reason: "stake_requires_wallet" },
      });
      return;
    }

    if (!telegramId) {
      setInternalBuyError("Telegram ID was not detected. Please open the Mini App inside Telegram.");
      return;
    }

    const amountText = String(tonAmount).trim();
    const amount = Number(amountText);

    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amountText) || !(amount > 0)) {
      setInternalBuyError("Enter a valid TON amount (up to 8 decimals).");
      return;
    }

    setInternalBuyLoading(true);

    try {
      const balanceRes = await api.get(`/wallet/${encodeURIComponent(walletAddress)}/`);
      const available = Number(balanceRes?.data?.ton_balance);

      if (!Number.isFinite(available)) {
        throw new Error("Could not load your wallet balance.");
      }

      setInternalTonBalance(available);

      if (available < amount) {
        const missing = Math.ceil((amount - available) * 1e9) / 1e9;
        navigate("/wallet", {
          state: {
            topupAmount: String(missing),
            returnTo: "/stake",
          },
        });
        return;
      }

      const accepted = window.confirm(
        `Buy ${outputLabel} with ${amountText} TON from your wallet balance?\n` +
        `Available: ${available} TON`
      );
      if (!accepted) return;

      const response = await api.post("/purchase/internal/", {
        wallet_address: walletAddress,
        telegram_id: telegramId,
        telegram_username: telegramUsername,
        amount: amountText,
        output_asset: selectedOutput,
        request_key: crypto.randomUUID(),
      });

      const nextBalance = Number(response?.data?.ton_balance);
      if (Number.isFinite(nextBalance)) setInternalTonBalance(nextBalance);

      showSuccess(`✅ Purchase completed. Invoice ${response?.data?.invoice?.invoice_no || ""}`);
      await loadInvoices();
    } catch (error) {
      console.error("Wallet balance purchase error:", getErrorDetails(error));
      setInternalBuyError(
        error?.response?.data?.error ||
        error?.message ||
        "Could not complete purchase."
      );
    } finally {
      setInternalBuyLoading(false);
    }
  }

  async function payAndRegister() {

    if (!telegramId) {

      alert("Telegram ID was not detected. Please open the Mini App inside Telegram.");

      return;

    }

    if (!walletAddress) {

      try {

        sessionStorage.setItem(

          STAKE_DRAFT_KEY,

          JSON.stringify({

            tonAmount,

            selectedOutput,

          })

        );

        sessionStorage.setItem(WALLET_RETURN_TO_KEY, "/stake");

      } catch (error) {

        console.warn("Could not save Stake return state:", error);

      }

      navigate("/wallet", {

        state: {

          returnTo: "/stake",

          reason: "stake_requires_wallet",

        },

      });

      return;

    }

    if (balanceLoading) {

      alert("Please wait while your TON balance is checked.");

      return;

    }

    if (walletBalance === null) {

      alert(balanceError || "Unable to verify wallet balance. Please try again.");

      return;

    }

    const requestedAmount = Number(tonAmount);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {

      alert("Enter a valid TON amount.");

      return;

    }

    // Keep a small reserve for TON network fees; the backend must still validate payment.

    if (walletBalance < requestedAmount + 0.05) {

      navigate("/wallet", {

        state: {

          reason: "insufficient_stake_balance",

          requiredAmount: requestedAmount,

          availableBalance: walletBalance,

          returnTo: "/stake",

        },

      });

      return;

    }

    const previousPending = readPendingPayment();

    if (previousPending) {

      const localInvoice = null;

      setPendingInvoice(null);

      showSuccess("⏳ Previous payment is still confirming. Do not pay again.");

      confirmPendingPayment(

        {

          ...previousPending,

          pending_invoice: localInvoice,

        },

        {

          resumed: true,

        }

      ).catch((error) => {

        console.error("Resume error:", error);

      });

      return;

    }

    setGramAddress("");

    setGramAmount("");

    setLoading(true);

    try {

      const amount = Number(tonAmount);

      if (!Number.isFinite(amount) || amount <= 0) {

        throw new Error("Invalid TON amount.");

      }

      const walletNetwork = String(tonWallet?.account?.chain || "-239");

      const nano = BigInt(Math.floor(amount * 1e9));

      const createTxPayload = {

        amount: nano.toString(),

        wallet_address: walletAddress,

        telegram_id: telegramId,

        telegram_username: telegramUsername,

        telegram_photo_url: telegramPhotoUrl,

        is_telegram: true,

        network: walletNetwork,

      };

      const txResponse = await api.post("/purchase/create-transaction/", createTxPayload);

      const backendData = txResponse?.data || {};

      const backendGramAddress = String(backendData?.gram_address || "");

      const backendGramAmount = String(backendData?.gram_amount ?? "");

      const transaction = backendData?.transaction;

      if (!backendGramAddress) {

        throw new Error("Backend did not return gram_address");

      }

      if (!backendGramAmount) {

        throw new Error("Backend did not return gram_amount");

      }

      if (!transaction || !Array.isArray(transaction?.messages) || transaction.messages.length === 0) {

        throw new Error("Backend returned invalid transaction");

      }

      const firstMessage = transaction.messages[0];

      if (String(firstMessage?.address || "") !== backendGramAddress) {

        throw new Error("GRAM address mismatch in transaction");

      }

      if (String(firstMessage?.amount || "") !== backendGramAmount) {

        throw new Error("GRAM amount mismatch in transaction");

      }

      setGramAddress(backendGramAddress);

      setGramAmount(backendGramAmount);

      const sendResult = await tonConnectUI.sendTransaction(transaction);

      const boc = String(sendResult?.boc || "");

      if (!boc) {

        throw new Error("Wallet did not return transaction BOC");

      }

      const paymentContext = {

        wallet_address: walletAddress,

        telegram_id: telegramId,

        telegram_username: telegramUsername,

        telegram_photo_url: telegramPhotoUrl,

        is_telegram: true,

        network: walletNetwork,

        output_asset: selectedOutput,

        gram_address: backendGramAddress,

        gram_amount: backendGramAmount,

        ton_amount: String(amount),

        ton_price: tonPrice,

        output_amount: selectedOutput === "USDT"

          ? (Number(amount) * Number(tonPrice || 0)).toFixed(8)

          : (Number(amount) * Number(tonPrice || 0) * ECG_PER_USDT).toFixed(8),

        boc,

        message_hash: "",

        created_at: Date.now(),

      };

      // Local pending invoice is not used; backend remains the source of truth.

      const pendingPayment = {

        ...paymentContext,

      };

      savePendingPayment(pendingPayment);

      setPendingInvoice(null);

      showSuccess("✅ Wallet accepted the payment. Creating the real invoice now...");

      const savedPurchase = await confirmPendingPayment(pendingPayment);

      if (!savedPurchase) {

        throw new Error("Wallet accepted payment but backend did not save the invoice");

      }

    } catch (error) {

      console.error("Payment error:", error);

      alert(

        `❌ Payment failed: ${

          error?.response?.data?.error ||

          error?.response?.data?.detail ||

          error?.message ||

          "Unknown error"

        }`

      );

    } finally {

      setLoading(false);

    }

  }

  // =========================

  // INVOICES

  // =========================

  const allInvoices = useMemo(() => {

    const seen = new Set();

    const paidInvoices = [];

    for (const invoice of invoices) {

      if (!invoice || typeof invoice !== "object") {

        continue;

      }

      const invoiceNo = String(invoice.invoice_no || "").trim();

      const txHash = String(invoice.ton_tx_hash || "").trim();

      const tonAmountValue = Number(invoice.ton_amount ?? 0);

      const paymentStatus = String(

        invoice.payment_status ||

        invoice.status ||

        invoice.__status ||

        ""

      ).trim().toUpperCase();

      // فقط فاکتور واقعی و کاملِ پرداخت‌شده نمایش داده شود.

      // فاکتورهای pending/خالی/ناقص در UI نمایش داده نمی‌شوند.

      if (

        invoice.__pending === true ||

        !invoiceNo ||

        invoiceNo.startsWith("PENDING-") ||

        !txHash ||

        txHash === "-" ||

        txHash.startsWith("TEST_") ||

        ["FAILED", "CANCELLED", "CANCELED", "REJECTED", "PENDING", "SAVING"].includes(

          paymentStatus

        ) ||

        !Number.isFinite(tonAmountValue) ||

        tonAmountValue <= 0

      ) {

        continue;

      }

      // اگر همان پرداخت دوبار از state و API برگشت، فقط یک کارت نشان بده.

      const dedupeKey = txHash || invoiceNo;

      if (seen.has(dedupeKey)) {

        continue;

      }

      seen.add(dedupeKey);

      paidInvoices.push({

        ...invoice,

        currency: invoice.currency || "TON",

        __pending: false,

        __status: "PAID",

      });

    }

    return paidInvoices;

  }, [invoices]);

  function formatInvoiceDate(value) {

    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {

      return String(value);

    }

    return date.toLocaleString();

  }

  async function copyTxHash(value) {

    const hash = String(value || "").trim();

    if (!hash || hash === "-") {

      return;

    }

    try {

      await navigator.clipboard.writeText(hash);

      showSuccess("✅ TX Hash copied");

    } catch (error) {

      console.error("Could not copy TX Hash:", error);

      showSuccess("❌ Could not copy TX Hash");

    }

  }

  function InvestmentCountdown({ unlockAt, createdAt, fallbackDays = 365, completedLabel = "Mining Completed" }) {

    const getTargetTime = () => {

      const direct = new Date(unlockAt).getTime();

      if (Number.isFinite(direct)) return direct;

      const start = new Date(createdAt).getTime();

      if (Number.isFinite(start)) {

        return start + fallbackDays * 24 * 60 * 60 * 1000;

      }

      return null;

    };

    const targetTime = getTargetTime();

    const [remainingMs, setRemainingMs] = useState(() =>

      targetTime ? Math.max(0, targetTime - Date.now()) : 0

    );

    useEffect(() => {

      if (!targetTime) {

        setRemainingMs(0);

        return;

      }

      const updateCountdown = () => {

        setRemainingMs(Math.max(0, targetTime - Date.now()));

      };

      updateCountdown();

      const timer = setInterval(updateCountdown, 1000);

      return () => clearInterval(timer);

    }, [targetTime]);

    if (!targetTime) {

      return <span>Waiting...</span>;

    }

    const addMonthsClamped = (date, monthsToAdd) => {

      const result = new Date(date.getTime());

      const originalDay = result.getUTCDate();

      result.setUTCDate(1);

      result.setUTCMonth(result.getUTCMonth() + monthsToAdd);

      const lastDayOfTargetMonth = new Date(

        Date.UTC(

          result.getUTCFullYear(),

          result.getUTCMonth() + 1,

          0

        )

      ).getUTCDate();

      result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

      return result;

    };

    const getCalendarParts = () => {

      if (remainingMs <= 0) {

        return {

          months: 0,

          days: 0,

          hours: 0,

          minutes: 0,

          seconds: 0,

        };

      }

      const now = new Date();

      const target = new Date(targetTime);

      let months =

        (target.getUTCFullYear() - now.getUTCFullYear()) * 12 +

        (target.getUTCMonth() - now.getUTCMonth());

      let monthCursor = addMonthsClamped(now, months);

      if (monthCursor.getTime() > target.getTime()) {

        months -= 1;

        monthCursor = addMonthsClamped(now, months);

      }

      const restSeconds = Math.max(

        0,

        Math.floor((target.getTime() - monthCursor.getTime()) / 1000)

      );

      const days = Math.floor(restSeconds / 86400);

      const hours = Math.floor((restSeconds % 86400) / 3600);

      const minutes = Math.floor((restSeconds % 3600) / 60);

      const seconds = restSeconds % 60;

      return {

        months: Math.max(0, months),

        days,

        hours,

        minutes,

        seconds,

      };

    };

    const { months, days, hours, minutes, seconds } = getCalendarParts();

    const pad = (value) => String(value).padStart(2, "0");

    const timeParts = [

      { value: months, label: "MONTHS" },

      { value: days, label: "DAYS" },

      { value: hours, label: "HOURS" },

      { value: minutes, label: "MINUTES" },

      { value: seconds, label: "SECONDS" },

    ];

    return (

      <div

        style={{

          display: "flex",

          alignItems: "center",

          justifyContent: "flex-end",

          gap: 6,

          flexWrap: "wrap",

          fontVariantNumeric: "tabular-nums",

          color: remainingMs > 0 ? "#00b7ff" : "#36d399",

          fontWeight: 800,

        }}

        title={

          remainingMs > 0

            ? `Unlocks at ${new Date(targetTime).toLocaleString()}`

            : completedLabel

        }

      >

        {timeParts.map((part, index) => (

          <div

            key={part.label}

            style={{

              display: "flex",

              alignItems: "center",

              gap: 6,

            }}

          >

            <div

              style={{

                display: "flex",

                flexDirection: "column",

                alignItems: "center",

                minWidth: part.label === "SECONDS" ? 48 : 42,

                lineHeight: 1.05,

              }}

            >

              <span

                style={{

                  fontSize: 18,

                  letterSpacing: "0.5px",

                }}

              >

                {pad(part.value)}

              </span>

              <span

                style={{

                  marginTop: 4,

                  fontSize: 8,

                  fontWeight: 600,

                  letterSpacing: "0.6px",

                  color: "#a9bdd3",

                }}

              >

                {part.label}

              </span>

            </div>

            {index < timeParts.length - 1 && (

              <span

                style={{

                  fontSize: 16,

                  marginTop: -8,

                }}

              >

                :

              </span>

            )}

          </div>

        ))}

      </div>

    );

  }

  function Row({ label, value }) {

    return (

      <div

        style={{

          display: "flex",

          justifyContent: "space-between",

          gap: 12,

          paddingBottom: 8,

          borderBottom: "1px dashed #222",

        }}

      >

        <div style={{ opacity: 0.75 }}>{label}</div>

        <div style={{ fontWeight: 700 }}>{value ?? "-"}</div>

      </div>

    );

  }

  // =========================

  // UI

  // =========================

  return (

    <div className="dark-wrapper">

      <div className="page-container dark-card">

        <h2 className="title">Stake</h2>

        {successMessage && (

              <div className="success-box">{successMessage}</div>

            )}

            {(loading || confirmingPayment) && (

              <div className="loading-text">

                {loading

                  ? "Processing..."

                  : "Wallet accepted payment — saving invoice..."}

              </div>

            )}

            {/* =========================

                CHART

            ========================= */}

            <div className="live-chart-box">

              <div className="live-chart-header">

                <div>

                  <span className="live-dot" aria-hidden="true" />

                  <span className="live-chart-title">

                    {selectedChart} / USD

                  </span>

                </div>

                <span className="live-chart-badge">LIVE</span>

              </div>

              {/* Chart selector */}

              <div className="chart-switcher">

                <button

                  type="button"

                  className={`chart-switch-btn ${

                    selectedChart === "USDT" ? "active" : ""

                  }`}

                  onClick={() => setSelectedChart("USDT")}

                >

                  USDT

                </button>

                <button

                  type="button"

                  className={`chart-switch-btn ${

                    selectedChart === "TON" ? "active" : ""

                  }`}

                  onClick={() => setSelectedChart("TON")}

                >

                  TON

                </button>

              </div>

              {/* Live TradingView chart */}

              <iframe

                key={selectedChart}

                className="live-chart-frame"

                title={`Live ${selectedChart} chart`}

                src={`https\://s.tradingview.com/widgetembed/?frameElementId=tradingview_${selectedChart.toLowerCase()}&symbol=${

                  selectedChart === "TON"

                    ? "CRYPTO%3ATONUSD"

                    : "COINBASE%3AUSDTUSD"

                }&interval=15&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=0f1d3b&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1&locale=en`}

                loading="lazy"

                allowFullScreen

              />

              <div className="chart-source">

                Live market chart by TradingView

              </div>

            </div>

            {/* =========================

                PRICE

            ========================= */}

            {tonPrice && (

              <div className="price-box dark-subcard">

                TON Price: <b>${tonPrice}</b> USD

              </div>

            )}

            {priceError && (

              <div className="error-text">{priceError}</div>

            )}

            {/* =========================

                INPUT

            ========================= */}

            {/* =========================

                OUTPUT SELECTOR

            ========================= */}

            <div className="output-selector">

              <p className="output-label">💰 Select Output Currency:</p>

              <div className="output-buttons">

                <button

                  className={`output-btn ${selectedOutput === "ECG" ? "active-ecg" : ""}`}

                  onClick={() => setSelectedOutput("ECG")}

                  disabled={loading}

                >

                  <img

                    src={ecgLogo}

                    alt=""

                    aria-hidden="true"

                    className="output-token-logo"

                  />

                  <span>ECG</span>

                </button>

                <button

                  className={`output-btn ${selectedOutput === "USDT" ? "active-usdt" : ""}`}

                  onClick={() => setSelectedOutput("USDT")}

                  disabled={loading}

                >

                  <img

                    src={usdtLogo}

                    alt=""

                    aria-hidden="true"

                    className="output-token-logo"

                  />

                  <span>USDT</span>

                </button>

              </div>

            </div>

            {walletAddress && (

              <div className="price-box dark-subcard" aria-live="polite">

                <strong>Connected TON balance:</strong>{" "}

                {balanceLoading ? "Checking..." : walletBalance === null ? "Unavailable" : `${walletBalance.toFixed(4)} TON`}

                {balanceError && <div className="error-text">{balanceError}</div>}

              </div>

            )}

            <p className="label-text">You Pay (TON)</p>

            <input

              className="input-box dark-input"

              type="number"

              value={tonAmount}

              onChange={(e) => setTonAmount(e.target.value)}

              min="0"

              step="0.1"

              disabled={loading}

            />

            {/* =========================

                OUTPUT BOXES

            ========================= */}

            <div className="output-boxes">

              {/* ECG */}

              <div

                className={`output-box ecg-box ${selectedOutput === "ECG" ? "box-active" : "box-inactive"}`}

              >

                <div className="box-header">

                  <span className="box-icon box-icon--ecg">

                    <img src={ecgLogo} alt="ECG" className="box-token-logo" />

                  </span>

                  <div>

                    <span className="box-title">ECG</span>

                    <span className="box-subtitle">You Receive</span>

                  </div>

                </div>

                <div className="box-content">

                  <div className="box-row">

                    <span className="box-label">Amount:</span>

                    <span className="box-value">

                      {(Number(tonAmount) * Number(tonPrice) * ECG_PER_USDT).toFixed(2)} ECG

                    </span>

                  </div>

                  <div className="box-row">

                    <span className="box-label">≈ USD:</span>

                    <span className="box-value">${usdValue}</span>

                  </div>

                  <div className="box-row">

                    <span className="box-label">5% Profit:</span>

                    <span className="box-value">{ecgProfit} ECG</span>

                  </div>

                </div>

              </div>

              {/* USDT */}

              <div

                className={`output-box usdt-box ${selectedOutput === "USDT" ? "box-active" : "box-inactive"}`}

              >

                <div className="box-header">

                  <span className="box-icon box-icon--usdt">

                    <img src={usdtLogo} alt="USDT" className="box-token-logo" />

                  </span>

                  <div>

                    <span className="box-title">USDT</span>

                    <span className="box-subtitle">You Receive</span>

                  </div>

                </div>

                <div className="box-content">

                  <div className="box-row">

                    <span className="box-label">Amount:</span>

                    <span className="box-value">

                      {(Number(tonAmount) * Number(tonPrice)).toFixed(2)} USDT

                    </span>

                  </div>

                  <div className="box-row">

                    <span className="box-label">≈ USD:</span>

                    <span className="box-value">${usdValue}</span>

                  </div>

                  <div className="box-row">

                    <span className="box-label">5% Profit:</span>

                    <span className="box-value">{usdtProfit} USDT</span>

                  </div>

                </div>

              </div>

            </div>

            {/* =========================

                PAYMENT BUTTON

            ========================= */}

            <div className="stake-balance-info" role="status" aria-live="polite" style={{

              marginBottom: 12,

              padding: "12px 14px",

              borderRadius: 12,

              background: "rgba(255,255,255,0.06)",

              display: "flex",

              justifyContent: "space-between",

              alignItems: "center",

              gap: 12,

              flexWrap: "wrap",

            }}>

              <span>Wallet page TON balance</span>

              <strong>

                {!walletAddress

                  ? "Connect wallet"

                  : internalBalanceLoading

                    ? "Loading…"

                    : internalTonBalance === null

                      ? "Unavailable"

                      : `${internalTonBalance.toLocaleString("en-US", { maximumFractionDigits: 9 })} TON`}

              </strong>

              {internalBalanceError && (

                <small style={{ width: "100%", color: "#ff8b8b" }}>

                  {internalBalanceError}

                </small>

              )}

            </div>

            <button

              type="button"

              onClick={buyWithWalletBalance}

              className="convert-btn"

              disabled={internalBuyLoading || internalBalanceLoading}

            >

              {internalBuyLoading

                ? "Processing..."

                : !walletAddress

                  ? "Connect Wallet to Stake"

                  : internalBalanceLoading

                    ? "Checking Balance..."

                    : internalTonBalance !== null && internalTonBalance < Number(tonAmount)

                      ? "Insufficient Balance — Top Up"

                      : `Stake TON → ${outputLabel}`}

            </button>

            {internalBuyError && (

              <p role="alert" style={{ color: "#ff8888", marginTop: 10 }}>{internalBuyError}</p>

            )}

          </div>
          {/* =========================
              INVOICES

          ========================= */}

                  {purchaseRequests.some((item) => item?.status !== "APPROVED") && (

            <div className="invoices-section">

              <div className="invoices-header">

                <h3 className="invoices-title">Purchase Requests</h3>

              </div>

              <div className="invoices-grid">

                {purchaseRequests

                  .filter((item) => item?.status !== "APPROVED")

                  .map((item) => {

                    const isRejected = item.status === "REJECTED";

                    return (

                      <div key={item.id} className="invoice-card currency-ton">

                        <div className="invoice-header">

                          <div className="invoice-number">

                            <span className="invoice-label">Request TON</span>

                            <span className="invoice-id">#{item.id}</span>

                          </div>

                          <div

                            className={`invoice-status ${

                              isRejected ? "status-failed" : "status-pending"

                            }`}

                          >

                            <span className="dot" />

                            {isRejected ? "REJECTED" : "PENDING REVIEW"}

                          </div>

                        </div>

                        <div className="invoice-body">

                          <Row label="Date" value={formatInvoiceDate(item.created_at)} />

                          <Row label="TON Amount" value={item.ton_amount} />

                          <Row label="Receive" value={item.output_asset} />

                          <Row

                            label="Status"

                            value={

                              isRejected

                                ? "Rejected by admin. No balance was added."

                                : "Waiting for admin approval."

                            }

                          />

                        </div>

                      </div>

                    );

                  })}

              </div>

            </div>

          )} 

    </div>

  );

}