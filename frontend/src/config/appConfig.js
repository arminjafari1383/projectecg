const botUsername = String(
  import.meta.env.VITE_BOT_USERNAME || "Aipolynetbot"
).trim().replace(/^@/, "");

const miniAppShortName = String(
  import.meta.env.VITE_MINI_APP_SHORT_NAME || "app"
).trim().replace(/^\//, "").replace(/\/$/, "");

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/` : "/api/");

const tonConnectManifestUrl =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ||
  (typeof window !== "undefined"
    ? `${window.location.origin}/tonconnect-manifest.json`
    : "https://aipolynet.com/tonconnect-manifest.json");

export const APP_CONFIG = {
  botUsername,
  miniAppShortName,
  apiBaseUrl,
  tonConnectManifestUrl,
  isDev: import.meta.env.DEV,
};

export default APP_CONFIG;
