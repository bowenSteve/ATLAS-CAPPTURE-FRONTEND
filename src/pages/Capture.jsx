import React, { useState } from "react";
import useStore from "../store/useStore";
import { startSession } from "../services/api";

export default function Capture({ nav }) {
  const { videoPath, phone, setCredits, setScreenshotFiles } = useStore();
  const [captures, setCaptures] = useState([]);
  const [capturing, setCapturing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function takeScreenshot() {
    setCapturing(true);
    setError("");
    try {
      const result = await window.electron.captureScreen(videoPath);
      setCaptures((prev) => [...prev, result]);
    } catch (e) {
      setError(`Screen capture failed: ${e.message}`);
    } finally {
      setCapturing(false);
    }
  }

  async function removeCapture(index) {
    const cap = captures[index];
    await window.electron.deleteCapture(cap.path);
    setCaptures((prev) => prev.filter((_, i) => i !== index));
  }

  async function clearAll() {
    await window.electron.clearCaptures(videoPath);
    setCaptures([]);
  }

  async function handleStart() {
    if (!captures.length) {
      setError("Take at least one screenshot first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const session = await startSession(phone, 100);
      setCredits(session.credits_remaining);
      setScreenshotFiles(captures.map((c) => c.path));
      useStore.setState({ _session: session });
      nav("processing");
    } catch (e) {
      const msg = e.response?.data?.detail || e.message;
      setError(e.response?.status === 402 ? msg + " — top up your credits." : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <button
        onClick={() => nav("dashboard")}
        className="text-gray-400 hover:text-white text-sm mb-6 flex items-center gap-1 transition"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <h2 className="text-xl font-bold text-white mb-2">Capture Segment Screenshots</h2>
      <p className="text-gray-400 text-sm mb-1">
        Open <span className="text-white font-medium">Atlas Capture</span> and navigate to the segment list panel.
        Click <span className="text-white font-medium">Take Screenshot</span> — this app will minimize,
        capture the screen, then restore. Scroll and repeat for each page of segments.
      </p>
      <p className="text-gray-500 text-xs mb-6">
        Screenshots are saved next to your video automatically.
      </p>

      {/* Video info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 mb-5 text-sm text-gray-400 flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
        </svg>
        <span className="text-white truncate">{videoPath?.split(/[\\/]/).pop()}</span>
      </div>

      {/* Take screenshot */}
      <button
        onClick={takeScreenshot}
        disabled={capturing}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition mb-5 flex items-center justify-center gap-2"
      >
        {capturing ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Capturing screen...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Take Screenshot
          </>
        )}
      </button>

      {/* Gallery */}
      {captures.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-300">
              {captures.length} screenshot{captures.length !== 1 ? "s" : ""} captured
            </span>
            <button
              onClick={clearAll}
              className="text-xs text-red-400 hover:text-red-300 transition"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {captures.map((cap, i) => (
              <div key={i} className="relative group rounded-lg overflow-hidden border border-gray-700">
                <img
                  src={cap.preview}
                  alt={`Screenshot ${i + 1}`}
                  className="w-full aspect-video object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition" />
                <button
                  onClick={() => removeCapture(i)}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-600 hover:bg-red-500 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center transition"
                >
                  ×
                </button>
                <span className="absolute bottom-1 left-1 text-xs text-white bg-black/60 rounded px-1">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {captures.length > 0 && (
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition"
        >
          {loading
            ? "Starting..."
            : `Start Annotation (${captures.length} screenshot${captures.length !== 1 ? "s" : ""})`}
        </button>
      )}
    </div>
  );
}
