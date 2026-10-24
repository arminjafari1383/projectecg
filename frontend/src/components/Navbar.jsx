import React from "react";
import { NavLink } from "react-router-dom";

import "./Navbar.css";
import { useTranslation } from "react-i18next";
import MineIcon from "../assets/nav/mine.webp";
import StakeIcon from "../assets/nav/stake.webp";
import FriendIcon from "../assets/nav/friends.webp";
import AboutUsIcon from "../assets/nav/about.webp";
import WalletIcon from "../assets/nav/wallet.webp";


// accent = rgb triplet for glows/borders, soft = label colour when active
const navItems = [
  {
    to: "/Timer",
    label: "Mine",
    icon: MineIcon,
    accent: "59, 130, 246",
    soft: "#93c5fd",
  },
  {
    to: "/stake",
    label: "Stake",
    icon: StakeIcon,
    accent: "34, 211, 238",
    soft: "#67e8f9",
  },
  {
    to: "/referrals",
    label: "Friends",
    icon: FriendIcon,
    accent: "168, 85, 247",
    soft: "#c4b5fd",
  },
  {
    to: "/Aboutus",
    label: "About Us",
    icon: AboutUsIcon,
    accent: "245, 158, 11",
    soft: "#fcd34d",
  },
  {
    to: "/wallet",
    label: "Wallets",
    icon: WalletIcon,
    accent: "217, 70, 239",
    soft: "#f0abfc",
  },
];


const Navbar = () => {
  const { t } = useTranslation();

  const navKeys = [
    "nav.mine",
    "nav.stake",
    "nav.friends",
    "nav.aboutUs",
    "nav.wallets",
  ];
  return (
    <nav
      className="navbar"
      aria-label="Main navigation"
    >
      {navItems.map((item,index) => (
        <NavLink
          key={item.to}
          to={item.to}
          style={{ "--accent": item.accent, "--soft": item.soft }}
          className={({ isActive }) =>
            [
              "nav-item",
              isActive ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")
          }
        >
          <span className="nav-card" aria-hidden="true">
            <img src={item.icon} alt="" draggable="false" />
            <span className="nav-arrow">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </span>

          <span className="nav-label">
            {t(navKeys[index])}
          </span>
        </NavLink>
      ))}
    </nav>
  );
};


export default Navbar;