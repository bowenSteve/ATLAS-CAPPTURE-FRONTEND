import React, { useState } from "react";
import useStore from "../store/useStore";
import { getMe } from "../services/api";

export default function Dashboard({ nav }) {
  const {
    phone, credits, setCredits,
    videoPath, setVideoPath,
    context, setContext,
    setScreenshotFiles,
  } = useStore();

  const [error, setError] = useState("");

  async function pickVideo() {
    const p = await window.electron.selectFile([
      { name: "Videos", extensions: ["mp4", "avi", "mov", "mkv", "webm"] },
    ]);
    if (p) {
      setVideoPath(p);
      setScreenshotFiles(null); // clear any prior captures when switching videos
    }
  }

  async function refreshCredits() {
    try {
      const user = await getMe(phone);
      setCredits(user.credits);
    } catch {}
  }

  function handleNext() {
    if (!videoPath) {
      setError("Please select a video file first.");
      return;
    }
    setError("");
    nav("capture");
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-white">Annotate Video</h2>
          <p className="text-gray-400 text-sm">{phone}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-2 text-center">
            <div className="text-xs text-gray-400">Credits</div>
            <div className="text-lg font-bold text-indigo-400">{credits.toFixed(1)}</div>
          </div>
          <button
            onClick={refreshCredits}
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition"
            title="Refresh credits"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => nav("topup")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            Top Up
          </button>
        </div>
      </div>

      {/* Credit cost info */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-6 text-sm text-gray-400 grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-white font-semibold">3 credits</div>
          <div>Short video</div>
          <div className="text-xs text-gray-600">&lt; 50 segments</div>
        </div>
        <div className="text-center border-x border-gray-800">
          <div className="text-white font-semibold">5 credits</div>
          <div>Medium video</div>
          <div className="text-xs text-gray-600">50 – 150 segments</div>
        </div>
        <div className="text-center">
          <div className="text-white font-semibold">8 credits</div>
          <div>Long video</div>
          <div className="text-xs text-gray-600">150+ segments</div>
        </div>
      </div>

      {/* File inputs */}
      <div className="space-y-4 mb-6">
        <FileCard
          label="Video File"
          value={videoPath}
          placeholder="No video selected"
          onPick={pickVideo}
        />
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Task Context <span className="text-gray-500">(optional)</span>
          </label>
          <input
            type="text"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. person cooking in a kitchen"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 rounded-xl px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      <button
        onClick={handleNext}
        disabled={!videoPath}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition"
      >
        Next — Capture Segment Screenshots →
      </button>
    </div>
  );
}

function FileCard({ label, value, placeholder, onPick }) {
  const short = value ? value.split(/[\\/]/).pop() : null;
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <button
        onClick={onPick}
        className="w-full bg-gray-900 border border-gray-700 hover:border-indigo-500 rounded-xl px-4 py-3 text-left flex items-center gap-3 transition group"
      >
        <div className="w-8 h-8 rounded-lg bg-gray-800 group-hover:bg-indigo-900 flex items-center justify-center shrink-0 transition">
          <svg className="w-4 h-4 text-gray-400 group-hover:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
        </div>
        <span className={short ? "text-white text-sm" : "text-gray-500 text-sm"}>
          {short || placeholder}
        </span>
      </button>
    </div>
  );
}
