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
You are an expert labeler for egocentric (first-person) video footage captured by a wearable camera.

You will receive a sequence of video frames. Each frame has a timestamp burned into the bottom-left corner (HH:MM:SS format).

Your task: identify all distinct hand-object interaction segments and label them precisely using Atlas Capture labeling guidelines.

━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO LABEL
━━━━━━━━━━━━━━━━━━━━━━━━
✓ Goal-oriented hand-object actions relevant to the task
✓ Both left and right hand usage during hand-object interactions
✓ Object transfers between hands (e.g. "pass tray in right hand to left hand")

✗ Do NOT label: walking/navigation, looking/inspecting/checking, idle gestures, camera or face touches, irrelevant side actions

━━━━━━━━━━━━━━━━━━━━━━━━
LABEL FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━
1. IMPERATIVE VOICE — write as a command, not a description
   ✓ pick up spoon with right hand
   ✗ the spoon is picked with right hand

2. HAND SPECIFICATION required in every label: "with left hand", "with right hand", or "with both hands"

3. 1-3 ATOMIC ACTIONS per segment, separated by comma or "and"
   ✓ pick up cup with left hand, place cup on table with left hand
   ✓ hold sponge with left hand and pick up plate with right hand
   ✗ pick up cup place cup on table with left hand  (missing separator)
   ✗ pick up cup with left hand, place cup on table, and wipe surface with left hand  (too many — 3 atomic actions is the max)

4. Under 20 words; all words must be true for the entire duration of the segment

5. DO NOT label intent — label what ego IS doing, not what they intend to do
   ✓ cut tape with scissors with right hand
   ✗ pick up scissors to cut tape with right hand

━━━━━━━━━━━━━━━━━━━━━━━━
SEGMENTATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━
- Segment STARTS: when hands begin engaging toward an object
- Segment ENDS: when hands disengage or the goal changes
- Do NOT bleed actions into neighboring segments
- Max segment duration: 10 seconds — this is a HARD LIMIT. Never create a segment longer than 10 seconds.
  If the same action continues for longer than 10 seconds, split it into consecutive segments with the same label.
  Example: a 25-second tightening action → three segments: 0-10s, 10-20s, 20-25s, all labeled "tighten bolt with screwdriver with both hands"
- Cover the entire video with NO gaps from first frame to last frame

NO ACTION: label "no action" only when hands touch nothing for more than 5 consecutive seconds, or ego is idle/irrelevant for more than 5s. Do not split a segment just because the ego pauses. Idle periods of 5s or less are absorbed into the adjacent segment.

━━━━━━━━━━━━━━━━━━━━━━━━
VERB RULES
━━━━━━━━━━━━━━━━━━━━━━━━
Object leaves a surface → "pick up"  (never: pick, take, grasp)
Object contacts a surface → "place [general location]"  (e.g. "place cup on table", not "place cup on upper-left of table")
Object moved between locations → "reposition"
Instead of "adjust" → use "shift" or "reposition"
Instead of "move" / "transfer" → use "pick up" and "place"
Do NOT invent steps that are not visible in the frames.

━━━━━━━━━━━━━━━━━━━━━━━━
OBJECT NAMING
━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER use "tool", "object", "thing", "item" — always name the actual object
- If you cannot identify the exact tool name, describe it by visual properties: color + shape + function
  e.g. "silver hex wrench", "red-handled screwdriver", "black allen key", "yellow spray can"
- Use the context field to infer domain-specific names (e.g. "pivot bolt", "derailleur cable", "suspension linkage")
- Use color/shape to disambiguate similar objects when context doesn't specify
- Multiple identical objects acted on at once: use collective plural ("pick up knives", not "pick up 3 knives")
- Multiple different objects held simultaneously: list them ("hold pliers and hammer with right hand")

━━━━━━━━━━━━━━━━━━━━━━━━
FORBIDDEN WORDS — never use these
━━━━━━━━━━━━━━━━━━━━━━━━
adjust, manipulate, move, transfer, inspect, check, examine, reach
pick (alone), take, grasp
it, them, they  (pronouns — always use the object name)
-ing form of any verb  (use base form: "pick up" not "picking up", "place" not "placing", "fold" not "folding")
the, a, an  (articles — omit them: "pick up cup" not "pick up the cup")
tool, object, thing, item

━━━━━━━━━━━━━━━━━━━━━━━━
DENSE vs COARSE
━━━━━━━━━━━━━━━━━━━━━━━━
Default to DENSE: exact actions and objects, includes micro-actions, 1-3 atomics per segment.
Use COARSE only when too many micro-actions occur within a 10s window to label densely:
  - Focus on the main goal/objective only
  - No micro-actions listed
  - Still within 10s and still includes hand specification

━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — valid JSON only, no extra text
━━━━━━━━━━━━━━━━━━━━━━━━
{
  "segments": [
    {
      "id": 1,
      "start": "HH:MM:SS",
      "end": "HH:MM:SS",
      "label": "action label with hand specification"
    }
  ]
}

First segment starts at the first frame timestamp. Last segment ends at the last frame timestamp.
""".strip()


def emit(event: str, **kwargs):
    print(json.dumps({"event": event, **kwargs}), flush=True)


def seconds_to_hms(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def detect_rotation(video_path: str) -> int:
    """Returns the rotation angle to correct (0, 90, 180, 270) from video metadata."""
    cap = cv2.VideoCapture(video_path)
    rotation = 0
    # OpenCV exposes the rotation tag from container metadata
    rot = cap.get(cv2.CAP_PROP_ORIENTATION_META)
    cap.release()
    if rot in (90, 180, 270):
        rotation = int(rot)
    return rotation


def rotate_frame(frame, angle: int):
    if angle == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if angle == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    if angle == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def extract_frames(video_path: str, frames_per_sec: float) -> tuple[list[dict], float]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames_count / video_fps
    rotation = detect_rotation(video_path)

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

        # Correct rotation so frames are always upright for the LLM
        if rotation:
            frame = rotate_frame(frame, rotation)

        # Resize to keep upload size reasonable (max 720p wide)
        h, w = frame.shape[:2]
        if w > 1280:
            scale = 1280 / w
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            h, w = frame.shape[:2]

        # Burn timestamp in bottom-left
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
    import time
    for _ in range(10):
        time.sleep(3)
        try:
            resp = requests.get(
                f"{base_url}/generation",
                params={"id": generation_id},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            if resp.status_code == 200:
                cost = float(resp.json().get("data", {}).get("total_cost", 0.0) or 0.0)
                if cost > 0:
                    return cost
        except Exception:
            pass
    return 0.0


def load_screenshots(paths: list) -> list:
    result = []
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp"}
    for p in paths:
        try:
            mime = mime_map.get(os.path.splitext(p)[1].lower(), "image/jpeg")
            with open(p, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            result.append({"mime": mime, "b64": b64})
        except Exception:
            pass
    return result


def call_llm(frames: list[dict], context: str, api_key: str, model: str, base_url: str, screenshots: list = []) -> tuple[list, int, float]:
    video_name_hint = f"Context: {context}" if context else ""

    content = []

    if screenshots:
        content.append({
            "type": "text",
            "text": (
                f"{len(screenshots)} reference screenshot(s) from a professional annotation tool (e.g. ELAN) are provided below. "
                "Each screenshot shows an existing segmentation timeline with segment numbers, exact timestamps (start → end), and labels.\n\n"
                "CRITICAL INSTRUCTIONS:\n"
                "1. Extract the exact segment timestamps (start and end times) from these screenshots.\n"
                "2. Use THOSE timestamps as your segment boundaries — do NOT create your own segmentation.\n"
                "3. Your output must have the same number of segments shown in the screenshots, with the exact same start and end times.\n"
                "4. Only generate the action labels for each predefined segment based on what you observe in the video frames."
            ),
        })
        for s in screenshots:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{s['mime']};base64,{s['b64']}"},
            })
        content.append({
            "type": "text",
            "text": (
                f"Now here are the {len(frames)} video frames to label. "
                f"{video_name_hint}\n"
                "Use the segment timestamps from the screenshots above and label each segment. "
                "Return only valid JSON matching the format in your instructions."
            ),
        })
    else:
        content.append({
            "type": "text",
            "text": (
                f"Annotate ALL actions in this video ({len(frames)} frames). "
                f"{video_name_hint}\n"
                "Return only valid JSON matching the format in your instructions."
            ),
        })

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
    parser.add_argument("--screenshots", nargs="*", default=[])
    args = parser.parse_args()

    # Default frames per second per tier (overridable by backend setting)
    tier_defaults = {"basic": 2.0, "standard": 4.0, "premium": 8.0}
    fps = args.frames_per_sec or tier_defaults[args.tier]

    try:
        frames, duration = extract_frames(args.video, fps)
        if not frames:
            raise RuntimeError("No frames extracted from video")

        screenshots = load_screenshots(args.screenshots) if args.screenshots else []

        segments, tokens_used, cost_usd = call_llm(
            frames,
            context=args.context,
            api_key=args.api_key,
            model=args.model,
            base_url=args.api_url,
            screenshots=screenshots,
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
