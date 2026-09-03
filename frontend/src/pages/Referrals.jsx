// frontend/src/components/Referrals.jsx

import {
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "../api";
import { readTelegramIdentity, saveUserData } from "../utils/userStorage";
import {
  captureInviterCode,
  getInviterCode,
  setInviterCode as persistInviterCode,
  markReferralApplied,
  markReferralFailed,
  generateTelegramInviteLink,
  generateWebReferralLink,
  buildReferralApiParams,
} from "../utils/referral";

import "./Referrals.css";

function getTelegramWebApp() {
  try {
    if (typeof window === "undefined") return null;
    return window.Telegram?.WebApp || null;
  } catch {
    return null;
  }
}

/**
 * باز کردن لینک در تلگرام
 */
function openTelegramLink(url) {
  const tg = getTelegramWebApp();
  if (tg && typeof tg.openTelegramLink === "function") {
    try {
      tg.openTelegramLink(url);
      return true;
    } catch {
      // fallback
    }
  }
  return false;
}

// ======================================================
// AVATAR
// ======================================================

function getTelegramAvatar(telegramId, username) {
  const cleanUsername = String(username || "")
    .trim()
    .replace(/^@/, "");

  if (
    cleanUsername &&
    cleanUsername !== "browser" &&
    !cleanUsername.startsWith("browser_")
  ) {
    return (
      `https://t.me/i/userpic/320/` +
      `${encodeURIComponent(cleanUsername)}.jpg`
    );
  }

  return (
    "https://ui-avatars.com/api/" +
    "?name=%F0%9F%91%A4" +
    "&background=273043" +
    "&color=ffffff" +
    "&size=64" +
    "&rounded=true"
  );
}

// ======================================================
// COMPONENT
// ======================================================

export default function Referrals() {
  // ====================================================
  // STATE
  // ====================================================

  const [myCode, setMyCode] = useState(null);
  const [refCount, setRefCount] = useState(null);
  const [levels, setLevels] = useState(null);
  const [totalReferrals, setTotalReferrals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [telegramId, setTelegramId] = useState(null);
  const [telegramUsername, setTelegramUsername] = useState(null);
  const [telegramPhotoUrl, setTelegramPhotoUrl] = useState(null);
  const [inviterCode, setInviterCode] = useState(null);
  const [referralReady, setReferralReady] = useState(false);
  const [manualInviterCode, setManualInviterCode] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);

  const registerKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const tg = getTelegramWebApp();
      if (tg) {
        setIsTelegramWebApp(true);
      }

      const identity = readTelegramIdentity();
      const code = captureInviterCode() || getInviterCode();

      if (cancelled) return;

      setTelegramId(identity?.telegram_id ?? null);
      setTelegramUsername(identity?.telegram_username ?? null);
      setTelegramPhotoUrl(identity?.telegram_photo_url ?? null);
      setInviterCode(code);
      setReferralReady(true);
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  // ====================================================
  // REGISTER / LOAD USER
  // ====================================================

  useEffect(() => {
    let cancelled = false;

    async function registerUser() {
      if (!referralReady) {
        return;
      }

      const finalTelegramId = Number(telegramId || 0);

      if (!Number.isInteger(finalTelegramId) || finalTelegramId <= 0) {
        setMyCode(null);
        setRefCount(null);
        setError("Telegram ID not found. Please open the app from Telegram first.");
        return;
      }

      let finalInviterCode = inviterCode || getInviterCode();

      if (!finalInviterCode && showManualInput && manualInviterCode) {
        finalInviterCode = persistInviterCode(manualInviterCode.trim());
      }

      const currentRegisterKey = [
        finalTelegramId,
        telegramUsername || "",
        telegramPhotoUrl || "",
        finalInviterCode || "",
      ].join("|");

      if (registerKeyRef.current === currentRegisterKey && myCode) {
        return;
      }

      registerKeyRef.current = currentRegisterKey;

      const identity = {
        telegram_id: finalTelegramId,
        telegram_username: telegramUsername,
        telegram_photo_url: telegramPhotoUrl,
        is_telegram: true,
      };

      const params = buildReferralApiParams(identity, finalInviterCode);

      try {
        setLoading(true);
        setError("");

        const response = await api.get("/referrals/count/", { params });

        if (cancelled) return;

        setRefCount(response.data?.count ?? 0);

        const returnedCode =
          response.data?.referral_code ||
          response.data?.user?.referral_code ||
          null;

        setMyCode(returnedCode);

        if (finalInviterCode && response.data?.referral_applied) {
          markReferralApplied(finalInviterCode);
        } else if (finalInviterCode && response.data?.referral_error) {
          markReferralFailed(finalInviterCode);
          setError(response.data.referral_error);
          setShowManualInput(true);
        }

        if (response.data?.telegram_id) {
          saveUserData({
            telegramId: Number(response.data.telegram_id),
            telegramUsername:
              response.data?.telegram_username ?? telegramUsername ?? null,
            telegramPhotoUrl:
              response.data?.telegram_photo_url ?? telegramPhotoUrl ?? null,
            isTelegram: true,
          });
        }
      } catch (err) {
        if (cancelled) return;

        if (err?.response?.status === 400 && err?.response?.data?.referral_error) {
          setError(err.response.data.referral_error);
          setShowManualInput(true);
        } else if (err?.response?.status === 400) {
          setError(err?.response?.data?.error || "Invalid request.");
        } else if (err?.response?.status === 404) {
          setError("Referral account not found.");
        } else {
          setError(
            err?.response?.data?.error ||
            err?.response?.data?.detail ||
            err?.message ||
            "Failed to load referral account."
          );
        }

        registerKeyRef.current = null;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    registerUser();

    return () => {
      cancelled = true;
    };
  }, [
    referralReady,
    inviterCode,
    telegramId,
    telegramUsername,
    telegramPhotoUrl,
    manualInviterCode,
    showManualInput,
  ]);

  // ====================================================
  // LEVELS
  // ====================================================

  useEffect(() => {
    const finalTelegramId = Number(telegramId || 0);

    if (
      !referralReady ||
      !myCode ||
      !Number.isInteger(finalTelegramId) ||
      finalTelegramId <= 0
    ) {
      return undefined;
    }

    let cancelled = false;
    let requestRunning = false;

    async function fetchLevels() {
      if (requestRunning) return;
      requestRunning = true;

      try {
        const response = await api.get("/referral/levels/", {
          params: buildReferralApiParams(
            {
              telegram_id: finalTelegramId,
              telegram_username: telegramUsername,
              telegram_photo_url: telegramPhotoUrl,
              is_telegram: true,
            },
            inviterCode
          ),
        });

        if (cancelled) return;

        const data = response.data;

        setLevels(data?.levels || {});
        setTotalReferrals(data?.total_referrals || 0);

        if (!myCode && data?.referral_code) {
          setMyCode(data.referral_code);
        }
      } catch (err) {
        console.error("❌ Referral levels error:", err);

        if (!cancelled) {
          setError(
            err?.response?.data?.error ||
            err?.response?.data?.detail ||
            "Failed to load referral levels."
          );
        }
      } finally {
        requestRunning = false;
      }
    }

    fetchLevels();

    const refreshOnFocus = () => fetchLevels();

    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        fetchLevels();
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener(
        "visibilitychange",
        refreshOnVisible
      );
    };
  }, [
    referralReady,
    telegramId,
    telegramUsername,
    telegramPhotoUrl,
    inviterCode,
    myCode,
  ]);

  // ====================================================
  // REFERRAL LINK (Telegram Bot)
  // ====================================================

  const referralLink = myCode ? generateTelegramInviteLink(myCode) : "";
  const webReferralLink = myCode ? generateWebReferralLink(myCode) : "";

  // ====================================================
  // OPEN REFERRAL LINK
  // ====================================================

  function openReferralLink() {
    if (!referralLink) return;

    // تلاش برای باز کردن در تلگرام
    const opened = openTelegramLink(referralLink);

    // اگر در تلگرام باز نشد، از لینک وب استفاده کن
    if (!opened) {
      window.open(webReferralLink, "_blank", "noopener,noreferrer");
    }
  }

  // ====================================================
  // SHARE
  // ====================================================

  function shareReferral() {
    if (!referralLink) return;

    const message =
      `🎯 Join me on AI PolyNet!\n\n` +
      `🚀 Open the Mini App using my referral link:\n\n` +
      `${referralLink}\n\n` +
      `💎 Don't miss out on the rewards!`;

    // اگر در تلگرام هستیم
    const tg = getTelegramWebApp();
    if (tg && typeof tg.openTelegramLink === "function") {
      const shareUrl =
        `https://t.me/share/url` +
        `?url=${encodeURIComponent(referralLink)}` +
        `&text=${encodeURIComponent(message)}`;
      try {
        tg.openTelegramLink(shareUrl);
        return;
      } catch {
        // fallback
      }
    }

    // استفاده از Web Share API
    if (navigator.share) {
      navigator.share({
        title: 'AI PolyNet Referral',
        text: message,
        url: referralLink,
      }).catch(() => {});
      return;
    }

    // Fallback: کپی در کلیپ‌بورد
    navigator.clipboard.writeText(message).then(() => {
      alert("✅ Referral link copied to clipboard!");
    }).catch(() => {
      window.open(referralLink, "_blank");
    });
  }

  // ====================================================
  // COPY
  // ====================================================

  async function copyReferralLink() {
    if (!referralLink) return;

    // ترجیحاً لینک تلگرام را کپی کن
    const linkToCopy = isTelegramWebApp ? referralLink : webReferralLink;

    try {
      await navigator.clipboard.writeText(linkToCopy);
      alert("✅ Referral link copied!");
    } catch (err) {
      console.error("Copy failed:", err);
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = linkToCopy;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert("✅ Referral link copied!");
    }
  }

  // ====================================================
  // HANDLE MANUAL INVITER CODE
  // ====================================================

  function handleApplyInviterCode() {
    if (!manualInviterCode.trim()) {
      setError("Please enter a referral code.");
      return;
    }

    const code = persistInviterCode(manualInviterCode.trim());
    if (!code) {
      setError("Invalid referral code format.");
      return;
    }

    setInviterCode(code);
    setShowManualInput(false);
    setError("");
    registerKeyRef.current = null;
  }

  function handleSkipInviterCode() {
    setShowManualInput(false);
    setInviterCode(null);
    setError("");
    registerKeyRef.current = null;
  }

  // ====================================================
  // TABLE
  // ====================================================

  function renderLevelTable(level, data) {
    const levelProfitMessage =
      level === 1
        ? "Direct referral: 1000 EPL join bonus + 5% stake profit (ECG)."
        : "Indirect referral: 500 EPL join bonus + 1% stake profit (ECG).";

    if (!data) {
      return (
        <div className="level-table">
          <div className="level-header">
            <h4>⭐ Level {level}</h4>
          </div>
          <p className={`level-profit-note ${level === 1 ? "level-profit-main" : ""}`}>
            {levelProfitMessage}
          </p>
          <div className="empty-message">No data available</div>
        </div>
      );
    }

    const users = data.users || [];
    const count = data.count || 0;
    const displayUsers = users.slice(0, 10);

    return (
      <div className="level-table">
        <div className="level-header">
          <h4>⭐ Level {level}</h4>
          <span className="level-count">Total: {count}</span>
        </div>

        <p className={`level-profit-note ${level === 1 ? "level-profit-main" : ""}`}>
          {levelProfitMessage}
        </p>

        {level === 1 && (
          <div
            style={{
              marginBottom: "10px",
              fontSize: "12px",
              opacity: 0.8,
            }}
          >
            ✅ Direct join bonus is 1000 EPL. Indirect Levels 2–5 receive 500 EPL per new downline. Purchase profit is shown separately in ECG and USDT. Referral rewards are tracked in EPL, ECG and USDT.
          </div>
        )}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Investment (TON)</th>
                <th>Referral Bonus (EPL)</th>
                <th>{level === 1 ? "5% Profit (ECG)" : "1% Profit (ECG)"}</th>
                <th>{level === 1 ? "5% Profit (USDT)" : "1% Profit (USDT)"}</th>
              </tr>
            </thead>

            <tbody>
              {displayUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="empty-message">
                    No users in this level
                  </td>
                </tr>
              ) : (
                displayUsers.map((user, index) => {
                  const isString = typeof user === "string";
                  const userTelegramId = isString ? null : user?.telegram_id;
                  const userTelegramUsername = isString ? null : user?.telegram_username;
                  const userWallet = isString ? user : user?.wallet || "-";
                  const investment = isString ? 0 : user?.investment || 0;

                  const legacyProfit = isString ? 0 : Number(user?.profit || 0);
                  const legacyProfitAsset = isString
                    ? "ECG"
                    : String(user?.profit_asset || "ECG").toUpperCase();

                  const profitECG = isString
                    ? 0
                    : Number(user?.profit_ecg ?? (legacyProfitAsset === "ECG" ? legacyProfit : 0));

                  const profitUSDT = isString
                    ? 0
                    : Number(user?.profit_usdt ?? (legacyProfitAsset === "USDT" ? legacyProfit : 0));

                  const referralJoinBonus = isString ? 0 : user?.referral_bonus || 0;

                  const cleanUsername = String(userTelegramUsername || "")
                    .trim()
                    .replace(/^@/, "");

                  const userTelegramPhotoUrl = isString
                    ? null
                    : user?.telegram_photo_url || user?.photo_url || null;

                  const avatarUrl =
                    userTelegramPhotoUrl ||
                    getTelegramAvatar(userTelegramId, cleanUsername);

                  const fallbackAvatar = getTelegramAvatar(null, null);

                  return (
                    <tr key={`${index}-${userTelegramId || userWallet}`}>
                      <td>{index + 1}</td>

                      <td className="user-cell">
                        <div className="referral-user-profile">
                          <div className="user-avatar-wrapper">
                            <img
                              src={avatarUrl}
                              alt={cleanUsername ? `@${cleanUsername}` : "Telegram avatar"}
                              className="user-avatar"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = fallbackAvatar;
                              }}
                            />
                          </div>
                          <span
                            className="referral-username"
                            title={cleanUsername ? `@${cleanUsername}` : "Telegram user"}
                          >
                            {cleanUsername ? `@${cleanUsername}` : "Telegram user"}
                          </span>
                        </div>
                      </td>

                      <td className="investment-cell">{investment}</td>
                      <td className="profit-cell">+ {Number(referralJoinBonus || 0).toFixed(4)} EPL</td>
                      <td className="profit-cell">+ {Number(profitECG || 0).toFixed(4)} ECG</td>
                      <td className="profit-cell">+ {Number(profitUSDT || 0).toFixed(4)} USDT</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {users.length > 10 && (
          <div className="show-more">+ {users.length - 10} more users</div>
        )}
      </div>
    );
  }

  // ====================================================
  // TELEGRAM ID REQUIRED
  // ====================================================

  if (referralReady && !telegramId) {
    return (
      <div className="wallet-required">
        📱 Telegram ID not found. Please login first.
      </div>
    );
  }

  // ====================================================
  // RENDER
  // ====================================================

  return (
    <div className="referral-dashboard">
      <h2>🎯 Referral Dashboard</h2>

      {loading && <div className="loading-spinner">Loading...</div>}

      {error && <div className="error-message">❌ {error}</div>}

      {!referralReady && <div className="loading-spinner">📱 Preparing...</div>}

      {/* Manual inviter code input */}
      {showManualInput && (
        <div className="manual-inviter-section">
          <p>Please enter your referral code:</p>
          <div className="manual-input-row">
            <input
              type="text"
              value={manualInviterCode}
              onChange={(e) => setManualInviterCode(e.target.value)}
              placeholder="Enter referral code..."
              className="manual-input"
            />
            <button onClick={handleApplyInviterCode} className="btn-apply">
              Apply
            </button>
            <button onClick={handleSkipInviterCode} className="btn-skip">
              Skip
            </button>
          </div>
        </div>
      )}

      {myCode ? (
        <>
          <div className="referral-link-section">
            <p className="referral-link-label">
              {isTelegramWebApp ? "🔗 Telegram Mini App Invite Link" : "🔗 Your Referral Link"}
            </p>

            <div className="link-actions">
              <input 
                value={isTelegramWebApp ? referralLink : webReferralLink} 
                readOnly 
                className="link-input" 
              />

              <button onClick={copyReferralLink} disabled={!referralLink} className="btn-copy">
                📋 Copy
              </button>

              <button onClick={shareReferral} disabled={!referralLink} className="btn-share-telegram">
                📤 Share on Telegram
              </button>
            </div>

            <div className="stats-box">
              <div className="stat-item">
                <span className="stat-label">👥 Direct Invites</span>
                <span className="stat-value">{refCount === null ? "..." : refCount}</span>
              </div>

              <div className="stat-item">
                <span className="stat-label">🌳 Total Tree</span>
                <span className="stat-value">{totalReferrals}</span>
              </div>
            </div>

            {inviterCode && (
              <div className="info-note">
                🎁 Invited by: <b>{inviterCode}</b>
              </div>
            )}
          </div>

          <div className="levels-section">
            <h3>🔺 Referral Tree (5 Levels)</h3>

            <div className="levels-grid">
              {[1, 2, 3, 4, 5].map((level) => (
                <div key={level} className="level-card">
                  {renderLevelTable(level, levels?.[`level_${level}`])}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="loading-spinner">Loading referral data...</div>
      )}
    </div>
  );
}