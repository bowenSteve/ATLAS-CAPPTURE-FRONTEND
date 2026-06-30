import React, { useEffect, useState } from "react";
import { setBaseUrl, setAuthToken, getMe } from "./services/api";
import useStore from "./store/useStore";
import Auth from "./pages/Auth";
import Annotate from "./pages/tabs/Annotate";
import Dashboard from "./pages/tabs/Dashboard";
import History from "./pages/tabs/History";
import Settings from "./pages/tabs/Settings";
import Overview from "./pages/admin/Overview";
import Users from "./pages/admin/Users";
import AdminSettings from "./pages/admin/AdminSettings";

const USER_TABS = [
  { id: "annotate", label: "Annotate", icon: VideoIcon },
  { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const ADMIN_TABS = [
  { id: "admin-overview", label: "Overview", icon: ChartIcon },
  { id: "admin-users", label: "Users", icon: UsersIcon },
  { id: "admin-settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const { token, user, setUser, setBackendUrl, theme, logout } = useStore();
  const [tab, setTab] = useState("annotate");
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    window.electron.getConfig().then(async (cfg) => {
      setBackendUrl(cfg.backendUrl);
      setBaseUrl(cfg.backendUrl);
      // If we have a stored token, bootstrap the user object from the API
      if (token) {
        try {
          const u = await getMe();
          setUser(u);
        } catch {
          // Token expired or invalid — log out silently
          logout();
        }
      }
    });
  }, []);

  // Apply dark/light class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  if (!token) return <Auth />;

  const tabs = adminMode ? ADMIN_TABS : USER_TABS;
  const activeTab = adminMode
    ? tab.startsWith("admin-") ? tab : "admin-overview"
    : tab.startsWith("admin-") ? "annotate" : tab;

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Title bar */}
      <div className="h-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 select-none shrink-0 drag">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Atlas Capture Tool</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          <span>{user?.email}</span>
          <span className="font-semibold text-indigo-500">{user?.credits?.toFixed(1)} cr</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col py-3">
          <nav className="flex-1 px-2 space-y-0.5">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { setTab(t.id); if (t.id.startsWith("admin-")) setAdminMode(true); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="px-2 space-y-0.5 border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
            {user?.role === "admin" && (
              <button
                onClick={() => {
                  setAdminMode((m) => !m);
                  setTab(adminMode ? "annotate" : "admin-overview");
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                  adminMode
                    ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <ShieldIcon className="w-4 h-4 shrink-0" />
                {adminMode ? "← User View" : "Admin Panel"}
              </button>
            )}

            {/* Theme toggle */}
            <ThemeToggle />
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {!adminMode && activeTab === "annotate" && <Annotate />}
          {!adminMode && activeTab === "dashboard" && <Dashboard />}
          {!adminMode && activeTab === "history" && <History />}
          {!adminMode && activeTab === "settings" && <Settings />}
          {adminMode && activeTab === "admin-overview" && <Overview />}
          {adminMode && activeTab === "admin-users" && <Users />}
          {adminMode && activeTab === "admin-settings" && <AdminSettings />}
        </main>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useStore();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition"
    >
      {theme === "dark"
        ? <SunIcon className="w-4 h-4 shrink-0" />
        : <MoonIcon className="w-4 h-4 shrink-0" />}
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function VideoIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  );
}
function DashboardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 10h4v11H3zM10 3h4v18h-4zM17 6h4v15h-4z" />
    </svg>
  );
}
function HistoryIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function ChartIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
function UsersIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
function ShieldIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
function SunIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
function MoonIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}
