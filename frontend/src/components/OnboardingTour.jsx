import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./OnboardingTour.css";

const STEPS = [
  { path: "/Timer", icon: "👋", title: "Welcome to ECG", description: "Discover the features of the app in a quick guided tour. Tap Next to explore each section." },
  { path: "/Timer", icon: "⛏️", title: "Mine", description: "This is your mining dashboard. Follow the timer and check your mining progress here." },
  { path: "/stake", icon: "💎", title: "Stake", description: "Explore the staking section and review its available options and details before participating." },
  { path: "/referrals", icon: "👥", title: "Friends", description: "Invite friends with your referral link and review your referrals and available rewards." },
  { path: "/Aboutus", icon: "📋", title: "About Us", description: "Learn about the project and explore the activities and information available in this section." },
  { path: "/wallet", icon: "👛", title: "Wallets", description: "Manage your wallet and review wallet-related information from this page." },
];

function storageKey() {
  // Telegram Mini App users get separate completion flags on shared devices.
  const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  return `ecg-onboarding-v1:${telegramId || "browser"}`;
}

export default function OnboardingTour() {
  const navigate = useNavigate();
  const [step, setStep] = useState(() => {
    try { return localStorage.getItem(storageKey()) === "done" ? -1 : 0; }
    catch { return 0; }
  });

  useEffect(() => {
    if (step < 0) return;
    // Navigate only to actual application pages; no server changes required.
    navigate(STEPS[step].path);
  }, [step, navigate]);

  useEffect(() => {
    if (step < 0) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [step]);

  function finish() {
    try { localStorage.setItem(storageKey(), "done"); } catch { /* storage can be blocked */ }
    setStep(-1);
    navigate("/Timer");
  }

  if (step < 0) return null;
  const current = STEPS[step];
  const percent = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="ecg-tour" role="dialog" aria-modal="true" aria-label="Introduction to ECG">
      <div className="ecg-tour-shade" />
      <section className="ecg-tour-card">
        <div className="ecg-tour-top">
          <span className="ecg-tour-step">STEP {step + 1} OF {STEPS.length}</span>
          <button type="button" className="ecg-tour-skip" onClick={finish}>Skip tour ✕</button>
        </div>
        <div className="ecg-tour-progress"><div style={{ width: `${percent}%` }} /></div>
        <div className="ecg-tour-symbol" aria-hidden="true">{current.icon}</div>
        <h2>{current.title}</h2>
        <p>{current.description}</p>
        <div className="ecg-tour-dots" aria-label="Tour progress">
          {STEPS.map((_, index) => <span key={index} className={index === step ? "selected" : ""} />)}
        </div>
        <div className="ecg-tour-actions">
          <button type="button" className="ecg-tour-back" disabled={step === 0} onClick={() => setStep(s => s - 1)}>Back</button>
          <button type="button" className="ecg-tour-next" onClick={step === STEPS.length - 1 ? finish : () => setStep(s => s + 1)}>
            {step === STEPS.length - 1 ? "Get Started ✓" : "Next →"}
          </button>
        </div>
      </section>
      <div className="ecg-tour-bottom-note">Explore each section as the tour advances</div>
    </div>
  );
}
