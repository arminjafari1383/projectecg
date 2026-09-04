import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../api";
import "./AdminDashboard.css";

const tabs = ["users", "purchases", "withdrawals"];

const number = (value) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

const short = (value = "") => {
  const text = String(value || "");
  return text.length > 22
    ? `${text.slice(0, 10)}…${text.slice(-8)}`
    : text;
};

const isCompletedStatus = (status) =>
  ["PAID", "SUCCESS", "COMPLETE", "COMPLETED"].includes(
    String(status || "").toUpperCase()
  );

const getErrorText = (err, fallback) =>
  err?.response?.data?.error ||
  err?.response?.data?.detail ||
  err?.message ||
  fallback;

export default function AdminDashboard() {
  const [otp, setOtp] = useState("");
  const [adminSession, setAdminSession] = useState(
    () => sessionStorage.getItem("admin_session_token") || ""
  );
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("users");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedAdminText, setCopiedAdminText] = useState("");
  const [completingWithdrawalId, setCompletingWithdrawalId] = useState(null);

  const clearAdminSession = useCallback(() => {
    sessionStorage.removeItem("admin_session_token");
    setAdminSession("");
    setData(null);
  }, []);

  const fetchDashboard = useCallback(
    async ({ sessionToken = "", otpCode = "" } = {}) => {
      const headers = {};

      if (sessionToken) {
        headers["X-Admin-Session"] = sessionToken;
      } else if (otpCode) {
        headers["X-Admin-OTP"] = otpCode;
      }

      return api.get("/admin/system-dashboard/", { headers });
    },
    []
  );

  const loadDashboard = useCallback(async () => {
    const cleanOtp = otp.trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError("Please enter the current 6-digit Google Authenticator code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const sessionResponse = await api.post(
        "/admin/session/",
        {},
        { headers: { "X-Admin-OTP": cleanOtp } }
      );

      const token = sessionResponse?.data?.admin_session || "";
      if (!token) throw new Error("Server did not return an admin session.");

      let dashboardResponse;

      // New backend: dashboard is read with the signed admin session.
      try {
        dashboardResponse = await fetchDashboard({ sessionToken: token });
      } catch (sessionErr) {
        // Backwards-compatible fallback while the old backend is still deployed.
        if (sessionErr?.response?.status !== 403) throw sessionErr;
        dashboardResponse = await fetchDashboard({ otpCode: cleanOtp });
      }

      sessionStorage.setItem("admin_session_token", token);
      setAdminSession(token);
      setData(dashboardResponse.data);
      setOtp("");
    } catch (err) {
      console.error("[ADMIN LOGIN ERROR]", err);
      clearAdminSession();
      setError(getErrorText(err, "Unable to load admin dashboard."));
    } finally {
      setLoading(false);
    }
  }, [otp, fetchDashboard, clearAdminSession]);

  const refreshDashboard = useCallback(async () => {
    if (!adminSession) {
      setData(null);
      setError("Admin session expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetchDashboard({ sessionToken: adminSession });
      setData(response.data);
    } catch (err) {
      console.error("[ADMIN REFRESH ERROR]", err);

      if (err?.response?.status === 403) {
        clearAdminSession();
        setError("Admin session expired. Please sign in again.");
      } else {
        setError(getErrorText(err, "Unable to refresh dashboard."));
      }
    } finally {
      setLoading(false);
    }
  }, [adminSession, fetchDashboard, clearAdminSession]);

  // If a valid session still exists, restore the dashboard after page reload.
  useEffect(() => {
    if (!adminSession || data) return;
    refreshDashboard();
  }, [adminSession, data, refreshDashboard]);

  const logoutAdmin = useCallback(() => {
    clearAdminSession();
    setOtp("");
    setError("");
  }, [clearAdminSession]);

  const copyAdminValue = useCallback(async (label, value) => {
    const text = String(value || "").trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedAdminText(`${label} copied`);
    } catch (copyError) {
      console.error("[ADMIN COPY ERROR]", copyError);
      setCopiedAdminText(`Could not copy ${label.toLowerCase()}`);
    }

    window.setTimeout(() => setCopiedAdminText(""), 1800);
  }, []);

  const completeWithdrawal = useCallback(
    async (withdrawal) => {
      if (!withdrawal?.id) return;

      if (!adminSession) {
        clearAdminSession();
        setError("Admin session expired. Please sign in again.");
        return;
      }

      const txHash = window.prompt(
        "Transaction hash / payment receipt:",
        withdrawal.tx_hash || ""
      );

      if (txHash === null) return;

      const cleanTxHash = txHash.trim();
      if (!cleanTxHash) {
        setError("Please enter TX Hash / payment receipt.");
        return;
      }

      setCompletingWithdrawalId(withdrawal.id);
      setError("");

      try {
        const response = await api.post(
          `/admin/withdrawals/${withdrawal.id}/complete/`,
          { tx_hash: cleanTxHash },
          { headers: { "X-Admin-Session": adminSession } }
        );

        const completed = response?.data?.withdrawal || {};

        setData((current) => {
          if (!current) return current;

          return {
            ...current,
            withdrawals: (current.withdrawals || []).map((row) =>
              row.id === withdrawal.id
                ? {
                    ...row,
                    ...completed,
                    status: completed.status || "PAID",
                    display_status: "COMPLETE",
                    tx_hash: completed.tx_hash || cleanTxHash,
                    completed_at:
                      completed.completed_at || new Date().toISOString(),
                  }
                : row
            ),
          };
        });
      } catch (err) {
        console.error("[COMPLETE WITHDRAW ERROR]", err);

        if (err?.response?.status === 403) {
          clearAdminSession();
          setError("Admin session expired. Please sign in again.");
          return;
        }

        setError(getErrorText(err, "Unable to complete withdrawal."));
      } finally {
        setCompletingWithdrawalId(null);
      }
    },
    [adminSession, clearAdminSession]
  );

  const rows = useMemo(() => {
    const list = data?.[tab] || [];
    const needle = query.trim().toLowerCase();

    if (!needle) return list;

    return list.filter((item) =>
      JSON.stringify(item).toLowerCase().includes(needle)
    );
  }, [data, tab, query]);

  if (!data) {
    return (
      <main className="admin-page">
        <div className="admin-login">
          <h1>System Admin</h1>
          <p>Enter the current Google Authenticator code</p>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={otp}
            onChange={(event) =>
              setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") loadDashboard();
            }}
            placeholder="Google Authenticator code"
            autoComplete="one-time-code"
          />

          <button type="button" onClick={loadDashboard} disabled={loading}>
            {loading ? "Loading…" : "Open dashboard"}
          </button>

          {error && <p className="admin-error">{error}</p>}
        </div>
      </main>
    );
  }

  const summary = data.summary || {};
  const treasury = summary.treasury || {};

  return (
    <main className="admin-page">
      <header className="admin-head">
        <div>
          <p>AI POLIFY</p>
          <h1>System Dashboard</h1>
        </div>

        <div className="admin-head-actions">
          <button type="button" onClick={refreshDashboard} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={logoutAdmin}>Logout</button>
        </div>
      </header>

      {error && <div className="admin-error">{error}</div>}

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

      {treasury.low_balance && (
        <div className="treasury-alert">
          Warning: treasury TON balance is below {treasury.minimum_ton || 100} TON.
        </div>
      )}

      <section className="summary-grid">
        <Stat label="Total users" value={number(summary.total_users)} />
        <Stat label="Active users" value={number(summary.active_users)} />
        <Stat label="Total purchases" value={number(summary.total_purchases)} />
        <Stat label="TON received" value={`${number(summary.total_ton_received)} TON`} />
        <Stat label="Total USD value" value={`$${number(summary.total_usd_value)}`} />

        <Stat label="EPL available" value={`${number(summary.epl_available)} EPL`} />
        <Stat label="EPL total earned" value={`${number(summary.epl_total_earned)} EPL`} />
        <Stat label="Timer EPL" value={`${number(summary.timer_epl_total)} EPL`} />
        <Stat label="Referral EPL" value={`${number(summary.referral_epl_total)} EPL`} />

        <Stat label="ECG available" value={`${number(summary.ecg_available)} ECG`} />
        <Stat label="USDT available" value={`${number(summary.usdt_available)} USDT`} />
        <Stat label="Pending withdrawals" value={number(summary.pending_withdrawals)} />

        <Stat label="ECG self locked" value={`${number(summary.ecg_self_locked)} ECG`} />
        <Stat label="ECG self unlocked" value={`${number(summary.ecg_self_unlocked)} ECG`} />
        <Stat label="ECG referral profit" value={`${number(summary.ecg_referral_profit)} ECG`} />

        <Stat label="USDT self locked" value={`${number(summary.usdt_self_locked)} USDT`} />
        <Stat label="USDT self unlocked" value={`${number(summary.usdt_self_unlocked)} USDT`} />
        <Stat label="USDT referral profit" value={`${number(summary.usdt_referral_profit)} USDT`} />

        <Stat
          label="Treasury TON"
          value={
            treasury.balance_ton == null
              ? "—"
              : `${number(treasury.balance_ton)} TON`
          }
          danger={Boolean(treasury.low_balance)}
        />
      </section>

      <section className="admin-panel">
        <div className="admin-tools">
          <div>
            {tabs.map((item) => (
              <button
                type="button"
                key={item}
                className={tab === item ? "active" : ""}
                onClick={() => {
                  setTab(item);
                  setQuery("");
                }}
              >
                {item}
              </button>
            ))}
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search users, wallets or invoices…"
          />
        </div>

        <Table
          tab={tab}
          rows={rows}
          onCompleteWithdrawal={completeWithdrawal}
          completingWithdrawalId={completingWithdrawalId}
          onCopyValue={copyAdminValue}
        />
      </section>
    </main>
  );
}

function Stat({ label, value, danger }) {
  return (
    <article className={`stat ${danger ? "danger" : ""}`}>
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </article>
  );
}

function Table({
  tab,
  rows,
  onCompleteWithdrawal,
  completingWithdrawalId,
  onCopyValue,
}) {
  let columns = [];

  if (tab === "users") {
    columns = [
      ["telegram_id", "Telegram ID"],
      ["username", "User"],
      ["wallet_address", "Wallet"],
      ["referral_count", "Referrals"],
      ["epl_balance", "EPL Balance"],
      ["epl_total_earned", "EPL Earned"],
      ["timer_reward_total", "Timer EPL"],
      ["referral_epl_total", "Referral EPL"],
      ["ecg_available", "ECG Available"],
      ["ecg_self_locked", "ECG Locked Profit"],
      ["ecg_self_unlocked", "ECG Unlocked Profit"],
      ["ecg_referral_profit", "ECG Referral"],
      ["usdt_available", "USDT Available"],
      ["usdt_self_locked", "USDT Locked Profit"],
      ["usdt_self_unlocked", "USDT Unlocked Profit"],
      ["usdt_referral_profit", "USDT Referral"],
      ["total_investment", "Investment"],
      ["total_earned", "Earned"],
      ["is_active", "Active"],
      ["last_active", "Last Active"],
    ];
  }

  if (tab === "purchases") {
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

  if (tab === "withdrawals") {
    columns = [
      ["id", "ID"],
      ["username", "User"],
      ["wallet_address", "Connected Wallet"],
      ["source_asset", "Source"],
      ["asset", "Payout Asset"],
      ["requested_amount", "Requested"],
      ["destination_wallet", "Destination Wallet"],
      ["status", "Status"],
      ["tx_hash", "TX Hash / Receipt"],
      ["created_at", "Created"],
      ["completed_at", "Completed"],
      ["action", "Action"],
    ];
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label]) => <th key={key}>{label}</th>)}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={`${tab}-${row.id}`}>
              {columns.map(([key]) => {
                if (tab === "withdrawals" && key === "requested_amount") {
                  const asset = String(row.asset || "").toUpperCase();
                  const isTon = asset === "TON" || asset === "GRAM";
                  const amount = isTon
                    ? row.ton_amount ?? row.requested_amount ?? 0
                    : row.requested_amount ?? row.amount ?? 0;
                  return (
                    <td key={key}>
                      <strong>{`${number(amount)} ${isTon ? "TON" : asset || row.source_asset || ""}`}</strong>
                    </td>
                  );
                }

                if (tab === "withdrawals" && key === "status") {
                  const status = String(row.status || "").toUpperCase();
                  const text = isCompletedStatus(status)
                    ? "Complete"
                    : status === "PENDING"
                      ? "Pending"
                      : status || "—";
                  return <td key={key}><strong>{text}</strong></td>;
                }

                if (tab === "withdrawals" && key === "action") {
                  const status = String(row.status || "").toUpperCase();
                  const pending = status === "PENDING";
                  const completing = completingWithdrawalId === row.id;

                  return (
                    <td key={key}>
                      {pending ? (
                        <button
                          type="button"
                          onClick={() => onCompleteWithdrawal(row)}
                          disabled={completing}
                        >
                          {completing ? "Completing…" : "Pending → Complete"}
                        </button>
                      ) : (
                        <span>{isCompletedStatus(status) ? "Complete" : "—"}</span>
                      )}
                    </td>
                  );
                }

                if (key === "destination_wallet") {
                  const full = String(row.destination_wallet || row.wallet || "");
                  return (
                    <td key={key} title={full} style={{ minWidth: 280, maxWidth: 420 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: "normal",
                            wordBreak: "break-all",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            fontSize: 12,
                          }}
                        >
                          {full || "—"}
                        </span>
                        {full && (
                          <button
                            type="button"
                            onClick={() => onCopyValue("Destination wallet", full)}
                          >
                            ⧉ Copy
                          </button>
                        )}
                      </div>
                    </td>
                  );
                }

                if (["wallet_address", "tx_hash"].includes(key)) {
                  const full = String(row[key] || "");
                  return (
                    <td key={key} title={full} style={{ minWidth: 180 }}>
                      {short(full) || "—"}
                    </td>
                  );
                }

                return <td key={key}>{formatCell(key, row[key])}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {!rows.length && <p className="empty">No records</p>}
    </div>
  );
}

function formatCell(key, value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (["created_at", "completed_at", "last_active"].includes(key)) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  const numericKeys = new Set([
    "epl_balance",
    "epl_total_earned",
    "timer_reward_total",
    "referral_epl_total",
    "ecg_available",
    "ecg_self_locked",
    "ecg_self_unlocked",
    "ecg_referral_profit",
    "usdt_available",
    "usdt_self_locked",
    "usdt_self_unlocked",
    "usdt_referral_profit",
    "total_investment",
    "total_earned",
    "ton_amount",
    "ton_usd_rate",
    "usd_value",
    "ecg_value",
    "output_amount",
    "self_profit_5",
  ]);

  if (numericKeys.has(key)) return number(value);
  return String(value ?? "—");
}
