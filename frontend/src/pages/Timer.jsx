import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./Timer.css";
import { useNavigate } from "react-router-dom";
import Logo from "../assets/2.png";
import Blade from "../assets/1.png";
import eplLogo from "../assets/epl-logo.png";
import { readTelegramIdentity, saveUserData } from "../utils/userStorage";
import {
  captureInviterCode,
  markReferralApplied,
  saveOwnReferralCode,
  getOwnReferralCode,
  generateTelegramInviteLink,
  buildReferralApiParams,
} from "../utils/referral";
import { api } from "../api";
import { showAd } from "../utils/ads";
import axios from "axios";
import LanguageSelector from "../components/LanguageSelector";
import { useTranslation } from "react-i18next";

function getTelegramWebApp() {
  try {
    if (typeof window === "undefined") return null;
    return window.Telegram?.WebApp || null;
  } catch {
    return null;
  }
}


function CountdownHourglass({
  remaining,
  topSandHeight,
  bottomSandHeight,
}) {
  const topFill = Math.max(
    0,
    Math.min(77, topSandHeight * 0.84)
  );

  const bottomFill = Math.max(
    0,
    Math.min(77, bottomSandHeight * 0.84)
  );

  const topY = 132 - topFill;

  const bottomBase = 236;

  const bottomPeak =
    bottomFill <= 1
      ? bottomBase
      : Math.max(
          169,
          bottomBase - bottomFill
        );

  const bottomHalfWidth =
    13 + (bottomFill / 77) * 43;

  const bottomLeft =
    120 - bottomHalfWidth;

  const bottomRight =
    120 + bottomHalfWidth;

  return (
    <svg
      viewBox="0 0 240 285"
      xmlns="http://www.w3.org/2000/svg"
      className={`countdown-hourglass ${
        remaining > 0
          ? "hourglass-running"
          : "hourglass-ready"
      }`}
      role="img"
      aria-label="EPL hourly reward countdown"
    >
      <style>
        {`
          .hg-glass-main {
            fill: rgba(0, 73, 120, 0.035);
            stroke: url(#hgGlassEdge);
            stroke-width: 3;
          }
          .hg-glass-inside {
            fill: none;
            stroke: rgba(114, 221, 255, 0.28);
            stroke-width: 1.2;
          }
          .hg-glass-highlight {
            fill: none;
            stroke: rgba(230, 252, 255, 0.92);
            stroke-width: 2;
            stroke-linecap: round;
          }
          .hg-top-cap,
          .hg-bottom-cap {
            filter: url(#hgBlueGlow);
          }
          .hg-stream {
            animation: hgStreamPulse .16s linear infinite alternate;
          }
          .hg-stream-glow {
            animation: hgStreamPulse .16s linear infinite alternate;
          }
          @keyframes hgStreamPulse {
            from { opacity: .67; }
            to { opacity: 1; }
          }
          .hg-particle {
            fill: #ffe979;
            filter: url(#hgGoldGlow);
            animation: hgParticleFall 1.25s linear infinite;
          }
          .hg-p1 { animation-delay: 0s; }
          .hg-p2 { animation-delay: -.18s; }
          .hg-p3 { animation-delay: -.34s; }
          .hg-p4 { animation-delay: -.52s; }
          .hg-p5 { animation-delay: -.72s; }
          .hg-p6 { animation-delay: -.95s; }
          @keyframes hgParticleFall {
            0% { transform: translateY(-12px); opacity: 0; }
            15% { opacity: 1; }
            80% { opacity: .8; }
            100% { transform: translateY(63px); opacity: 0; }
          }
          .hg-top-grain {
            fill: #fff1a0;
            animation: hgTopGrainFloat 1.8s ease-in-out infinite alternate;
          }
          .hg-top-grain:nth-child(2) { animation-delay: -.3s; }
          .hg-top-grain:nth-child(3) { animation-delay: -.6s; }
          .hg-top-grain:nth-child(4) { animation-delay: -.9s; }
          .hg-top-grain:nth-child(5) { animation-delay: -1.2s; }
          @keyframes hgTopGrainFloat {
            from { opacity: .35; transform: translateY(1px); }
            to { opacity: 1; transform: translateY(-2px); }
          }
          .hg-base-glow {
            transform-origin: center;
            animation: hgBaseGlow 2s ease-in-out infinite alternate;
          }
          @keyframes hgBaseGlow {
            from { opacity: .28; transform: scaleX(.87); }
            to { opacity: .66; transform: scaleX(1.05); }
          }
          .hg-shine {
            animation: hgGlassShine 2.4s ease-in-out infinite alternate;
          }
          @keyframes hgGlassShine {
            from { opacity: .3; }
            to { opacity: .9; }
          }
        `}
      </style>

      <defs>
        <linearGradient id="hgMetal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#001a69" />
          <stop offset="13%" stopColor="#005bca" />
          <stop offset="27%" stopColor="#19d8ff" />
          <stop offset="43%" stopColor="#077cff" />
          <stop offset="63%" stopColor="#00369e" />
          <stop offset="80%" stopColor="#10c9ff" />
          <stop offset="100%" stopColor="#001354" />
        </linearGradient>
        <linearGradient id="hgGlassEdge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0058bc" />
          <stop offset="15%" stopColor="#dffcff" />
          <stop offset="31%" stopColor="#1adaff" />
          <stop offset="55%" stopColor="#007de7" />
          <stop offset="76%" stopColor="#44dfff" />
          <stop offset="86%" stopColor="#e8fdff" />
          <stop offset="100%" stopColor="#0063c7" />
        </linearGradient>
        <linearGradient id="hgSand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff9ba" />
          <stop offset="18%" stopColor="#ffe96e" />
          <stop offset="43%" stopColor="#ffc72f" />
          <stop offset="68%" stopColor="#f5a008" />
          <stop offset="100%" stopColor="#b85900" />
        </linearGradient>
        <radialGradient id="hgGoldCenter">
          <stop offset="0%" stopColor="#fff6b8" stopOpacity=".95" />
          <stop offset="35%" stopColor="#ffca31" stopOpacity=".55" />
          <stop offset="100%" stopColor="#ff8a00" stopOpacity="0" />
        </radialGradient>
        <filter id="hgBlueGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blueBlur" />
          <feMerge>
            <feMergeNode in="blueBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="hgStrongBlueGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="hgGoldGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.3" result="goldBlur" />
          <feMerge>
            <feMergeNode in="goldBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="hgTopChamber">
          <path d="M63 47 C64 87 77 108 103 129 C111 136 116 143 120 149 C124 143 129 136 137 129 C163 108 176 87 177 47 Z" />
        </clipPath>
        <clipPath id="hgBottomChamber">
          <path d="M120 149 C116 156 111 162 103 169 C77 190 64 211 63 239 L177 239 C176 211 163 190 137 169 C129 162 124 156 120 149 Z" />
        </clipPath>
      </defs>

      <ellipse
        className="hg-base-glow"
        cx="120"
        cy="258"
        rx="58"
        ry="9"
        fill="#008cff"
        opacity=".45"
        filter="url(#hgStrongBlueGlow)"
      />

      <path d="M63 47 C64 87 77 108 103 129 C111 136 116 143 120 149 C124 143 129 136 137 129 C163 108 176 87 177 47 Z" fill="#003865" opacity=".12" />
      <path d="M120 149 C116 156 111 162 103 169 C77 190 64 211 63 239 L177 239 C176 211 163 190 137 169 C129 162 124 156 120 149 Z" fill="#003865" opacity=".12" />

      <g clipPath="url(#hgTopChamber)">
        {topFill > 0 && (
          <>
            <rect x="57" y={topY} width="126" height={topFill + 5} fill="url(#hgSand)" filter="url(#hgGoldGlow)" />
            <ellipse cx="120" cy={topY} rx="50" ry="6" fill="#ffe970" opacity=".92" />
            <ellipse cx="105" cy={topY - 1} rx="28" ry="2" fill="#fff9b8" opacity=".45" />
          </>
        )}
        {remaining > 0 && topFill > 15 && (
          <g>
            <circle className="hg-top-grain" cx="91" cy="91" r=".85" />
            <circle className="hg-top-grain" cx="104" cy="102" r=".7" />
            <circle className="hg-top-grain" cx="116" cy="94" r=".9" />
            <circle className="hg-top-grain" cx="132" cy="102" r=".7" />
            <circle className="hg-top-grain" cx="145" cy="92" r=".8" />
          </g>
        )}
      </g>

      <g clipPath="url(#hgBottomChamber)">
        {bottomFill > 1 && (
          <>
            <ellipse cx="120" cy="228" rx="52" ry="27" fill="url(#hgGoldCenter)" opacity=".25" />
            <path
              d={`
                M ${bottomLeft} ${bottomBase}
                Q 83 ${bottomPeak + 12} 120 ${bottomPeak}
                Q 157 ${bottomPeak + 12} ${bottomRight} ${bottomBase}
                Z
              `}
              fill="url(#hgSand)"
              filter="url(#hgGoldGlow)"
            />
            <ellipse cx="120" cy={bottomBase} rx={bottomHalfWidth} ry="4" fill="#e58900" opacity=".55" />
          </>
        )}
      </g>

      {remaining > 0 && (
        <circle cx="120" cy="151" r="24" fill="url(#hgGoldCenter)" opacity=".23" />
      )}

      {remaining > 0 && topFill > 1 && (
        <>
          <line
            className="hg-stream-glow"
            x1="120"
            y1="146"
            x2="120"
            y2={Math.max(205, bottomPeak)}
            stroke="#ffa600"
            strokeWidth="5"
            strokeLinecap="round"
            opacity=".28"
            filter="url(#hgGoldGlow)"
          />
          <line
            className="hg-stream"
            x1="120"
            y1="146"
            x2="120"
            y2={Math.max(205, bottomPeak)}
            stroke="#ffe470"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <g>
            <circle className="hg-particle hg-p1" cx="117" cy="151" r=".8" />
            <circle className="hg-particle hg-p2" cx="123" cy="153" r=".65" />
            <circle className="hg-particle hg-p3" cx="119" cy="158" r=".75" />
            <circle className="hg-particle hg-p4" cx="122" cy="162" r=".9" />
            <circle className="hg-particle hg-p5" cx="116" cy="166" r=".6" />
            <circle className="hg-particle hg-p6" cx="124" cy="171" r=".7" />
          </g>
        </>
      )}

      <path className="hg-glass-main" d="M63 47 C64 87 77 108 103 129 C111 136 116 143 120 149 C124 143 129 136 137 129 C163 108 176 87 177 47" />
      <path className="hg-glass-main" d="M120 149 C116 156 111 162 103 169 C77 190 64 211 63 239 M120 149 C124 156 129 162 137 169 C163 190 176 211 177 239" />

      <path className="hg-glass-inside" d="M70 54 C70 86 82 105 107 126" />
      <path className="hg-glass-inside" d="M170 54 C170 86 158 105 133 126" />
      <path className="hg-glass-inside" d="M70 232 C71 208 83 190 107 171" />
      <path className="hg-glass-inside" d="M170 232 C169 208 157 190 133 171" />

      <path className="hg-glass-highlight hg-shine" d="M72 59 C72 84 78 99 93 115" />
      <path className="hg-glass-highlight hg-shine" d="M72 228 C72 208 79 194 94 181" />

      <g className="hg-top-cap">
        <ellipse cx="120" cy="41" rx="60" ry="7.5" fill="#001c6d" />
        <rect x="59" y="34" width="122" height="15" rx="6" fill="url(#hgMetal)" stroke="#17cfff" strokeWidth="1.5" />
        <path d="M66 38 Q120 32 174 38" fill="none" stroke="#73e9ff" strokeWidth="1.2" opacity=".82" />
      </g>

      <g className="hg-bottom-cap">
        <rect x="59" y="235" width="122" height="15" rx="6" fill="url(#hgMetal)" stroke="#17cfff" strokeWidth="1.5" />
        <path d="M66 240 Q120 245 174 240" fill="none" stroke="#74eaff" strokeWidth="1.1" opacity=".7" />
        <ellipse cx="120" cy="250" rx="62" ry="8" fill="#002381" stroke="#099cff" strokeWidth="1.4" />
        <ellipse cx="120" cy="248" rx="54" ry="4.5" fill="#0788ff" opacity=".45" />
      </g>
    </svg>
  );
}



export default function TimerPage() {

  const { t } = useTranslation();
  const navigate = useNavigate();
  // =========================================================
  // STATE
  // =========================================================
  const [telegramIdentity, setTelegramIdentity] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(60 * 60);
  const [totalRewards, setTotalRewards] = useState("0");
  const [referralBonus, setReferralBonus] = useState("0");
  const [rewardCount, setRewardCount] = useState(0);
  const [eplWallet, setEplWallet] = useState(null);
  const [eplLoading, setEplLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [claiming,setClaiming] = useState(false);
  const claimingRef = useRef(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [welcomeOpen,setWelcomeOpen] = useState(false);
  const [totalReferrals, setTotalReferrals] = useState(0);
  const [referralsLoaded, setReferralsLoaded] = useState(false);
  const [welcomeStats,setWelcomeStats] = useState(null);
  const welcomeShownRef = useRef(false);
  const [shoppingOpen,setShoppingOpen] = useState(false);
  const [shoppingPage,setShoppingPage] = useState(null);

  // =========================================================
  // REFs
  // =========================================================
  const intervalRef = useRef(null);
  const menuRef = useRef(null);
  
  // ✅ REFهای کنترل اجرا
  const initializedRef = useRef(false);
  const dataLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);
  const remainingRef = useRef(null);
  
  // ✅ REF برای Telegram WebApp - فقط یک بار
  const telegramRef = useRef(null);

  // =========================================================
  // CONSTANTS
  // =========================================================
  const telegramId = telegramIdentity?.telegram_id || null;
  const telegramUsername = telegramIdentity?.telegram_username || null;
  const telegramPhotoUrl = telegramIdentity?.telegram_photo_url || null;

  const telegramDisplayName =
    [
      telegramIdentity?.telegram_first_name,
      telegramIdentity?.telegram_last_name,
    ]
      .filter(Boolean)
      .join(" ") ||
    (telegramUsername ? `@${telegramUsername}` : "Telegram User");

  // =========================================================
  // ✅ TIMER FUNCTIONS - با useRef ثابت
  // =========================================================
  
  const stopTimerRef = useRef(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  });

  const startTimerRef = useRef(() => {
    if (intervalRef.current) {
      return;
    }
    
    intervalRef.current = setInterval(() => {
      setRemaining((sec) => {
        if (sec === null || sec === undefined || sec <= 0) {
          return 0;
        }
        const newSec = sec - 1;
        remainingRef.current = newSec;
        return newSec;
      });
    }, 1000);
  });

  // =========================================================
  // ✅ EFFECT برای مدیریت تایمر
  // =========================================================
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // =========================================================
  // ✅ EFFECT برای شروع تایمر
  // =========================================================
  useEffect(() => {
    if (remaining !== null && remaining > 0) {
      startTimerRef.current();
    } else if (remaining === 0) {
      stopTimerRef.current();
    }
  }, [remaining]);

  // =========================================================
  // REFERRAL CAPTURE
  // =========================================================
  const resolveReferralCode = useCallback(() => {
    return captureInviterCode();
  }, []);

  // =========================================================
  // 📡 بارگذاری داده‌ها
  // =========================================================
  const loadUserData = useCallback(async (identity, referralCode = null) => {
    const telegramId = identity?.telegram_id;
    if (isLoadingRef.current || dataLoadedRef.current || !telegramId) {
      return;
    }

    isLoadingRef.current = true;

    try {
      const params = buildReferralApiParams(identity, referralCode);
      const headers = {
        "X-Telegram-Id": String(telegramId),
        "X-Telegram": "true",
      };

      if (identity.telegram_username) {
        headers["X-Telegram-Username"] = identity.telegram_username;
      }

      if (identity.telegram_photo_url) {
        headers["X-Telegram-Photo-Url"] = identity.telegram_photo_url;
      }

      const statusResponse = await api.get("/wallet/reward_status/", {
        params,
        headers,
      });
      const data = statusResponse.data;

      if (data && data.status !== "error") {
        if (referralCode && data.referral_applied) {
          markReferralApplied(referralCode);
        } else if (referralCode && data.referral_error) {
          setMessage(`⚠️ ${data.referral_error}`);
        }
        
        setTotalRewards(data.total_rewards ?? "0");
        setReferralBonus(data.referral_bonus ?? "0");
        setRewardCount(data.rewards_count ?? 0);
        
        const serverCooldown = data.cooldown_seconds ?? 60 * 60;
        setCooldownSeconds(serverCooldown);
        
        const secondsRemaining = data.seconds_remaining ?? 0;
        remainingRef.current = secondsRemaining;
        setRemaining(secondsRemaining);
        
        setEplWallet({
          epl_balance: data.epl_balance || "0",
          hourly_reward_balance: data.hourly_reward_balance || data.total_rewards || "0",
          referral_bonus: data.referral_bonus || "0",
          hourly_claims: data.hourly_claims || data.rewards_count || 0,
          referral_code: data.referral_code || null,
        });
        
        if (data.referral_code) {
          saveOwnReferralCode(data.referral_code);
        }

        saveUserData({
          telegramId: data.telegram_id ?? telegramId,
          telegramUsername: data.telegram_username ?? identity.telegram_username,
          telegramPhotoUrl: data.telegram_photo_url ?? identity.telegram_photo_url,
          isTelegram: true,
        });
        
        dataLoadedRef.current = true;
        setMessage("");
      } else {
        setMessage("ℹ️ No data available");
      }

    } catch (error) {
      console.error("[Timer] ❌ Error loading user data:", error);
      
      if (error?.response?.status === 404) {
        setRemaining(0);
        setMessage("Welcome! Start mining to earn rewards.");
        dataLoadedRef.current = true;
        return;
      }
      
      const errorMessage = error?.response?.data?.error || 
                           error?.response?.data?.message || 
                           error?.response?.data?.detail ||
                           error.message || 
                           "Could not connect to server";
      
      setMessage(`❌ ${errorMessage}`);
      isLoadingRef.current = false;
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  // =========================================================
  // ✅ TELEGRAM BOOTSTRAP - فقط یک بار
  // =========================================================
  useEffect(() => {
    // ✅ جلوگیری از اجرای مجدد
    if (initializedRef.current) {
      return;
    }
    
    initializedRef.current = true;

    // ✅ ذخیره Telegram WebApp در ref
    telegramRef.current = getTelegramWebApp();
    const tg = telegramRef.current;

    // ✅ فقط یک بار ready و expand رو صدا بزن
    if (tg) {
      try {
        tg.ready?.();
        tg.expand?.();
      } catch (error) {
        // ignore
      }
    }

    // خواندن هویت تلگرام
    const identity = readTelegramIdentity();
    
    if (identity) {
      setTelegramIdentity(identity);
    }

    // پردازش رفرال
    const referralCode = resolveReferralCode();

    if (identity?.telegram_id) {
      const timerId = setTimeout(() => {
        loadUserData(identity, referralCode);
      }, 100);

      return () => clearTimeout(timerId);
    }

    const timeoutId = setTimeout(() => {
      const retryIdentity = readTelegramIdentity();

      if (retryIdentity?.telegram_id) {
        setTelegramIdentity(retryIdentity);
        const retryReferral = resolveReferralCode();
        loadUserData(retryIdentity, retryReferral);
      } else {
        setMessage("⚠️ Please open this app from Telegram.");
        dataLoadedRef.current = true;
      }
    }, 500);

    return () => clearTimeout(timeoutId);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ✅ وابستگی خالی - فقط یک بار

  // =========================================================
  // MENU
  // =========================================================
  useEffect(() => {
    const closeMenu = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  // =========================================================
  // CLAIM REWARD
  // =========================================================
  const claimReward = async () => {
    if (!telegramId) {
      setMessage("⚠️ Telegram identity not available.");
      return;
    }

    const canClaim = remaining === 0;
    if (!canClaim) {
      setMessage("⚠️ Please wait for the timer to finish.");
      return;
    }

    if (claimingRef.current) return;
    claimingRef.current = true;
    setClaiming(true);

    try{
      setMessage("⏳ Claiming reward...");
      const headers = {
        "X-Telegram-Id": String(telegramId),
        "X-Telegram": "true",
      };

      if (telegramUsername) {
        headers["X-Telegram-Username"] = telegramUsername;
      }

      if (telegramPhotoUrl) {
        headers["X-Telegram-Photo-Url"] = telegramPhotoUrl;
      }

      const payload = {
        telegram_id: telegramId,
        telegram_username: telegramUsername,
        telegram_photo_url: telegramPhotoUrl,
      };

      const res = await api.post("/wallet/tick/", payload, { headers });
      const data = res.data;

      if (data?.status === "rewarded") {
        setTotalRewards(data.total_rewards ?? "0");
        setReferralBonus(data.referral_points ?? data.referral_bonus ?? referralBonus);
        setRewardCount(data.rewards_count ?? 0);
        setEplWallet((prev) => ({
          ...(prev || {}),
          epl_balance: data.epl_balance ?? prev?.epl_balance ?? "0",
          hourly_reward_balance: data.hourly_reward_balance ?? data.total_rewards ?? prev?.hourly_reward_balance ?? "0",
          referral_bonus: data.referral_bonus ?? data.referral_points ?? prev?.referral_bonus ?? "0",
          hourly_claims: data.rewards_count ?? prev?.hourly_claims ?? 0,
        }));
        setMessage(`🎉 ${data.message || "Reward claimed!"}`);

        const cooldown = data.cooldown_seconds ?? cooldownSeconds ?? 3600;
        setCooldownSeconds(cooldown);
        remainingRef.current = cooldown;
        setRemaining(cooldown);
        dataLoadedRef.current = true;
        showAd();
        return;
      }

      if (data?.status === "too_early") {
        const serverCooldown = data.cooldown_seconds ?? 60 * 60;
        const sec = Math.min(data.seconds_remaining || 0, serverCooldown);
        setCooldownSeconds(serverCooldown);
        remainingRef.current = sec;
        setRemaining(sec);
        setMessage(`⏳ Please wait ${Math.floor(sec / 60)} minutes ${sec % 60} seconds`);
        return;
      }

      setMessage("⚠️ " + (data?.message || data?.error || "Could not claim."));
    } catch (error) {
      console.error("[Timer] claimReward ERROR:", error);
      setMessage(`❌ ${error?.response?.data?.error || error?.response?.data?.message || "Error claiming reward."}`);
    } finally {
      claimingRef.current = false;
      setClaiming(false);
    }
  };

  // =========================================================
  // SAND PROGRESS
  // =========================================================
  const canClaim = remaining === 0 || remaining === null;
  const rewardCycleSeconds = cooldownSeconds || 60 * 60;
  const remainingRatio = remaining === null ? 1 : Math.min(1, Math.max(0, remaining / rewardCycleSeconds));
  const elapsedRatio = 1 - remainingRatio;
  const topSandHeight = 90 * remainingRatio;
  const bottomSandHeight = 90 * elapsedRatio;
  const progress = Math.round(elapsedRatio * 100);
  const ringRadius = 122;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringProgress = remaining === null ? 0 : Math.min(1,Math.max(0,1 - remaining / rewardCycleSeconds));
  const ringOffset = ringCircumference * (1 - ringProgress);

  const hours = remaining == null ? "--" : String(Math.floor(remaining / 3600)).padStart(2, "0");
  const minutes = remaining == null ? "--" : String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const seconds = remaining == null ? "--" : String(Math.floor(remaining % 60)).padStart(2, "0");

  // =========================================================
  // REFERRAL INVITE
  // =========================================================
  const fetchOwnReferralCode = async () => {
    const walletCode = String(eplWallet?.referral_code || "").trim();
    if (walletCode) {
      saveOwnReferralCode(walletCode);
      return walletCode;
    }

    const cachedCode = getOwnReferralCode();
    if (cachedCode) {
      return cachedCode;
    }

    const identity = readTelegramIdentity();
    if (!identity) {
      throw new Error("Telegram identity is not available.");
    }

    const response = await api.get("/referrals/count/", {
      params: buildReferralApiParams(identity),
    });

    const code = String(response?.data?.referral_code || "").trim();
    if (!code) {
      throw new Error("Referral code was not returned by the server.");
    }

    saveOwnReferralCode(code);
    return code;
  };

  const shareReferralOnTelegram = async () => {
    if (inviteLoading) return;
    setInviteLoading(true);
    setInviteMessage("");

    try {
      const code = await fetchOwnReferralCode();
      const referralLink = generateTelegramInviteLink(code);
      const shareUrl =
        `https://t.me/share/url` +
        `?url=${encodeURIComponent(referralLink)}` +
        `&text=${encodeURIComponent("Join AI POLIFY with my referral link")}`;

      const tg = telegramRef.current || getTelegramWebApp();
      if (typeof tg?.openTelegramLink === "function") {
        tg.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, "_blank", "noopener,noreferrer");
      }
      setInviteMessage("Referral link opened in Telegram.");
    } catch (error) {
      console.error("[Timer] Invite referral error:", error);
      setInviteMessage(
        error?.response?.data?.error ||
        error?.response?.data?.detail ||
        error?.message ||
        "Could not open the referral link."
      );
    } finally {
      setInviteLoading(false);
    }
  };

  /* =========================================================
   WELCOME POPUP — REFERRAL DATA
  ========================================================= */
  useEffect(() => {
    if (!telegramId) {
      return;
    }

    let cancelled = false;

    async function loadWelcomeReferralData() {
      try {
        const response = await api.get(
          "/referral/levels/",
          {
            params: {
              telegram_id: telegramId,
              telegram_username:
               telegramUsername || undefined,
              telegram_photo_url:
               telegramPhotoUrl || undefined,
              is_telegram: true,
            },
          }
        );
       if (cancelled) {
        return;
       }
       setTotalReferrals(
        Number(
          response.data?.total_referrals || 0
        )
       );
      } catch (error) {
        console.error(
          "[Timer] welcome referral load error:",
          error
        );
        if(!cancelled) {
          setTotalReferrals(0)
        }
      } finally {
        if (!cancelled) {
          setReferralsLoaded(true);
        }
      }
    }
    loadWelcomeReferralData();

    return () => {
      cancelled = true;
    };
  }, [
    telegramId,
    telegramUsername,
    telegramPhotoUrl,
  ]);
  
  useEffect (() => {
    if (
      !telegramId ||
      !eplWallet ||
      !referralsLoaded ||
      welcomeShownRef.current
    ){
      return;
    }
    welcomeShownRef.current = true;

    const snapshotKey = `timer_snapshot_${telegramId}`;
    const seesionKey = `timer_welcome_session_${telegramId}`

    if (sessionStorage.getItem(seesionKey) === "true"){
      return;
    }
    
    const currentStats = {
      referrals: Number(totalReferrals || 0),
      referralRewards: Number(eplWallet.referralBonus || 0),
      hourlyRewards: Number(eplWallet.hourly_reward_balance || 0),
      claims: Number(eplWallet.hourly_claims || 0),
    };

    let previousStats = null;

    try {
      const saved = localStorage.getItem(snapshotKey);
      previousStats = saved ? JSON.parse(saved) : null;
    }catch (error) {
      console.error("Snapshot error:", error);
    }

    const newStats = {
      referrals: Math.max(
        0,
        currentStats.referrals - Number(previousStats?.referrals ?? currentStats.referrals)
      ),
      
      referralRewards: Math.max(
        0,
        currentStats.referralRewards - Number(previousStats?.referralRewards ?? currentStats.referralRewards)
      ),
      hourlyRewards:Math.max(
        0,
        currentStats.hourlyRewards - Number(previousStats?.hourlyRewards ?? currentStats.hourlyRewards)
      ),

      claims:Math.max(
        0,
        currentStats.claims - Number(previousStats?.claims ?? currentStats.claims)
      ),
    };

    localStorage.setItem(
      snapshotKey,
      JSON.stringify(currentStats)
    );

    sessionStorage.setItem(seesionKey,"true");

    setWelcomeStats(newStats);



    const timer = window.setTimeout(() => {
      setWelcomeOpen(true);
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    telegramId,
    eplWallet,
    referralsLoaded,
    totalReferrals,
  ]);

  // =========================================================
  // EPL CALCULATIONS
  // =========================================================
  const eplReferralBalance = Number(eplWallet?.referral_bonus ?? referralBonus ?? 0);
  const eplHourlyBalance = Number(eplWallet?.hourly_reward_balance ?? totalRewards ?? 0);
  const eplHourlyClaims = Number(eplWallet?.hourly_claims ?? rewardCount ?? 0);
  const eplBalance = Number(eplWallet?.epl_balance ?? eplHourlyBalance + eplReferralBalance);

  // =========================================================
  // UI
  // =========================================================

  
    // Demo referral levels
    const unlockedLevels = 3;

    const referralLevels = Array.from(
      { length: 8 },
      (_, i) => ({
        level: i + 1,
        reward: i === 0 ? 1000 : 500,
        unlocked: i < unlockedLevels,
      })
    );

  return (
    <div className="boost-page">
      {welcomeOpen && (
        <div
        className="welcome-celebration-backdrop"
        onClick={() => setWelcomeOpen(false)}
        >
          {/* CONFETTI */}
          <div className="welcome-confetti" aria-hidden="true">
            {Array.from({ length: 24 }).map((_,index) => (
              <span
              key={index}
              style={{
                "--i":index,
                "--x":`${(index * 37) % 100}%`,
                "--delay":`${(index % 8) * 0.08}s`,
              }}
              />
            ))}
            
          </div>
          <div
          className="welcome-celebration-card"
          onClick={(event) => 
            event.stopPropagation()
          }
          >
            <button
            type="button"
            className="welcome-close-btn"
            onClick={() =>
              setWelcomeOpen(false)
            }
            aria-label="Close welcome popup"
            >
              ×
            </button>

            <div className="welcome-party-icon">
              🎉
            </div>
            
            {telegramPhotoUrl ? (
              <img
                src={telegramPhotoUrl}
                alt="Telegram profile"
                className="welcome-profile-image"
              />
            ):(
              <div className="welcome-profile-image welcome-profile-fallback">
                👤

              </div>
            
            )}
            <div className="welcome-eyebrow">
              WELCOME BACK
            </div>
            <h2 className="welcome-title">
              {telegramDisplayName}
            </h2>
            <p className="welcome-description">
              Here's what's new since your last visit!.
            </p>
            
            <div className="welcome-stats-grid">

              {welcomeStats?.referrals > 0 && (
                <div className="welcome-stat-card">
                  <div className="welcome-stat-icon">👥</div>

                  <div className="welcome-stat-value">
                    +{welcomeStats.referrals.toLocaleString()}
                  </div>

                  <div className="welcome-stat-label">
                    New Referrals
                  </div>
                </div>
              )}

              {welcomeStats?.referralRewards > 0 && (
                <div className="welcome-stat-card">
                  <div className="welcome-stat-icon">🚀</div>

                  <div className="welcome-stat-value">
                    +{welcomeStats.referralRewards.toLocaleString()}
                  </div>

                  <div className="welcome-stat-label">
                    New Referral EPL
                  </div>
                </div>
              )}

              {welcomeStats?.hourlyRewards > 0 && (
                <div className="welcome-stat-card">
                  <div className="welcome-stat-icon">💎</div>

                  <div className="welcome-stat-value">
                    +{welcomeStats.hourlyRewards.toLocaleString()}
                  </div>

                  <div className="welcome-stat-label">
                    New Hourly EPL
                  </div>
                </div>
              )}

              {welcomeStats?.claims > 0 && (
                <div className="welcome-stat-card">
                  <div className="welcome-stat-icon">🎁</div>

                  <div className="welcome-stat-value">
                    +{welcomeStats.claims.toLocaleString()}
                  </div>

                  <div className="welcome-stat-label">
                    New Rewards Claimed
                  </div>
                </div>
              )}

              {welcomeStats &&
                Object.values(welcomeStats).every(
                  value => value === 0
                ) && (
                  <div className="welcome-stat-card">
                    <div className="welcome-stat-icon">✨</div>

                    <div className="welcome-stat-label">
                      No new activity since your last visit.
                    </div>
                  </div>
                )}

            </div>

            <br /><br /><br /><br />
          </div>

        </div>
      )}
      
{shoppingPage && (
  <div className="shopping-coming-overlay">
    <div className="shopping-coming-card">
      <button
        type="button"
        className="shopping-back-button"
        onClick={() => setShoppingPage(null)}
      >
        ← Back to Timer
      </button>

      <div className="shopping-coming-icon">
        {shoppingPage === "NFT" ? "🖼️" : "🌐"}
      </div>

      <h1>{shoppingPage}</h1>
      <h2>Coming Soon</h2>

      <p>
        Something exciting is on the way.
        Stay tuned!
      </p>
    </div>
  </div>
)}


      <main className="mining-shell">
        <header className="topbar">
          <div className="hamburger-menu" ref={menuRef}>
            <button
              type="button"
              className={`hamburger-btn ${menuOpen ? "is-open" : ""}`}
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              data-tour="hamburger-menu"
            >
              <span />
              <span />
              <span />
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="menu-backdrop"
                  aria-label="Close menu overlay"
                  onClick={() => setMenuOpen(false)}
                />
                <aside className="side-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
                  <div className="drawer-header">
                    <div className="drawer-brand">
                      <strong>AI POLIFY</strong>
                      <span>quick menu</span>
                    </div>
                    <button type="button" className="drawer-icon-btn" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                      <span className="drawer-icon">×</span>
                    </button>
                  </div>
                  <div className="drawer-buttons">
                    {/* PROFILE / TELEGRAM ACCOUNT */}
                    <div
                    className="drawer-main-btn"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent:"space-between",
                      gap:12,
                      cursor:"default",
                    }}
                    >
                      <div style={{ minWidth: 0, textAlign:"left" }}>
                        <div className="drawer-btn-text">
                          👤 Profile
                        </div>
                        <div
                        style={{
                          marginTop:5,
                          fontSize: 13,
                          fontWeight: 800,
                          overflow:"hidden",
                          textOverflow:"ellipsis",
                          whiteSpace:"nowrap",
                        }}
                        >
                          {telegramDisplayName}
                        </div>
                        <div
                        style={{
                          marginTop: 3,
                          fontSize: 11,
                          opacity:0.7,
                        }}
                        >
                          Telegram ID: {telegramId || "Not detected"}

                        </div>

                      </div>
                      {telegramPhotoUrl ? (
                        <img
                        src={telegramPhotoUrl}
                        alt="Telegram profile"
                        style={{
                          width:42,
                          height:42,
                          flex:"0 0 42px",
                          borderRadius:"50%",
                          objectFit:"cover",
                          border:"1px solid rgba(0,217,255,.55)",
                        }}
                        />
                      ):(
                        <div
                          aria-hidden="true"
                          style={{
                            width:42,
                            height: 42,
                            flex: "0 0 42px",
                            borderRadius: "50%",
                            display:"grid",
                            placeItems:"center",
                            background:"rgba(0,217,255,.40)",
                            fontSize:18,
                          }}
                          >
                           ✈️ 
                          </div>
                      )}
                    </div>
                    
          {/* SHOPPING MENU */}
          <div className="timer-shopping-menu">
            <button
              type="button"
              className="drawer-main-btn drawer-shop-btn"
              onClick={() => setShoppingOpen((prev) => !prev)}
              aria-expanded={shoppingOpen}
            >
              <span className="drawer-shop-text">
                <span className="drawer-btn-text">
                  🛍️ Shopping
                </span>
                <span className="drawer-shop-sub">
                  NFT & Metaverse
                </span>
              </span>
              <span>{shoppingOpen ? "▲" : "▼"}</span>
            </button>

            {shoppingOpen && (
              <div className="timer-shopping-submenu">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setShoppingOpen(false);
                    navigate("/shop");
                  }}
                >
                   NFT
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShoppingPage("Metaverse");
                    setMenuOpen(false);
                  }}
                >
                   Metaverse
                </button>
              </div>
            )}
          </div>

                    <a
                      className="drawer-main-btn drawer-support-btn"
                      href="https://t.me/Ai_POLYFI"
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setMenuOpen(false)}

                    >
                      <span className="drawer-btn-text">🎧 Support</span>
                      <span className="drawer-telegram">@Ai_POLYFI</span>
                    </a>
                  </div>
                </aside>
              </>
            )}
          </div>

          <div className="brand-lockup">
            <span className="brand-mark">
              <img src={Logo} alt="AI POLIFY Logo" className="brand-logo" />
            </span>
            <h1>AI POLIFY</h1>
          </div>

          <LanguageSelector />
        </header>

        <section className="panel">
          <div className="reactor">
            <svg viewBox="0 0 260 260" width="260" height="260">
              <circle cx="130" cy="130" r="122" fill="none" stroke="#12284d" strokeWidth="3"/>
              <circle id="ring" cx="130" cy="130" r={ringRadius} fill="none" stroke="#38c6ff" strokeWidth="4" strokeLinecap="round" strokeDasharray={ringCircumference} strokeDashoffset={ringOffset} transform="rotate(-90 130 130)" style={{transition:"stroke-dashoffset 1s linear",}}/>
            </svg>
            <div className="core"><b id="rate">100</b><span>EPL / HOUR</span></div>
            <i className="dot" style={{left:"30px",top:"32px"}}></i>
            <i className="dot" style={{right:"30px",top:"50px"}}></i>
            <i className="dot" style={{left:"44px",bottom:"26px"}}></i>
          </div>
          <div class="timer">
            <div><b id="h">{hours}</b><small>HOURS</small></div><em>:</em>
            <div><b id="m">{minutes}</b><small>MINUTES</small></div><em>:</em>
            <div><b id="s">{seconds}</b><small>SECONDS</small></div>
          </div>
         
        {remaining === 0 ? (
          <button
          type="button"
          className="next next-ready"
          id="next"
          data-tour = "reward-ready"
          onClick={claimReward}
          disabled={claiming}
          >
            {claiming ? "Claiming..." : "Reward ready! Tap to claim"}
          </button>
        ):(
          <div className="next" id="next" data-tour="reward-ready">
            {`NEXT reward in ${hours}:${minutes}:${seconds}`}
          </div>
        )  
        }


        </section>

       <section className="balance-card-3d">
        <div className="balance-top">
          <div className="label-row-3d">
            <span>
              Total Balance
            </span>
            <span className="info-icon-3d">
              i
            </span>
          </div>

          <div className="balance-amount-3d">

            <span
            id="balanceAmount"
            className="amount-number"
            >

              {eplBalance.toFixed(4)}
            </span>

            <span className="currency-prefix">
              EPL
            </span>

          </div>
          
         

        </div>

        <div class="coin-top-right">

        <div class="coin-visual-3d">

          <div class="coin-glow-orbit"></div>

          <div class="coin-orbit-ring"></div>

          <div class="coin-orbit-ring ring-2"></div>

          <div class="coin-pedestal"></div>

          <div class="coin-pedestal-glow"></div>


          <div class="coin-3d-wrapper">

            <div class="coin-3d-face">

              {/* <span class="coin-text">
                EPL
              </span> */}

            </div>

            <div class="coin-3d-edge"></div>

          </div>


          <div class="coin-reflection"></div>

        </div>

      </div>

       <div className="action-buttons-3d">

          


          <button
            data-tour="withdraw"
            className="btn-withdraw-3d"
            type="button"
            disabled
          >

            <span className="withdraw-icon">
              ↑
            </span>

            <span className="withdraw-text">
              Withdraw
            </span>

            <span className="soon-badge">
              Soon
            </span>

          </button>

        </div>

        
        


       </section>


       <section class="stats-row">

        <div class="stat-card blue-theme" data-tour="hourly-reward">

          <div class="stat-header">

            <div class="icon-circle">

               <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00d9ff"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >

                <circle
                  cx="12"
                  cy="12"
                  r="10"
                ></circle>

                 <polyline
                  points="12 6 12 12 16 14"
                ></polyline>

              </svg>
            </div>

            <span>
              Hourly Reward
            </span>

          </div>

          <div class="stat-value">

            <span id="hourlyReward">
              {rewardCount}
            </span>

           

          </div>

            


          <div class="stat-footer">

            <span>
              Per hour
            </span>

            <div class="mini-chart"></div>

          </div>
        </div>

        <div class="stat-card purple-theme" data-tour="referral-bouns">

          <div class="stat-header">

            <div class="icon-circle">

              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a855f7"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >

                <path
                  d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                ></path>

                <circle
                  cx="9"
                  cy="7"
                  r="4"
                ></circle>

                <path
                  d="M23 21v-2a4 4 0 0 0-3-3.87"
                ></path>

                <path
                  d="M16 3.13a4 4 0 0 1 0 7.75"
                ></path>

              </svg>

            </div>

            <span>
              Referral Bonus
            </span>

          </div>


          <div class="stat-value">

            <span id="referralBonusStat">
              {Number(referralBonus).toFixed(4)}
            </span>

            <small>
              EPL
            </small>

          </div>


          <div
            id="referralBonusUsd"
            class="stat-sub"
          >
            = $0.00
          </div>


          <div class="stat-footer">

            <span>
              Total Earned
            </span>

            <span
              id="referralBonusFooter"
              class="highlight"
            >
              {Number(referralBonus).toFixed(4)}
            </span>

          </div>

        </div>

       </section>

       
      {/* 8-Level Referral Rewards */}
      {/* <section className="referral-glass">
        <div className="referral-glass-title">
          <span>💎 Referral Rewards</span>
          <small>{unlockedLevels}/8 Levels</small>
        </div>

        <div className="referral-level-grid">
          {referralLevels.map((item) => (
            <div
              key={item.level}
              className={`referral-level ${
                item.unlocked ? "unlocked" : "locked"
              }`}
            >
              <div className="referral-level-circle">
                {item.unlocked ? "✓" : "✕"}
              </div>

              <span>Level {item.level}</span>
              <strong>{item.reward.toLocaleString()} EPL</strong>
            </div>
          ))}
        </div>

        <div className="referral-glass-footer">
          <span>Total potential rewards</span>
          <strong>4,500 EPL</strong>
        </div>
      </section> */}

        <section className="invite-banner">

          <div className="gift-icon">
          🎁
          </div>

          <div className="invite-text">

          <h4>
            Invite Friends
          </h4>

          <p>
            Invite more friends and earn more EPL
          </p>

          </div>
          <button
          className="btn-invite"
          type="button"
          disabled
          >
            ✈️ Invite Now
          </button>
        </section>

      


        

        {message && <p className="server-message">{message}</p>}
      </main>

     
    </div>
  );
}