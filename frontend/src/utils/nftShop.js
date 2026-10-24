import verdantImg from "../assets/shop/verdant.jpg";

/**
 * NFT shop — catalog + local order store.
 *
 * Orders and sold-counts are kept in localStorage so the flow works end-to-end
 * without a backend (same behaviour as the original VERDANT demo, but it now
 * survives a reload). To go live, replace `createOrder` / `loadState` with calls
 * to your API (see `src/api.js`) — the page only depends on these functions.
 */

export const SUPPORT_URL = "https://t.me/Ai_POLYFI";

export const PRODUCTS = [
  {
    id: "verdant",
    name: "VERDANT",
    image: verdantImg,
    price: 50,
    total: 200,
    initialSold: 44, // 200 total, 156 available
    maxPerOrder: 5,
    network: "TON",
    description:
      "Amidst a realm of enchantment, a green dragon awakens. With scales of emerald hue, reminiscent of nature's finest jewels, this mythical creature holds dominion over lush lands. Its wings, adorned with foliage, carry it through the vast skies, while its captivating green eyes embody ancient wisdom and mystic powers.",
  },
];

const STORAGE_KEY = "aipolify.nftShop.v1";

const emptyState = () => ({ sold: {}, invoices: [] });

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return {
      sold: parsed && typeof parsed.sold === "object" && parsed.sold ? parsed.sold : {},
      invoices: Array.isArray(parsed?.invoices) ? parsed.invoices : [],
    };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / quota) — keep going in memory */
  }
}

export function getSold(product, state) {
  return Math.min(
    product.total,
    (product.initialSold || 0) + (state.sold[product.id] || 0)
  );
}

export function getAvailable(product, state) {
  return Math.max(0, product.total - getSold(product, state));
}

export function isValidTonAddress(value) {
  const addr = String(value || "").trim();
  return (
    /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(addr) ||
    /^-?\d:[a-fA-F0-9]{64}$/.test(addr)
  );
}

function makeInvoiceId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${rand}`;
}

/** Validates + stores an order. Returns { state, invoice } or throws Error(code). */
export function createOrder(state, { product, qty, wallet, contact }) {
  const available = getAvailable(product, state);
  const amount = Math.floor(Number(qty));

  if (!isValidTonAddress(wallet)) throw new Error("INVALID_WALLET");
  if (!amount || amount < 1 || amount > product.maxPerOrder || amount > available) {
    throw new Error("INVALID_QTY");
  }

  const invoice = {
    id: makeInvoiceId(),
    createdAt: new Date().toISOString(),
    productId: product.id,
    product: product.name,
    qty: amount,
    total: amount * product.price,
    wallet: String(wallet).trim(),
    contact: String(contact || "").trim(),
    status: "pending", // pending -> completed (set by support / backend)
  };

  const next = {
    sold: { ...state.sold, [product.id]: (state.sold[product.id] || 0) + amount },
    invoices: [invoice, ...state.invoices],
  };
  saveState(next);
  return { state: next, invoice };
}

export const formatUsd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

export const shortAddress = (a) =>
  a && a.length > 16 ? `${a.slice(0, 7)}…${a.slice(-6)}` : a || "";


/** Cache display-only invoice after authoritative backend order creation. */
export function saveBackendOrder(state, invoice) {
  const next = {
    ...state,
    invoices: [invoice, ...state.invoices.filter((i) => i.id !== invoice.id)],
  };
  saveState(next);
  return next;
}
