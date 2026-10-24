import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./SpotlightTour.css";

const tours = {
  "/Timer": [
    {
      element:'[data-tour="hamburger-menu"]',
      popover:{
        title:"☰ Main Menu",
        description:
          "You can access 3 sections from this menu: 👤 Profile to view your account,🛍️ Shopping to explore purchases,and 🎧 Support to get help.",
        side:"bottom",
        align:"start",
      },
    },

    {
      element: '[data-tour="withdraw"]',
      popover: {
        title:"💰 Withdraw",
        description:
           "Coming Soon! You will soon be able to withdraw your EPL tokens.",
        side: "bottom",
        align: "center",
      },
    },

    {
      element:'[data-tour="hourly-reward"]',
      popover:{
        title:"⏱ Hourly Reward",
        description:"This section shows the number of hours you have logged.",
        side:"bottom",
        align:"center",
      },
    },

    {
      element: '[data-tour="referral-bouns"]',
      popover:{
        title:"👥 Referral Bonus",
        description:
         "This section shows the total rewards you have earned from your referrals,calculated in EPL.",
         side:"bottom",
         align:"center",
        
      },
    },

    {
      element: '[data-tour="reward-ready"]',
      popover: {
        title: "⏳ Hourly Reward",
        description:
          "This section shows when your next EPL reward is ready. When the countdown reaches zero, your reward becomes available to claim.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="invite-friends"]',
      popover: {
        title: "Invite Friends",
        description: "Invite your friends and earn rewards.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="stake"]',
      popover: {
        title: "Stake",
        description: "Stake your assets to earn more.",
        side: "bottom",
        align: "center",
      },
    },

    {
      element:'[data-tour="stake-ecg-usdt"]',
      popover:{
        title:"💰 Stake ECG & USDT",
        description: "Stake your ECG and USDT tokens to earn rewards and grow your earnings.",
        side:"top",
        align:"center",
      },
    },

    {
      element: '[data-tour="daily-bonus"]',
      popover: {
        title: "🎁 Daily Bonus",
        description:
          "Get your daily bonus and earn rewards every day!",
        side: "top",
        align: "center",
      },
    },

    {
      element: '[data-tour="free-vpn"]',
      popover: {
        title: "🛡️ Free VPN Access",
        description:
          "Invite 5 of your friends and unlock free VPN access!",
        side: "top",
        align: "center",
      },
    },
  ],
};

export default function SpotlightTour() {
  const { pathname } = useLocation();

  useEffect(() => {
    const steps = tours[pathname];
    const telegramId =
      window.Telegram?.WebApp?.initDataUnsafe?.user?.id ||
      "browser";

    const key = `tour-v4-${telegramId}-${pathname}`;

    if (!steps || localStorage.getItem(key)) return;

    let tour;
    let completed = false;

    const timer = setTimeout(() => {
      const availableSteps = steps.filter((step) =>
        document.querySelector(step.element)
      );

      if (availableSteps.length === 0) {
        console.warn("Tour elements not found");
        return;
      }

      tour = driver({
        showProgress: true,
        showButtons: ["previous", "next", "close"],
        nextBtnText: "Next →",
        prevBtnText: "Back",
        doneBtnText: "Finish",
        stagePadding: 18,
        stageRadius: 16,
        overlayOpacity: 0.88,
        smoothScroll: true,
        steps: availableSteps,
        onNextClick: () => {
          if (tour.isLastStep()) {
            completed = true;
            localStorage.setItem(key, "done");
            tour.destroy();
          } else {
            tour.moveNext();
          }
        },
        onDestroyed: () => {
          if (completed) {
            console.log("Tour completed");
          }
        },
      });

      tour.drive();
    }, 1200);

    return () => {
      clearTimeout(timer);
      tour?.destroy();
    };
  }, [pathname]);

  return null;
}