import { cookieUtils } from "./cookie";

export const USER_DATA_KEY = "my_app_user_data";

function normalizeTelegramId(value) {
  const id = Number(value || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return id;
}

export function loadUserData() {
  try {
    const raw = localStorage.getItem(USER_DATA_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore malformed localStorage
  }

  const cookieData = cookieUtils.getCookie("user_data");
  if (cookieData && typeof cookieData === "object") {
    return cookieData;
  }

  return null;
}

export function saveUserData(data) {
  const current = loadUserData() || {};
  const merged = { ...current, ...data };

  try {
    localStorage.setItem(USER_DATA_KEY, JSON.stringify(merged));
  } catch {
    // ignore quota errors
  }

  const cookiePayload = {
    walletAddress: merged.walletAddress ?? null,
    telegramId: merged.telegramId ?? null,
    telegramUsername: merged.telegramUsername ?? null,
    isTelegram: merged.isTelegram ?? false,
  };

  cookieUtils.setCookie("user_data", cookiePayload);
  return merged;
}

export function clearUserData() {
  try {
    localStorage.removeItem(USER_DATA_KEY);
    localStorage.removeItem("telegram_id");
  } catch {
    // ignore
  }
  cookieUtils.deleteCookie("user_data");
}

export function deriveBrowserTelegramId(walletAddress) {
  const address = String(walletAddress || "").trim();
  if (!address) {
    return null;
  }

  let hash = 0;
  for (let i = 0; i < address.length; i += 1) {
    hash = (hash << 5) - hash + address.charCodeAt(i);
    hash &= hash;
  }

  return Number(Math.abs(hash) + 1_000_000_000_000);
}

export function readTelegramIdentity() {
  try {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user || null;
    const stored = loadUserData() || {};

    const telegramId = normalizeTelegramId(
      tgUser?.id ?? stored?.telegramId ?? localStorage.getItem("telegram_id")
    );

    if (!telegramId) {
      return null;
    }

    const identity = {
      telegram_id: telegramId,
      telegram_username:
        tgUser?.username || stored?.telegramUsername || null,
      telegram_photo_url:
        tgUser?.photo_url || stored?.telegramPhotoUrl || null,
      telegram_first_name:
        tgUser?.first_name || stored?.telegramFirstName || null,
      telegram_last_name:
        tgUser?.last_name || stored?.telegramLastName || null,
      is_telegram: Boolean(tgUser?.id || stored?.isTelegram),
    };

    localStorage.setItem("telegram_id", String(telegramId));
    saveUserData({
      telegramId,
      telegramUsername: identity.telegram_username,
      telegramPhotoUrl: identity.telegram_photo_url,
      telegramFirstName: identity.telegram_first_name,
      telegramLastName: identity.telegram_last_name,
      isTelegram: identity.is_telegram,
    });

    return identity;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[userStorage] Could not read Telegram identity:", error);
    }
    return null;
  }
}
