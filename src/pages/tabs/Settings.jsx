import React, { useState } from "react";
import useStore from "../../store/useStore";
import { updateProfile, deleteAccount } from "../../services/api";

export default function Settings() {
  const { user, setUser, logout, theme, setTheme } = useStore();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const updated = await updateProfile(name);
      setUser(updated);
      setSaveMsg("Profile saved.");
    } catch (err) {
      setSaveMsg(err.response?.data?.detail || "Failed to save.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAccount();
      logout();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-6">Settings</h2>

      {/* Profile */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Profile</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
            <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5">
              {user?.email}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-xl text-sm transition"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            {saveMsg && (
              <span className="text-sm text-indigo-600 dark:text-indigo-400">{saveMsg}</span>
            )}
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Appearance</h3>
        <div className="flex gap-3">
          {["light", "dark"].map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium capitalize transition ${
                theme === t
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              }`}
            >
              {t === "light" ? "☀️ Light" : "🌙 Dark"}
            </button>
          ))}
        </div>
      </section>

      {/* Sign out */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Session</h3>
        <button
          onClick={logout}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
        >
          Sign out
        </button>
      </section>

      {/* Danger zone */}
      <section className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900 rounded-2xl p-5">
        <h3 className="font-semibold text-red-600 dark:text-red-400 mb-2">Danger Zone</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Permanently deletes your account and all data. This cannot be undone.
        </p>
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="text-sm text-red-500 hover:text-red-600 font-medium transition"
          >
            Delete Account
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Are you sure? This is permanent.</p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-xl text-sm transition disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete my account"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
