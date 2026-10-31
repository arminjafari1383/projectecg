import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import LanguageSelector from "../components/LanguageSelector";
import {
  PRODUCTS,
  SUPPORT_URL,
  saveBackendOrder,
  formatUsd,
  getAvailable,
  getSold,
  isValidTonAddress,
  loadState,
  shortAddress,
} from "../utils/nftShop";
import "./NftShop.css";
import { api } from "../api";

/* ---------- small inline icons ---------- */

const Icon = ({ children, size = 18, stroke = 1.9, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
const CopyIcon = () => (
  <Icon size={16}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </Icon>
);
const CheckIcon = () => (
  <Icon size={16} stroke={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
const SendIcon = () => (
  <Icon size={18}>
    <path d="M21 3L10.5 13.5" />
    <path d="M21 3l-6.5 18-4-7.5L3 9.5 21 3z" />
  </Icon>
);
const TonIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      d="M12 22 3.4 8.2A1.9 1.9 0 0 1 5 5.3h14a1.9 1.9 0 0 1 1.6 2.9L12 22Zm0-3.6V7.4H5.6L12 18.4Zm1.4-11h5L13.4 17V7.4Z"
      fill="currentColor"
    />
  </svg>
);

/* ---------- helpers ---------- */


const formatGram = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "— GRAM";
  }

  const rounded = Math.ceil(amount);

  return `${rounded.toLocaleString("en-US")} GRAM`;
};



function useCopy() {
  const [copiedKey, setCopiedKey] = useState("");
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (key, text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopiedKey(key);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopiedKey(""), 1600);
    } catch {
      /* clipboard blocked — nothing else to do */
    }
  }, []);

  return { copiedKey, copy };
}

function useSheetBehaviour(open, onClose) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return ref;
}

/* ---------- bottom sheet ---------- */

function Sheet({ open, onClose, title, closeLabel, children, labelledBy }) {
  const ref = useSheetBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div
      className="shop-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="shop-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={ref}
      >
        <div className="shop-sheet__grab" aria-hidden="true" />
        <div className="shop-sheet__head">
          <h2 id={labelledBy}>{title}</h2>
          <button
            type="button"
            className="shop-icon-btn"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function saveBackendOrderStatuses(old, updates) {
  const byId = new Map(updates.map((v) => [v.id, v]));
  const changed = old.invoices.some((v) => byId.has(v.id) && v.status !== byId.get(v.id).status);
  if (!changed) return old;
  return { ...old, invoices: old.invoices.map((v) => byId.get(v.id) || v) };
}

/* ---------- page ---------- */

export default function NftShop() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const product = PRODUCTS[0];

  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("shop");
  const [buyOpen, setBuyOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState(null);

  const [qty, setQty] = useState(1);
  const [wallet, setWallet] = useState("");
  const [contact, setContact] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderSaving, setOrderSaving] = useState(false);
  const [serverStock, setServerStock] = useState(null);
  const [gramQuote, setGramQuote] = useState(null);
  const [demoSaving,setDemoSaving] = useState(false);
  const [demoMessage,setDemoMessage] = useState("");

  // Display-only cache. Server remains authoritative for payment and rewards.
  useEffect(() => {
    try {
      window.localStorage.setItem("aipolify.nftShop.v1", JSON.stringify(state));
    } catch {
      // Browser storage may be disabled.
    }
  }, [state]);

  useEffect(() => {
    api.get("nft/catalog/")
    .then((response) => {
      setServerStock(response.data?.verdant || null);
      setGramQuote(response.data?.unit_price_gram ?? null);
    })

    .catch(() => {
      setServerStock(null);
      setGramQuote(null);
    });
  },[]);

  const { copiedKey, copy } = useCopy();

  const available = serverStock ? serverStock.available : getAvailable(product, state);
  const sold = serverStock ? product.initialSold + serverStock.sold_after_launch : getSold(product, state);
  const soldPct = Math.round((sold / product.total) * 100);
  const maxQty = Math.max(1, Math.min(product.maxPerOrder, available));

  const walletOk = isValidTonAddress(wallet);
  const showWalletError = submitted && !walletOk;
  const showAgreeError = submitted && !agree;

  const activeInvoice = useMemo(
    () => state.invoices.find((inv) => inv.id === invoiceId) || null,
    [state.invoices, invoiceId]
  );

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language || "en", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  const openBuy = () => {
    setQty(1);
    setWallet("");
    setContact("");
    setAgree(false);
    setSubmitted(false);
    setBuyOpen(true);
  };

  const closeBuy = useCallback(() => setBuyOpen(false), []);
  const closeInvoice = useCallback(() => setInvoiceId(null), []);
  const [insufficientBalance, setInsufficientBalance] = useState(null);

  const submitOrder = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!walletOk || !agree || orderSaving) return;
    setOrderError("");
    setInsufficientBalance(null);
    setOrderSaving(true);
    try {
      const response = await api.post("/nft/buy-internal/", {
        wallet_address: wallet,
        product_id: product.id,
        quantity: Number(qty),
        contact,
      });
      const data = response.data;
      const invoice = {
        id: data.id,
        createdAt: data.created_at,
        productId: product.id,
        product: product.name,
        qty: data.quantity,
        total: Number(data.usd_total),
        tonDue: data.ton_due,
        wallet,
        contact,
        status: data.status,
      };
      setState((old) => saveBackendOrder(old, invoice));
      api.get("/nft/catalog/").then((r) => setServerStock(r.data?.verdant || null)).catch(() => {});
      setBuyOpen(false);
      setInvoiceId(invoice.id);
   
    } catch (error) {
      const data = error?.response?.data;

      if (data?.code === "INSUFFICIENT_BALANCE") {
        setInsufficientBalance({
          balance: data.balance_ton,
          required: data.required_ton,
          shortage: data.shortage_ton,
        });

        setOrderError(
          "موجودی کیف پول داخلی کافی نیست. لطفاً ابتدا کیف پول داخلی خود را شارژ کنید."
        );
      } else {
        setOrderError(
          data?.error || "خرید NFT انجام نشد."
        );
      }
    } finally {
      setOrderSaving(false);
    }

  };

  

const testNftPurchase = async () => {
  setSubmitted(true);

  if (!walletOk || !agree || demoSaving || orderSaving) {
    return;
  }

  setDemoSaving(true);
  setDemoMessage("");
  setOrderError("");
  setInsufficientBalance(null);

  try {
    // خرید از موجودی واقعی کیف پول داخلی
    const response = await api.post(
      "/nft/buy-internal/",
      {
        wallet_address: wallet.trim(),
        product_id: product.id,
        quantity: Number(qty),
        contact,
      }
    );

    const data = response.data;

    const invoice = {
      id: data.id,
      createdAt: data.created_at,
      productId: product.id,
      product: product.name,
      qty: data.quantity,
      total: Number(data.usd_total),
      tonDue: data.ton_due,
      wallet: wallet.trim(),
      contact,
      status: data.status,
    };

    setState((old) => saveBackendOrder(old, invoice));

    api.get("/nft/catalog/")
      .then((res) => {
        setServerStock(res.data?.verdant || null);
      })
      .catch(console.error);

    setDemoMessage(
      `NFT purchased. Remaining balance: ${data.remaining_ton} TON`
    );

    setBuyOpen(false);
    setInvoiceId(invoice.id);

  } catch (error) {
    const data = error?.response?.data;

    if (data?.code === "INSUFFICIENT_BALANCE") {
      setInsufficientBalance({
        balance: data.balance_ton,
        required: data.required_ton,
        shortage: data.shortage_ton,
      });

      setOrderError(
        "موجودی کیف پول داخلی کافی نیست. لطفاً موجودی کیف پول داخلی را افزایش بده."
      );
    } else {
      setOrderError(
        data?.error || "خرید NFT انجام نشد."
      );
    }
  } finally {
    setDemoSaving(false);
  }
};




  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const orders = state.invoices.filter((i) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i.id || ""));
      if (orders.length === 0) return;
      const updated = await Promise.all(orders.map(async (order) => {
        try {
          const response = await api.get(`/nft/orders/${order.id}/`);
          return { ...order, status: response.data.status };
        } catch {
          return order;
        }
      }));
      if (!cancelled) {
        setState((old) => saveBackendOrderStatuses(old, updated));
      }
    };
    sync();
    return () => { cancelled = true; };
  }, [tab]);

  const steps = (status) => [
    { key: "placed", label: t("shop.stepPlaced"), done: true },
    { key: "verified", label: t("shop.stepVerified"), done: status === "completed" },
    { key: "delivered", label: t("shop.stepDelivered"), done: status === "completed" },
  ];

  const statusLabel = (s) => (s === "completed" ? t("shop.completed") : t("shop.pending"));

  return (
    <div className="nft-shop">
      {/* ---------- header ---------- */}
      <header className="shop-header">
        <button
          type="button"
          className="shop-glass-btn"
          onClick={() => navigate("/Timer")}
          aria-label="Back"
        >
          <BackIcon />
        </button>

        <div className="shop-header__title">
          <h1>{t("shop.title")}</h1>
          <span>AI POLIFY</span>
        </div>

        <LanguageSelector />
      </header>

      {/* ---------- tabs ---------- */}
      <div className="shop-tabs" role="tablist" data-active={tab === "shop" ? "0" : "1"}>
        <span className="shop-tabs__thumb" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          aria-selected={tab === "shop"}
          className={tab === "shop" ? "is-active" : ""}
          onClick={() => setTab("shop")}
        >
          {t("shop.tabShop")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "invoices"}
          className={tab === "invoices" ? "is-active" : ""}
          onClick={() => setTab("invoices")}
        >
          {t("shop.tabInvoices")}
          {state.invoices.length > 0 && (
            <span className="shop-tabs__count">{state.invoices.length}</span>
          )}
        </button>
      </div>

      {/* ---------- marketplace ---------- */}
      {tab === "shop" && (
        <section className="shop-view" aria-label={t("shop.tabShop")}>
          <article className="nft-card">
            <div className="nft-card__frame">
              <div className="nft-card__art">
                <img src={product.image} alt={product.name} draggable="false" />
                <span className="nft-chip nft-chip--net">
                  <TonIcon />
                  {product.network}
                </span>
                <span className={`nft-chip nft-chip--stock ${available <= 0 ? "is-out" : ""}`}>
                  <i aria-hidden="true" />
                  {available > 0 ? t("shop.inStock") : t("shop.soldOut")}
                </span>
                <h2 className="nft-card__name">{product.name}</h2>
              </div>
            </div>

            <div className="nft-card__body">
              <div className="nft-price">
                <div>
                  <span className="nft-label">{t("shop.price")}</span>
                  <strong className="nft-price__value">{gramQuote !== null ? formatGram(gramQuote) : "- GRAM"}</strong>
                </div>
                <div className="nft-price__avail">
                  {available > 0 && (
                      <b>
                        {gramQuote !== null
                          ? formatGram(gramQuote)
                          : "— GRAM"}
                      </b>
                    )}
                  <strong>
                    {available}
                    <small> / {product.total}</small>
                  </strong>
                </div>
              </div>

              <div
                className="nft-meter"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={product.total}
                aria-valuenow={sold}
                aria-label={t("shop.supply")}
              >
                <span style={{ width: `${soldPct}%` }} />
              </div>
              <div className="nft-meter__legend">
                <span>
                  {sold} {t("shop.sold")}
                </span>
                <span>{soldPct}%</span>
              </div>

              <p className="nft-desc" dir="ltr">{product.description}</p>

              <dl className="nft-stats">
                <div>
                  <dt>{t("shop.supply")}</dt>
                  <dd>{product.total}</dd>
                </div>
                <div>
                  <dt>{t("shop.sold")}</dt>
                  <dd>{sold}</dd>
                </div>
                <div>
                  <dt>{t("shop.network")}</dt>
                  <dd>{product.network}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="shop-cta"
                onClick={openBuy}
                disabled={available <= 0}
              >
                <span>{available > 0 ? t("shop.buyNow") : t("shop.soldOut")}</span>
                {available > 0 && <b>{formatUsd(product.price)}</b>}
              </button>
            </div>
          </article>

          <div className="nft-next" aria-label={t("shop.nextDrop")}>
            <div className="nft-next__orb" aria-hidden="true" />
            <div>
              <strong>{t("shop.nextDrop")}</strong>
              <span>{t("shop.nextDropSub")}</span>
            </div>
          </div>
        </section>
      )}

      {/* ---------- invoices ---------- */}
      {tab === "invoices" && (
        <section className="shop-view" aria-label={t("shop.tabInvoices")}>
          {state.invoices.length === 0 ? (
            <div className="shop-empty">
              <div className="shop-empty__icon" aria-hidden="true">
                <Icon size={30} stroke={1.5}>
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
                  <path d="M9.5 8h5M9.5 12h5" />
                </Icon>
              </div>
              <strong>{t("shop.emptyTitle")}</strong>
              <span>{t("shop.emptyHint")}</span>
            </div>
          ) : (
            <ul className="inv-list">
              {state.invoices.map((inv) => (
                <li key={inv.id}>
                  <button
                    type="button"
                    className="inv-row"
                    onClick={() => setInvoiceId(inv.id)}
                  >
                    <span className="inv-row__thumb">
                      <img src={product.image} alt="" draggable="false" />
                    </span>
                    <span className="inv-row__main">
                      <strong>
                        {inv.product} × {inv.qty}
                      </strong>
                      <small>{inv.id}</small>
                    </span>
                    <span className="inv-row__side">
                      <b>{formatUsd(inv.total)}</b>
                      <em className={`inv-status inv-status--${inv.status}`}>
                        {statusLabel(inv.status)}
                      </em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---------- buy sheet ---------- */}
      <Sheet
        open={buyOpen}
        onClose={closeBuy}
        title={t("shop.placeOrder")}
        closeLabel={t("shop.close")}
        labelledBy="shop-buy-title"
      >
        <form className="order-form" onSubmit={submitOrder} noValidate>
          {orderError && <p role="alert" style={{color: "#ff8d8d"}}>{orderError}</p>}
          {orderSaving && <p role="status">Creating order...</p>}
          <div className="order-item">
            <img src={product.image} alt="" draggable="false" />
            <div>
              <strong>{product.name}</strong>
              <span>
                {t("shop.unitPrice")} · {gramQuote !== null ? formatGram(gramQuote) : "— GRAM"}
              </span>
            </div>
          </div>

          <div className="order-row">
            <div>
              <span className="order-label">{t("shop.quantity")}</span>
              <small className="order-hint">
                {t("shop.maxPerOrder", { count: maxQty })}
              </small>
            </div>
            <div className="stepper">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                aria-label="−"
              >
                −
              </button>
              <output aria-live="polite">{qty}</output>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={qty >= maxQty}
                aria-label="+"
              >
                +
              </button>
            </div>
          </div>

          <div className="order-total">
            <span>{t("shop.orderTotal")}</span>
            <strong>
              {gramQuote !== null
                ? formatGram(Number(gramQuote) * qty)
                : "— GRAM"}
            </strong>
          </div>

          <label className="field">
            <span className="order-label">{t("shop.walletLabel")}</span>
            <input
              type="text"
              dir="ltr"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="UQ… / EQ…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
              aria-invalid={showWalletError}
              className={showWalletError ? "has-error" : walletOk ? "is-valid" : ""}
            />
            <small className={`field__msg ${showWalletError ? "is-error" : ""}`}>
              {showWalletError ? t("shop.walletError") : t("shop.walletHint")}
            </small>
          </label>

          <label className="field">
            <span className="order-label">{t("shop.contactLabel")}</span>
            <input
              type="text"
              dir="ltr"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("shop.contactPlaceholder")}
              autoComplete="off"
            />
          </label>

          <label className={`agree ${showAgreeError ? "has-error" : ""}`}>
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span className="agree__box" aria-hidden="true">
              <CheckIcon />
            </span>
            <span>
              {t("shop.agree")}
              {showAgreeError && (
                <em className="agree__err">{t("shop.agreeError")}</em>
              )}
            </span>
          </label>
          
          {import.meta.env.DEV && (
            <div
              style={{
                margin: "12px 0",
                padding: 12,
                border: "1px dashed #eab308",
                borderRadius: 12,
              }}
            >
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 12,
                  color: "#facc15",
                }}
              >
                LOCAL TEST ONLY — No real TON payment.
              </p>

              <button
                type="button"
                className="shop-cta"
                style={{
                  background: "#a16207",
                  color: "white",
                }}
                disabled={
                  demoSaving ||
                  orderSaving ||
                  !walletOk ||
                  !agree
                }
                onClick={testNftPurchase}
              >
                {demoSaving
                  ? "Testing NFT..."
                  : "🧪 Test NFT Purchase"}
              </button>

              {demoMessage && (
                <p role="status">{demoMessage}</p>
              )}
            </div>
          )}

          
{insufficientBalance && (
  <div
    style={{
      margin: "14px 0",
      padding: 16,
      borderRadius: 12,
      border: "1px solid #f59e0b",
      background: "rgba(245, 158, 11, 0.08)",
    }}
  >
    <p style={{ fontWeight: 700, marginBottom: 10 }}>
      موجودی کیف پول داخلی کافی نیست.
    </p>

    <p>
      موجودی فعلی: {insufficientBalance.balance} TON
    </p>

    <p>
      مبلغ مورد نیاز: {insufficientBalance.required} TON
    </p>

    <p>
      کسری موجودی: {insufficientBalance.shortage} TON
    </p>

    <button
      type="button"
      className="shop-cta"
      onClick={() => {
        setBuyOpen(false);
        navigate("/wallet");
      }}
      style={{ marginTop: 12 }}
    >
      افزایش موجودی کیف پول داخلی
    </button>
  </div>
)}

{orderError && !insufficientBalance && (
  <p role="alert" style={{ color: "#ff8d8d" }}>
    {orderError}
  </p>
)}

<button
  type="submit"
  className="shop-cta"
  disabled={orderSaving}
>
  <span>
    {orderSaving ? "در حال خرید..." : t("shop.submit")}
  </span>
  <b>
  {gramQuote !== null
    ? formatGram(Number(gramQuote) * qty)
    : "— GRAM"}
</b>
</button>

        </form>
      </Sheet>

      {/* ---------- invoice sheet ---------- */}
      <Sheet
        open={Boolean(activeInvoice)}
        onClose={closeInvoice}
        title={t("shop.invoiceTitle")}
        closeLabel={t("shop.close")}
        labelledBy="shop-invoice-title"
      >
        {activeInvoice && (
          <div className="receipt">
            <div className="receipt__top">
              <div>
                <span className="nft-label">{t("shop.invoiceId")}</span>
                <button
                  type="button"
                  className="receipt__id"
                  onClick={() => copy("id", activeInvoice.id)}
                  title={t("shop.copy")}
                >
                  {activeInvoice.id}
                  {copiedKey === "id" ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              <em className={`inv-status inv-status--${activeInvoice.status}`}>
                {statusLabel(activeInvoice.status)}
              </em>
            </div>

            <div className="receipt__tear" aria-hidden="true" />

            <dl className="receipt__rows">
              <div>
                <dt>{t("shop.item")}</dt>
                <dd>
                  {activeInvoice.product} × {activeInvoice.qty}
                </dd>
              </div>
              <div>
                <dt>{t("shop.date")}</dt>
                <dd>{dateFmt.format(new Date(activeInvoice.createdAt))}</dd>
              </div>
              <div>
                <dt>{t("shop.wallet")}</dt>
                <dd>
                  <button
                    type="button"
                    className="receipt__copy"
                    dir="ltr"
                    onClick={() => copy("wallet", activeInvoice.wallet)}
                    title={t("shop.copy")}
                  >
                    {shortAddress(activeInvoice.wallet)}
                    {copiedKey === "wallet" ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </dd>
              </div>
              {activeInvoice.contact && (
                <div>
                  <dt>{t("shop.contact")}</dt>
                  <dd dir="ltr">{activeInvoice.contact}</dd>
                </div>
              )}
              {activeInvoice.tonDue && <div><dt>TON to pay (quote)</dt><dd>{activeInvoice.tonDue} TON</dd></div>}
              <div className="receipt__total">
                <dt>{t("shop.total")}</dt>
                <dd>{formatUsd(activeInvoice.total)}</dd>
              </div>
            </dl>

            <ol className="timeline">
              {steps(activeInvoice.status).map((s) => (
                <li key={s.key} className={s.done ? "is-done" : ""}>
                  <span aria-hidden="true">{s.done ? <CheckIcon /> : null}</span>
                  {s.label}
                </li>
              ))}
            </ol>

            <p className="receipt__note">
              {activeInvoice.status === "completed"
                ? t("shop.noteDone")
                : t("shop.notePending")}
            </p>

            <a
              className="shop-cta shop-cta--ghost"
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
            >
              <SendIcon />
              <span>{t("shop.support")}</span>
              <b>@Ai_POLYFI</b>
            </a>
          </div>
        )}
      </Sheet>
    </div>
  );
}
