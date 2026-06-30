import React, { useEffect, useState } from "react";
import useStore from "../store/useStore";

export default function Results({ nav }) {
  const { outputPath, setResults } = useStore();
  const [data, setData] = useState([]);
  const [filter, setFilter] = useState("all"); // all | changed | kept

  useEffect(() => {
    if (!outputPath) { nav("dashboard"); return; }
    // Read file via Electron's fs (injected through a simple IPC in preload)
    // Fallback: ask electron to open file and return contents
    window.electron
      .selectFile([{ name: "JSON", extensions: ["json"] }])
      .then(() => {})
      .catch(() => {});

    // Actually read via fetch (local file)
    fetch(outputPath.startsWith("file://") ? outputPath : `file://${outputPath}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [outputPath]);

  const changed = data.filter((r) => r.changed);
  const kept = data.filter((r) => !r.changed);
  const visible =
    filter === "changed" ? changed : filter === "kept" ? kept : data;

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Annotation Results</h2>
          <p className="text-gray-400 text-sm">
            {data.length} segments · {changed.length} changed · {kept.length} kept
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.electron.openOutput(outputPath)}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-xl transition"
          >
            Open File
          </button>
          <button
            onClick={() => nav("dashboard")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            New Job
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Total" value={data.length} color="text-white" />
        <StatCard label="Changed" value={changed.length} color="text-amber-400" />
        <StatCard label="Kept" value={kept.length} color="text-green-400" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-900 rounded-xl p-1 w-fit">
        {["all", "changed", "kept"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize ${
              filter === f
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Segment list */}
      <div className="space-y-2">
        {visible.map((seg) => (
          <SegmentRow key={seg.id} seg={seg} />
        ))}
        {visible.length === 0 && (
          <div className="text-center text-gray-600 py-12">
            {data.length === 0
              ? "Loading results..."
              : "No segments in this filter."}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-1">{label}</div>
    </div>
  );
}

function SegmentRow({ seg }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`bg-gray-900 border rounded-xl overflow-hidden transition ${
        seg.changed ? "border-amber-800/50" : "border-gray-800"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition"
      >
        <span className="text-gray-600 text-xs w-8 text-right shrink-0">{seg.id}</span>
        <span className={`text-xs shrink-0 ${seg.changed ? "text-amber-400" : "text-green-400"}`}>
          {seg.changed ? "changed" : "kept"}
        </span>
        <span className="text-gray-400 text-xs shrink-0">{seg.start} → {seg.end}</span>
        <span className="text-white text-sm truncate flex-1">{seg.suggested_label}</span>
        <span className={`text-xs shrink-0 px-2 py-0.5 rounded-full ${
          seg.confidence === "high"
            ? "bg-green-900/50 text-green-400"
            : seg.confidence === "medium"
            ? "bg-yellow-900/50 text-yellow-400"
            : "bg-gray-800 text-gray-500"
        }`}>
          {seg.confidence}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-800 space-y-2 text-sm">
          {seg.changed && (
            <div>
              <span className="text-gray-500 text-xs">Original:</span>
              <p className="text-gray-400 mt-0.5 line-through">{seg.original_label}</p>
            </div>
          )}
          <div>
            <span className="text-gray-500 text-xs">Note:</span>
            <p className="text-gray-300 mt-0.5">{seg.notes}</p>
          </div>
        </div>
      )}
    </div>
  );
}
