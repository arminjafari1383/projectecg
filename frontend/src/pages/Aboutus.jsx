import React, { useState,useEffect } from "react";
import TelegramIcon from "../../icons/telegram.png";
import InstagramIcon from "../../icons/instagram.png";
import WebsiteIcon from "../../icons/website.png";
import PaperIcon from "../../icons/paper.png";
import StakeIcon from "../../icons/stake1.png";
import YoutubeIcon from "../../icons/youtube.png";
import api from "../api";
import { useWallet } from "../context/WalletContext";
import { readTelegramIdentity } from "../utils/userStorage";
import { buildReferralApiParams } from "../utils/referral";
import createAdHandler from "monetag-tg-sdk";
import "./Aboutus.css";

const MONETAG_ZONE_ID = 12345678;
const showMonetagAd = createAdHandler(MONETAG_ZONE_ID);

function TasksPage({
  showSnackbar }) {
    const [tasks, setTasks] = useState({});
    const [claiming, setClaiming] = useState({});
    const [eplBalance, setEplBalance] = useState(null);
    const [adLoading, setAdLoading] = useState(false);
    const [adMessage,setAdMessage] = useState("");
    const handleWatchAd = async () => {
      if (adLoading) return;

      setAdLoading(true);
      setAdMessage("");

       try {
      await showMonetagAd({
        type:"end",
        requestVar:"about_us"
      });

      setAdMessage("Advertisement closed.");
    } catch (error) {
      console.error("Monetag error:",error);

      setAdMessage(
        "Advertisement unavailable. Please try again."
      );
    }finally{
      setAdLoading(false);
    }

    };
   
    const [vpn,setVpn] = useState({
      direct_invites:0,
      required_invites:5,
      remaining_invites:5,
      progress:0,
      unlocked:false,
    });
    const [vpnLoading,setVpnLoading]=useState(true);
    const [vpnError,setVpnError] = useState(false);
    const { walletAddress } = useWallet();

    useEffect(() => {
      let active = true;
      const identity = readTelegramIdentity();
      api.get("/social-rewards/", {
        params: {
          ...buildReferralApiParams(identity || {}),
          ...(walletAddress ? { wallet_address: walletAddress } : {}),
        },
      }).then(({ data }) => {
        if (!active) return;
        const claimed = {};
        (data.climed || data.claimed || []).forEach(item => { claimed[item] = true; });
        setTasks(claimed);
        if (data.epl_balance != null) setEplBalance(String(data.epl_balance));
      }).catch(error => console.error("Social rewards loading error:", error));
      return () => { active = false; };
    }, [walletAddress]);

    
    useEffect(() => {
      let active = true;

      const loadVpnStatus = async () => {
        setVpnLoading(true);
        setVpnError(false);

        try {
          const identity = readTelegramIdentity();

          if (!identity?.telegram_id) {
            throw new Error("Telegram identity missing");
          }

          const response = await api.get("/vpn/status/", {
            params: buildReferralApiParams(identity),
          });

          if (active) {
            setVpn(response.data);
          }
        } catch (error) {
          console.error("VPN status error:", error);

          if (active) {
            setVpnError(true);
          }
        } finally {
          if (active) {
            setVpnLoading(false);
          }
        }
      };

      loadVpnStatus();

      return () => {
        active = false;
      };
    }, []);

    const claimReward = async (task) => {
      if (tasks[task] || claiming[task]) return;
      // Give instant visual feedback; undo if server rejects the credit.
      setTasks(prev => ({ ...prev, [task]: true }));
      setClaiming(prev => ({ ...prev, [task]: true }));
      try {
        const identity = readTelegramIdentity();
        const { data } = await api.post("/social-reward/", {
          platform: task,
          wallet_address: walletAddress || "",
          telegram_id: identity?.telegram_id ?? null,
        });
        if (!['claimed', 'already_claimed'].includes(data.status)) {
          throw new Error(data.error || 'Social claim was not accepted');
        }
        if (data.epl_balance != null) setEplBalance(String(data.epl_balance));
        window.dispatchEvent(new Event("wallet-balance-updated"));
        showSnackbar(data.status === 'already_claimed'
          ? '⚡ Reward already claimed'
          : '🎉 +1000 EPL credited (local test)');
      } catch (error) {
        setTasks(prev => ({ ...prev, [task]: false }));
        showSnackbar(error?.response?.data?.error || '❌ Reward failed');
        console.error("Social reward error:", error);
      } finally {
        setClaiming(prev => ({ ...prev, [task]: false }));
      }
    };

  const links = {
    telegram: "https://t.me/EcoSmartECS",
    instagram: "https://www.instagram.com/ecosmartecs/",
    youtube: "https://www.youtube.com/@YOUR_CHANNEL",
    website: "https://ecosmartecs.com/",
    whitepaper: "https://main--hlx--ecosmartecs.aem.live/",
    staking: "https://bscscan.com/address/0x4685e9111696eff9c81a6f5ece2d83ab6b423b91#code",
  };

  return (
    <div className="tasks-page">
      <h2 className="tasks-title"> About us</h2>
      {eplBalance !== null && (
        <p className="social-epl-live" aria-live="polite">
          EPL Balance: <strong>{Number(eplBalance).toLocaleString('en-US', { maximumFractionDigits: 4 })} EPL</strong>
          <small>Local test balance</small>
        </p>
      )}

      <div className="tasks-grid">
       {/* Telegram */}
        <a
          href={links.telegram}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => claimReward("telegram")}
          className={`task-card ${tasks.telegram ? "task-claimed" : ""}`}
        >
          <div className="social-icon-wrap">
            <img src={TelegramIcon} alt="Telegram" />
          </div>

          <div className="social-info">
            <h3>Join Telegram</h3>
            <span>Join our official community</span>
          </div>

          <div className={`social-reward ${tasks.telegram ? "claimed" : ""}`}>
            <small>SOCIAL</small>
            <strong>
              {tasks.telegram ? "✓ CLAIMED" : "+1000 EPL"}
            </strong>
          </div>
        </a>


        {/* Instagram */}
        <a
          href={links.instagram}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => claimReward("instagram")}
          className={`task-card ${tasks.instagram ? "task-claimed" : ""}`}
        >
          <div className="social-icon-wrap">
            <img src={InstagramIcon} alt="Instagram" />
          </div>

          <div className="social-info">
            <h3>Follow Instagram</h3>
            <span>Follow our latest updates</span>
          </div>

          <div className={`social-reward ${tasks.instagram ? "claimed" : ""}`}>
            <small>SOCIAL</small>
            <strong>
              {tasks.instagram ? "✓ CLAIMED" : "+1000 EPL"}
            </strong>
          </div>
        </a>


        {/* YouTube */}
        <a
          href={links.youtube}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => claimReward("youtube")}
          className={`task-card ${tasks.youtube ? "task-claimed" : ""}`}
        >
          <div className="social-icon-wrap">
            <img src={YoutubeIcon} alt="YouTube" />
          </div>

          <div className="social-info">
            <h3>Subscribe YouTube</h3>
            <span>Watch & follow our channel</span>
          </div>

          <div className={`social-reward ${tasks.youtube ? "claimed" : ""}`}>
            <small>SOCIAL</small>
            <strong>
              {tasks.youtube ? "✓ CLAIMED" : "+1000 EPL"}
            </strong>
          </div>
        </a>

      
      </div>

      

      {/* 🔹 لینک‌های پایینی */}
      <div className="extra-links">
        <a href={links.whitepaper} target="_blank" rel="noopener noreferrer" className="task-link">
          <img src={PaperIcon} alt="Whitepaper" />
          <span>View Whitepaper</span>
        </a>

        <a href={links.staking} target="_blank" rel="noopener noreferrer" className="task-link">
          <img src={StakeIcon} alt="Staking" />
          <span>Staking Contract</span>
        </a>
      </div><br /><br />

      
      
      {/* Free VPN Reward */}
      <section className="vpn-card">

        <div className="vpn-row">
          <div className="vpn-ico">🛡</div>

          <div className="vpn-info">
            <b>Free VPN access</b>
            <span>
              Reward for reaching 5 direct invites
            </span>
          </div>

          <div className="vpn-count">
            {vpnLoading
              ? "..."
              : vpnError
              ? "Unavailable"
              : `${vpn.direct_invites} / ${vpn.required_invites}`}
          </div>
        </div>

        <div className="vpn-bar">
          <i
            style={{
              width: `${vpnError ? 0 : vpn.progress}%`,
              transition: "width 0.4s ease"
            }}
          />
        </div>

        <p className="vpn-hint">
          {vpnError
            ? "Unable to load VPN status"
            : vpnLoading
            ? "Checking your referrals..."
            : vpn.unlocked
            ? "🎉 VPN reward unlocked!"
            : `Invite ${vpn.remaining_invites} more friends to unlock`}
        </p>

        <button
          className={`vpn-btn ${
            !vpnError && vpn.unlocked ? "ready" : ""
          }`}
          type="button"
          disabled
        >
          {vpnLoading
            ? "Loading..."
            : vpnError
            ? "VPN status unavailable"
            : vpn.unlocked
            ? "✓ VPN Unlocked"
            : "Locked · invite friends to unlock"}
        </button>

      </section>

      {/* Monetag watch Ad */}
      <section className="monetag-card">
        <div className="monetag-header">
          <div className="monetag-icon">🎬</div>
          <div className="monetag-info">
            <b>Watch Ads</b>
            <span>
              Watch advertisements and support our platform
            </span>
          </div>
        </div>

        <div className="monetag-preview">
          <div className="monetag-play">▶</div>
          <strong>Watch Advertisement</strong>
          <span>Powered by Monetag</span>
        </div>

        <button
        className="monetag-btn"
        type="button"
        onClick={handleWatchAd}
        disabled={adLoading}
        >
          {adLoading ? "Loading Ad...":"▶ Watch Ad"}
        </button>

        {adMessage && (
          <p className="monetag-message">
            {adMessage}
          </p>
        )

        }
      </section>

    </div>
  );
}

export default TasksPage;
