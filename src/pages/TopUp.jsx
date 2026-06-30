import React, { useState, useEffect, useRef } from "react";
import useStore from "../store/useStore";
import { stkPush, pollPayment } from "../services/api";

const PACKAGES = [
  { kes: 100, credits: 10 },
  { kes: 200, credits: 20 },
  { kes: 500, credits: 50 },
  { kes: 1000, credits: 100 },
];

export default function TopUp({ nav }) {
  const { phone, credits, setCredits } = useStore();
  const [selected, setSelected] = useState(PACKAGES[0]);
  const [step, setStep] = useState("select"); // select | waiting | success | failed
  const [checkoutId, setCheckoutId] = useState(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  function cleanup() {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
  }

  useEffect(() => () => cleanup(), []);

  async function handlePay() {
    setError("");
    try {
      const res = await stkPush(phone, selected.kes);
      setCheckoutId(res.checkout_id);
      setStep("waiting");
      setElapsed(0);

      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

      pollRef.current = setInterval(async () => {
        try {
          const status = await pollPayment(res.checkout_id);
          if (status.status === "paid") {
            cleanup();
            setCredits(status.current_balance);
            setStep("success");
          } else if (status.status === "failed") {
            cleanup();
            setStep("failed");
          }
        } catch {}
      }, 3000);

      // timeout after 90 seconds
      setTimeout(() => {
        if (pollRef.current) {
          cleanup();
          setStep("failed");
          setError("Payment timed out. Try again.");
        }
      }, 90000);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to initiate payment.");
    }
  }

  if (step === "waiting") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-indigo-900 flex items-center justify-center mx-auto mb-6 animate-pulse">
            <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Check Your Phone</h2>
          <p className="text-gray-400 text-sm mb-6">
            An M-Pesa prompt has been sent to <span className="text-white">{phone}</span>.
            Enter your PIN to pay <span className="text-white">KES {selected.kes}</span>.
          </p>
          <div className="bg-gray-900 rounded-xl px-4 py-2 inline-block text-gray-500 text-sm">
            Waiting... {elapsed}s
          </div>
          <button
            onClick={() => { cleanup(); setStep("select"); }}
            className="block mx-auto mt-4 text-gray-500 hover:text-gray-300 text-sm transition"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-900 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Payment Successful!</h2>
          <p className="text-gray-400 text-sm mb-2">
            {selected.credits} credits added to your account.
          </p>
          <p className="text-indigo-400 text-lg font-bold mb-8">Balance: {credits.toFixed(1)} credits</p>
          <button
            onClick={() => nav("dashboard")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3 rounded-xl transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <button onClick={() => nav("dashboard")} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <h2 className="text-xl font-bold text-white mb-2">Top Up Credits</h2>
      <p className="text-gray-400 text-sm mb-6">10 credits = KES 100 · Pay with M-Pesa</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {PACKAGES.map((pkg) => (
          <button
            key={pkg.kes}
            onClick={() => setSelected(pkg)}
            className={`p-4 rounded-2xl border text-left transition ${
              selected.kes === pkg.kes
                ? "border-indigo-500 bg-indigo-950"
                : "border-gray-700 bg-gray-900 hover:border-gray-500"
            }`}
          >
            <div className="text-white font-bold text-lg">KES {pkg.kes}</div>
            <div className="text-indigo-400 text-sm">{pkg.credits} credits</div>
          </button>
        ))}
      </div>

      {step === "failed" && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm mb-4">
          {error || "Payment failed or was cancelled. Try again."}
        </div>
      )}

      {error && step === "select" && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handlePay}
        className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-4 rounded-xl transition flex items-center justify-center gap-2"
      >
        <span>Pay KES {selected.kes} via M-Pesa</span>
      </button>
      <p className="text-gray-600 text-xs text-center mt-3">
        You will receive an STK push on {phone}
      </p>
    </div>
  );
}
