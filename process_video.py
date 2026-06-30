#!/usr/bin/env python3
"""
Atlas Capture Tool – Video Annotation Pipeline
Extracts frames from a video based on tier, then calls an LLM to annotate.
Emits JSON events to stdout for the Electron shell to consume.
"""

import argparse
import base64
import json
import os
import sys
import tempfile
import shutil
import re
import cv2
import requests

ANNOTATION_SYSTEM_PROMPT = """
You are an expert at labeling egocentric video footage captured by a first-person camera worn by an annotator.

You will receive a sequence of video frames. Each frame has a timestamp burned into the bottom-left corner (HH:MM:SS format).

Your task: identify ALL distinct actions in the video and assign them time boundaries and labels.

MANDATORY LABELING RULES:
1. HAND SPECIFICATION REQUIRED — every label must include:
   "with left hand", "with right hand", or "with both hands"
   Example: "open refrigerator door with right hand"

2. USE SPECIFIC VERBS — forbidden vague verbs: adjust, manipulate, move, transfer, handle
   Instead use: open, close, pick up, put down, pour, cut, stir, press, pull, push, rotate, lift, place, wipe, fold, spread, squeeze, grip, release

3. NAME THE OBJECT EXPLICITLY — never use pronouns ("it", "them", "the item")
   Say: "pick up glass bottle" not "pick it up"

4. NO ACTION RULE — only label a segment "No Action with right hand" if the person is:
   - Genuinely stationary for more than 5 consecutive seconds, AND
   - No meaningful sub-actions are visible

5. DENSE LABELING PREFERRED — when in doubt, split into more segments rather than merging.
   If two different objects are acted on in sequence, those are separate segments.

6. SEGMENT BOUNDARIES — place boundaries at clear visual transition points between actions.
   Cover the ENTIRE video from first frame to last frame, NO GAPS between segments.

7. FORBIDDEN WORDS: "adjust", "manipulate", "move", "transfer", "pick" (use "pick up"), "take",
   "grasp" (unless specifically grasping), "give" (use "hand over"), "put" alone (use "put down" or "place"),
   pronouns (it, them, they, the item, the object)

OUTPUT FORMAT — return valid JSON only, no extra text:
{
  "segments": [
    {
      "id": 1,
      "start": "HH:MM:SS",
      "end": "HH:MM:SS",
      "label": "specific action label with hand specification"
    }
  ]
}

Timestamps must match the HH:MM:SS format visible in the frames.
First segment starts at the first frame's timestamp.
Last segment ends at the last frame's timestamp.
""".strip()


def emit(event: str, **kwargs):
    print(json.dumps({"event": event, **kwargs}), flush=True)


def seconds_to_hms(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def extract_frames(video_path: str, frames_per_sec: float) -> tuple[list[dict], float]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames_count / video_fps

    interval = 1.0 / frames_per_sec
    timestamps = []
    t = 0.0
    while t <= duration:
        timestamps.append(t)
        t += interval

    emit("extracting", total=len(timestamps), duration=round(duration, 1))

    frames = []
    for i, ts in enumerate(timestamps):
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ret, frame = cap.read()
        if not ret:
            break

        # Resize to keep upload size reasonable (max 720p wide)
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            h, w = frame.shape[:2]

        # Burn timestamp
        time_str = seconds_to_hms(ts)
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, time_str, (8, h - 12), font, 0.7, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(frame, time_str, (8, h - 12), font, 0.7, (255, 255, 255), 1, cv2.LINE_AA)

        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        b64 = base64.b64encode(buf.tobytes()).decode()
        frames.append({"timestamp": ts, "time_str": time_str, "b64": b64})

        emit("extracting_progress", current=i + 1, total=len(timestamps))

    cap.release()
    return frames, duration


def fetch_generation_cost(generation_id: str, api_key: str, base_url: str) -> float:
    try:
        resp = requests.get(
            f"{base_url}/generation",
            params={"id": generation_id},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        if resp.status_code == 200:
            return float(resp.json().get("data", {}).get("total_cost", 0.0) or 0.0)
    except Exception:
        pass
    return 0.0


def call_llm(frames: list[dict], context: str, api_key: str, model: str, base_url: str) -> tuple[list, int, float]:
    video_name_hint = f"Context: {context}" if context else ""

    content = [
        {
            "type": "text",
            "text": (
                f"Annotate ALL actions in this video ({len(frames)} frames). "
                f"{video_name_hint}\n"
                "Return only valid JSON matching the format in your instructions."
            ),
        }
    ]

    for f in frames:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{f['b64']}"},
        })

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": ANNOTATION_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "max_tokens": 8192,
    }

    emit("annotating", frame_count=len(frames))

    resp = requests.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=300,
    )
    resp.raise_for_status()
    data = resp.json()

    raw_text = data["choices"][0]["message"]["content"]
    tokens_used = data.get("usage", {}).get("total_tokens", 0)

    # Fetch exact USD cost from OpenRouter generation endpoint
    generation_id = data.get("id", "")
    cost_usd = fetch_generation_cost(generation_id, api_key, base_url) if generation_id else 0.0

    # Extract JSON from response (handle markdown code blocks)
    json_match = re.search(r"\{[\s\S]*\}", raw_text)
    if not json_match:
        raise RuntimeError("LLM did not return valid JSON")

    parsed = json.loads(json_match.group())
    segments = parsed.get("segments", [])
    return segments, tokens_used, cost_usd


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--tier", default="standard", choices=["basic", "standard", "premium"])
    parser.add_argument("--frames-per-sec", type=float, default=None)
    parser.add_argument("--context", default="")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--model", default="google/gemini-2.0-flash-001")
    parser.add_argument("--api-url", default="https://openrouter.ai/api/v1")
    parser.add_argument("--annotation-id", type=int, default=None)
    args = parser.parse_args()

    # Default frames per second per tier (overridable by backend setting)
    tier_defaults = {"basic": 0.1, "standard": 0.2, "premium": 0.5}
    fps = args.frames_per_sec or tier_defaults[args.tier]

    try:
        frames, duration = extract_frames(args.video, fps)
        if not frames:
            raise RuntimeError("No frames extracted from video")

        segments, tokens_used, cost_usd = call_llm(
            frames,
            context=args.context,
            api_key=args.api_key,
            model=args.model,
            base_url=args.api_url,
        )

        emit(
            "done",
            segments=segments,
            tokens_used=tokens_used,
            cost_usd=round(cost_usd, 6),
            segment_count=len(segments),
            duration=round(duration, 1),
            annotation_id=args.annotation_id,
        )

    except Exception as e:
        emit("error", message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
