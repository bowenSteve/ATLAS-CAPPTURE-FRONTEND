import React, { useState, useEffect, useCallback } from "react";
import { listAnnotations } from "../../services/api";

const TIER_COLOR = {
  basic: "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800",
  standard: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950",
  premium: "text-white bg-slate-800 dark:text-slate-900 dark:bg-slate-200",
};

const STATUS_COLOR = {
  done: "text-slate-700 dark:text-slate-300",
  processing: "text-slate-400",
  failed: "text-red-500",
};

export default function History() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAnnotations(page * limit, limit);
      setItems(result.items);
      setTotal(result.total);
    } catch {}
    setLoading(false);
  }, [page]);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString("en-KE", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      timeZone: "Africa/Nairobi",
    });
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">History</h2>
          {total > 0 && <p className="text-xs text-gray-400 mt-0.5">{total} annotation{total !== 1 ? "s" : ""}</p>}
        </div>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">No annotations yet. Annotate a video to see history here.</div>
      ) : (
        <div className="space-y-3">
          {items.map((ann) => (
              <div key={ann.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
                {/* Row header */}
                <button
                  onClick={() => toggle(ann.id)}
                  className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  {/* Video name + tier */}
                  <div className="flex items-center gap-2 min-w-0 w-72 shrink-0">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {ann.video_name || "Unknown video"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TIER_COLOR[ann.tier] || "text-gray-500"}`}>
                      {ann.tier}
                    </span>
                  </div>

                  {/* Status */}
                  <span className={`text-xs font-medium w-20 shrink-0 ${STATUS_COLOR[ann.status]}`}>{ann.status}</span>

                  {/* Stats row */}
                  <div className="flex items-center gap-5 text-xs text-gray-400 flex-1 min-w-0">
                    <span className="shrink-0"><span className="font-medium text-gray-600 dark:text-gray-300">{ann.segment_count}</span> segments</span>
                    <span className="shrink-0"><span className="font-medium text-gray-600 dark:text-gray-300">{ann.credits_used}</span> credits</span>
                  </div>

                  {/* Date */}
                  <span className="text-xs text-gray-400 shrink-0">{formatDate(ann.created_at)}</span>

                  <svg
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded === ann.id ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded segments — two column grid */}
                {expanded === ann.id && ann.output_json?.segments && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1.5">
                      {ann.output_json.segments.map((seg) => (
                        <div key={seg.id} className="flex gap-3 text-xs min-w-0">
                          <span className="text-indigo-400 font-mono shrink-0 w-14">{seg.start}</span>
                          <span className="text-gray-400 font-mono shrink-0">→</span>
                          <span className="text-gray-400 font-mono shrink-0 w-14">{seg.end}</span>
                          <span className="text-gray-700 dark:text-gray-300 flex-1 min-w-0">{seg.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {expanded === ann.id && ann.status === "failed" && (
                  <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 text-xs text-red-400">
                    Annotation failed — credits were refunded.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-400">
            {page + 1} / {Math.ceil(total / limit)}
          </span>
          <button
            disabled={(page + 1) * limit >= total}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 transition"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
