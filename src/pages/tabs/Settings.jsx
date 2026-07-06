import React, { useState, useEffect } from "react";
import useStore from "../../store/useStore";
import { updateProfile, deleteAccount } from "../../services/api";

export default function Settings() {
  const { user, setUser, logout, theme, setTheme } = useStore();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState(null); // null | checking | not-available | available | downloading | downloaded | error | dev-mode
  const [updateInfo, setUpdateInfo] = useState({});

  useEffect(() => {
    window.electron.getAppVersion().then(setAppVersion);
    window.electron.onUpdateStatus((data) => {
      setUpdateStatus(data.type);
      setUpdateInfo(data);
    });
    return () => window.electron.removeUpdateListener();
  }, []);

  function handleCheckForUpdates() {
    setUpdateStatus("checking");
    setUpdateInfo({});
    window.electron.checkForUpdates();
  }

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

      {/* Updates */}
      <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Updates</h3>
            {appVersion && (
              <p className="text-xs text-gray-400 mt-0.5">Current version: v{appVersion}</p>
            )}
          </div>
          {(!updateStatus || updateStatus === "not-available" || updateStatus === "error" || updateStatus === "dev-mode") && (
            <button
              onClick={handleCheckForUpdates}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-sm transition"
            >
              Check for Updates
            </button>
          )}
        </div>

        {updateStatus === "checking" && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <svg className="w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Checking for updates…
          </div>
        )}

        {updateStatus === "not-available" && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            You're on the latest version.
          </div>
        )}

        {updateStatus === "available" && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Version {updateInfo.version} is available
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Download and install to update.</p>
            </div>
            <button
              onClick={() => { setUpdateStatus("downloading"); window.electron.downloadUpdate(); }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-sm transition"
            >
              Download & Install
            </button>
          </div>
        )}

        {updateStatus === "downloading" && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              <span>Downloading update…</span>
              <span>{updateInfo.percent ?? 0}%</span>
            </div>
            <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${updateInfo.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {updateStatus === "downloaded" && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Version {updateInfo.version} ready to install
              </p>
              <p className="text-xs text-gray-400 mt-0.5">The app will restart to apply the update.</p>
            </div>
            <button
              onClick={() => window.electron.installUpdate()}
              className="bg-green-600 hover:bg-green-500 text-white font-medium px-4 py-2 rounded-xl text-sm transition"
            >
              Restart & Update
            </button>
          </div>
        )}

        {updateStatus === "error" && (
          <div>
            <p className="text-sm text-red-500 mb-2">{updateInfo.message || "Update check failed."}</p>
          </div>
        )}

        {updateStatus === "dev-mode" && (
          <p className="text-sm text-gray-400">Updates are not available in development mode.</p>
        )}
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
