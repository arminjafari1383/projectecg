
import { useEffect, useState } from "react";
import { api } from "../api";
import { readTelegramIdentity } from "../utils/userStorage";
import { buildReferralApiParams } from "../utils/referral";
import "./RewardCap.css";

// =====================================================
// HELPERS
// =====================================================

const safeNumber = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? Math.max(0, number)
    : 0;
};

const formatTON = (value) => {
  const number = safeNumber(value);

  return `${number.toLocaleString("en-US", {
    maximumFractionDigits: 8,
  })} TON`;
};

const clampPercent = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, number));
};

// =====================================================
// REWARD CAP COMPONENT
// =====================================================

export default function RewardCap() {
  const [rewardCap, setRewardCap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // =====================================================
  // FETCH REAL REWARD CAP FROM DJANGO
  // =====================================================

  useEffect(() => {
    let cancelled = false;
    let requestRunning = false;

    const fetchRewardCap = async () => {
      if (cancelled || requestRunning) return;

      requestRunning = true;

      try {
        const identity = readTelegramIdentity();

        if (!identity?.telegram_id) {
          if (!cancelled) {
            setError(
              "Please open the app in Telegram."
            );
          }
          return;
        }

        const response = await api.get(
          "/reward-cap/",
          {
            params: buildReferralApiParams(identity),
          }
        );

        if (!cancelled) {
          setRewardCap(response.data);
          setError("");
        }
      } catch (err) {
        console.error(
          "[REWARD CAP API ERROR]",
          err
        );

        if (!cancelled) {
          setError(
            err?.response?.data?.error ||
            "Failed to load Reward Cap."
          );
        }
      } finally {
        requestRunning = false;

        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchRewardCap();

    const refresh = () => {
      if (
        document.visibilityState === "visible"
      ) {
        fetchRewardCap();
      }
    };

    window.addEventListener("focus", refresh);

    window.addEventListener(
      "visibilitychange",
      refresh
    );

    document.addEventListener(
      "visibilitychange",
      refresh
    );

    const interval = window.setInterval(
      fetchRewardCap,
      15000
    );

    return () => {
      cancelled = true;

      window.removeEventListener("focus", refresh);

      window.removeEventListener(
        "visibilitychange",
        refresh
      );

      document.removeEventListener(
        "visibilitychange",
        refresh
      );

      window.clearInterval(interval);
    };
  }, []);

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <section className="reward-cap">
        <p className="rc-message">
          Loading Reward Cap...
        </p>
      </section>
    );
  }

  // =====================================================
  // ERROR OR NO DATA
  // =====================================================

  if (!rewardCap) {
    return (
      <section className="reward-cap">
        <p className="rc-message" role="alert">
          {error || "Reward Cap unavailable."}
        </p>
      </section>
    );
  }

  // =====================================================
  // REAL VALUES FROM BACKEND
  // =====================================================

  // Personal Purchase = Stake + NFT Purchase
  // Calculated and stored by Django.
  const personalBuy = safeNumber(
    rewardCap.personal_purchase_ton
  );

  // Income Cap = 10 x Personal Purchase
  const cap = safeNumber(
    rewardCap.cap_ton
  );

  // Referral rewards already received
  const received = safeNumber(
    rewardCap.used_ton
  );

  // Referral rewards burned after reaching cap
  const burned = safeNumber(
    rewardCap.burned_ton
  );

  // Available capacity for future referral rewards
  const remaining = Math.max(
    0,
    cap - received
  );

  // =====================================================
  // PROGRESS
  // =====================================================

  // Remaining reward capacity as a percentage of the total active cap.
  // Each new eligible purchase increases cap by 10x the purchase amount
  // on the backend. Previously earned rewards remain deducted from it.
  const percent = clampPercent(
    cap > 0
      ? (remaining / cap) * 100
      : 0
  );

  // =====================================================
  // ACCOUNT STATUS
  // =====================================================

  const eligible = cap > 0;

  const fullCap =
    eligible && remaining <= 0;

  const nearCap =
    eligible &&
    !fullCap &&
    percent <= 20;

  const statusText = !eligible
    ? "Inactive"
    : fullCap
    ? "Cap Reached"
    : nearCap
    ? "Near Cap"
    : "Active";

  const messageText = !eligible
    ? "Make a Stake or NFT purchase to activate your Reward Cap."
    : fullCap
    ? "Your income cap is fully used. Additional referral rewards will be burned."
    : nearCap
    ? "You are approaching your Reward Cap."
    : "You still have available Reward Cap.";

  // =====================================================
  // SEMICIRCLE GAUGE POSITION
  // =====================================================

  // 0%   = left
  // 50%  = top
  // 100% = right

  const angle = (Math.PI * percent) / 100;

  const knobX =
    120 - 95 * Math.cos(angle);

  const knobY =
    120 - 95 * Math.sin(angle);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <section className="reward-cap">

      {/* HEADER */}
      <div className="rc-header">
        <div>
          <h2>Your Reward Cap</h2>

          <p>
            Remaining capacity / 10× (Stake + NFT Purchase)
          </p>
        </div>

        <span
          className={`rc-badge ${
            nearCap ? "is-warning" : ""
          }`}
        >
          {statusText}
        </span>
      </div>

      {/* REWARD CAP GAUGE */}
      <div className="rc-gauge">
        <svg
          viewBox="0 0 240 140"
          role="img"
          aria-label="Remaining Reward Cap percentage"
        >
          {/* BACKGROUND */}
          <path
            className="rc-track"
            d="M25 120 A95 95 0 0 1 215 120"
            pathLength="100"
          />

          {/* FILLED PROGRESS */}
          <path
            className={`rc-arc ${
              nearCap ? "is-warning" : ""
            }`}
            d="M25 120 A95 95 0 0 1 215 120"
            pathLength="100"
            strokeDasharray={`${percent} 100`}
          />

          {/* MOVING KNOB */}
          <circle
            cx={knobX}
            cy={knobY}
            r="6"
            className="rc-knob"
          />
        </svg>

        {/* CENTER */}
        <div className="rc-gauge-center">
          <strong>
            {percent.toFixed(1)}%
          </strong>

          <span>
            {formatTON(remaining)} available
          </span>

          <span>
            of {formatTON(cap)} Income Cap
          </span>

          <span>
            {formatTON(received)} already received
          </span>
        </div>
      </div>

      {/* STATUS MESSAGE */}
      <div
        className={`rc-message ${
          nearCap ? "is-warning" : ""
        }`}
      >
        {messageText}
      </div>

      {/* STATISTICS */}
      <div className="rc-stats">

        <div className="rc-stat">
          <span>
            Personal Purchase (Stake + NFT)
          </span>

          <strong>
            {formatTON(personalBuy)}
          </strong>
        </div>

        <div className="rc-stat is-highlight">
          <span>
            Rewards Received
          </span>

          <strong>
            {formatTON(received)}
          </strong>
        </div>

        <div className="rc-stat">
          <span>
            Income Cap (10×)
          </span>

          <strong>
            {formatTON(cap)}
          </strong>
        </div>

        <div className="rc-stat">
          <span>
            Remaining
          </span>

          <strong>
            {formatTON(remaining)}
          </strong>
        </div>

      </div>

      {/* BURNED REWARDS */}
      <div className="rc-burned">
        <span>
          Burned Rewards
        </span>

        <strong>
          {formatTON(burned)}
        </strong>
      </div>

      {/* REFRESH ERROR */}
      {error && (
        <p className="rc-message" role="alert">
          {error}
        </p>
      )}

    </section>
  );
}
