import React, { useEffect, useRef, useState } from "react";
import useStore from "../store/useStore";
import { completeSession, cancelSession } from "../services/api";

export default function Processing({ nav }) {
  const { videoPath, screenshotFiles, context, phone, setCredits, setResults, setOutputPath } =
    useStore();
  const session = useStore.getState()._session;

  const [phase, setPhase] = useState("parsing"); // parsing | annotating | done | error
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("");
  const [log, setLog] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const logRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!session || !videoPath || !screenshotFiles?.length) {
      nav("dashboard");
      return;
    }

    window.electron.onProgress((data) => {
      if (cancelled.current) return;
      if (data.event === "parsing_screenshots") {
        setPhase("parsing");
        setTotal(data.total);
      } else if (data.event === "parsing_progress") {
        setCurrent(data.current);
        setCurrentLabel(`Parsing ${data.name}...`);
      } else if (data.event === "parsing_done") {
        setTotal(data.segment_count);
        setCurrent(0);
        setPhase("annotating");
        setCurrentLabel("");
      } else if (data.event === "start") {
        setTotal(data.total);
        setPhase("annotating");
      } else if (data.event === "progress") {
        setCurrent(data.current);
        setCurrentLabel(data.original || "");
      } else if (data.event === "segment_done") {
        setLog((prev) => [...prev.slice(-49), data]);
      } else if (data.event === "done") {
        setPhase("done");
        setOutputPath(data.output_path);
        completeSession(session.session_token).catch(() => {});
      } else if (data.event === "error") {
        setPhase("error");
        setErrorMsg(data.message || "Unknown error");
        cancelSession(session.session_token).then((r) => {
          if (r?.credits_refunded) setCredits((c) => c + r.credits_refunded);
        }).catch(() => {});
      }
    });

    window.electron
      .runAnnotation({
        videoPath,
        screenshotFiles,
        context,
        apiKey: session.openrouter_api_key,
        model: session.openrouter_model,
      })
      .then((result) => {
        // fetch full results from output file
        import("../services/api").then(({ default: _ }) => {});
      })
      .catch((e) => {
        if (!cancelled.current) {
          setPhase("error");
          setErrorMsg(e.message);
        }
      });

    return () => {
      window.electron.removeProgressListener();
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  if (phase === "done") {
    nav("results");
    return null;
  }

  if (phase === "error") {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-900 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
          <p className="text-gray-400 text-sm mb-6">{errorMsg}</p>
          <p className="text-green-400 text-xs mb-6">Your credits have been refunded.</p>
          <button onClick={() => nav("dashboard")} className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-xl font-bold text-white mb-1">
        {phase === "parsing" ? "Parsing Screenshots" : "Annotating Segments"}
      </h2>
      <p className="text-gray-400 text-sm mb-6">
        {phase === "parsing"
          ? `Reading segment list from screenshots...`
          : `Processing segment ${current} of ${total}`}
      </p>

      {/* Progress bar */}
      <div className="bg-gray-800 rounded-full h-2 mb-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500 mb-6">
        <span>{current} / {total}</span>
        <span>{pct}%</span>
      </div>

      {currentLabel && (
        <div className="text-gray-400 text-sm mb-4 truncate">
          Current: <span className="text-white">{currentLabel}</span>
        </div>
      )}

      {/* Live log */}
      <div
        ref={logRef}
        className="bg-gray-900 border border-gray-800 rounded-2xl p-4 h-64 overflow-y-auto space-y-1"
      >
        {log.map((entry, i) => (
          <div key={i} className="flex items-start gap-3 text-xs">
            <span className="text-gray-600 shrink-0 w-8 text-right">{entry.id}</span>
            <span className={entry.changed ? "text-amber-400" : "text-green-400"}>
              {entry.changed ? "~" : "✓"}
            </span>
            <span className="text-gray-300 truncate flex-1">{entry.suggested_label}</span>
            <span className="text-gray-600 shrink-0">{entry.confidence}</span>
          </div>
        ))}
        {log.length === 0 && (
          <p className="text-gray-600 text-xs text-center pt-10">Processing will appear here...</p>
        )}
      </div>
    </div>
  );
}
