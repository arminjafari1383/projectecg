import APP_CONFIG from "../config/appConfig";

export const INVITER_CODE_KEY = "inviter_code";
export const USED_REFERRAL_KEY = "used_referral_code";
export const OWN_REFERRAL_CODE_KEY = "my_referral_code";

const LEGACY_INVITER_KEYS = [
  "referral_code",
  "pending_referral",
];

const REFERRAL_PREFIXES = [
  "ref_",
  "r_",
  "invite_",
  "inv_",
  "referral_",
];

function debugLog(...args) {
  if (APP_CONFIG.isDev) {
    console.log("[referral]", ...args);
  }
}

export function cleanReferralCode(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let code = String(value).trim();
  if (!code) {
    return null;
  }

  try {
    code = decodeURIComponent(code);
  } catch {
    // ignore invalid URI encoding
  }

  code = code.trim();
  const lower = code.toLowerCase();

  for (const prefix of REFERRAL_PREFIXES) {
    if (lower.startsWith(prefix)) {
      code = code.slice(prefix.length);
      break;
    }
  }

  code = code.replace(/[^a-zA-Z0-9]/g, "");
  if (!code) {
    return null;
  }

  return code.toUpperCase();
}

function migrateLegacyReferralKeys() {
  try {
    for (const legacyKey of LEGACY_INVITER_KEYS) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (!legacyValue) {
        continue;
      }

      const cleanCode = cleanReferralCode(legacyValue);
      if (cleanCode) {
        localStorage.setItem(INVITER_CODE_KEY, cleanCode);
      }
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // ignore storage errors
  }
}

function saveReferralCode(code, { force = false } = {}) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return null;
  }

  if (!force && isReferralAlreadyUsed(cleanCode)) {
    debugLog("Referral already used, skip save:", cleanCode);
    return null;
  }

  try {
    localStorage.setItem(INVITER_CODE_KEY, cleanCode);
    for (const legacyKey of LEGACY_INVITER_KEYS) {
      localStorage.removeItem(legacyKey);
    }
    debugLog("Saved referral code:", cleanCode);
    return cleanCode;
  } catch (error) {
    debugLog("Failed to save referral code:", error);
    return cleanCode;
  }
}

function getTelegramWebApp() {
  try {
    return window.Telegram?.WebApp || null;
  } catch {
    return null;
  }
}

function captureFromTelegram() {
  const tg = getTelegramWebApp();
  if (!tg) {
    return null;
  }

  try {
    tg.ready?.();
  } catch {
    // ignore
  }

  const startParam = tg.initDataUnsafe?.start_param;
  if (startParam) {
    const code = cleanReferralCode(startParam);
    if (code) {
      return saveReferralCode(code, { force: true });
    }
  }

  try {
    const url = new URL(window.location.href);
    const telegramStartParam = url.searchParams.get("tgWebAppStartParam");
    if (telegramStartParam) {
      const code = cleanReferralCode(telegramStartParam);
      if (code) {
        return saveReferralCode(code, { force: true });
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function captureFromUrl() {
  try {
    const url = new URL(window.location.href);
    const params = [
      "ref",
      "referral",
      "referral_code",
      "code",
      "inviter",
      "invite",
      "share",
      "startapp",
      "tgWebAppStartParam",
      "start_param",
    ];

    for (const param of params) {
      const value = url.searchParams.get(param);
      if (!value) {
        continue;
      }
      const code = cleanReferralCode(value);
      if (code) {
        return saveReferralCode(code, { force: true });
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function captureFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash) {
      return null;
    }

    const cleanHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const directCode = cleanReferralCode(cleanHash);
    if (directCode) {
      return saveReferralCode(directCode, { force: true });
    }

    const hashParams = new URLSearchParams(cleanHash.replace(/^.*?\?/, ""));
    const params = ["ref", "referral", "referral_code", "code", "inviter", "invite", "share"];

    for (const param of params) {
      const value = hashParams.get(param);
      if (!value) {
        continue;
      }
      const code = cleanReferralCode(value);
      if (code) {
        return saveReferralCode(code, { force: true });
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function captureFromWindowName() {
  try {
    const name = window.name;
    if (!name) {
      return null;
    }

    if (/ref_|invite_|r_/i.test(name)) {
      const code = cleanReferralCode(name);
      if (code) {
        return saveReferralCode(code, { force: true });
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export function isReferralAlreadyUsed(code) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return false;
  }

  const used = cleanReferralCode(localStorage.getItem(USED_REFERRAL_KEY));
  return used === cleanCode;
}

export function captureInviterCode() {
  migrateLegacyReferralKeys();

  const freshSources = [
    captureFromTelegram,
    captureFromUrl,
    captureFromHash,
    captureFromWindowName,
  ];

  for (const source of freshSources) {
    const code = source();
    if (code) {
      return code;
    }
  }

  const stored = getStoredInviterCode();
  if (stored && !isReferralAlreadyUsed(stored)) {
    return stored;
  }

  return null;
}

export function getStoredInviterCode() {
  migrateLegacyReferralKeys();
  try {
    return cleanReferralCode(localStorage.getItem(INVITER_CODE_KEY));
  } catch {
    return null;
  }
}

export function getInviterCode() {
  return captureInviterCode() || getStoredInviterCode();
}

export function setInviterCode(code) {
  return saveReferralCode(code, { force: true });
}

export function clearInviterCode() {
  try {
    localStorage.removeItem(INVITER_CODE_KEY);
    for (const legacyKey of LEGACY_INVITER_KEYS) {
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // ignore
  }
}

export function markReferralApplied(code) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return;
  }

  try {
    localStorage.setItem(USED_REFERRAL_KEY, cleanCode);
    clearInviterCode();
  } catch {
    // ignore
  }
}

export function markReferralFailed(code) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return;
  }

  try {
    localStorage.setItem(`${USED_REFERRAL_KEY}_failed`, cleanCode);
    clearInviterCode();
  } catch {
    // ignore
  }
}

export function wasReferralRejected(code) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return false;
  }

  const failed = cleanReferralCode(
    localStorage.getItem(`${USED_REFERRAL_KEY}_failed`)
  );
  return failed === cleanCode;
}

export function hasInviterCode() {
  return Boolean(getInviterCode());
}

export function validateAndGetInviterCode() {
  const code = getInviterCode();
  if (code && code.length >= 1 && code.length <= 32) {
    return code;
  }
  return null;
}

export function saveOwnReferralCode(code) {
  const cleanCode = cleanReferralCode(code);
  if (!cleanCode) {
    return null;
  }

  try {
    localStorage.setItem(OWN_REFERRAL_CODE_KEY, cleanCode);
  } catch {
    // ignore
  }

  return cleanCode;
}

export function getOwnReferralCode() {
  return cleanReferralCode(localStorage.getItem(OWN_REFERRAL_CODE_KEY));
}

export function generateTelegramInviteLink(referralCode) {
  const code = cleanReferralCode(referralCode);
  if (!code) {
    return null;
  }

  const bot = APP_CONFIG.botUsername;
  const shortName = APP_CONFIG.miniAppShortName;
  return `https://t.me/${bot}/${shortName}?startapp=ref_${encodeURIComponent(code)}`;
}

export function generateWebReferralLink(referralCode) {
  const code = cleanReferralCode(referralCode);
  if (!code || typeof window === "undefined") {
    return null;
  }

  return `${window.location.origin}?ref=${encodeURIComponent(code)}`;
}

export function generateReferralLink(referralCode, baseUrl) {
  if (baseUrl) {
    const code = cleanReferralCode(referralCode);
    if (!code) {
      return null;
    }
    return `${baseUrl}?ref=${encodeURIComponent(code)}`;
  }

  return generateWebReferralLink(referralCode);
}

export function buildReferralApiParams(identity, inviterCode = null) {
  const code = cleanReferralCode(inviterCode || getInviterCode());
  const params = {
    telegram_id: identity?.telegram_id,
    telegram_username: identity?.telegram_username || undefined,
    telegram_photo_url: identity?.telegram_photo_url || undefined,
    is_telegram: identity?.is_telegram ?? true,
  };

  if (code && !isReferralAlreadyUsed(code) && !wasReferralRejected(code)) {
    params.inviter_code = code;
  }

  return params;
}
