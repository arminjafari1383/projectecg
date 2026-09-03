import React from "react";
import { NavLink } from "react-router-dom";

import "./Navbar.css";

import WalletIcon from "../assets/wallet.png";
import StakeIcon from "../assets/stake.png";
import MineIcon from "../assets/mine.png";
import FriendIcon from "../assets/friends.png";
import AboutUsIcon from "../assets/aboutus.png";


const navItems = [
  {
    to: "/Timer",
    label: "Mine",
    icon: MineIcon,
  },
  {
    to: "/stake",
    label: "Stake",
    icon: StakeIcon,
  },
  {
    to: "/referrals",
    label: "Friends",
    icon: FriendIcon,
  },
  {
    to: "/Aboutus",
    label: "About Us",
    icon: AboutUsIcon,
  },
  {
    to: "/wallet",
    label: "Wallets",
    icon: WalletIcon,
  },
];


const Navbar = () => {
  return (
    <nav
      className="navbar"
      aria-label="Main navigation"
    >
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              "nav-item",
              isActive ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")
          }
        >
          <img
            src={item.icon}
            alt={`${item.label} icon`}
          />

          <span>
            {item.label}
          </span>
        </NavLink>
      ))}
    </nav>
  );
};


export default Navbar;