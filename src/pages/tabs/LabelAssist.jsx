import { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { restructureLabel } from "../../services/api";

const CONTEXT_KEY_PREFIX = "atlas_chat_context:";

export default function LabelAssist() {
  const { videoName, user, setCredits } = useStore();
  const [videoKey, setVideoKey] = useState(videoName || "");
  const [context, setContextState] = useState("");
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState([]); // session-only: [{ id, label, warnings }]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  // Load persisted context whenever the video identifier changes
  useEffect(() => {
    const key = videoKey.trim();
    setContextState(key ? localStorage.getItem(CONTEXT_KEY_PREFIX + key) || "" : "");
  }, [videoKey]);

  function updateContext(value) {
    setContextState(value);
    const key = videoKey.trim();
    if (key) localStorage.setItem(CONTEXT_KEY_PREFIX + key, value);
  }

  function clearSavedContext() {
    const key = videoKey.trim();
    if (key) localStorage.removeItem(CONTEXT_KEY_PREFIX + key);
    setContextState("");
  }

  async function handleRestructure() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await restructureLabel(context, description, videoKey);
      setHistory((prev) => [{ id: Date.now(), label: res.label, warnings: res.warnings || [] }, ...prev]);
      setCredits(res.credits_remaining);
      setDescription(""); // ready for the next segment
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }

  function copyLabel(entry) {
    navigator.clipboard.writeText(entry.label).then(() => {
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  const insufficientCredits = user && user.credits < 0.1;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Label Assist</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Describe a segment in plain language and get back a properly formatted Atlas Capture label.
      </p>

      {/* Video identifier */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Video / session name
        </label>
        <input
          type="text"
          value={videoKey}
          onChange={(e) => setVideoKey(e.target.value)}
          placeholder="e.g. kitchen_003"
          className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition"
        />
        <p className="text-xs text-gray-400 mt-1.5">
          Context below is saved per video name, so you don't have to retype it for every segment.
        </p>
      </div>

      {/* Context */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Context <span className="text-xs font-normal text-gray-400">(optional)</span>
          </label>
          {context && (
            <button onClick={clearSavedContext} className="text-xs text-red-500 hover:underline">
              Clear saved context
            </button>
          )}
        </div>
        <textarea
          value={context}
          onChange={(e) => updateContext(e.target.value)}
          placeholder="e.g. person cooking in a kitchen"
          rows={2}
          className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition resize-none"
        />
      </div>

      {/* Segment description */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Segment description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. picks up a knife with the right hand and starts cutting an onion on the board"
          rows={3}
          className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition resize-none"
        />
      </div>

      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-4 text-sm">
        <span className="text-gray-500 dark:text-gray-400">Cost</span>
        <span className="font-semibold text-gray-900 dark:text-white">0.1 credits</span>
      </div>
      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-6 text-sm">
        <span className="text-gray-500 dark:text-gray-400">Your balance</span>
        <span className={`font-semibold ${!insufficientCredits ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
          {user?.credits?.toFixed(1)} credits
        </span>
      </div>

      <button
        onClick={handleRestructure}
        disabled={!description.trim() || loading || insufficientCredits}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl text-sm transition"
      >
        {loading ? "Restructuring…" :
         insufficientCredits ? "Insufficient credits — top up in Dashboard" :
         "Restructure"}
      </button>

      {error && (
        <p className="text-sm text-red-500 mt-3">{error}</p>
      )}

      {history.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">{history.length} label{history.length !== 1 ? "s" : ""} this session</p>
            <button onClick={() => setHistory([])} className="text-xs text-red-500 hover:underline">
              Clear list
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {history.map((entry) => (
              <div key={entry.id}>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 flex gap-3 items-center group">
                  <div className="text-sm text-gray-900 dark:text-white flex-1">{entry.label}</div>
                  <button
                    onClick={() => copyLabel(entry)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                    title="Copy label"
                  >
                    {copiedId === entry.id ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                {entry.warnings.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {entry.warnings.map((w, i) => (
                      <div key={i} className="flex gap-2 items-start bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        <span className="shrink-0 mt-0.5">⚠</span>
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
