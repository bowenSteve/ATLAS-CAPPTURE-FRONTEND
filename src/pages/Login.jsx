import React, { useState } from "react";
import { register } from "../services/api";
import useStore from "../store/useStore";

export default function Login({ nav }) {
  const { setPhone, setCredits } = useStore();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const user = await register(trimmed);
      setPhone(user.phone);
      setCredits(user.credits);
      nav("dashboard");
    } catch (e) {
      setError(e.response?.data?.detail || "Could not connect to server. Check your internet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gray-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Atlas Capture</h1>
          <p className="text-gray-400 text-sm mt-1">Video Annotation Tool</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            placeholder="e.g. 0712345678"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading || !input.trim()}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Connecting..." : "Continue"}
          </button>
          <p className="text-gray-500 text-xs text-center mt-4">
            Your phone number is your account identity.
          </p>
        </div>
      </div>
    </div>
  );
}
