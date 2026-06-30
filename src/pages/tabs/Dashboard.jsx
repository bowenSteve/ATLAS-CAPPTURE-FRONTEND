import React, { useState, useEffect } from "react";
import useStore from "../../store/useStore";
import { stkPush, pollPayment, getMe } from "../../services/api";

const PACKAGES = [
  { kes: 100, credits: 10 },
  { kes: 200, credits: 20 },
  { kes: 500, credits: 50 },
  { kes: 1000, credits: 100 },
];

export default function Dashboard() {
  const { user, setUser, setCredits } = useStore();
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [selectedKes, setSelectedKes] = useState(100);
  const [topupState, setTopupState] = useState("idle"); // idle | sending | waiting | success | failed
  const [checkoutId, setCheckoutId] = useState("");
  const [pollTimer, setPollTimer] = useState(null);
  const [error, setError] = useState("");

  async function refreshUser() {
    try {
      const u = await getMe();
      setUser(u);
    } catch {}
  }

  async function handleTopUp() {
    if (!mpesaPhone.trim()) { setError("Enter your Mpesa phone number"); return; }
    setError("");
    setTopupState("sending");
    try {
      const result = await stkPush(mpesaPhone, selectedKes);
      setCheckoutId(result.checkout_id);
      setTopupState("waiting");
      startPolling(result.checkout_id);
    } catch (err) {
      setTopupState("idle");
      setError(err.response?.data?.detail || err.message);
    }
  }

  function startPolling(cid) {
    const timer = setInterval(async () => {
      try {
        const status = await pollPayment(cid);
        if (status.status === "paid") {
          clearInterval(timer);
          setTopupState("success");
          setCredits(status.current_balance);
        } else if (status.status === "failed") {
          clearInterval(timer);
          setTopupState("failed");
        }
      } catch {}
    }, 3000);
    setPollTimer(timer);
  }

  useEffect(() => () => { if (pollTimer) clearInterval(pollTimer); }, [pollTimer]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Dashboard</h2>
        <button onClick={refreshUser} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Credit balance */}
      <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-6 mb-6 text-white">
        <div className="text-sm font-medium opacity-80 mb-1">Credit Balance</div>
        <div className="text-4xl font-bold mb-1">{user?.credits?.toFixed(1)}</div>
        <div className="text-sm opacity-70">≈ KES {((user?.credits || 0) * 10).toFixed(0)} value</div>
      </div>

      {/* Tier overview */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Basic", credits: 3, desc: "~10 fps" },
          { label: "Standard", credits: 5, desc: "~5 fps" },
          { label: "Premium", credits: 8, desc: "~2 fps" },
        ].map((t) => (
          <div key={t.label} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-center">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t.label}</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white">{t.credits}</div>
            <div className="text-xs text-gray-400">credits</div>
          </div>
        ))}
      </div>

      {/* Top up */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Top Up via Mpesa</h3>

        <div className="grid grid-cols-4 gap-2 mb-4">
          {PACKAGES.map((pkg) => (
            <button
              key={pkg.kes}
              onClick={() => setSelectedKes(pkg.kes)}
              className={`rounded-xl p-2.5 border-2 text-center transition ${
                selectedKes === pkg.kes
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <div className="text-sm font-bold text-gray-900 dark:text-white">KES {pkg.kes}</div>
              <div className="text-xs text-indigo-600 dark:text-indigo-400">{pkg.credits} credits</div>
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Mpesa Phone Number
          </label>
          <input
            type="tel"
            value={mpesaPhone}
            onChange={(e) => setMpesaPhone(e.target.value)}
            placeholder="e.g. 0712345678"
            disabled={topupState !== "idle"}
            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="text-sm text-red-500 mb-3">{error}</div>
        )}

        {topupState === "idle" && (
          <button
            onClick={handleTopUp}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl text-sm transition"
          >
            Send KES {selectedKes} Prompt
          </button>
        )}

        {topupState === "sending" && (
          <div className="text-center py-3 text-sm text-gray-400">Sending prompt…</div>
        )}

        {topupState === "waiting" && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-1">Check your phone</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Enter your Mpesa PIN to complete payment. Waiting for confirmation…</div>
            <div className="flex justify-center mt-3">
              <svg className="w-5 h-5 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          </div>
        )}

        {topupState === "success" && (
          <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 text-center">
            <div className="text-sm font-medium text-indigo-900 dark:text-indigo-100 mb-1">Payment successful!</div>
            <div className="text-xs text-indigo-600 dark:text-indigo-400">
              {PACKAGES.find((p) => p.kes === selectedKes)?.credits} credits added to your account.
            </div>
            <button
              onClick={() => { setTopupState("idle"); setError(""); }}
              className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Top up again
            </button>
          </div>
        )}

        {topupState === "failed" && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
            <div className="text-sm text-slate-700 dark:text-slate-300 mb-2">Payment failed or was cancelled.</div>
            <button
              onClick={() => { setTopupState("idle"); setError(""); }}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
