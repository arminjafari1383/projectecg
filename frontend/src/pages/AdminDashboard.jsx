import {
  useCallback,
  useMemo,
  useState,
} from "react";

import { api } from "../api";
import "./AdminDashboard.css";


const tabs = [
  "users",
  "purchases",
  "withdrawals",
];


const short = (value = "") => {
  const text = String(value || "");

  return text.length > 18
    ? `${text.slice(0, 9)}…${text.slice(-6)}`
    : text;
};


const number = (value) => {
  const parsed = Number(value || 0);

  if (!Number.isFinite(parsed)) {
    return "0";
  }

  return parsed.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 6,
    }
  );
};


const isCompletedStatus = (status) => {
  return [
    "SUCCESS",
    "COMPLETE",
    "COMPLETED",
  ].includes(
    String(status || "").toUpperCase()
  );
};


export default function AdminDashboard() {
  // Google Authenticator فقط برای ورود
  const [otp, setOtp] =
    useState("");

  // سشن ادمین بعد از ورود موفق
  const [
    adminSession,
    setAdminSession,
  ] = useState(() => {
    return (
      sessionStorage.getItem(
        "admin_session_token"
      ) || ""
    );
  });

  const [data, setData] =
    useState(null);

  const [tab, setTab] =
    useState("users");

  const [query, setQuery] =
    useState("");

  const [error, setError] =
    useState("");

  const [copiedAdminText, setCopiedAdminText] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [
    completingWithdrawalId,
    setCompletingWithdrawalId,
  ] = useState(null);


  // =========================================================
  // LOGIN
  // =========================================================

  const loadDashboard =
    useCallback(async () => {
      const cleanOtp =
        otp.trim();

      if (
        !/^\d{6}$/.test(
          cleanOtp
        )
      ) {
        setError(
          "Please enter the current 6-digit Google Authenticator code."
        );

        return;
      }

      setLoading(true);
      setError("");

      try {
        // -----------------------------------------
        // 1. ساخت Admin Session
        // -----------------------------------------

        const sessionResponse =
          await api.post(
            "/admin/session/",
            {},
            {
              headers: {
                "X-Admin-OTP":
                  cleanOtp,
              },
            }
          );

        const token =
          sessionResponse
            ?.data
            ?.admin_session
          || "";

        if (!token) {
          throw new Error(
            "Server did not return an admin session."
          );
        }


        // -----------------------------------------
        // 2. دریافت اطلاعات Dashboard
        // -----------------------------------------

        const response =
          await api.get(
            "/admin/system-dashboard/",
            {
              headers: {
                "X-Admin-OTP":
                  cleanOtp,
              },
            }
          );


        // -----------------------------------------
        // 3. ذخیره Admin Session
        // -----------------------------------------

        sessionStorage.setItem(
          "admin_session_token",
          token
        );

        setAdminSession(
          token
        );

        setData(
          response.data
        );

        // OTP را نگه نمی‌داریم
        setOtp("");

      } catch (err) {
        console.error(
          "[ADMIN LOGIN ERROR]",
          err
        );

        sessionStorage.removeItem(
          "admin_session_token"
        );

        setAdminSession("");

        setData(null);

        setError(
          err.response
            ?.data
            ?.error
          ||
          err.response
            ?.data
            ?.detail
          ||
          err.message
          ||
          "Unable to load admin dashboard."
        );

      } finally {
        setLoading(false);
      }
    }, [otp]);


  // =========================================================
  // COPY ADMIN VALUE
  // =========================================================

  const copyAdminValue =
    useCallback(async (label, value) => {
      const text = String(value || "").trim();

      if (!text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopiedAdminText(`${label} copied`);
      } catch (copyError) {
        console.error("[ADMIN COPY ERROR]", copyError);
        setCopiedAdminText(`Could not copy ${label.toLowerCase()}`);
      }

      window.setTimeout(() => {
        setCopiedAdminText("");
      }, 1800);
    }, []);


  // =========================================================
  // COMPLETE WITHDRAWAL
  // =========================================================

  const completeWithdrawal =
    useCallback(
      async (withdrawal) => {
        if (
          !withdrawal?.id
        ) {
          return;
        }


        // Admin session باید وجود داشته باشد
        if (!adminSession) {
          setError(
            "Admin session expired. Please sign in again."
          );

          setData(null);

          return;
        }


        // -----------------------------------------
        // TX HASH
        // -----------------------------------------

        const txHash =
          window.prompt(
            "Transaction hash / payment receipt:",
            withdrawal.tx_hash || ""
          );

        // Cancel
        if (
          txHash === null
        ) {
          return;
        }

        const cleanTxHash =
          txHash.trim();

        if (!cleanTxHash) {
          setError(
            "Please enter TX Hash / payment receipt."
          );

          return;
        }


        try {
          setCompletingWithdrawalId(
            withdrawal.id
          );

          setError("");


          // -----------------------------------------
          // Pending -> Complete
          // -----------------------------------------

          const response =
            await api.post(
              `/admin/withdrawals/${withdrawal.id}/complete/`,

              {
                tx_hash:
                  cleanTxHash,
              },

              {
                headers: {
                  "X-Admin-Session":
                    adminSession,
                },
              }
            );


          const completed =
            response
              ?.data
              ?.withdrawal
            || {};


          // -----------------------------------------
          // بدون Reload همان لحظه جدول را Complete کن
          // -----------------------------------------

          setData(
            (current) => {
              if (!current) {
                return current;
              }

              const withdrawals =
                (
                  current.withdrawals
                  || []
                ).map(
                  (row) => {
                    if (
                      row.id !==
                      withdrawal.id
                    ) {
                      return row;
                    }

                    return {
                      ...row,
                      ...completed,

                      status:
                        completed.status
                        || "SUCCESS",

                      display_status:
                        "COMPLETE",

                      tx_hash:
                        completed.tx_hash
                        || cleanTxHash,

                      completed_at:
                        completed.completed_at
                        || new Date()
                          .toISOString(),
                    };
                  }
                );


              // summary pending ها را هم به‌صورت محلی کم کن
              const summary = {
                ...(current.summary || {}),
              };

              const asset =
                String(
                  withdrawal.asset
                  || ""
                ).toUpperCase();

              if (
                asset === "TON" ||
                asset === "GRAM"
              ) {
                const currentPending =
                  Number(
                    summary
                      .pending_withdraw_ton
                    || 0
                  );

                const tonAmount =
                  Number(
                    withdrawal
                      .ton_amount
                    || 0
                  );

                summary.pending_withdraw_ton =
                  Math.max(
                    0,
                    currentPending -
                      tonAmount
                  );
              } else {
                const currentPending =
                  Number(
                    summary
                      .pending_withdraw_ecg
                    || 0
                  );

                const ecgAmount =
                  Number(
                    withdrawal
                      .amount
                    || 0
                  );

                summary.pending_withdraw_ecg =
                  Math.max(
                    0,
                    currentPending -
                      ecgAmount
                  );
              }


              return {
                ...current,
                summary,
                withdrawals,
              };
            }
          );

        } catch (err) {
          console.error(
            "[COMPLETE WITHDRAW ERROR]",
            err
          );


          // Session تمام شده
          if (
            err.response
              ?.status === 403
          ) {
            sessionStorage.removeItem(
              "admin_session_token"
            );

            setAdminSession("");

            setData(null);

            setOtp("");

            setError(
              err.response
                ?.data
                ?.error
              ||
              "Admin session expired. Please sign in again."
            );

            return;
          }


          setError(
            err.response
              ?.data
              ?.error
            ||
            err.response
              ?.data
              ?.detail
            ||
            "Unable to complete withdrawal."
          );

        } finally {
          setCompletingWithdrawalId(
            null
          );
        }
      },

      [adminSession]
    );


  // =========================================================
  // REFRESH
  // =========================================================

  const refreshDashboard = () => {
    // چون system-dashboard فعلاً با OTP محافظت شده،
    // برای Refresh کامل دوباره Login می‌کنیم.
    setData(null);
    setOtp("");
    setError("");
  };


  // =========================================================
  // LOGOUT
  // =========================================================

  const logoutAdmin = () => {
    sessionStorage.removeItem(
      "admin_session_token"
    );

    setAdminSession("");

    setOtp("");

    setData(null);

    setError("");
  };


  // =========================================================
  // FILTER ROWS
  // =========================================================

  const rows =
    useMemo(() => {
      const list =
        data?.[tab] || [];

      const needle =
        query
          .trim()
          .toLowerCase();

      if (!needle) {
        return list;
      }

      return list.filter(
        (item) => {
          return JSON.stringify(
            item
          )
            .toLowerCase()
            .includes(
              needle
            );
        }
      );
    }, [
      data,
      tab,
      query,
    ]);


  // =========================================================
  // LOGIN PAGE
  // =========================================================

  if (!data) {
    return (
      <main className="admin-page">

        <div className="admin-login">

          <h1>
            System Admin
          </h1>

          <p>
            Enter the current Google Authenticator code
          </p>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={otp}

            onChange={(event) => {
              setOtp(
                event.target.value
                  .replace(
                    /\D/g,
                    ""
                  )
                  .slice(
                    0,
                    6
                  )
              );
            }}

            onKeyDown={(event) => {
              if (
                event.key ===
                "Enter"
              ) {
                loadDashboard();
              }
            }}

            placeholder="Google Authenticator code"
            autoComplete="one-time-code"
          />

          <button
            type="button"
            onClick={
              loadDashboard
            }
            disabled={
              loading
            }
          >
            {loading
              ? "Loading…"
              : "Open dashboard"}
          </button>


          {error && (
            <p className="admin-error">
              {error}
            </p>
          )}

        </div>

      </main>
    );
  }


  // =========================================================
  // DATA
  // =========================================================

  const summary =
    data.summary || {};

  const treasury =
    summary.treasury || {};


  // =========================================================
  // DASHBOARD
  // =========================================================

  return (
    <main className="admin-page">

      {/* ================================================== */}
      {/* HEADER */}
      {/* ================================================== */}

      <header className="admin-head">

        <div>
          <p>
            AI POLIFY
          </p>

          <h1>
            System Dashboard
          </h1>
        </div>


        <div className="admin-head-actions">

          <button
            type="button"
            onClick={
              refreshDashboard
            }
          >
            Refresh
          </button>


          <button
            type="button"
            onClick={
              logoutAdmin
            }
          >
            Logout
          </button>

        </div>

      </header>


      {/* ================================================== */}
      {/* ERROR */}
      {/* ================================================== */}

      {error && (
        <div className="admin-error">
          {error}
        </div>
      )}

      {copiedAdminText && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(89, 196, 142, 0.22)",
            background: "rgba(39, 174, 96, 0.10)",
            color: "#9af0be",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          ✓ {copiedAdminText}
        </div>
      )}


      {/* ================================================== */}
      {/* TREASURY WARNING */}
      {/* ================================================== */}

      {treasury.low_balance && (
        <div className="treasury-alert">
          Warning: treasury TON balance is below 100 TON.
        </div>
      )}


      {/* ================================================== */}
      {/* SUMMARY */}
      {/* ================================================== */}

      <section className="summary-grid">

        <Stat
          label="Total users"
          value={number(
            summary.total_users
          )}
        />

        <Stat
          label="Active users"
          value={number(
            summary.active_users
          )}
        />

        <Stat
          label="Total purchases"
          value={number(
            summary.total_purchases
          )}
        />

        <Stat
          label="TON received"
          value={`${number(
            summary.total_ton_received
          )} TON`}
        />

        <Stat
          label="Total USD value"
          value={`$${number(
            summary.total_usd_value
          )}`}
        />


        <Stat
          label="Treasury TON"
          value={
            treasury.balance_ton ==
            null
              ? "—"
              : `${number(
                  treasury.balance_ton
                )} TON`
          }
          danger={
            treasury.low_balance
          }
        />


        <Stat
          label="Referral rewards"
          value={`${number(
            summary.total_referral_bonus
          )} ECG`}
        />

        <Stat
          label="Referral reward events"
          value={number(
            summary.referral_reward_events
          )}
        />


        <Stat
          label="Daily rewards total"
          value={`${number(
            summary.total_daily_rewards
          )} ECG`}
        />

        <Stat
          label="Daily rewards locked"
          value={`${number(
            summary.total_daily_locked
          )} ECG`}
        />

        <Stat
          label="Daily rewards unlocked"
          value={`${number(
            summary.total_daily_unlocked
          )} ECG`}
        />

        <Stat
          label="Daily claim events"
          value={number(
            summary.daily_reward_events
          )}
        />


        <Stat
          label="Downline profit"
          value={`${number(
            summary.total_downline_profit
          )} ECG`}
        />


        <Stat
          label="Self profit locked"
          value={`${number(
            summary.total_self_profit_locked
          )} ECG`}
        />

        <Stat
          label="Self profit unlocked"
          value={`${number(
            summary.total_self_profit_unlocked
          )} ECG`}
        />

        <Stat
          label="ECG profit payable"
          value={`${number(
            summary.profit_payable_ecg
          )} ECG`}
        />

        <Stat
          label="USDT profit payable"
          value={`${number(
            summary.profit_payable_usdt
          )} USDT`}
        />


        <Stat
          label="Principal locked"
          value={`${number(
            summary.total_principal_locked
          )} ECG`}
        />

        <Stat
          label="Principal unlocked"
          value={`${number(
            summary.total_principal_unlocked
          )} ECG`}
        />


        <Stat
          label="Total deposited"
          value={number(
            summary.total_deposited
          )}
        />

        <Stat
          label="Total withdrawn"
          value={number(
            summary.total_withdrawn
          )}
        />


        <Stat
          label="USDT principal locked"
          value={`${number(
            summary.usdt_principal_locked
          )} USDT`}
        />

        <Stat
          label="USDT principal unlocked"
          value={`${number(
            summary.usdt_principal_unlocked
          )} USDT`}
        />

        <Stat
          label="USDT profit locked"
          value={`${number(
            summary.usdt_profit_locked
          )} USDT`}
        />

        <Stat
          label="USDT profit unlocked"
          value={`${number(
            summary.usdt_profit_unlocked
          )} USDT`}
        />


        <Stat
          label="Pending ECG withdrawals"
          value={`${number(
            summary.pending_withdraw_ecg
          )} ECG`}
        />

        <Stat
          label="Pending TON withdrawals"
          value={`${number(
            summary.pending_withdraw_ton
          )} TON`}
        />

      </section>


      {/* ================================================== */}
      {/* TABLE */}
      {/* ================================================== */}

      <section className="admin-panel">

        <div className="admin-tools">

          <div>
            {tabs.map(
              (item) => (
                <button
                  type="button"
                  key={item}

                  className={
                    tab === item
                      ? "active"
                      : ""
                  }

                  onClick={() => {
                    setTab(item);
                    setQuery("");
                  }}
                >
                  {item}
                </button>
              )
            )}
          </div>


          <input
            value={query}

            onChange={(event) => {
              setQuery(
                event.target.value
              );
            }}

            placeholder="Search users, wallets or invoices…"
          />

        </div>


        <Table
          tab={tab}
          rows={rows}

          onCompleteWithdrawal={
            completeWithdrawal
          }

          completingWithdrawalId={
            completingWithdrawalId
          }

          onCopyValue={
            copyAdminValue
          }
        />

      </section>

    </main>
  );
}


// =========================================================
// STAT
// =========================================================

function Stat({
  label,
  value,
  danger,
}) {
  return (
    <article
      className={`stat ${
        danger
          ? "danger"
          : ""
      }`}
    >
      <span>
        {label}
      </span>

      <strong>
        {value ?? "—"}
      </strong>
    </article>
  );
}


// =========================================================
// TABLE
// =========================================================

function Table({
  tab,
  rows,
  onCompleteWithdrawal,
  completingWithdrawalId,
  onCopyValue,
}) {
  let columns = [];


  // =======================================================
  // USERS
  // =======================================================

  if (
    tab === "users"
  ) {
    columns = [
      ["username", "User"],
      ["wallet_address", "Wallet"],
      ["referral_count", "Referrals"],
      ["referral_bonus", "Referral Bonus"],

      [
        "daily_reward_total",
        "Daily Total",
      ],

      [
        "daily_reward_locked",
        "Daily Locked",
      ],

      [
        "daily_reward_unlocked",
        "Daily Unlocked",
      ],

      [
        "downline_profit",
        "Downline Profit",
      ],

      [
        "self_profit_locked",
        "Self Profit Locked",
      ],

      [
        "self_profit_unlocked",
        "Self Profit Unlocked",
      ],

      [
        "principal_locked",
        "Principal Locked",
      ],

      [
        "principal_unlocked",
        "Principal Unlocked",
      ],

      [
        "total_investment",
        "Investment",
      ],

      [
        "total_earned",
        "Earned",
      ],

      [
        "withdrawable_ecg",
        "Withdrawable ECG",
      ],

      [
        "locked_ecg",
        "Locked ECG",
      ],

      [
        "withdrawable_usdt",
        "Withdrawable USDT",
      ],

      [
        "locked_usdt",
        "Locked USDT",
      ],

      [
        "is_active",
        "Active",
      ],
    ];
  }


  // =======================================================
  // PURCHASES
  // =======================================================

  if (
    tab === "purchases"
  ) {
    columns = [
      ["invoice_no", "Invoice"],
      ["username", "User"],
      ["wallet_address", "Wallet"],
      ["ton_amount", "TON"],
      ["ton_usd_rate", "TON Rate"],
      ["usd_value", "USD Value"],
      ["ecg_value", "ECG Value"],
      ["output_amount", "Output"],
      ["output_asset", "Asset"],
      ["self_profit_5", "5% Profit"],
      ["profit_asset", "Profit Asset"],
      ["tx_hash", "TX Hash"],
      ["created_at", "Date"],
    ];
  }


  // =======================================================
  // WITHDRAWALS
  // =======================================================

  if (
    tab === "withdrawals"
  ) {
    columns = [
      ["id", "ID"],

      [
        "username",
        "User",
      ],

      [
        "wallet_address",
        "Connected Wallet",
      ],

      [
        "asset",
        "Asset",
      ],

      [
        "requested_amount",
        "Requested",
      ],

      [
        "ecg_reserved",
        "ECG Reserved",
      ],

      [
        "destination_wallet",
        "Destination Wallet",
      ],

      [
        "status",
        "Status",
      ],

      [
        "tx_hash",
        "TX Hash / Receipt",
      ],

      [
        "created_at",
        "Created",
      ],

      [
        "completed_at",
        "Completed",
      ],

      [
        "action",
        "Action",
      ],
    ];
  }


  return (
    <div className="table-wrap">

      <table>

        <thead>
          <tr>
            {columns.map(
              ([key, label]) => (
                <th key={key}>
                  {label}
                </th>
              )
            )}
          </tr>
        </thead>


        <tbody>

          {rows.map(
            (row) => (
              <tr
                key={`${tab}-${row.id}`}
              >

                {columns.map(
                  ([key]) => {


                    // ========================================
                    // WITHDRAW REQUESTED AMOUNT
                    // ========================================

                    if (
                      tab ===
                        "withdrawals"
                      &&
                      key ===
                        "requested_amount"
                    ) {
                      const asset =
                        String(
                          row.asset
                          || ""
                        ).toUpperCase();

                      const isTon =
                        asset === "TON"
                        ||
                        asset === "GRAM";

                      return (
                        <td key={key}>
                          <strong>

                            {isTon
                              ? `${number(
                                  row.ton_amount
                                )} TON`

                              : `${number(
                                  row.amount
                                )} ECG`
                            }

                          </strong>
                        </td>
                      );
                    }


                    // ========================================
                    // ECG RESERVED
                    // ========================================

                    if (
                      tab ===
                        "withdrawals"
                      &&
                      key ===
                        "ecg_reserved"
                    ) {
                      return (
                        <td key={key}>
                          {`${number(
                            row.amount
                          )} ECG`}
                        </td>
                      );
                    }


                    // ========================================
                    // STATUS
                    // ========================================

                    if (
                      tab ===
                        "withdrawals"
                      &&
                      key ===
                        "status"
                    ) {
                      const rawStatus =
                        String(
                          row.status || ""
                        ).toUpperCase();


                      let text =
                        rawStatus || "—";


                      if (
                        isCompletedStatus(
                          rawStatus
                        )
                      ) {
                        text =
                          "Complete";
                      }

                      else if (
                        rawStatus ===
                        "PENDING"
                      ) {
                        text =
                          "Pending";
                      }

                      else if (
                        rawStatus ===
                        "FAILED"
                      ) {
                        text =
                          "Failed";
                      }


                      return (
                        <td key={key}>
                          <strong>
                            {text}
                          </strong>
                        </td>
                      );
                    }


                    // ========================================
                    // ACTION
                    // ========================================

                    if (
                      tab ===
                        "withdrawals"
                      &&
                      key ===
                        "action"
                    ) {
                      const status =
                        String(
                          row.status
                          || ""
                        ).toUpperCase();

                      const pending =
                        status ===
                        "PENDING";

                      const completing =
                        completingWithdrawalId
                        === row.id;


                      return (
                        <td key={key}>

                          {pending ? (

                            <button
                              type="button"

                              onClick={() => {
                                onCompleteWithdrawal(
                                  row
                                );
                              }}

                              disabled={
                                completing
                              }
                            >

                              {completing
                                ? "Completing…"
                                : "Pending → Complete"
                              }

                            </button>

                          ) : (

                            <span>

                              {isCompletedStatus(
                                status
                              )
                                ? "Complete"
                                : "—"
                              }

                            </span>

                          )}

                        </td>
                      );
                    }


                    // ========================================
                    // DESTINATION WALLET + COPY
                    // ========================================

                    if (
                      tab === "withdrawals" &&
                      key === "destination_wallet"
                    ) {
                      const fullDestination = String(
                        row.destination_wallet || ""
                      );

                      return (
                        <td
                          key={key}
                          title={fullDestination}
                          style={{
                            minWidth: 280,
                            maxWidth: 420,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: "normal",
                                wordBreak: "break-all",
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: 12,
                                lineHeight: 1.45,
                              }}
                            >
                              {fullDestination || "—"}
                            </span>

                            {fullDestination && (
                              <button
                                type="button"
                                onClick={() =>
                                  onCopyValue(
                                    "Destination wallet",
                                    fullDestination
                                  )
                                }
                                title="Copy destination wallet"
                                style={{
                                  flexShrink: 0,
                                  minWidth: 68,
                                  height: 34,
                                  padding: "0 10px",
                                  borderRadius: 10,
                                  border:
                                    "1px solid rgba(105, 163, 255, 0.28)",
                                  background:
                                    "rgba(63, 126, 255, 0.12)",
                                  color: "#dceaff",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                ⧉ Copy
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }


                    // ========================================
                    // FULL WALLET / TX
                    // ========================================

                    if (
                      tab ===
                        "withdrawals"
                      &&
                      [
                        "wallet_address",
                        "tx_hash",
                      ].includes(
                        key
                      )
                    ) {
                      const full =
                        String(
                          row[key]
                          || ""
                        );

                      return (
                        <td
                          key={key}

                          title={
                            full
                          }

                          style={{
                            minWidth:
                              220,

                            maxWidth:
                              360,

                            whiteSpace:
                              "normal",

                            wordBreak:
                              "break-all",
                          }}
                        >
                          {full || "—"}
                        </td>
                      );
                    }


                    // ========================================
                    // NORMAL CELL
                    // ========================================

                    const value =
                      formatCell(
                        key,
                        row[key]
                      );

                    return (
                      <td key={key}>
                        {value}
                      </td>
                    );
                  }
                )}

              </tr>
            )
          )}

        </tbody>

      </table>


      {!rows.length && (
        <p className="empty">
          No records
        </p>
      )}

    </div>
  );
}


// =========================================================
// FORMAT CELL
// =========================================================

function formatCell(
  key,
  value,
) {
  if (
    key.includes(
      "wallet"
    )
    ||
    key ===
      "destination_wallet"
    ||
    key ===
      "tx_hash"
  ) {
    return short(
      String(
        value || ""
      )
    );
  }


  if (
    typeof value ===
    "boolean"
  ) {
    return value
      ? "Yes"
      : "No";
  }


  if (
    key ===
      "created_at"
    ||
    key ===
      "completed_at"
    ||
    key ===
      "last_active"
  ) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(
        value
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(
        value
      );
    }

    return date
      .toLocaleString();
  }


  return String(
    value ?? "—"
  );
}