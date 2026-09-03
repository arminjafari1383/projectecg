import React from "react";
import TelegramIcon from "../../icons/telegram.png";
import InstagramIcon from "../../icons/instagram.png";
import WebsiteIcon from "../../icons/website.png";
import PaperIcon from "../../icons/paper.png";
import StakeIcon from "../../icons/stake1.png";
import "./Aboutus.css";

function TasksPage({ tasks, setTasks, setCoins, showSnackbar }) {
  const claimReward = (task) => {
    if (!tasks[task]) {
      setTasks({ ...tasks, [task]: true });
      setCoins((c) => c + 100);
      showSnackbar("✅ Task Completed! +100 Coins");
    } else {
      showSnackbar("⚡ Already claimed");
    }
  };

  const links = {
    telegram: "https://t.me/EcoSmartECS",
    instagram: "https://www.instagram.com/ecosmartecs/",
    website: "https://ecosmartecs.com/",
    whitepaper: "https://main--hlx--ecosmartecs.aem.live/",
    staking: "https://bscscan.com/address/0x4685e9111696eff9c81a6f5ece2d83ab6b423b91#code",
  };

  return (
    <div className="tasks-page">
      <h2 className="tasks-title">🚀 About us</h2>

      <div className="tasks-grid">
        {/* Telegram */}
        <a
          href={links.telegram}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => claimReward("telegram")}
          className="task-card"
        >
          <img src={TelegramIcon} alt="Telegram" />
          <h3>Join Telegram</h3>
        </a>

        {/* Instagram */}
        <a
          href={links.instagram}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => claimReward("instagram")}
          className="task-card"
        >
          <img src={InstagramIcon} alt="Instagram" />
          <h3>Follow Instagram</h3>
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
      </div>
    </div>
  );
}

export default TasksPage;
