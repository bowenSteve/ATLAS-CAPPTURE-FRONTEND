import { useState, useEffect } from "react";
import { adminOverview, adminOpenRouterBalance } from "../../services/api";

function KPI({ label, value, sub, highlight }) {
  return (
    <div className={`border rounded-2xl p-4 ${highlight ? "bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"}`}>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${highlight ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BalanceBar({ usage, limit }) {
  if (limit == null) return null;
  const pct = Math.min(100, (usage / limit) * 100);
  return (
    <div className="mt-2">
      <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
        <div
          className="h-1.5 rounded-full bg-indigo-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>${usage.toFixed(4)} used</span>
        <span>${limit.toFixed(2)} limit</span>
      </div>
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function fetchData(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      adminOverview().catch(() => null),
      adminOpenRouterBalance().catch(() => null),
    ]).then(([overview, bal]) => {
      setData(overview);
      setBalance(bal);
    }).finally(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }

  useEffect(() => { fetchData(); }, []);

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading…</div>;
  if (!data) return <div className="p-6 text-red-400 text-sm">Failed to load overview.</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Overview</h2>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition disabled:opacity-50"
        >
          <svg className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* OpenRouter Balance Banner */}
      {balance && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 mb-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">OpenRouter Balance</span>
            {balance.is_free_tier && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">Free tier</span>
            )}
          </div>
          <div className="flex items-end gap-6 mt-1">
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {balance.remaining != null ? `$${balance.remaining.toFixed(4)}` : "Pay-as-you-go"}
              </div>
              <div className="text-xs text-gray-400">remaining</div>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 pb-1">
              <span className="text-indigo-600 dark:text-indigo-400 font-semibold">${balance.usage.toFixed(4)}</span> spent total
              {data.total_cost_usd > 0 && (
                <span className="ml-2 text-gray-400">· <span className="font-medium">${data.total_cost_usd.toFixed(4)}</span> via this app</span>
              )}
            </div>
          </div>
          <BalanceBar usage={balance.usage} limit={balance.limit} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <KPI label="Total Users" value={data.total_users} />
        <KPI label="Active (7 days)" value={data.active_7d} />
        <KPI label="Total Annotations" value={data.total_annotations} sub={`${data.annotations_30d} this month`} />
        <KPI label="Revenue (KES)" value={(data.total_revenue_kes || 0).toLocaleString()} />
        <KPI label="Done Annotations" value={data.done_annotations} />
        <KPI label="Total Tokens" value={(data.total_tokens || 0).toLocaleString()} />
        <KPI label="Credits Used" value={(data.total_credits_used || 0).toFixed(1)} />
        <KPI
          label="API Cost (USD)"
          value={`$${(data.total_cost_usd || 0).toFixed(4)}`}
          highlight={data.total_cost_usd > 0}
          sub={data.done_annotations > 0 ? `$${(data.total_cost_usd / data.done_annotations).toFixed(4)} / job` : undefined}
        />
      </div>

      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Recent Annotations</h3>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-gray-100 dark:border-gray-800">
            <tr className="text-gray-400">
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Video</th>
              <th className="text-left px-4 py-3 font-medium">Tier</th>
              <th className="text-left px-4 py-3 font-medium">Tokens</th>
              <th className="text-left px-4 py-3 font-medium">Cost</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_annotations.map((a) => (
              <tr key={a.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{a.user_email}</td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 truncate max-w-[120px]">{a.video_name}</td>
                <td className="px-4 py-2.5">
                  <span className="text-indigo-600 dark:text-indigo-400 capitalize">{a.tier}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{a.tokens_used?.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-indigo-600 dark:text-indigo-400 font-medium">
                  {a.cost_usd > 0 ? `$${a.cost_usd.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span className={a.status === "done" ? "text-slate-700 dark:text-slate-300" : a.status === "failed" ? "text-red-400" : "text-slate-400"}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-400">
                  {new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
