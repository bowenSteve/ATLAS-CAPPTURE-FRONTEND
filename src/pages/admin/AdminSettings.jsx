import React, { useState, useEffect } from "react";
import { adminGetSettings, adminUpdateSettings } from "../../services/api";

export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    adminGetSettings().then(setSettings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setMsg("");
    try {
      await adminUpdateSettings({
        openrouter_api_key: settings.openrouter_api_key,
        openrouter_model: settings.openrouter_model,
        frames_per_sec_basic: Number(settings.frames_per_sec_basic),
        frames_per_sec_standard: Number(settings.frames_per_sec_standard),
        frames_per_sec_premium: Number(settings.frames_per_sec_premium),
        credit_cost_basic: Number(settings.credit_cost_basic),
        credit_cost_standard: Number(settings.credit_cost_standard),
        credit_cost_premium: Number(settings.credit_cost_premium),
        credits_per_100_kes: Number(settings.credits_per_100_kes),
      });
      setMsg("Settings saved successfully.");
    } catch (err) {
      setMsg(err.response?.data?.detail || "Failed to save settings.");
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  function set(key, val) {
    setSettings((prev) => ({ ...prev, [key]: val }));
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading…</div>;
  if (!settings) return <div className="p-6 text-red-400 text-sm">Failed to load settings.</div>;

  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Admin Settings</h2>

      {/* OpenRouter */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">OpenRouter / LLM</h3>
        <div className="space-y-4">
          <Field label="API Key">
            <input
              type="password"
              value={settings.openrouter_api_key || ""}
              onChange={(e) => set("openrouter_api_key", e.target.value)}
              placeholder="sk-or-v1-…"
              className={inputClass}
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={settings.openrouter_model || ""}
              onChange={(e) => set("openrouter_model", e.target.value)}
              placeholder="google/gemini-2.0-flash-001"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Tier config */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Tier Configuration</h3>
        <p className="text-xs text-gray-400 mb-4">Frames per second = how many video frames to extract per second of footage. Higher = more accurate but more tokens.</p>
        <div className="space-y-5">
          {[
            ["Basic", "basic"],
            ["Standard", "standard"],
            ["Premium", "premium"],
          ].map(([label, key]) => (
            <div key={key}>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frames / sec">
                  <input
                    type="number"
                    step="0.05"
                    min="0.01"
                    value={settings[`frames_per_sec_${key}`]}
                    onChange={(e) => set(`frames_per_sec_${key}`, e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Credits cost">
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={settings[`credit_cost_${key}`]}
                    onChange={(e) => set(`credit_cost_${key}`, e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Credits pricing */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Credit Pricing</h3>
        <Field label="Credits per KES 100">
          <input
            type="number"
            step="1"
            min="1"
            value={settings.credits_per_100_kes}
            onChange={(e) => set("credits_per_100_kes", e.target.value)}
            className={inputClass}
          />
        </Field>
      </section>

      {msg && (
        <div className={`text-sm mb-4 ${msg.includes("Failed") ? "text-red-400" : "text-green-500"}`}>{msg}</div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl text-sm transition"
      >
        {saving ? "Saving…" : "Save All Settings"}
      </button>
    </div>
  );
}

const inputClass = "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition";

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
