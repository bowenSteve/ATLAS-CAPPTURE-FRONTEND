import { useState, useRef } from "react";
import useStore from "../../store/useStore";
import { startAnnotation, completeAnnotation, failAnnotation } from "../../services/api";

const TIERS = [
  {
    id: "basic",
    label: "Basic",
    credits: 1,
    fps: 1.0,
    desc: "Good accuracy",
  },
  {
    id: "standard",
    label: "Standard",
    credits: 2,
    fps: 2.0,
    desc: "High accuracy",
  },
  {
    id: "premium",
    label: "Premium",
    credits: 3,
    fps: 4.0,
    desc: "Highest accuracy",
  },
];

export default function Annotate() {
  const { videoPath, videoName, tier, context, setVideoPath, setTier, setContext, user, setCredits, setLastResult } = useStore();
  const [phase, setPhase] = useState("idle"); // idle | extracting | annotating | done | error
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [llmProgress, setLlmProgress] = useState({ done: 0, total: 1 });
  const [streamChars, setStreamChars] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [partialSegments, setPartialSegments] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const annotationIdRef = useRef(null);
  const errorHandledRef = useRef(false);

  function copySegment(seg) {
    navigator.clipboard.writeText(seg.label).then(() => {
      setCopiedId(seg.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  async function pickVideo() {
    const p = await window.electron.selectFile([
      { name: "Videos", extensions: ["mp4", "avi", "mov", "mkv", "webm", "MP4"] },
    ]);
    if (p) setVideoPath(p);
  }

  async function pickScreenshots() {
    const paths = await window.electron.selectFiles([
      { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] },
    ]);
    if (paths.length > 0) setScreenshots((prev) => [...new Set([...prev, ...paths])]);
  }

  function removeScreenshot(path) {
    setScreenshots((prev) => prev.filter((p) => p !== path));
  }

  async function handleAnnotate() {
    if (!videoPath) return;
    setPhase("extracting");
    setProgress({ current: 0, total: 0 });
    setErrorMsg("");
    setResult(null);
    setWarnings([]);

    let sessionData;
    try {
      sessionData = await startAnnotation(videoName, tier, context);
      setCredits(sessionData.credits_remaining);
      annotationIdRef.current = sessionData.annotation_id;
    } catch (err) {
      setPhase("error");
      setErrorMsg(err.response?.data?.detail || err.message);
      return;
    }

    errorHandledRef.current = false;

    window.electron.onProgress((data) => {
      if (data.event === "extracting") {
        setPhase("extracting");
        setProgress({ current: 0, total: data.total });
      } else if (data.event === "extracting_progress") {
        setProgress({ current: data.current, total: data.total });
      } else if (data.event === "annotating") {
        setPhase("annotating");
        setProgress({ current: 0, total: data.frame_count });
        setLlmProgress({ done: 0, total: data.chunks_total || 1 });
      } else if (data.event === "annotating_progress") {
        setLlmProgress({ done: data.chunks_done, total: data.chunks_total });
      } else if (data.event === "stream_chars") {
        setStreamChars(data.chars);
      } else if (data.event === "partial_segments") {
        setPartialSegments(data.segments || []);
      } else if (data.event === "warning") {
        console.warn("[Extraction warning]", data.message);
        setWarnings(prev => [...prev, data.message]);
      } else if (data.event === "log") {
        console.log("[Python stderr]", data.message);
      } else if (data.event === "error") {
        errorHandledRef.current = true;
        setPhase("error");
        setErrorMsg(data.message);
      }
    });

    try {
      const done = await window.electron.runAnnotation({
        videoPath,
        tier,
        framesPerSec: sessionData.frames_per_sec,
        context,
        apiKey: sessionData.openrouter_api_key,
        model: sessionData.openrouter_model,
        apiUrl: sessionData.openrouter_base_url,
        annotationId: sessionData.annotation_id,
        screenshotPaths: screenshots,
      });

      await completeAnnotation(sessionData.annotation_id, done.segments, done.tokens_used, done.cost_usd || 0);

      const resultData = {
        segments: done.segments,
        tokens_used: done.tokens_used,
        cost_usd: done.cost_usd || 0,
        duration: done.duration,
        video_name: videoName,
        tier,
      };
      setResult(resultData);
      setLastResult(resultData);
      setPhase("done");
    } catch (err) {
      if (!errorHandledRef.current) {
        // Strip Electron's IPC wrapper prefix to show the real Python error
        const msg = err.message.replace(/^Error invoking remote method '[^']+': /, "");
        setPhase("error");
        setErrorMsg(msg);
      }
      if (annotationIdRef.current) {
        failAnnotation(annotationIdRef.current, errorHandledRef.current ? errorMsg : msg).then((r) => {
          if (r?.credits_refunded) setCredits((c) => c + r.credits_refunded);
        }).catch(() => {});
      }
    } finally {
      window.electron.removeProgressListener();
    }
  }

  function reset() {
    setPhase("idle");
    setResult(null);
    setErrorMsg("");
    setProgress({ current: 0, total: 0 });
    setLlmProgress({ done: 0, total: 1 });
    setStreamChars(0);
    setPartialSegments([]);
    setScreenshots([]);
  }

  const selectedTier = TIERS.find((t) => t.id === tier);
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const streamPct = progress.total > 0 ? Math.min(95, Math.round((streamChars / (progress.total * 2)) * 100)) : 0;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Annotate Video</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Select a video and tier to generate egocentric action labels.
      </p>

      {phase === "idle" && (
        <>
          {/* Video picker */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Video File</label>
            {videoName ? (
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 flex items-center gap-3">
                <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                <span className="text-sm font-medium text-gray-900 dark:text-white flex-1 truncate">{videoName}</span>
                <button
                  onClick={() => setVideoPath(null)}
                  className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-red-100 dark:hover:bg-red-900 flex items-center justify-center transition shrink-0"
                  title="Remove video"
                >
                  <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={pickVideo}
                className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-2xl px-5 py-6 flex flex-col items-center gap-2 transition group"
              >
                <svg className="w-8 h-8 text-gray-400 group-hover:text-indigo-500 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                <span className="text-sm text-gray-400">Click to select a video file</span>
              </button>
            )}
          </div>

          {/* Screenshot reference images */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Reference Screenshots
                <span className="ml-1.5 text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <button
                onClick={pickScreenshots}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add images
              </button>
            </div>

            {screenshots.length === 0 ? (
              <button
                onClick={pickScreenshots}
                className="w-full bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl px-4 py-4 flex items-center gap-3 transition group"
              >
                <svg className="w-5 h-5 text-gray-400 group-hover:text-indigo-500 transition shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-gray-400">Attach screenshots that mark segment boundaries</span>
              </button>
            ) : (
              <div className="space-y-1.5">
                {screenshots.map((p) => (
                  <div key={p} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 flex items-center gap-2">
                    <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{p.split(/[\\/]/).pop()}</span>
                    <button onClick={() => removeScreenshot(p)} className="w-5 h-5 rounded-full hover:bg-red-100 dark:hover:bg-red-900 flex items-center justify-center transition shrink-0">
                      <svg className="w-3 h-3 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button onClick={pickScreenshots} className="text-xs text-indigo-500 hover:underline mt-1">+ Add more</button>
              </div>
            )}
          </div>

          {/* Tier selector */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Accuracy Tier</label>
            <div className="grid grid-cols-3 gap-3">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTier(t.id)}
                  className={`rounded-xl border-2 p-3 text-left transition ${
                    tier === t.id
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{t.label}</div>
                  <div className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-0.5">{t.credits} credits</div>
                  <div className="text-xs text-gray-400 mt-1 leading-tight">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Context */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Context
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. person cooking in a kitchen"
              className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-4 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Cost</span>
            <span className="font-semibold text-gray-900 dark:text-white">{selectedTier?.credits} credits</span>
          </div>
          <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-6 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Your balance</span>
            <span className={`font-semibold ${user?.credits >= selectedTier?.credits ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {user?.credits?.toFixed(1)} credits
            </span>
          </div>

          <button
            onClick={handleAnnotate}
            disabled={!videoPath || !user || user.credits < selectedTier?.credits}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl text-sm transition"
          >
            {!videoPath ? "Select a video first" :
             user?.credits < selectedTier?.credits ? "Insufficient credits — top up in Dashboard" :
             "Start Annotation"}
          </button>
        </>
      )}

      {(phase === "extracting" || phase === "annotating") && (
        <div className="py-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {phase === "extracting" ? "Extracting Frames" : "Processing"}
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              {phase === "extracting"
                ? `Frame ${progress.current} of ${progress.total}`
                : llmProgress.total > 1
                  ? `Segment ${llmProgress.done} of ${llmProgress.total} labeled`
                  : "Extracting segment timestamps…"}
            </p>
          </div>

          {phase === "extracting" && progress.total > 0 && (
            <>
              <div className="bg-gray-200 dark:bg-gray-800 rounded-full h-2 mb-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{progress.current} / {progress.total} frames</span>
                <span>{pct}%</span>
              </div>
            </>
          )}

          {phase === "annotating" && (
            <>
              <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2 overflow-hidden">
                {llmProgress.total > 1 ? (
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((llmProgress.done / llmProgress.total) * 100)}%` }}
                  />
                ) : (
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(4, streamPct)}%` }}
                  />
                )}
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                {llmProgress.total > 1 ? (
                  <>
                    <span>{llmProgress.done} of {llmProgress.total} segments labeled</span>
                    <span>{Math.round((llmProgress.done / llmProgress.total) * 100)}%</span>
                  </>
                ) : (
                  <>
                    <span>Processing your video...</span>
                    <span>{streamPct}%</span>
                  </>
                )}
              </div>

              {partialSegments.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs text-gray-400 mb-2">{partialSegments.length} segments labeled so far…</p>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {partialSegments.map((seg) => (
                      <div key={seg.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 flex gap-3 opacity-80">
                        <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0 w-16">{seg.start}</div>
                        <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0">→ {seg.end}</div>
                        <div className="text-sm text-gray-700 dark:text-gray-300 flex-1">{seg.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Annotation Failed</h3>
          <p className="text-sm text-red-500 mb-1">{errorMsg}</p>
          <p className="text-xs text-gray-400 mb-6">Credits have been refunded.</p>
          <button onClick={reset} className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium px-6 py-2.5 rounded-xl text-sm transition">
            Try Again
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div>
          <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-indigo-900 dark:text-indigo-100 text-sm">Annotation Complete</div>
                <div className="text-xs text-indigo-600 dark:text-indigo-400">
                  {result.segment_count || result.segments?.length} segments · {result.duration}s video
                </div>
              </div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex gap-2 items-start bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <span className="shrink-0 mt-0.5">⚠</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1 mb-5">
            {result.segments?.map((seg) => (
              <div key={seg.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 flex gap-3 group">
                <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0 w-16">{seg.start}</div>
                <div className="text-xs text-gray-400 font-mono mt-0.5 shrink-0">→ {seg.end}</div>
                <div className="text-sm text-gray-900 dark:text-white flex-1">{seg.label}</div>
                <button
                  onClick={() => copySegment(seg)}
                  className="opacity-0 group-hover:opacity-100 transition shrink-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="Copy label"
                >
                  {copiedId === seg.id ? (
                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>

          <button onClick={reset} className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium py-3 rounded-xl text-sm transition">
            Annotate Another Video
          </button>
        </div>
      )}
    </div>
  );
}
