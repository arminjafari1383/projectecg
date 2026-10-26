import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useTonWallet, TonConnectButton, useTonConnectUI, useTonAddress } from "@tonconnect/ui-react";
import { useLocation, useNavigate } from "react-router-dom";
import ecgLogo from "../assets/ecg-logo.png";
import usdtLogo from "../assets/usdt-logo.png"
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { beginCell } from "@ton/core";
import { Buffer } from "buffer";
import "./Wallet.css";
import RewardCap from "./RewardCap";
import {
  loadUserData as loadUserDataFromStorage,
  saveUserData as saveUserDataToStorage,
  readTelegramIdentity,
  deriveBrowserTelegramId,
} from "../utils/userStorage";
import {
  captureInviterCode,
  getInviterCode,
  markReferralApplied,
  markReferralFailed,
  buildReferralApiParams,
} from "../utils/referral";

const ECG_PER_USDT = 312;
const WALLET_RETURN_TO_KEY = "wallet_return_to";

// Payment flow mirrors Purchase.jsx: send the backend-created transaction through TON Connect.
const TOPUP_DIAGNOSTIC_ONLY = false;

const ECG_CONTRACT_ADDRESS = "0x79b88B5298C6025b09d910428A30e960dcEeB282";

const ECG_CONTRACT_LINK =
  `https://bscscan.com/address/${ECG_CONTRACT_ADDRESS}`;


// ======================================================
// LOCAL STORAGE
// ======================================================

const removeStoredWalletOnly = () => {
  try {
    const current = loadUserDataFromStorage();
    if (!current) return;

    const { walletAddress, ...telegramData } = current;
    saveUserDataToStorage(telegramData);
  } catch (error) {
    console.error("Could not remove stored wallet:", error);
  }
};


const shortenMiddle = (value, start = 6, end = 6) => {
  if (!value) return "-";
  if (value.length <= start + end + 3) {
    return value;
  }
  return `${value.slice(0, start)}...${value.slice(-end)}`;
};


// ======================================================
// NETWORK NORMALIZATION HELPER
// ======================================================

/**
 * Normalize a TON network value into the canonical "-239" (Mainnet)
 * or "-3" (Testnet) string form.
 *
 * TON Connect may return the chain as a string ("-239"), a number (-239),
 * or even a float (-239.0). This helper guarantees a stable string so
 * comparisons never fail because of type or formatting differences.
 */
const normalizeNetwork = (value) => {
  if (value === null || value === undefined) return null;

  let str = String(value).trim();
  if (!str) return null;

  // Handle float-like values such as "-239.0" or "-3.0"
  if (str.includes(".")) {
    str = str.split(".")[0];
  }

  // Keep only the sign and digits
  const match = str.match(/^-?\d+$/);
  if (!match) return null;

  return str;
};


const CopyIcon = ({ size = 22, className = "" }) => (
  <svg
    className={`copy-icon-svg ${className}`.trim()}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    {/* this code for icon copy */}
    <rect
      x="8.25"
      y="8.25"
      width="11"
      height="11"
      rx="2.15"
      stroke="currentColor"
      strokeWidth="1.75"
    />
    {/* this code about code for two page together */}
    <path
      d="M15.75 8.25V6.75C15.75 5.64543 14.8546 4.75 13.75 4.75H6.75C5.64543 4.75 4.75 5.64543 4.75 6.75V13.75C4.75 14.8546 5.64543 15.75 6.75 15.75H8.25"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);


// ======================================================
// COMPONENT
// ======================================================

export default function Wallet() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const location = useLocation();
  const returnAfterConnectRef = useRef(false);
  const routeReturnTo = location.state?.returnTo || null;

  // this function get ton wallet situation 
  const tonWallet = useTonWallet();
  // this variable include open wallet list and disconnect wallet
  const [tonConnectUI] = useTonConnectUI();

  // Real wallet only: never use a hardcoded address for payments.
  // Localhost must use the same real TonConnect flow as production.
  const address = tonWallet?.account?.address || null;

  const isTonWalletConnected = Boolean(
    tonConnectUI.connected && address
  );

  // show address wallet in ui
  const displayAddress = useTonAddress();
  // ignore all request in moment, send for connect wallet
  const hasConnected = useRef(false);


  // ====================================================
  // STATES
  // ====================================================

  // this state save all information wallet
  const [wallet, setWallet] = useState(null);

  // this state realize wallet lock or not
  const [walletLocked, setWalletLocked] = useState(false);

  // this state keep all word error about situation wallet realtionship and get note for example("none","network","locked","bad_request","server_error")
  const [connectError, setConnectError] = useState("");

  // this state keep all typr error about situation wallet realtionship and get note for example("none","network","locked","bad_request","server_error")
  const [errorType, setErrorType] = useState("none");

  // this state use for copy note when you click at copy button show toast for users in ui
  const [copiedText, setCopiedText] = useState("");

  // this state show users change wallet or not
  const [isReplacingWallet, setIsReplacingWallet] = useState(false);
  // ====================================================
  // WITHDRAW STATES
  // ====================================================

  // show users want to withdraw or not if usestate == flase means users didn't want to withdraw of usestate == true means users want to withdraw
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

  // this state keep withdraw amount (this state keep variable by string not Number)

  const [amount, setAmount] = useState("");
  
  // this state keep live ton price
  const [tonPrice, setTonPrice] = useState(null);

  // this state set final assets for withdraw (this state means that users want to what coin want to withdraw for example ecg or ton)

  const [withdrawAsset, setWithdrawAsset] = useState("ECG");

  // this state say where is money (for example : first inventory == usdt convert to end inventory == ton)

  const [withdrawSource, setWithdrawSource] = useState("ECG");

  // this state it truns out what profit 
  const [withdrawBucket, setWithdrawBucket] = useState("ECG_SELF");

  // this state about destination address wallet
  const [destinationWallet, setDestinationWallet] = useState("");

  // this state about wallet note for example("invalid amount", "please connect your wallet first")

  const [withdrawError, setWithdrawError] = useState("");

  // this state about is it withdraw request sending (it is important for ignore double click)
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // history list withdraw
  const [withdrawHistory, setWithdrawHistory] = useState([]);

  // it truns out loading history
  const [withdrawHistoryLoading, setWithdrawHistoryLoading] = useState(false);

  // this state for stituation withdraw message
  const [withdrawNotice, setWithdrawNotice] = useState("");

  // this state save levels inforamtion referral
  const [referralLevels, setReferralLevels] = useState({});

  // this state save loads information 
  const [referralLevelsLoading, setReferralLevelsLoading] = useState(false);

  const [walletPage,setWalletPage] = useState("home")

  const [topupStep,setTopupStep] = useState(1);
  
  const [topupAmount,setTopupAmount] = useState("");
  
  const [topupError,setTopupError] = useState("");

  const [withdrawPageAsset,setWithdrawPageAsset] = useState("ECG");

  const [withdrawPageAmount,setWithdrawPageAmount] = useState("");
  
  const [withdrawPageError,setWithdrawPageError] = useState("");

  const [swapAmount,setSwapAmount] = useState("");
  
  const [swapError,setSwapError] = useState("");

  const [swapLoading,setSwapLoading] = useState(false);
  
  const [topupLoading, setTopupLoading] = useState(false);

  const [topupStatus,setTopupStatus] = useState("");




    // WALLET TRANSACTIONS
  const [transactionFilter, setTransactionFilter] = useState("all");

  const [walletTransactions, setWalletTransactions] = useState([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const verificationRunning = useRef(false);

  const loadWalletTransactions = useCallback(async () => {
    if (!address) {
      setWalletTransactions([]);
      return;
    }
    try {
      setTransactionsLoading(true);
      const response = await api.get("/wallet/transactions/", {
        params: { wallet_address: address },
      });
      setWalletTransactions(Array.isArray(response.data) ? response.data : []);
      setTransactionsError("");
    } catch (err) {
      console.error("[WALLET TRANSACTIONS]", err);
      setTransactionsError("Could not load transactions from server.");
    } finally {
      setTransactionsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (walletPage !== "transactions" || !address) return undefined;
    loadWalletTransactions();
    const timer = window.setInterval(loadWalletTransactions, 15000);
    return () => window.clearInterval(timer);
  }, [address, walletPage, loadWalletTransactions]);



  
  useEffect(() => {

    // use async function beacuse i want send request internet 
    async function getTonPrice() {
      try {
        //this variable get ton price by api for COINGECKO website
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd"
        );
        // this variable convert json string to object
        const data = await res.json();
        // this state for save ton price 
        setTonPrice(data?.["the-open-network"]?.usd || null);
      } catch (err) { // error handling
        console.log("TON price error", err);
      }
    }
    // calls get tonprice
    getTonPrice();
  }, []);



  // ====================================================
  // REFERRAL
  // ====================================================


  useEffect(() => {
    captureInviterCode();
  }, []);


  // ====================================================
  // SAVE WALLET ADDRESS
  // ====================================================
  
  useEffect(() => {
    // if wallet connect and address exsits , continue
    if (address) {
      // load users information from localstorage 
      const currentData = loadUserDataFromStorage() || {};
      // add new address to information that load for localstorage
      saveUserDataToStorage({
        ...currentData,
        walletAddress: address,
      });
    }
  }, [address]);// this part very important (when this effect change it is run)


  // ====================================================
  // CONNECT + LOAD WALLET
  // ====================================================

  const connectAndLoadWallet = useCallback(
    async () => {
      // this condition has it because 1 - if wallet connected , function didn't run again  2 - if wallet didn't exists go out
      if (hasConnected.current || !address) {
        return;
      }
      // when function run , ignore request repeat
      hasConnected.current = true;

      // clear last notice , before new attempt 
      setConnectError("");
      setErrorType("none");
      

      let inviter_code = getInviterCode();

      let telegramId = null;
      let telegramUsername = null;
      let isTelegram = false;
      let telegramPhotoUrl = null;

      const savedData = loadUserDataFromStorage();
      const liveIdentity = readTelegramIdentity();

      if (liveIdentity?.telegram_id) {
        telegramId = liveIdentity.telegram_id;
        telegramUsername = liveIdentity.telegram_username;
        telegramPhotoUrl = liveIdentity.telegram_photo_url;
        isTelegram = liveIdentity.is_telegram;
      } else if (
        savedData?.telegramId &&
        Number.isInteger(Number(savedData.telegramId)) &&
        Number(savedData.telegramId) > 0
      ) {
        telegramId = Number(savedData.telegramId);
        telegramUsername = savedData.telegramUsername || null;
        telegramPhotoUrl = savedData.telegramPhotoUrl || null;
        isTelegram = savedData.isTelegram || false;
      } else if (address) {
        telegramId = deriveBrowserTelegramId(address);
        telegramUsername = `browser_${address.slice(0, 8)}`;
        isTelegram = false;
        saveUserDataToStorage({
          telegramId,
          telegramUsername,
          isTelegram: false,
          walletAddress: address,
        });
      }

      if (!telegramId) {
        setConnectError("Telegram identity not found. Open the app from Telegram first.");
        setErrorType("bad_request");
        hasConnected.current = false;
        return;
      }

      const payload = {
        wallet_address: address,
        inviter_code: inviter_code || null,
        telegram_id: telegramId,
        telegram_username: telegramUsername,
        telegram_photo_url: telegramPhotoUrl,
        is_telegram: isTelegram,
      };

      // show payload on console web
      console.log("[CONNECT PAYLOAD]", payload);


      try {
        // send a request post to backend with payload
        const response = await api.post("/connect/", payload);
        
        // set wallet lock 
        setWalletLocked(Boolean(response.data?.user?.wallet_locked));

        // save return user from backend
        if (response.data?.user) {
          const user = response.data.user;
          saveUserDataToStorage({
            telegramId: user.telegram_id ?? telegramId,
            telegramUsername: user.telegram_username ?? telegramUsername,
            isTelegram: user.is_telegram ?? isTelegram,
            walletAddress: address,
          });

          if (inviter_code && response.data?.referral_applied) {
            markReferralApplied(inviter_code);
          } else if (inviter_code && response.data?.referral_error) {
            markReferralFailed(inviter_code);
          }
        }

        // send request to backend for get information
        const walletResponse = await api.get(
          `/wallet/${address}/`
        );
        // wallet response return json from backend
        setWallet(walletResponse.data);

        // If the user came here from Stake, return only after the wallet
        // has been connected to the Telegram account successfully.
        if (!returnAfterConnectRef.current) {
          let returnTo = routeReturnTo;

          try {
            returnTo = returnTo || sessionStorage.getItem(WALLET_RETURN_TO_KEY);
          } catch {
            // ignore sessionStorage access error
          }

          if (
            typeof returnTo === "string" &&
            returnTo.startsWith("/") &&
            returnTo !== "/wallet"
          ) {
            returnAfterConnectRef.current = true;

            try {
              sessionStorage.removeItem(WALLET_RETURN_TO_KEY);
            } catch {
              // ignore sessionStorage cleanup error
            }

            navigate(returnTo, { replace: true });
            return;
          }
        }

        // show error if exists
        setErrorType("none");
        // if exists error in try enter this block
      } catch (e) {
        // if axios get answer from backend , body insert in error data
        const errorData = e?.response?.data;
        // get status code from backend
        const statusCode = e?.response?.status;
        // review three mode , if one of them true return network error.
        const isNetworkError = e.message === "Network Error" || e.code === "ERR_NETWORK" || !e.response;

        // if error is network error enter this condition
        if (isNetworkError) {
          // it truns out type of error 
          setErrorType("network_error");
          // it truns out word in ui
          setConnectError("Network Error! Please check your internet connection.");
          // if error isn't network then reviews backend about this wallet previously connect another telegram user or not 
        } else if (statusCode === 409 || errorData?.code === "wallet_collision") {
          setErrorType("locked");
          setConnectError(
            errorData?.error ||
            "This wallet is already linked to another Telegram account."
          );
        } else if (
          errorData?.error?.includes("already linked") ||
          errorData?.error?.includes("locked") ||
          errorData?.detail?.includes("already linked")
        ) {
          setErrorType("locked");
          setConnectError("This wallet is already linked to another Telegram account.");
          // if doesn't previously error but http status equal 400 
        } else if (statusCode === 400) {
          setErrorType("bad_request");
          const msg = errorData?.error || errorData?.detail || "Invalid wallet address format.";
          setConnectError(`Bad Request: ${msg}`);
        } else {
          setErrorType("server_error");
          const errorMessage = errorData?.error || errorData?.detail || e?.message || "Server error.";
          setConnectError(`Server Error: ${errorMessage}`);
        }

        // if error doesn't status code 400 and doesn't network code
        // attempt get address wallet
        if (statusCode !== 400 && !isNetworkError) {
          // maybe /connect/ get error but wallet exists in backend
          try {
            // if discover address wallet , show on the page
            const r = await api.get(`/wallet/${address}/`);
            // this state show on page in frontend
            setWallet(r.data);
          } catch {
            // ignore fallback error
          }
        }
      }
    },
    // in this part if address wallet / return route change load again
    [address, navigate, routeReturnTo]
  );


  
  useEffect(() => {
    connectAndLoadWallet();
  }, [connectAndLoadWallet]);


  // ====================================================
  // LIVE WALLET VALUES
  // ====================================================

  // duty get new inventory wallet from backend.
  const refreshWalletValues = useCallback(async () => {
    // if doesn't wallet address , nothing send request.
    if (!address) {
      return;
    }

    
    try {
      // get new wallet from backend
      const response = await api.get(`/wallet/${address}/`);
      // all before walletstate replace backend 
      setWallet(response.data);

    } catch (error) {
      // if refresh fail print browser console.
      console.error("[WALLET VALUES] refresh error", error);
    }
    // reference by address wallet
  }, [address]);

  // if wallet disconnected , effect dosen't run.
  useEffect(() => {
    if (!address) {
      return undefined;
    }

    
    // as soon as run , once wallet refersh.
    refreshWalletValues();


    // function refresh wallet run it.
    const timer = window.setInterval(refreshWalletValues, 15000);

    // function for when browser tab visible.
    const onVisible = () => {
      // reviewing before page observe or not.
      if (document.visibilityState === "visible") {
        // when user tab , wallet refresh.
        refreshWalletValues();
      }
    };

    // if window focus wallet refersh.
    const onFocus = () => {
      refreshWalletValues();
    };

    // event about change visiblity on active page.
    document.addEventListener("visibilitychange", onVisible);
    // event about activate focus
    window.addEventListener("focus", onFocus);

    // run cleanup function 
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [address, refreshWalletValues]);


  // ====================================================
  // DISCONNECT / REPLACE WALLET
  // ====================================================

  // start disconnet function 
  const disconnectWallet = async () => {
    // want tonwallet to disconnect wallet
    try {
      await tonConnectUI.disconnect();
    } catch (error) {
      console.error("TonConnect disconnect error:", error);
    }

    // Telegram is the account identity now. Disconnecting TON must NOT
    // delete telegram_id, Telegram profile data, or the referral identity.
    removeStoredWalletOnly();

    // remove wallet state
    setWallet(null);
    // situation lock to false
    setWalletLocked(false);
    // remove error connect
    setConnectError("");
    // reset type error.
    setErrorType("none");
    // clear error withdraw
    setWithdrawError("");
    // close withdraw model
    setIsWithdrawOpen(false);

    // flag that ignore repeat connect
    hasConnected.current = false;

    // all page reload
    window.location.reload();
  };
  

  // this function for change wallet
  const replaceWallet = async () => {
    // this condition for ignore Simultaneous operations
    if (isReplacingWallet || isWithdrawing || !address) {
      return;
    }

    // change situation wallet is changeing
    setIsReplacingWallet(true);
    // clear before error
    setConnectError("");
    setErrorType("none");

    // start opreation replace 
    try {
      // for wallet print replace wallet
      console.log("[WALLET_CHANGE] disconnecting current wallet", address);
      // current wallet disconnect 
      await tonConnectUI.disconnect();
      // only clear address wallet saved
      removeStoredWalletOnly();
      // previosuly clear wallet address
      setWallet(null);
      //reset lock wallet
      setWalletLocked(false);
      // clear withdraw error
      setWithdrawError("");
      // close withdraw model
      setIsWithdrawOpen(false);
      // get premission for connect new wallet
      hasConnected.current = false;

      // this section for ton connect have time for compelte disconnect.
      await new Promise((resolve) => setTimeout(resolve, 300));
      // open window wallet for select wallet
      await tonConnectUI.openModal();

    } catch (error) {
      // this section for handle error replace wallet.
      console.error("[WALLET_REPLACE] error", error);
      setConnectError(error?.message || "Could not replace wallet.");
      setErrorType("server_error");

    } finally {
      // both situation fail or success this state get false.
      setIsReplacingWallet(false);
    }
  };

  // if user click retry , clear error then flag connect reset and all page reload.
  const handleRetry = () => {
    setConnectError("");
    setErrorType("none");
    hasConnected.current = false;
    window.location.reload();
  };


  // ====================================================
  // COPY
  // ====================================================

  // the public function for copy text for example(txhash and wallet address)
  const copyText = async (label, value) => {
    // if didn't exists for copy function stop
    if (!value) return;

    
    try {
      // amount convert to string and insert to clipboard 
      await navigator.clipboard.writeText(String(value));
      // after 1/8 seconds message copy
      setCopiedText(`${label} copied`);
      window.setTimeout(() => setCopiedText(""), 1800);
      // if copy fail enter catch
    } catch {
      setCopiedText(`Could not copy ${label.toLowerCase()}`);
      window.setTimeout(() => setCopiedText(""), 1800);
    }
  };

  
  // for open contract list ecg
  const openContractLink = () => {
    window.open(ECG_CONTRACT_LINK, "_blank", "noopener,noreferrer");
  };


  // ====================================================
  // OPEN / CLOSE WITHDRAW
  // ====================================================

  // this function for open withdraw realize self or referral
  const openWithdraw = (bucket = "ALL") => {
    // clear error for previously message
    setWithdrawError("");
    setWithdrawNotice("");
    setAmount("");
    // this parameters said source money ecg
    setWithdrawSource("ECG");
    // this parameters self or referral
    setWithdrawBucket(bucket);
    // exit money is ton
    setWithdrawAsset("TON");
    // clear previously address wallet
    setDestinationWallet("");
    setIsWithdrawOpen(true);
  };

  // this function as same as previously function
  const openUsdtWithdraw = (bucket = "ALL") => {
    setWithdrawError("");
    setWithdrawNotice("");
    setAmount("");
    setWithdrawSource("USDT");
    setWithdrawBucket(bucket);
    // this function convert usdt to ton
    setWithdrawAsset("TON");
    setDestinationWallet("");
    setIsWithdrawOpen(true);
  };

  
  // this function for close withdraw function 
  const closeWithdraw = () => {
    // if withdraw request sending didn't close withdraw page.
    if (isWithdrawing) return;
    // despite didn't close app.
    setIsWithdrawOpen(false);
  };


  // ====================================================
  // WITHDRAW HISTORY
  // ====================================================

  // this function get withdraw history.
  const loadWithdrawHistory = useCallback(async () => {
    // if didn't wallet , history is empty and didn't send request.
    if (!address) {
      setWithdrawHistory([]);
      return;
    }

    
    try {
      // is loading history withdraw
      setWithdrawHistoryLoading(true);
      // GET withdraw/history api
      const response = await api.get("/withdraw/history/", {
        params: { wallet_address: address },
      });
      setWithdrawHistory(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("[WITHDRAW HISTORY] load error", error);
    } finally {
      setWithdrawHistoryLoading(false);
    }
  }, [address]);


  // if didn't wallet nothing work
  useEffect(() => {
    if (!address) return undefined;

    // immedatily get withdrawhistory
    loadWithdrawHistory();

    
    const timer = window.setInterval(loadWithdrawHistory, 10000);

    return () => window.clearInterval(timer);
  }, [address, loadWithdrawHistory]);


  // ====================================================
  // WITHDRAW
  // ====================================================

  const onWithdraw = async () => {
    setWithdrawError("");
    setWithdrawNotice("");

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      setWithdrawError("Invalid amount.");
      return;
    }

    if (!address) {
      setWithdrawError("Please connect your wallet first.");
      return;
    }

    if (withdrawSource === "USDT" && !tonPrice) {
      setWithdrawError("TON price is not available yet.");
      return;
    }

    if (!destinationWallet.trim()) {
      setWithdrawError(
        `Please enter the destination ${withdrawSource === "USDT" ? "TON" : withdrawAsset} wallet address.`
      );
      return;
    }

    const payload = {
      wallet_address: address,
      destination_wallet: destinationWallet.trim(),
      source_asset: withdrawSource,
      asset: withdrawSource === "USDT" ? "TON" : withdrawAsset,
      scope: withdrawSource === "USDT" ? "USDT_PROFIT_ONLY" : "ALL_WITHDRAWABLE",
      withdraw_bucket: withdrawBucket,
      amount: value,
    };

    try {
      setIsWithdrawing(true);
      const withdrawResponse = await api.post("/withdraw/request/", payload);
      // Backend is the source of truth.
      // /withdraw/request/ has already reserved/deducted the source balance.
      // Reload the wallet immediately so the UI shows the exact backend value.
      const walletResponse = await api.get(`/wallet/${address}/`);
      setWallet(walletResponse.data);
      const createdRequest = withdrawResponse?.data || {};

      setWithdrawNotice(
        withdrawSource === "USDT"
          ? `USDT → TON request #${createdRequest.id || ""} submitted. Please wait for admin approval.`
          : `Withdrawal request #${createdRequest.id || ""} submitted. Please wait for admin approval.`
      );

      await loadWithdrawHistory();

      setIsWithdrawOpen(false);
      setAmount("");
      setDestinationWallet("");
    } catch (error) {
      console.error("[WITHDRAW] request error", error);

      const backendMessage =
        error?.response?.data?.error ||
        error?.response?.data?.detail ||
        error?.response?.data?.message ||
        error?.message ||
        "Withdrawal failed.";

      setWithdrawError(backendMessage);
    } finally {
      setIsWithdrawing(false);
    }
  };


  // ====================================================
  // UNI-LEVEL REFERRAL VALUES (ECG)
  // ====================================================

  const loadReferralLevels = useCallback(async () => {
    const identity = readTelegramIdentity();
    if (!identity?.telegram_id) {
      setReferralLevels({});
      return;
    }

    setReferralLevelsLoading(true);

    try {
      const response = await api.get("/referral/levels/", {
        params: buildReferralApiParams(identity),
      });
      setReferralLevels(response?.data?.levels || {});
    } catch (error) {
      console.error("[Wallet] referral levels load error:", error);
    } finally {
      setReferralLevelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setReferralLevels({});
      return undefined;
    }

    loadReferralLevels();

    const timer = window.setInterval(loadReferralLevels, 15000);

    return () => window.clearInterval(timer);
  }, [address, loadReferralLevels]);

  // ====================================================
  // CALCULATIONS
  // ====================================================

  // for compatibility by for respond backend ecg
  const ecgAsset = wallet?.assets?.ECG || wallet?.balances?.ECG || {};
  const usdtAsset = wallet?.assets?.USDT || wallet?.balances?.USDT || {};


  // referral ecg for withdraw
  const referralProfitEcgUnlocked = Number(
    wallet?.referral_profit_ecg_unlocked ??
    wallet?.referral_available_ecg ??
    wallet?.available_referral_ecg ??
    wallet?.ecg_referral_profit ??
    0
  );


  const referralAvailableEcg = referralProfitEcgUnlocked;

  // profit 5% that 30 days didn't finish.
  const purchaseProfitLocked = Number(
    wallet?.purchase_profit_ecg_locked ??
    wallet?.self_profit_locked ??
    0
  );
  

  // Own ECG Unlocked (own profit unlock and ready for withdraw)
  const selfProfitUnlocked = Number(
    wallet?.purchase_profit_ecg_unlocked ??
    wallet?.ecg_self_unlocked ??
    0
  );

  // total ecg profit
  const purchaseProfitBalance = useMemo(
    () =>
      Number(
        // backend response
        wallet?.total_ecg_profit ??
        // if backend didn't response.
        (Number(wallet?.self_profit_locked || 0) +
        Number(wallet?.ecg_self_unlocked || 0) +
        Number(wallet?.ecg_referral_profit || 0))
      ),
      // if wallet change reload 
    [wallet]
  );

  // available ecg for all withdraw 
  const withdrawableBalance = Number(
    wallet?.withdrawable_ecg_profit ??
    // if backend didn't response
    (selfProfitUnlocked + referralProfitEcgUnlocked)
  );

  // total purchase profit usdt
  const purchaseProfitUsdt = Number(
    wallet?.purchase_profit_usdt ??
    usdtAsset.available ??
    0
  );
  

  // own usdt locked
  const purchaseProfitUsdtLocked = Number(
    wallet?.purchase_profit_usdt_locked ?? 0
  );

  // all usdt for withdraw
  const withdrawableUsdt = Number(
    wallet?.withdrawable_usdt_profit ??
    wallet?.purchase_profit_usdt_unlocked ??
    0
  );

  // available own usdt
  const selfProfitUsdtUnlocked = Number(
    wallet?.self_profit_usdt_unlocked ?? 0
  );

  // referral usdt unlock
  const referralProfitUsdtUnlocked = Number(
    wallet?.referral_profit_usdt_unlocked ??
    Math.max(withdrawableUsdt - selfProfitUsdtUnlocked, 0)
  );

  // didn't referral only own profit ECG
  const ownEcgProfitTotal = purchaseProfitLocked + selfProfitUnlocked;

  // didn't referral only own profit USDT
  const ownUsdtProfitTotal = purchaseProfitUsdtLocked + selfProfitUsdtUnlocked;


  // choice ecg for referral or self
  const selectedEcgAvailable =
    withdrawBucket === "SELF"
      ? selfProfitUnlocked
      : withdrawBucket === "REFERRAL"
        ? referralProfitEcgUnlocked
        : withdrawableBalance;

  // choice usdt for referral or self
  const selectedUsdtAvailable =
    withdrawBucket === "SELF"
      ? selfProfitUsdtUnlocked
      : withdrawBucket === "REFERRAL"
        ? referralProfitUsdtUnlocked
        : withdrawableUsdt;

  // Convert ecg to ton
  const withdrawableTon = useMemo(() => {

    // choices buckect inventory
    const ecg = selectedEcgAvailable;

    // price or didn't inventory == 0
    if (!tonPrice || !ecg) {
      return "0.0000";
    }
    // calculate ton price
    return (ecg / (tonPrice * ECG_PER_USDT)).toFixed(4);
  }, [selectedEcgAvailable, tonPrice]);



  // calculate usdt price
  const withdrawableUsdtTon = useMemo(() => {
    if (!tonPrice || !selectedUsdtAvailable) {
      return "0.0000";
    }
    return (selectedUsdtAvailable / tonPrice).toFixed(4);
  }, [selectedUsdtAvailable, tonPrice]);

  
  // function for sum user profit level one
  const sumReferralProfit = (users = [], asset = "ECG") =>
    // iterate all user and sumition
    users.reduce((sum, user) => {
      if (asset === "USDT") {
        return sum + Number(user?.profit_usdt || 0);
      }
      return sum + Number(user?.profit_ecg ?? user?.profit ?? 0);
    }, 0);


  
  // sum all level one and profit 5% for ecg.
  const uniLevelFivePercentEcg = sumReferralProfit(
    referralLevels?.level_1?.users || [],
    "ECG"
  );


  // sum all level one and profit 5% for usdt.
  const uniLevelFivePercentUsdt = sumReferralProfit(
    referralLevels?.level_1?.users || [],
    "USDT"
  );

  

  // sum all level two until five and profit 1% for ecg.
  const uniLevelOnePercentEcg = [2, 3, 4, 5].reduce(
    (sum, level) =>
      sum + sumReferralProfit(referralLevels?.[`level_${level}`]?.users || [], "ECG"),
    0
  );

  // sum all level two until five and profit 1% for usdt.
  const uniLevelOnePercentUsdt = [2, 3, 4, 5].reduce(
    (sum, level) =>
      sum + sumReferralProfit(referralLevels?.[`level_${level}`]?.users || [], "USDT"),
    0
  );

  // if backend have number level1 and if backend didn't have referral table ecg
  const referralLevel1FivePercentEcg = Number(
    wallet?.referral_level1_profit_ecg ?? uniLevelFivePercentEcg ?? 0
  );

  // if backend have number level1 and if backend didn't have referral table usdt
  const referralLevels2To5OnePercentEcg = Number(
    wallet?.referral_levels2_5_profit_ecg ?? uniLevelOnePercentEcg ?? 0
  );

  const referralLevel1FivePercentUsdt = Number(
    wallet?.referral_level1_profit_usdt ?? uniLevelFivePercentUsdt ?? 0
  );

  const referralLevels2To5OnePercentUsdt = Number(
    wallet?.referral_levels2_5_profit_usdt ?? uniLevelOnePercentUsdt ?? 0
  );

  const totalWithdrawEcg = useMemo(
    () => Number(wallet?.total_withdrawn ?? 0),
    [wallet]
  );

  const canWithdrawEcgSelf = selfProfitUnlocked > 0;

  const canWithdrawEcgReferral = referralProfitEcgUnlocked > 0;

  const canWithdrawUsdtSelf = selfProfitUsdtUnlocked > 0;

  const canWithdrawUsdtReferral = referralProfitUsdtUnlocked > 0;


  const renderSwapPage = () => {
    const amount = Number(swapAmount)

    //Available ECG profit balance

    const available = withdrawableBalance;

    // ECG_PER_USDT = 312
    // TON price comes from CoinGecko
    const rate = tonPrice
     ? 1 / (ECG_PER_USDT * tonPrice)
     : 0;
    const receiveTon = 
    Number.isFinite(amount) && amount > 0
    ? amount * rate
    : 0;
    const handleSwap = () => {
      if (!Number.isFinite(amount) || amount <= 0){
        setSwapError("Enter a valid ECG amount.");
        return;

      }
    
    if (amount > available) {
      setSwapError("Insufficient ECG balance.");
      return;
    }

    if (!tonPrice || !Number.isFinite(tonPrice)) {
      setSwapError("Ton price is not available.");
      return;
    }

    setSwapError(
      "Swap preview is ready. Real swap requires backend integration."
    );
    };


    return (
      <div className="wallet-topup-glass">
        <button
        type="button"
        className="wallet-topup-back"
        onClick={()=>{
          setWalletPage("home");
          setSwapAmount("");
          setSwapError("");
        }}
        >
          ← Back to Wallet
        </button>

        <h2>Swap</h2>
        
        <p>
          Available:{available.toFixed(2)} ECG
        </p>

        <label htmlFor="swap-amount">
          From(ECG)
        </label>

        <div className="wallet-swap-input-row">
          <input
          id="swap-amount" 
          type="number" 
          min="0"
          step="any"
          placeholder="0.00"
          value={swapAmount}
          onChange={(e) => {
            setSwapAmount(e.target.value);
            setSwapError("");
          }}
          />

          <button
          type="button"
          onClick={() => {
            setSwapAmount(String(available));
            setSwapError("");
          }}
          >
            Max
          </button>

        </div>

        <div className="wallet-swap-arrow">
          ↓
        </div>

        <div className="wallet-swap-summary">
          <div>
            <span>You receive</span>
            <strong>
              ≈ {receiveTon.toFixed(6)} TON
            </strong>
          </div>

           <div>
          <span>Rate</span>
          <strong>
            1 ECG ≈ {rate.toFixed(8)} TON
          </strong>
        </div>

        {swapError && (
        <p role="status" className="wallet-topup-error">
          {swapError}
        </p>
      )}

      <button
        type="button"
        className="wallet-topup-continue"
        onClick={handleSwap}
        disabled={swapLoading}
      >
        {swapLoading ? "Processing..." : "Swap"}
      </button>

        </div>
      </div>
    )

  }

  // TRANSACTIONS PAGE
const renderTransactionsPage = () => {
  const filters = [
    { key: "all", label: "All" },
    { key: "topup", label: "Top Ups" },
    { key: "withdraw", label: "Withdrawals" },
    { key: "swap", label: "Swaps" },
    { key: "purchase", label: "Purchases" },
  ];

  const filteredTransactions =
    transactionFilter === "all"
      ? walletTransactions
      : walletTransactions.filter(
          (tx) => tx.type === transactionFilter
        );

  return (
    <div className="wallet-topup-glass wallet-transactions-glass">
      <button
        type="button"
        className="wallet-topup-back"
        onClick={() => setWalletPage("home")}
      >
        ← Back to Wallet
      </button>

      <h2>Transactions</h2>

      <div className="wallet-transactions-tabs">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={
              transactionFilter === filter.key ? "active" : ""
            }
            onClick={() => setTransactionFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {transactionsError && <p role="alert" className="wallet-topup-error">{transactionsError}</p>}
      {transactionsLoading && walletTransactions.length === 0 ? (
        <p className="wallet-transactions-empty">Loading transactions...</p>
      ) : filteredTransactions.length === 0 ? (
        <p className="wallet-transactions-empty">
          No transactions found.
        </p>
      ) : (
        
<div className="wallet-transactions-list">
  {filteredTransactions.map((tx) => {
    const type = String(tx.type || "").toLowerCase();

    const isTopUp = type === "topup";
    const isWithdraw = type === "withdraw";

    return (
      <div
        className={`wallet-transaction-item ${
          isTopUp
            ? "tx-topup"
            : isWithdraw
            ? "tx-withdraw"
            : ""
        }`}
        key={tx.id}
      >
        <div className="wallet-transaction-info">
          <strong>
            {tx.title ||
              (isTopUp
                ? "TON Top Up"
                : isWithdraw
                ? "Withdrawal"
                : "Transaction")}
          </strong>

          <span>
            {tx.date
              ? new Date(tx.date).toLocaleString("en-US")
              : "—"}
          </span>
        </div>

        <div className="wallet-transaction-right">
          <strong>
            {isTopUp ? "+" : isWithdraw ? "−" : ""}
            {tx.amount} {tx.asset}
          </strong>

          <span className="wallet-tx-status">
            {tx.status}
          </span>
        </div>
      </div>
    );
  })}
</div>

      )}
    </div>
  );
};

  const renderWithdrawPage = () => {
    const available = withdrawableBalance;

    const handleWithdrawContinue = () => {
      const value = Number(withdrawPageAmount);

      if (!Number.isFinite(value) || value <= 0) {
        setWithdrawError("Enter a valid amount.");
        return;
      }

      if (withdrawPageAsset !== "ECG") {
        setWithdrawPageError(
          "TON withdrawal is not configured in this form yet."
        );
        return;
      }

      if (value > available) {
        setWithdrawPageError("Insufficient balance.");
        return;
      }

      setWithdrawPageError("");

      openWithdraw("ALL");
      
      setAmount(withdrawPageAmount);
    };

    return (
      <div className="wallet-topup-glass">
        <button
        type="button"
        className="wallet-topup-back"
        onClick={() => setWalletPage("home")}
        >
          ← Back to Wallet
        </button>

        <h2>Withdraw</h2>
        <p>
          Available:{available.toFixed(2)}ECG
        </p>

        <label> Asset </label>

        <div className="wallet-withdraw-assets">
          <button
          type="button"
          className={withdrawPageAsset === "ECG" ? "active":""}
          onClick={() => setWithdrawPageAsset("ECG")}
          >
            ECG

          </button>

          <button
          type="button"
          className={withdrawPageAsset === "TON" ? "active":""}
          onClick={() => setWithdrawPageAsset("TON")}
          >
            TON
          </button>
        </div>
        <label htmlFor="withdraw-page-amount">
          Amount ({withdrawPageAsset})
        </label>

        <input
        id="withdraw-page-amount"
        type="number"
        min="0"
        step="any"
        placeholder="0.00"
        value={withdrawPageAmount}
        onChange={(e) => {
          setWithdrawPageAmount(e.target.value);
          setWithdrawPageError("");
        }}
        />
        {
          withdrawPageError && (
            <p role="alert" className="wallet-topup-error">
              {withdrawPageError}
            </p>
          )
        }
        <button
        type="button"
        className="wallet-topup-continue"
        onClick={handleWithdrawContinue}
        >
          Continue
        </button>

      </div>
    )
  }


 
  // Resume a submitted on-chain payment until Django confirms it.
  // The signed BOC is not a secret; sessionStorage survives a page reload.
  const verifySubmittedTopUp = useCallback(async (payment) => {
    if (!payment?.deposit_id || !payment?.boc || verificationRunning.current) return;
    verificationRunning.current = true;
    setTopupLoading(true);
    setTopupStep(4);
    setTopupError("");

    try {
      // Indexers can take some time to observe a blockchain transaction.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await api.post("/ton/topup/confirm/", {
            deposit_id: payment.deposit_id,
            boc: payment.boc,
            wallet_address: payment.wallet_address,
          });
          if (response.data?.status === "confirmed") {
            sessionStorage.removeItem("pending_ton_topup");
            setTopupStatus("TON Top Up confirmed and credited to your internal wallet.");
            const walletResponse = await api.get(`/wallet/${encodeURIComponent(payment.wallet_address)}/`);
            setWallet(walletResponse.data);
            await loadWalletTransactions();
            return;
          }
          setTopupStatus("Payment submitted. Waiting for blockchain confirmation...");
        } catch (err) {
          if (err?.response?.status === 409 || err?.response?.status === 400) {
            throw new Error(err?.response?.data?.error || "Top Up verification failed.");
          }
          // Transient TON indexer/API errors: retry, never credit locally.
          setTopupStatus("Checking blockchain confirmation...");
        }
        if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      setTopupStatus("Still pending. Use Retry Verification to check again; no funds have been credited yet.");
    } catch (err) {
      setTopupError(err.message || "Could not confirm Top Up.");
    } finally {
      verificationRunning.current = false;
      setTopupLoading(false);
    }
  }, [loadWalletTransactions]);

  useEffect(() => {
    if (!address) return;
    try {
      const payment = JSON.parse(sessionStorage.getItem("pending_ton_topup") || "null");
      if (payment?.wallet_address === address && payment.deposit_id && payment.boc) {
        verifySubmittedTopUp(payment);
      }
    } catch (error) {
      console.error("Cannot restore pending TON Top Up", error);
    }
  }, [address, verifySubmittedTopUp]);

  const submitTonTopUp = async () => {
    const walletAddress = tonWallet?.account?.address || null;
    const amountText = String(topupAmount).trim();
    const rawWalletChain = tonWallet?.account?.chain;

    // Normalize the wallet network into a canonical "-239" or "-3" string.
    const walletNetwork = normalizeNetwork(rawWalletChain);

    const diagnosticId = `TOPUP-${Date.now()}`;

    console.group(`[${diagnosticId}] TON TOPUP DIAGNOSTICS`);
    console.log("01. Wallet connection", {
      connected: Boolean(tonConnectUI.connected),
      walletAddressPresent: Boolean(walletAddress),
      walletChainRaw: rawWalletChain,
      walletChainType: typeof rawWalletChain,
      walletNetworkNormalized: walletNetwork,
      diagnosticOnly: TOPUP_DIAGNOSTIC_ONLY,
    });
    console.log("02. Requested amount", {
      amountText,
      validFormat: /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(amountText),
    });
    console.groupEnd();

    if (!walletAddress || !tonConnectUI.connected) {
      console.error(`[${diagnosticId}] Wallet is not connected`);
      setTopupError("Connect your real TON wallet first.");
      return;
    }

    if (
      !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(amountText) ||
      !Number.isFinite(Number(amountText)) ||
      Number(amountText) <= 0
    ) {
      console.error(`[${diagnosticId}] Invalid amount`);
      setTopupError("Enter a valid positive TON amount (up to 9 decimals).");
      return;
    }

    if (verificationRunning.current || topupLoading) {
      console.warn(`[${diagnosticId}] Another operation is already running`);
      return;
    }

    if (sessionStorage.getItem("pending_ton_topup")) {
      console.warn(`[${diagnosticId}] Previous payment is still pending`);
      setTopupError(
        "A previous TON Top Up is still pending verification. Complete it before starting another."
      );
      setTopupStep(4);
      return;
    }

    setTopupLoading(true);
    setTopupError("");
    setTopupStatus("");

    try {
      console.group(`[${diagnosticId}] CREATE TOPUP REQUEST`);
      console.log("03. POST /ton/topup/create/", {
        amount: amountText,
        walletAddressPresent: Boolean(walletAddress),
        walletNetworkRaw: rawWalletChain,
        walletNetworkNormalized: walletNetwork,
      });

      if (!walletNetwork || !["-239", "-3"].includes(walletNetwork)) {
        console.error(`[${diagnosticId}] Unsupported wallet network`, {
          raw: rawWalletChain,
          rawType: typeof rawWalletChain,
          normalized: walletNetwork,
        });
        throw new Error(
          `Unsupported or missing TON wallet network: ${walletNetwork ?? "missing"}. ` +
          `Please ensure your wallet is on Mainnet (-239) or Testnet (-3).`
        );
      }

      const response = await api.post("/ton/topup/create/", {
        wallet_address: walletAddress,
        amount: amountText,
        network: walletNetwork,
      });
      const deposit = response.data;

      console.log("04. Backend response metadata", {
        httpStatus: response.status,
        responseKeys: deposit && typeof deposit === "object" ? Object.keys(deposit) : [],
        depositStatus: deposit?.status,
        depositIdPresent: Boolean(deposit?.deposit_id),
        referencePresent: Boolean(deposit?.reference),
        serverNetworkRaw: deposit?.network,
        serverNetworkType: typeof deposit?.network,
        transactionPresent: Boolean(deposit?.transaction),
        transactionKeys: deposit?.transaction && typeof deposit.transaction === "object"
          ? Object.keys(deposit.transaction)
          : [],
        messagesCount: Array.isArray(deposit?.transaction?.messages)
          ? deposit.transaction.messages.length
          : 0,
      });
      console.groupEnd();

      if (
        deposit?.status !== "pending" ||
        !deposit?.deposit_id ||
        !deposit?.reference ||
        !deposit?.transaction?.messages?.[0]
      ) {
        console.error(`[${diagnosticId}] Invalid create response structure`, deposit);
        throw new Error("Invalid Top Up response from server. Check backend response logs.");
      }

      // Normalize the server-returned network as well before comparing.
      const serverNetwork = normalizeNetwork(deposit.network);
      const normalizedWalletNetwork = normalizeNetwork(walletNetwork);

      const networksMatch = Boolean(
        serverNetwork &&
        normalizedWalletNetwork &&
        serverNetwork === normalizedWalletNetwork
      );

      console.group(`[${diagnosticId}] NETWORK COMPARISON`);
      console.table([
        {
          source: "Backend (server)",
          rawValue: deposit.network,
          rawType: typeof deposit.network,
          normalized: serverNetwork,
          isMainnet: serverNetwork === "-239",
          isTestnet: serverNetwork === "-3",
          isValid: ["-239", "-3"].includes(serverNetwork),
        },
        {
          source: "TonConnect wallet",
          rawValue: rawWalletChain,
          rawType: typeof rawWalletChain,
          normalized: normalizedWalletNetwork,
          isMainnet: normalizedWalletNetwork === "-239",
          isTestnet: normalizedWalletNetwork === "-3",
          isValid: ["-239", "-3"].includes(normalizedWalletNetwork),
        },
      ]);
      console.log("Networks match:", networksMatch);
      console.log("Raw wallet chain:", rawWalletChain, "Type:", typeof rawWalletChain);
      console.log("Normalized wallet network:", normalizedWalletNetwork);
      console.log("Normalized server network:", serverNetwork);
      console.log("Expected Mainnet ID: -239; Testnet ID: -3");
      console.groupEnd();

      if (!networksMatch) {
        console.error(`[${diagnosticId}] NETWORK MISMATCH — PAYMENT BLOCKED`, {
          serverNetwork,
          serverNetworkRaw: deposit.network,
          walletNetwork: normalizedWalletNetwork,
          walletChainRaw: rawWalletChain,
          walletChainType: typeof rawWalletChain,
          connected: Boolean(tonConnectUI.connected),
          expectedMainnet: "-239",
          expectedTestnet: "-3",
          hint: "Switch your TON wallet to the same network as the server.",
        });
        throw new Error(
          `Wallet network does not match the server TON network. ` +
          `Server=${serverNetwork ?? "missing"}, ` +
          `Wallet=${normalizedWalletNetwork ?? "missing"}. ` +
          `Please switch your wallet to ${serverNetwork === "-239" ? "Mainnet" : "Testnet"} and try again.`
        );
      }

      const firstMessage = deposit.transaction.messages[0];
      const validUntil = Number(deposit.transaction.validUntil);
      const amountNano = String(firstMessage.amount ?? "");
      const amountNanoIsValid = /^[1-9]\d*$/.test(amountNano);

      console.group(`[${diagnosticId}] TRANSACTION VALIDATION`);
      console.log("05. Transaction metadata", {
        recipientPresent: Boolean(firstMessage.address),
        recipient: firstMessage.address,
        amountNanoPresent: Boolean(amountNano),
        amountNano,
        amountNanoIsValid,
        validUntil: deposit.transaction.validUntil,
        validUntilIsValid: Number.isFinite(validUntil),
        messageCount: deposit.transaction.messages.length,
      });
      console.groupEnd();

      if (
        !firstMessage.address ||
        !amountNanoIsValid ||
        !Number.isFinite(validUntil)
      ) {
        throw new Error("Invalid transaction details returned by the backend.");
      }

      // Keep diagnostic mode enabled until real Mainnet confirmation and
      // idempotent balance crediting have been verified end to end.
      if (TOPUP_DIAGNOSTIC_ONLY) {
        console.warn(`[${diagnosticId}] DIAGNOSTIC MODE: no payment was sent`, {
          result: "No wallet transaction submitted",
          reason: "TOPUP_DIAGNOSTIC_ONLY is true",
        });
        setTopupStatus("Diagnostics completed. No payment was sent.");
        setTopupError(
          "Diagnostic mode is enabled. Payment remains disabled until backend verification is validated."
        );
        return;
      }

      const commentCell = beginCell()
        .storeUint(0, 32)
        .storeStringTail(`TOPUP:${deposit.reference}`)
        .endCell();

      const transaction = {
        ...deposit.transaction,
        messages: deposit.transaction.messages.map((message) => ({
          ...message,
          payload: Buffer.from(commentCell.toBoc()).toString("base64"),
        })),
      };

      console.log(`[${diagnosticId}] Opening connected wallet approval dialog`);
      const result = await tonConnectUI.sendTransaction(transaction);

      if (!result?.boc) {
        throw new Error("Wallet did not return a signed transaction.");
      }

      // Never log the BOC contents.
      console.log(`[${diagnosticId}] Wallet returned signed transaction`, {
        bocPresent: true,
        bocContentLogged: false,
      });

      const payment = {
        deposit_id: deposit.deposit_id,
        boc: result.boc,
        wallet_address: walletAddress,
      };

      sessionStorage.setItem("pending_ton_topup", JSON.stringify(payment));
      setTopupStep(4);
      setTopupLoading(false);
      await verifySubmittedTopUp(payment);
    } catch (error) {
      console.error(`[${diagnosticId}] TOPUP ERROR`, {
        message: error?.message,
        httpStatus: error?.response?.status,
        code: error?.code,
        serverError: error?.response?.data?.error,
        serverMessage: error?.response?.data?.message,
        responseKeys: error?.response?.data && typeof error.response.data === "object"
          ? Object.keys(error.response.data)
          : [],
      });

      setTopupError(
        error?.response?.data?.error ||
        error?.message ||
        "Could not submit Top Up."
      );
    } finally {
      setTopupLoading(false);
    }
  };

  const retryTonVerification = () => {
    try {
      const payment = JSON.parse(sessionStorage.getItem("pending_ton_topup") || "null");
      if (payment?.wallet_address === address) verifySubmittedTopUp(payment);
      else setTopupError("No pending Top Up found for this wallet.");
    } catch {
      setTopupError("Cannot read pending Top Up.");
    }
  };

  const renderTopUp = () => {
    const amount = Number(topupAmount);

    const continueTopUp = () => {
      const amount = Number(topupAmount);

      if (!Number.isFinite(amount) || amount <= 0){
        setTopupError("Enter a valid TON amount.");
        return;
      }

      setTopupError("");
      if (isTonWalletConnected) {
        setTopupStep(3);
      } else {
        setTopupStep(2);
      }
    }
    return(
      <div className="wallet-topup-glass">

        <button
        className="wallet-topup-back"
        onClick={() => {
          setWalletPage("home");
          setTopupStep(1);
          setTopupAmount("");
          setTopupError("");
        }}
        >
          ← Back to Wallet

        </button>

        <div className="wallet-topup-progress">
          <span className={topupStep >= 1 ? "active": ""}/>
          <span className={topupStep >= 2 ? "active": ""}/>
          <span className={topupStep >= 3 ? "active": ""}/>
          <span className={topupStep >= 4 ? "active": ""}/>
        </div>

        <p className="wallet-topup-step">
          Step {topupStep} of 4
        </p>

        {topupStep === 1 && (
          <>
            <h2>How much do you want to add?</h2>

            <label htmlFor = "topup-amount">
              Amount(TON)
            </label>

            <input 
            id="topup-amount"
            type="number" 
            min="0"
            step="any"
            placeholder="0.00"
            value={topupAmount}
            onChange={(e) => {
              setTopupAmount(e.target.value);
              setTopupError("");
            }}
            />

            <div className="wallet-topup-quick">
              {[10,50,100,500].map((value) => (
                <button
                key={value}
                onClick={() => {
                  setTopupAmount(String(value));
                  setTopupError("");
                }}
                >
                  {value} TON
                </button>
              ))}
            </div>
            {topupError && (
              <p role="alert" className="wallet-topup-error">
                {topupError}
              </p>
            )}
            <button
            className="wallet-topup-continue"
            onClick={continueTopUp}
            >
              Continue
            </button>
          </>
          
        )}

        {topupStep === 2 && (
          <>
            <h2>Connect your TON wallet</h2>

            <p>
              Amount: <strong>{amount.toLocaleString("en-US")} TON</strong>
            </p>

            {isTonWalletConnected ? (
              <>
                <p>Wallet connected: {shortenMiddle(address)}</p>
                <button
                  type="button"
                  className="wallet-topup-continue"
                  onClick={() => setTopupStep(3)}
                >
                  Continue to payment
                </button>
              </>
            ) : (
              <>
                <p>Connect Tonkeeper or another supported TON wallet.</p>
                <div className="wallet-topup-connect-button">
                  <TonConnectButton />
                </div>
                <button
                  type="button"
                  className="wallet-topup-continue"
                  onClick={() => setTopupStep(1)}
                >
                  Edit amount
                </button>
              </>
            )}

            {topupError && (
              <p role="alert" className="wallet-topup-error">
                {topupError}
              </p>
            )}
          </>
        )}

        {topupStep === 3 && (
            <>
              <h2>Confirm Payment</h2>

              <div className="wallet-topup-summary">
                <p>
                  Amount: <strong>{topupAmount} TON</strong>
                </p>

                <p>
                  From: <strong>{shortenMiddle(address)}</strong>
                </p>

                <p>
                  Network: <strong>TON</strong>
                </p>
              </div>
<button
             type="button"
             className="wallet-topup-continue"
             onClick={submitTonTopUp}
             disabled={topupLoading || !isTonWalletConnected}
             >
              {topupLoading ? "Submitting..." : "Pay with TON"}
             </button>

             {topupError && (
              <p role="alert" className="wallet-topup-error">
                {topupError}
              </p>
             )}
            </>
          )}

          
        {topupStep === 4 && (
          <>
            <h2>Top Up Submitted</h2>

            <p>
              {topupStatus ||
                "Transfer submitted. Waiting for blockchain verification."}
            </p>

            <p>
              Your TON balance will update after the backend
              confirms the transaction.
            </p>
            <button type="button" className="wallet-topup-continue" onClick={retryTonVerification} disabled={topupLoading}>
              {topupLoading ? "Verifying..." : "Retry Verification"}
            </button>
            {topupError && <p role="alert" className="wallet-topup-error">{topupError}</p>}

            <button
              type="button"
              className="wallet-topup-continue"
              onClick={() => {
                setWalletPage("home");
                setTopupStep(1);
                setTopupAmount("");
                setTopupError("");
                setTopupStatus("");
              }}
            >
              Back to Wallet
            </button>
          </>
        )}

      </div>
    )
  }

  useEffect(() => {
    if (
      walletPage === "topup" &&
      topupStep === 2 && 
      isTonWalletConnected
    ){
      setTopupStep(3);
    }
  }, [
    walletPage,
    topupStep,
    isTonWalletConnected
  ]);
  // ====================================================
  // UI
  // ====================================================

  return (
    

      <div className="wallet-box wallet-box--redesigned">

        {/* HEADER */}

        <div className="wallet-header-block">

          <h1 className="wallet-title">
            Wallet
          </h1>

          <p className="wallet-subtitle">
            Purchase profit balance in ECG
          </p>

        </div>

        <div className="wallet-page-container">
          {walletPage === "topup" && renderTopUp()}
          {walletPage === "withdraw" && renderWithdrawPage()}
          {walletPage === "swap" && renderSwapPage()}
          {walletPage === "transactions" && renderTransactionsPage()}

          
{walletPage === "home" && (
  <>
    <div className="wallet-demo-card">
      {/* Connected wallet and ECG contract addresses */}
      <div
        style={{
          display: "grid",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 14,
            background: "rgba(255,255,255,0.045)",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Connected TON Wallet Address
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 8,
            }}
          >
            <span
              title={address || "Wallet not connected"}
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflowWrap: "anywhere",
                minWidth: 0,
              }}
            >
              {address ? shortenMiddle(address, 9, 8) : "Not connected"}
            </span>
            <button
              type="button"
              className="wallet-copy-icon-btn"
              disabled={!address}
              onClick={() => copyText("Wallet address", address)}
              aria-label="Copy connected wallet address"
              title="Copy wallet address"
            >
              <CopyIcon size={19} />
            </button>
          </div>
        </div>

        <div
          style={{
            padding: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 14,
            background: "rgba(255,255,255,0.045)",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            ECG Token Contract (BNB Smart Chain)
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 8,
            }}
          >
            <a
              href={ECG_CONTRACT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              title={ECG_CONTRACT_ADDRESS}
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflowWrap: "anywhere",
                minWidth: 0,
              }}
            >
              {shortenMiddle(ECG_CONTRACT_ADDRESS, 9, 8)}
            </a>
          <button
            type="button"
            className="wallet-copy-icon-btn"
            onClick={() => copyText("Contract address", ECG_CONTRACT_ADDRESS)}
            aria-label="Copy ECG contract address"
            title="Copy contract address"
          >
            <CopyIcon size={19} />
          </button>
          </div>
        </div>
      </div>

      <div className="wallet-demo-balance">
        <span>TON Balance</span>
        <h2>
          {wallet
            ? `${Number(wallet.ton_balance ?? 0).toLocaleString(
                "en-US",
                { maximumFractionDigits: 9 }
              )} TON`
            : "— TON"}
        </h2>
      </div>

      <div className="wallet-demo-divider" />

      <div className="wallet-demo-balance">
        <span>ECG Balance</span>
        <h2>
          {address
            ? withdrawableBalance.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })
            : "—"} ECG
        </h2>
      </div>

      <div className="wallet-demo-actions">
        <button onClick={() => setWalletPage("topup")}>
          ＋ Top Up
        </button>

        <button onClick={() => setWalletPage("withdraw")}>
          ↗ Withdraw
        </button>

        <button onClick={() => setWalletPage("swap")}>
          ⇄ Swap
        </button>

        <button onClick={() => setWalletPage("transactions")}>
          ☷ Transactions
        </button>
      </div>
    </div>

    <RewardCap />
  </>
)}

       
        

       


        {/* if didn't address */}
        {!address ? (

          // =================================================
          // NOT CONNECTED
          // =================================================

          <div className="wallet-connect-state">

            {/* show button ton connect */}
            {!LOCAL_MODE && (
            <div className="connect-button-wrapper">
              <TonConnectButton />
            </div>
            )
            }
            <p className="wallet-connect-hint">
              Connect your TON wallet to see your balance,
              lock status and withdrawal progress.
            </p>

          </div>

        ) : (

          // =================================================
          // CONNECTED
          // =================================================

          <>

      



            {/* COPY TOAST */}

            {copiedText && (

              <div className="wallet-toast">
                {copiedText}
              </div>

            )}


            {/* CONNECTION ERROR */}

            {connectError && (

              <div className="wallet-error">

                <div className="error-icon">

                  {errorType === "locked" ? "🔒" : "⚠️"}

                </div>


                <div className="error-title">

                  {errorType === "locked"
                    ? "Wallet already linked"
                    : "Connection issue"}

                </div>


                <div className="error-desc">
                  {connectError}
                </div>


                {(errorType === "locked" || errorType === "network_error") && (

                  <div className="wallet-error-actions">

                    {errorType === "locked" && (

                      <button
                        className="wallet-inline-btn danger"
                        onClick={disconnectWallet}
                      >
                        Disconnect & Try Again
                      </button>

                    )}


                    {errorType === "network_error" && (

                      <button
                        className="wallet-inline-btn"
                        onClick={handleRetry}
                      >
                        Retry Connection
                      </button>

                    )}

                  </div>

                )}

              </div>

            )}


            {/* if wallet exists show four box */}
            {!wallet ? (

              <div className="wallet-loading-card">
                Loading wallet data...
              </div>

            ) : (

              <>

                 <section className="pw-section">
                  <div className="pw-section-head">
                    <div>
                      <div className="pw-eyebrow">{t("wallet.PROFITWITHDRAW")}</div>
                      <h3 className="pw-heading">{t("wallet.ECGTetherProfit")}</h3>
                      <p className="pw-subheading">
                        {t("wallet.pwsubheading")}
                      </p>
                    </div>
                    <span className="pw-live-dot" aria-hidden="true" />
                  </div>

                  <div className="pw-list">

                    {/* 1. ECG • OWN 5% */}
                    <article className="pw-card pw-card--ecg">
                      <div className="pw-card-top">
                        <div className="pw-card-icon-wrap">
                          <img
                            src={ecgLogo}
                            alt=""
                            aria-hidden="true"
                            className="output-token-logo"
                          />
                        </div>
                        <div className="pw-card-titles">
                          <span className="pw-card-title">{t("wallet.pwcardtitle")}</span>
                          <span className="pw-card-sub">{t("wallet.pwcardsub")}</span>
                        </div>
                        <span className={`pw-badge ${canWithdrawEcgSelf ? "pw-badge--ok" : "pw-badge--lock"}`}>
                          {canWithdrawEcgSelf 
                            ? t("wallet.available") 
                            : t("wallet.locked")
                          }
                        </span>
                      </div>

                      <div className="pw-card-amount">
                        <strong>{ownEcgProfitTotal.toFixed(4)}</strong>
                        <span>ECG</span>
                      </div>

                      <div className="pw-progress">
                        <div
                          className="pw-progress-fill"
                          style={{
                            width:
                              ownEcgProfitTotal > 0
                                ? `${Math.min(
                                    100,
                                    (selfProfitUnlocked / ownEcgProfitTotal) * 100
                                  )}%`
                                : "0%",
                          }}
                        />
                      </div>

                      <div className="pw-meta-row">
                        <div className="pw-meta">
                          <span>{t("wallet.Available")}</span>
                          <b>{selfProfitUnlocked.toFixed(4)} ECG</b>
                        </div>
                        <div className="pw-meta pw-meta--right">
                          <span>{t("wallet.Locked30d")}</span>
                          <b>{purchaseProfitLocked.toFixed(4)} ECG</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="pw-btn"
                        onClick={() => openWithdraw("SELF")}
                        disabled={!canWithdrawEcgSelf}
                      >
                        {canWithdrawEcgSelf 
                          ? t("wallet.withdraw") 
                          : t("wallet.locked30d")
                        }
                      </button>
                    </article>


                    {/* 2. ECG • REFERRAL */}
                    <article className="pw-card pw-card--ecg pw-card--ref">
                      <div className="pw-card-top">
                        <div className="pw-card-icon-wrap">
                          <img
                            src={ecgLogo}
                            alt=""
                            aria-hidden="true"
                            className="output-token-logo"
                          />
                        </div>
                        <div className="pw-card-titles">
                          <span className="pw-card-title">{t("wallet.ECGReferralProfit")}</span>
                          <span className="pw-card-sub">{t("wallet.Instantunlock")}</span>
                        </div>
                        <span className={`pw-badge ${canWithdrawEcgReferral ? "pw-badge--ok" : "pw-badge--mute"}`}>
                          {canWithdrawEcgReferral
                           ? t("wallet.Available")
                           : t("wallet.Nobalance")
                           }
                        </span>
                      </div>

                      <div className="pw-card-amount">
                        <strong>{referralAvailableEcg.toFixed(4)}</strong>
                        <span>ECG</span>
                      </div>

                      <div className="pw-meta-row">
                        <div className="pw-meta">
                          <span>{t("wallet.level")}</span>
                          <b>{referralLevel1FivePercentEcg.toFixed(4)} ECG</b>
                        </div>
                        <div className="pw-meta pw-meta--right">
                          <span>{t("wallet.level1")}</span>
                          <b>{referralLevels2To5OnePercentEcg.toFixed(4)} ECG</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="pw-btn pw-btn--ref"
                        onClick={() => openWithdraw("REFERRAL")}
                        disabled={!canWithdrawEcgReferral}
                      >
                        {canWithdrawEcgReferral
                         ? t("wallet.withdraw")
                         : t("wallet.Nobalance")
                        }
                      </button>
                    </article>


                    {/* 3. USDT • OWN 5% */}
                    <article className="pw-card pw-card--usdt">
                      <div className="pw-card-top">
                        <div className="pw-card-icon-wrap">
                          <img
                            src={usdtLogo}
                            alt=""
                            aria-hidden="true"
                            className="output-token-logo"
                          />
                        </div>
                        <div className="pw-card-titles">
                          <span className="pw-card-title">{t("wallet.TetherOwn5Profit")}</span>
                          <span className="pw-card-sub">{t("wallet.daymaturity")}</span>
                        </div>
                        <span className={`pw-badge ${canWithdrawUsdtSelf ? "pw-badge--ok" : "pw-badge--lock"}`}>
                          {canWithdrawUsdtSelf
                           ? t("wallet.Available") 
                           : t("wallet.locked")
                           }
                        </span>
                      </div>

                      <div className="pw-card-amount">
                        <strong>{ownUsdtProfitTotal.toFixed(4)}</strong>
                        <span>USDT</span>
                      </div>

                      <div className="pw-progress pw-progress--usdt">
                        <div
                          className="pw-progress-fill"
                          style={{
                            width:
                              ownUsdtProfitTotal > 0
                                ? `${Math.min(
                                    100,
                                    (selfProfitUsdtUnlocked / ownUsdtProfitTotal) * 100
                                  )}%`
                                : "0%",
                          }}
                        />
                      </div>

                      <div className="pw-meta-row">
                        <div className="pw-meta">
                          <span>{t("wallet.available")}</span>
                          <b>{selfProfitUsdtUnlocked.toFixed(4)} USDT</b>
                        </div>
                        <div className="pw-meta pw-meta--right">
                          <span>{t("wallet.Locked30d")}</span>
                          <b>{purchaseProfitUsdtLocked.toFixed(4)} USDT</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="pw-btn pw-btn--usdt"
                        onClick={() => openUsdtWithdraw("SELF")}
                        disabled={!canWithdrawUsdtSelf}
                      >
                        {canWithdrawUsdtSelf
                         ? t("wallet.withdraw") 
                         : t("wallet.locked30d")}
                      </button>
                    </article>


                    {/* 4. USDT • REFERRAL */}
                    <article className="pw-card pw-card--usdt pw-card--ref">
                      <div className="pw-card-top">
                        <div className="pw-card-icon-wrap">
                          <img
                            src={usdtLogo}
                            alt=""
                            aria-hidden="true"
                            className="output-token-logo"
                          />
                        </div>
                        <div className="pw-card-titles">
                          <span className="pw-card-title">{t("wallet.TetherReferralProfit")}</span>
                          <span className="pw-card-sub">{t("wallet.InstantconvertstoTON")}</span>
                        </div>
                        <span className={`pw-badge ${canWithdrawUsdtReferral ? "pw-badge--ok" : "pw-badge--mute"}`}>
                          {canWithdrawUsdtReferral 
                          ? t("wallet.Available") 
                          : t("wallet.Nobalance")
                          }
                        </span>
                      </div>

                      <div className="pw-card-amount">
                        <strong>{referralProfitUsdtUnlocked.toFixed(4)}</strong>
                        <span>USDT</span>
                      </div>

                      <div className="pw-meta-row">
                        <div className="pw-meta">
                          <span>{t("wallet.level")}</span>
                          <b>{referralLevel1FivePercentUsdt.toFixed(4)} USDT</b>
                        </div>
                        <div className="pw-meta pw-meta--right">
                          <span>{t("wallet.level1")}</span>
                          <b>{referralLevels2To5OnePercentUsdt.toFixed(4)} USDT</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="pw-btn pw-btn--usdt"
                        onClick={() => openUsdtWithdraw("REFERRAL")}
                        disabled={!canWithdrawUsdtReferral}
                      >
                        {canWithdrawUsdtReferral 
                        ? t("wallet.withdraw") 
                        : t("wallet.Nobalance")
                        }
                      </button>
                    </article>

                  </div>
                </section>
             


                {withdrawNotice && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      border: "1px solid rgba(255,255,255,0.18)",
                      borderRadius: 10,
                      lineHeight: 1.6,
                    }}
                  >
                    ⏳ {withdrawNotice}
                  </div>
                )}


                {/* REPLACE WALLET */}

                <button
                  className="wallet-disconnect-btn"
                  onClick={replaceWallet}
                  disabled={isReplacingWallet || isWithdrawing}
                >
                  {isReplacingWallet ? "Opening Wallet Selector..." : "🔄 Replace Wallet"}
                </button>


                {/* DISCONNECT */}

                <button
                  className="wallet-disconnect-btn"
                  onClick={disconnectWallet}
                  disabled={isReplacingWallet || isWithdrawing}
                >
                  Disconnect Wallet
                </button>

              </>

            )}

          </>

        )}

      </div>


      {/* ================================================= */}
      {/* WITHDRAW MODAL */}
      {/* ================================================= */}

      {isWithdrawOpen && wallet && (

        <div
          className="modal-backdrop"
          onClick={closeWithdraw}
        >

          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >

            {/* HEADER */}

            <div className="modal-header">

              <h3>
                {withdrawBucket === "SELF"
                  ? `Withdraw Own ${withdrawSource} Profit`
                  : withdrawBucket === "REFERRAL"
                    ? `Withdraw Referral ${withdrawSource} Profit`
                    : "Withdraw"}
              </h3>

              <button
                className="modal-close"
                onClick={closeWithdraw}
                disabled={isWithdrawing}
              >
                ×
              </button>

            </div>

            {/* BODY */}

            <div className="modal-body">

              <label>
                Withdrawal Method
              </label>

              {withdrawSource === "USDT" ? (
                <div className="asset-picker">
                  <button
                    type="button"
                    className="selected"
                    disabled
                  >
                    Convert USDT → TON
                  </button>
                </div>
              ) : (
                <div className="asset-picker">
                  <button
                    type="button"
                    className={withdrawAsset === "ECG" ? "selected" : ""}
                    onClick={() => {
                      setWithdrawAsset("ECG");
                      setDestinationWallet("");
                      setAmount("");
                      setWithdrawError("");
                    }}
                    disabled={isWithdrawing}
                  >
                    Withdraw with ECG
                  </button>

                  <button
                    type="button"
                    className={withdrawAsset === "TON" ? "selected" : ""}
                    onClick={() => {
                      setWithdrawAsset("TON");
                      setDestinationWallet("");
                      setAmount("");
                      setWithdrawError("");
                    }}
                    disabled={isWithdrawing}
                  >
                    Withdraw with TON
                  </button>
                </div>
              )}

              <label htmlFor="withdraw-destination">
                {withdrawSource === "USDT"
                  ? "TON Wallet Address"
                  : `${withdrawAsset} Wallet Address`}
              </label>

              <input
                id="withdraw-destination"
                type="text"
                value={destinationWallet}
                onChange={(e) => setDestinationWallet(e.target.value)}
                placeholder={
                  withdrawSource === "USDT"
                    ? "Enter destination TON wallet address"
                    : `Enter destination ${withdrawAsset} wallet address`
                }
                disabled={isWithdrawing}
                autoComplete="off"
              />

              <div className="ton-info">
                {withdrawSource === "USDT"
                  ? "Your unlocked Tether profit will be reserved and converted to TON. The request stays Pending until admin pays the TON destination and marks it Complete."
                  : `This ${withdrawAsset} request will stay Pending until an admin pays the destination wallet and marks it Complete.`}
              </div>

              <label htmlFor="withdraw-amount">
                {withdrawSource === "USDT"
                  ? "USDT Amount to Convert"
                  : withdrawAsset === "TON"
                    ? "TON Amount"
                    : "Withdrawable Amount (ECG)"}
              </label>

              <div className="amount-wrapper">
                <input
                  id="withdraw-amount"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={
                    withdrawSource === "USDT"
                      ? "Enter unlocked USDT amount"
                      : withdrawAsset === "TON"
                        ? "Enter TON amount"
                        : "Enter ECG amount"
                  }
                  min="0.000001"
                  disabled={isWithdrawing}
                />

                <button
                  type="button"
                  className="max-btn"
                  onClick={() =>
                    setAmount(
                      withdrawSource === "USDT"
                        ? selectedUsdtAvailable
                        : withdrawAsset === "TON"
                          ? withdrawableTon
                          : selectedEcgAvailable
                    )
                  }
                  disabled={isWithdrawing}
                >
                  MAX
                </button>
              </div>

              {withdrawSource === "USDT" ? (
                <div className="ton-info">
                  <div>
                    Available selected Tether profit:{" "}
                    <b>{selectedUsdtAvailable.toFixed(4)} USDT</b>
                  </div>
                  <div>
                    Estimated TON:{" "}
                    <b>
                      {tonPrice && Number(amount) > 0
                        ? (Number(amount) / Number(tonPrice)).toFixed(4)
                        : "0.0000"}
                      {" TON"}
                    </b>
                  </div>
                  <div>
                    MAX output: <b>{withdrawableUsdtTon} TON</b>
                  </div>
                </div>
              ) : withdrawAsset === "ECG" ? (
                <div className="max-balance-info">
                  <div>
                    Available selected profit:{" "}
                    <b>{selectedEcgAvailable.toFixed(4)} ECG</b>
                  </div>
                  <div>
                    Referral profit (instant):{" "}
                    <b>{referralProfitEcgUnlocked.toFixed(4)} ECG</b>
                  </div>
                  <div>
                    Own matured profit:{" "}
                    <b>{selfProfitUnlocked.toFixed(4)} ECG</b>
                  </div>
                </div>
              ) : (
                <div className="ton-info">
                  <div>
                    Withdrawable TON: <b>{withdrawableTon} TON</b>
                  </div>
                  <div>
                    Based on selected unlocked ECG profit:{" "}
                    <b>{selectedEcgAvailable.toFixed(2)} ECG</b>
                  </div>
                  <div>
                    Referral profit is available instantly; own 5% profit unlocks after 30 days.
                  </div>
                </div>
              )}

              {withdrawError && (
                <div className="error-text">
                  {withdrawError}
                </div>
              )}

            </div>

            {/* FOOTER */}

            <div className="modal-footer">

              <button
                className="btn-secondary"
                onClick={closeWithdraw}
                disabled={isWithdrawing}
              >
                Cancel
              </button>

              <button
                className="btn-primary"
                onClick={onWithdraw}
                disabled={isWithdrawing}
              >

                {isWithdrawing
                  ? "Submitting Request..."
                  : withdrawSource === "USDT"
                    ? "Convert USDT to TON"
                    : withdrawAsset === "TON"
                      ? "Request TON Withdrawal"
                      : "Request ECG Withdrawal"}

              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}