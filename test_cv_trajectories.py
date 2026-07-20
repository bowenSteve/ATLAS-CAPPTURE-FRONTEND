"""
Standalone test for _analyze_hand_trajectories.

Usage:
    python3 test_cv_trajectories.py <video.mp4> [<timestamps_csv>]

If no timestamps CSV is given, the script samples one segment per 5 seconds.

The CSV format (optional) is:
    seg_id,start_hms,end_hms,reference_label
    1,00:00:00,00:00:05,pick up blue wire with right hand
    ...

Prints a table comparing CV predictions against reference labels.
"""
import sys
import os
import csv
import json

# Add desktop dir to path so we can import from process_video
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2
import base64
import numpy as np

# Import the two functions we want to test
from process_video import _analyze_hand_trajectories, _build_cv_block, _extract_one, detect_rotation


def extract_segment_frames(video_path: str, start_s: float, end_s: float,
                             fps: float = 2.0) -> list[dict]:
    """Extract frames from a video segment at the given fps."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open: {video_path}")

    rotation = detect_rotation(video_path)
    vid_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = end_s - start_s
    n = max(4, int(duration * fps))
    timestamps = [start_s + i * duration / (n - 1) for i in range(n)]

    frames = []
    for ts in timestamps:
        frame = _extract_one(video_path, ts, rotation)
        if frame:
            frames.append(frame)
    cap.release()
    return frames


def hms_to_s(hms: str) -> float:
    parts = hms.strip().split(":")
    h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    return h * 3600 + m * 60 + s


def auto_segments(video_path: str, interval: float = 5.0) -> list[dict]:
    cap = cv2.VideoCapture(video_path)
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) / (cap.get(cv2.CAP_PROP_FPS) or 30.0)
    cap.release()
    segs = []
    t = 0.0
    sid = 1
    while t < total:
        end = min(t + interval, total)
        def fmt(s):
            h = int(s // 3600); m = int((s % 3600) // 60); sec = s % 60
            return f"{h:02d}:{m:02d}:{sec:06.3f}"
        segs.append({"id": sid, "start": fmt(t), "end": fmt(end), "label": ""})
        t = end
        sid += 1
    return segs


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    video_path = sys.argv[1]
    csv_path   = sys.argv[2] if len(sys.argv) > 2 else None

    if csv_path:
        segments = []
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                segments.append({
                    "id": int(row["seg_id"]),
                    "start": row["start_hms"],
                    "end": row["end_hms"],
                    "label": row.get("reference_label", ""),
                })
    else:
        print("No CSV provided — auto-segmenting every 5 seconds.")
        segments = auto_segments(video_path)

    print(f"\n{'Seg':>4}  {'Time':^23}  {'CV Left':^12}  {'CV Right':^12}  {'Conf':>5}  {'Both':>4}  Reference label")
    print("-" * 120)

    for seg in segments:
        start_s = hms_to_s(seg["start"])
        end_s   = hms_to_s(seg["end"])
        frames  = extract_segment_frames(video_path, start_s, end_s)

        if not frames:
            print(f"{seg['id']:>4}  {seg['start']} → {seg['end']}  (no frames extracted)")
            continue

        cv = _analyze_hand_trajectories(frames)

        both_s = "YES" if cv["both_hands"] else "no"
        ref    = seg.get("label", "—")

        print(
            f"{seg['id']:>4}  {seg['start']} → {seg['end']}  "
            f"{cv['left_action']:^12}  {cv['right_action']:^12}  "
            f"{cv['cv_confidence']:>5.0%}  {both_s:>4}  {ref}"
        )

        # Detailed numbers
        print(
            f"       dy L={cv['left_dy']:+.2f} R={cv['right_dy']:+.2f}  "
            f"mag L={cv['left_magnitude']:.2f} R={cv['right_magnitude']:.2f}  "
            f"n={cv['n_frames']} frames"
        )
        print()


if __name__ == "__main__":
    main()
