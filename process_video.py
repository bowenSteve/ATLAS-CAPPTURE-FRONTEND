#!/usr/bin/env python3
"""
Atlas Capture Tool – Video Annotation Pipeline
Extracts frames from a video based on tier, then calls an LLM to annotate.
Emits JSON events to stdout for the Electron shell to consume.
"""

import argparse
import base64
import hashlib
import json
import os
import sys
import time
import tempfile
import shutil
import re
import threading
import cv2
import numpy as np
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed


CHUNK_CACHE_DIR = os.path.join(os.path.expanduser("~"), ".atlas_capture", "chunk_cache")
CHUNK_CACHE_TTL = 86400  # 24 hours


def _cache_key(video_path: str, fps: float, chunk_idx: int) -> str:
    raw = f"{os.path.abspath(video_path)}:{fps}:{chunk_idx}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def _load_chunk_cache(video_path: str, fps: float, chunk_idx: int):
    path = os.path.join(CHUNK_CACHE_DIR, f"{_cache_key(video_path, fps, chunk_idx)}.json")
    if not os.path.exists(path):
        return None
    if time.time() - os.path.getmtime(path) > CHUNK_CACHE_TTL:
        os.remove(path)
        return None
    with open(path) as f:
        return json.load(f)


def _save_chunk_cache(video_path: str, fps: float, chunk_idx: int, segments, tokens, cost):
    os.makedirs(CHUNK_CACHE_DIR, exist_ok=True)
    path = os.path.join(CHUNK_CACHE_DIR, f"{_cache_key(video_path, fps, chunk_idx)}.json")
    with open(path, "w") as f:
        json.dump({"segments": segments, "tokens": tokens, "cost": cost}, f)

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
✓ Holding MANIPULATABLE objects (e.g. "hold cup with left hand, wipe cup with cloth in right hand")

✗ Do NOT label: walking/navigation, looking/inspecting/checking, idle gestures, camera or face touches, irrelevant side actions
✗ Do NOT label holding large stationary objects (tables, walls)

━━━━━━━━━━━━━━━━━━━━━━━━
LABEL FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━
1. IMPERATIVE VOICE — write as a command, not a description
   ✓ pick up spoon with right hand
   ✗ the spoon is picked with right hand

2. DUAL-HAND FORMAT — always label both hands separately, even when one hand is passive.
   The non-dominant hand is almost always "hold [object] with [left/right] hand".
   ✓ hold blue wire with left hand, cut wire with shears in right hand
   ✓ hold sponge with left hand, pick up plate with right hand
   ✓ hold cup with left hand, wipe cup with cloth in right hand
   Only use "with both hands" when both hands perform identical, symmetrical actions:
   ✓ twist wire with both hands   ✓ fold towel with both hands
   NEVER collapse two separate hand actions into one generic "with both hands" label.

3. 1-3 ATOMIC ACTIONS per segment, separated by comma
   ✓ hold wire with left hand, pick up shears with right hand
   ✓ hold cup with left hand, place cup on table with right hand
   ✗ pick up cup place cup on table with left hand  (missing separator)
   ✗ hold X with left hand, do A with right hand, do B with right hand, do C  (too many — 3 atomic actions is the max)

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
  Example: a 25-second smoothen action → three segments: 0-10s, 10-20s, 20-25s, all labeled "smoothen towel with both hands"
- Cover the entire video with NO gaps from first frame to last frame

NO ACTION: label "no action" only when hands touch nothing for more than 5 consecutive seconds, or ego is idle/irrelevant for more than 5s. Do not split a segment just because the ego pauses. Idle periods of 5s or less are absorbed into the adjacent segment.

━━━━━━━━━━━━━━━━━━━━━━━━
VERB RULES
━━━━━━━━━━━━━━━━━━━━━━━━
Object leaves a flat open surface → "pick up"  (never: pick, take)
Object retrieved from a confined space (fridge shelf, cabinet, drawer, rack) → "grasp [item] from [location]"
  ✓ grasp milk bottle from refrigerator with right hand
  ✗ pick up milk bottle from refrigerator  (reserved for flat surfaces)
Object carried across space (transport from one location to another) → "carry [item] from [A] to [B]"
  ✓ carry milk bottle from refrigerator with both hands  (then "place" in same segment)
Object contacts a surface → "place [object] on [destination]"  — destination = actual surface or object, not a vague region
  ✓ place cup on table   ✓ place lid on container   ✗ place cup down
Lid / cap removal → "pull [lid/cap] off [object]"  or  "remove [lid] from [object]"
Lid / cap attachment → "press [lid] onto [object]"  or  "place [lid] on [object]"
Object moved between locations → "reposition"
Button / switch → "press [button/switch]"

Instead of "adjust" → choose the most precise verb:
  shift, reposition, center, align, level, tilt, slide, rotate, unfold, turn, fold, tuck, flatten, straighten, smoothen, tighten, loosen

Instead of "manipulate" → choose the most precise verb:
  grip, hold, push, pull, press, work, twist, flip, squeeze, pinch, apply, assemble

Instead of "move" → "reposition" (within same location) or "carry" (between locations)
Instead of "transfer" → use "pick up" and "place"

Object exchanges between hands → use: hand over, put, pass, switch, set
  (NOT: transfer, handover, give)

PARALLEL DUAL-HAND ACTIONS — when both hands do the same action simultaneously on DIFFERENT objects,
list each hand separately; do NOT collapse to "with both hands":
  ✓ pick up black bottle with right hand, pick up white bottle with left hand
  ✗ pick up black and white bottles with both hands
Use "with both hands" ONLY when both hands act on the SAME object together:
  ✓ carry tray with both hands   ✓ press lid with both hands

Do NOT invent steps that are not visible in the frames.

━━━━━━━━━━━━━━━━━━━━━━━━
OBJECT NAMING
━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER use "tool", "object", "thing", "item" — always name the actual object
- If you cannot identify the exact object, describe it by visual properties: color + shape + function
  e.g. "silver hex wrench", "red-handled screwdriver", "black allen key", "yellow spray can"
- Use the context field to infer domain-specific names (e.g. "pivot bolt", "derailleur cable", "suspension linkage")
- Use adjectives (color, pattern, size, state) only to disambiguate two or more similar objects — otherwise keep it simple
- Multiple identical objects acted on at once: use collective plural ("pick up knives", not "pick up 3 knives")
- Multiple different objects held simultaneously: list them ("hold pliers and hammer with right hand")
- Placement destination = the actual surface or object receiving the item:
  ✓ place container on green container  ✓ place bottle on table  ✗ place container down

━━━━━━━━━━━━━━━━━━━━━━━━
FORBIDDEN WORDS — never use these
━━━━━━━━━━━━━━━━━━━━━━━━
adjust, manipulate, move, transfer, inspect, check, examine, reach
pick (alone), take
handover, give  (for object hand-off — use pass, put, hand over instead)
it, them, they  (pronouns — always use the object name)
-ing form of any verb  (use base form: "pick up" not "picking up", "fold" not "folding", "smoothen" not "smoothening")
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


LABELING_SYSTEM_PROMPT = """
You are an expert labeler for egocentric (first-person) video footage captured by a wearable camera.

You will receive:
1. A sequence of video frames with timestamps burned in (HH:MM:SS format)
2. A list of pre-defined segments with fixed start and end times

Your ONLY task: write the correct action label for each pre-defined segment, based on what you observe in the video frames for that time window. The timestamps are fixed — do NOT change them or invent new segments. Output EXACTLY the same number of segments as given.

━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO LABEL
━━━━━━━━━━━━━━━━━━━━━━━━
✓ Goal-oriented hand-object actions
✓ Both left and right hand usage during interactions
✓ Holding MANIPULATABLE objects (e.g. "hold cup with left hand, wipe cup with cloth in right hand")
✓ Object exchanges between hands (e.g. "pass towel in right hand to left hand")

✗ Do NOT label: walking/navigation, looking/checking, idle gestures, camera or face touches
✗ Do NOT label holding large stationary objects (tables, walls)

━━━━━━━━━━━━━━━━━━━━━━━━
LABEL FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━
1. IMPERATIVE VOICE — write as a command
   ✓ pick up spoon with right hand
   ✗ the spoon is picked with right hand

2. DUAL-HAND FORMAT — always label both hands separately, even when one hand is passive.
   The non-dominant hand is almost always "hold [object] with [left/right] hand".
   ✓ hold blue wire with left hand, cut wire with shears in right hand
   ✓ hold sponge with left hand, pick up plate with right hand
   Only use "with both hands" when both hands perform identical, symmetrical actions:
   ✓ twist wire with both hands   ✓ fold towel with both hands
   NEVER collapse two separate hand actions into a generic "with both hands" label.

3. 1-3 ATOMIC ACTIONS per segment, separated by comma
   ✓ hold wire with left hand, pick up shears with right hand
   ✓ hold cup with left hand, place cup on table with right hand

4. Under 20 words; all words must be true for the ENTIRE segment duration

5. DO NOT label intent — label what is actually happening
   ✓ cut tape with scissors with right hand
   ✗ pick up scissors to cut tape with right hand

━━━━━━━━━━━━━━━━━━━━━━━━
VERB RULES
━━━━━━━━━━━━━━━━━━━━━━━━
Object leaves flat open surface → "pick up"  (never: pick, take)
Object retrieved from confined space (fridge, cabinet, drawer) → "grasp [item] from [location]"
  ✓ grasp bottle from refrigerator with right hand
Object carried between locations → "carry [item] from [A]" + "place [item] on [B]" in same segment
Object contacts surface/object → "place [item] on [destination]"  (destination = actual surface or object)
  ✓ place lid on container   ✓ place cup on table   ✗ place cup down
Lid removal → "pull [lid] off [object]"  |  Lid attachment → "press [lid] onto [object]"
Button/switch → "press [button name]"
Object moved within same area → "reposition"
Object hand-off → hand over, put, pass, switch, set  (NOT: transfer, handover, give)

PARALLEL DUAL-HAND: same action on different objects simultaneously → list each hand separately:
  ✓ pick up black bottle with right hand, pick up white bottle with left hand
  ✗ pick up black and white bottles with both hands
"with both hands" ONLY when both hands act on the SAME object together.

Instead of "adjust" → shift, reposition, center, align, level, tilt, slide, rotate, unfold, turn, fold, tuck, flatten, straighten, smoothen, tighten, loosen
Instead of "manipulate" → grip, hold, push, pull, press, work, twist, flip, squeeze, pinch, apply, assemble

NO ACTION: only when hands touch nothing AND ego is idle for the ENTIRE segment duration (more than 5s with no hand-object contact).

━━━━━━━━━━━━━━━━━━━━━━━━
FORBIDDEN WORDS
━━━━━━━━━━━━━━━━━━━━━━━━
adjust, manipulate, move, transfer, inspect, check, examine, reach
pick (alone), take, handover, give
it, them, they  (use the object name)
-ing form of any verb  (fold not folding, smoothen not smoothening, pick up not picking up)
the, a, an  (no articles)
tool, object, thing, item

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
""".strip()


_FORBIDDEN_WORD_MAP = {
    # word/phrase → replacement
    r"\badjust\b": "reposition",
    r"\bmanipulate\b": "work with",
    r"\btransfer\b": "pass",
    r"\bhandover\b": "hand over",
    r"\bgive\b": "pass",
    r"\binspect\b": "examine visually",   # will be caught and replaced with better verb below
    r"\bcheck\b": "verify",
    r"\bexamine\b": "look at",
    r"\breach\b": "extend hand toward",
    r"\btake\b": "pick up",
    r"\b(pick|take)\s+(?!up\b)": "pick up ",
    r"\bthe\s+": "",
    r"\ba\s+(?=[a-z])": "",
    r"\ban\s+(?=[aeiou])": "",
}

# These warrant a flag to the UI rather than silent replacement
_HARD_FORBIDDEN = {"inspect", "check", "examine", "manipulate", "adjust", "transfer", "handover", "give", "move"}

_VERB_ING_RE = re.compile(
    r"\b(pick(?:ing)?(?:\s+up)?|plac|fold|smooth(?:en)?|grip|hold|rotat|flip|tuck|flatten|align|loosen|tighten|push|pull|press|twist|squeez|pinch|assembl|apply)ing\b",
    re.IGNORECASE,
)


def _sanitize_label(label: str) -> tuple[str, list[str]]:
    """
    Remove common guideline violations from a label string.
    Returns (cleaned_label, list_of_warnings).
    """
    warnings = []
    cleaned = label

    # Fix -ing verbs → base form
    def _fix_ing(m):
        stem = m.group(1)
        # Special case: "picking up" → "pick up"
        if stem.lower().startswith("pick"):
            return "pick up"
        return stem.rstrip("e") if stem.endswith("e") else stem

    cleaned = _VERB_ING_RE.sub(_fix_ing, cleaned)

    # Log hard forbidden words as warnings but leave the label unchanged
    for word in _HARD_FORBIDDEN:
        pattern = re.compile(rf"\b{re.escape(word)}\w*\b", re.IGNORECASE)
        if pattern.search(cleaned):
            warnings.append(f'Forbidden word "{word}" in label — please review')

    # Strip articles before nouns (simple heuristic)
    cleaned = re.sub(r"\b(the|an?) (?=[a-zA-Z])", "", cleaned)

    # Replace ' and ' between actions with ', '
    # e.g. "pick up bottle with right hand and rotate bottle" → "pick up bottle with right hand, rotate bottle"
    cleaned = re.sub(r"\s+and\s+", ", ", cleaned)

    # Collapse multiple spaces
    cleaned = re.sub(r"  +", " ", cleaned).strip()

    return cleaned, warnings


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


def _extract_one(video_path: str, ts: float, rotation: int) -> dict | None:
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    if rotation:
        frame = rotate_frame(frame, rotation)
    h, w = frame.shape[:2]
    if w > 1280:
        scale = 1280 / w
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
        h, w = frame.shape[:2]
    time_str = seconds_to_hms(ts)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(frame, time_str, (8, h - 12), font, 0.7, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(frame, time_str, (8, h - 12), font, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
    b64 = base64.b64encode(buf.tobytes()).decode()
    return {"timestamp": ts, "time_str": time_str, "b64": b64}


def extract_frames(video_path: str, frames_per_sec: float) -> tuple[list[dict], float]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames_count / video_fps
    cap.release()

    rotation = detect_rotation(video_path)

    interval = 1.0 / frames_per_sec
    timestamps = []
    t = 0.0
    while t <= duration:
        timestamps.append(t)
        t += interval

    emit("extracting", total=len(timestamps), duration=round(duration, 1))

    workers = min(os.cpu_count() or 4, 8)
    completed = threading.Lock()
    done_count = [0]

    results: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_extract_one, video_path, ts, rotation): i
                   for i, ts in enumerate(timestamps)}
        for future in as_completed(futures):
            idx = futures[future]
            frame = future.result()
            if frame:
                results[idx] = frame
            with completed:
                done_count[0] += 1
                emit("extracting_progress", current=done_count[0], total=len(timestamps))

    frames = [results[i] for i in sorted(results) if i in results]
    return frames, duration


def _extract_json(text: str) -> dict:
    """
    Robustly extract the first valid JSON object from an LLM response.
    Handles markdown code fences, trailing commas, and truncated responses.
    """
    # Strip markdown code fences
    text = re.sub(r"```(?:json)?\s*", "", text).strip()

    # Try progressively smaller matches if the greedy match fails to parse
    for m in re.finditer(r"\{", text):
        start = m.start()
        # Walk forward to find the matching closing brace
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : i + 1]
                    # Remove trailing commas before ] or } (common LLM mistake)
                    candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break  # try next opening brace
    raise RuntimeError("LLM response contained no parseable JSON object")


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


CHUNK_SIZE = 200  # frames per parallel LLM call

TIMESTAMP_EXTRACTION_PROMPT = """
You are an annotation extraction assistant. You will receive one or more screenshots from a professional video annotation tool (e.g. ELAN, Anvil, BORIS).

Your task: extract EVERY segment visible in the screenshot(s) — start time, end time, and action label.

CRITICAL — DO NOT SKIP SEGMENTS:
- Count the numbered rows in the screenshot (1, 2, 3, …). Your JSON must have exactly that many segments.
- If you can see segment 6 ends at time X and segment 8 starts at time Y, segment 7 MUST also be in your output.
- A segment with no visible label should still appear with label "".
- If multiple screenshots are provided, combine all segments from all screenshots.

Timestamp format rules:
  - Input may be: M:SS.s (e.g. 1:27.3), MM:SS, HH:MM:SS, or bare seconds (e.g. 87.3)
  - Convert ALL to HH:MM:SS, zero-padded, no decimals — round to nearest second
  - Examples: 0:06.3 → 00:00:06 | 1:27.3 → 00:01:27 | 95.0 → 00:01:35 | 0:51.1 → 00:00:51

Return ONLY valid JSON — no markdown, no explanation:
{"segments": [{"id": 1, "start": "HH:MM:SS", "end": "HH:MM:SS", "label": "exact label text"}, ...]}

Rules:
- Every numbered segment in the screenshot must appear in the output
- Order chronologically by start time
- Copy labels verbatim — do not paraphrase, translate, or correct them
""".strip()


def _extract_timestamps(screenshots: list, api_key: str, model: str, base_url: str) -> list:
    """Pass 1: extract segment timestamps and existing labels from annotation tool screenshots."""
    content = [
        {"type": "text", "text": f"Extract all segments (timestamps and labels) from the {len(screenshots)} annotation screenshot(s) below."}
    ]
    for s in screenshots:
        content.append({"type": "image_url", "image_url": {"url": f"data:{s['mime']};base64,{s['b64']}"}})

    max_retries = 5
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": TIMESTAMP_EXTRACTION_PROMPT},
                        {"role": "user", "content": content},
                    ],
                    "max_tokens": 8192,
                },
                timeout=120,
            )
            resp.raise_for_status()
            raw = resp.json()["choices"][0]["message"]["content"]
            segs = _extract_json(raw).get("segments", [])

            # Sort by start time
            def _seg_start_secs(s):
                parts = s.get("start", "00:00:00").strip().split(":")
                if len(parts) == 3:
                    return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
                elif len(parts) == 2:
                    return int(parts[0]) * 60 + float(parts[1])
                return float(parts[0])

            segs.sort(key=_seg_start_secs)

            # Deduplicate: drop any segment whose start time is within 0.5 seconds
            # of a previous segment's start (LLM sometimes extracts the same
            # region twice across adjacent screenshots).
            # 0.5s is tight enough to catch true duplicates but won't discard
            # legitimate adjacent segments that are only 1-2s apart.
            deduped = []
            for seg in segs:
                t = _seg_start_secs(seg)
                if not deduped or abs(t - _seg_start_secs(deduped[-1])) > 0.5:
                    deduped.append(seg)

            # Re-number ids sequentially
            for i, seg in enumerate(deduped, 1):
                seg["id"] = i

            # Warn about gaps > 5 seconds between consecutive segments —
            # these likely mean a segment was missed in extraction.
            for i in range(len(deduped) - 1):
                end_t   = _seg_start_secs({"start": deduped[i].get("end",   deduped[i].get("start", "00:00:00"))})
                start_t = _seg_start_secs(deduped[i + 1])
                gap = start_t - end_t
                if gap > 5:
                    emit("warning", message=(
                        f"Gap of {gap:.0f}s detected between segment {deduped[i]['id']} "
                        f"({deduped[i].get('end','?')}) and segment {deduped[i+1]['id']} "
                        f"({deduped[i+1].get('start','?')}) — a segment may have been missed in extraction."
                    ))

            return deduped
        except requests.exceptions.HTTPError as exc:
            if exc.response.status_code == 429 and attempt < max_retries - 1:
                time.sleep(30 * (attempt + 1))
                continue
            raise
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError):
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
    return []


def _call_label_batch_request(content: list, api_key: str, model: str,
                               base_url: str) -> tuple[list, int, float]:
    """Make one streaming LLM call for segment labeling. Returns (segments, tokens, cost)."""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": LABELING_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "max_tokens": 8192,
        "stream": True,
    }
    raw_text = ""
    tokens_used = 0
    generation_id = ""
    last_emit = 0
    max_retries = 5
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=300,
                stream=True,
            )
            resp.raise_for_status()
            raw_text = ""
            tokens_used = 0
            generation_id = ""
            last_emit = 0
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    if not generation_id:
                        generation_id = chunk.get("id", "")
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        raw_text += delta
                        if len(raw_text) - last_emit >= 40:
                            emit("stream_chars", chars=len(raw_text))
                            last_emit = len(raw_text)
                    usage = chunk.get("usage") or {}
                    if usage.get("total_tokens"):
                        tokens_used = usage["total_tokens"]
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass
            break
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code
            if status == 429 and attempt < max_retries - 1:
                emit("stream_chars", chars=0)
                time.sleep(30 * (attempt + 1))
                continue
            if status == 402:
                try:
                    detail = exc.response.json().get("error", {}).get("message", "")
                except Exception:
                    detail = ""
                raise RuntimeError(f"Token exhaustion: OpenRouter account has insufficient credits. {detail}".strip())
            raise
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError):
            if attempt == max_retries - 1:
                raise
            emit("stream_chars", chars=0)
            time.sleep(2 ** (attempt + 1))
    cost_usd = fetch_generation_cost(generation_id, api_key, base_url) if generation_id else 0.0
    return _extract_json(raw_text).get("segments", []), tokens_used, cost_usd


def _decode_frame(b64_str: str):
    """Decode a base64 JPEG string to a BGR numpy array."""
    buf = np.frombuffer(base64.b64decode(b64_str), dtype=np.uint8)
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def _classify_optical_flow(prev_gray, curr_gray) -> tuple[str, float, str, float, float, float, float, float]:
    """
    Compute dense optical flow between two greyscale frames.
    Returns (motion_type, avg_magnitude, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy).
    motion_type: static | rotation-cw | rotation-ccw |
                 upward | downward | lateral-left | lateral-right | complex
    activity_zone: which horizontal third of the frame has most motion
    mean_fx/fy: mean flow vector components for all active points
    rot_score: signed rotational cross-product score
    left_fy/right_fy: mean vertical flow in the left and right thirds of the frame
                      (used for zone-specific pick-up / hold detection)
    """
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray, None,
        pyr_scale=0.5, levels=3, winsize=15,
        iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
    )
    h, w = flow.shape[:2]
    mag_map = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)

    # Activity zone: which third of the frame is most active
    zone_l = float(np.mean(mag_map[:, : w // 3]))
    zone_c = float(np.mean(mag_map[:, w // 3 : 2 * w // 3]))
    zone_r = float(np.mean(mag_map[:, 2 * w // 3 :]))
    max_zone = max(zone_l, zone_c, zone_r)
    if max_zone < 0.5:
        activity_zone = "minimal"
    elif max(zone_l, zone_r) < zone_c * 1.5:
        activity_zone = "spread across frame"
    elif zone_l > zone_r and zone_l > zone_c:
        activity_zone = "left side of frame"
    elif zone_r > zone_l and zone_r > zone_c:
        activity_zone = "right side of frame"
    else:
        activity_zone = "center of frame"

    # Motion type from sampled flow vectors
    step = 20
    yy, xx = np.mgrid[step // 2 : h : step, step // 2 : w : step]
    fx = flow[yy, xx, 0]
    fy = flow[yy, xx, 1]
    mag = np.sqrt(fx ** 2 + fy ** 2)
    active = mag > 1.5
    if active.sum() < 8:
        return "static", float(np.mean(mag)), activity_zone, 0.0, 0.0, 0.0, 0.0, 0.0

    fx_a = fx[active]
    fy_a = fy[active]
    mag_a = mag[active]
    avg_mag = float(np.mean(mag_a))

    cx = (xx[active] - w / 2) / (w / 2)
    cy = (yy[active] - h / 2) / (h / 2)
    cross = cx * fy_a - cy * fx_a
    rot_score = float(np.mean(cross))

    mean_fx = float(np.mean(fx_a))
    mean_fy = float(np.mean(fy_a))

    # Zone-specific vertical flow: tells us which hand is doing the lifting/placing
    left_mask  = active & (xx < w // 3)
    right_mask = active & (xx > 2 * w // 3)
    left_fy  = float(np.mean(fy[left_mask]))  if left_mask.sum()  >= 3 else 0.0
    right_fy = float(np.mean(fy[right_mask])) if right_mask.sum() >= 3 else 0.0

    net_displacement = float(np.sqrt(mean_fx ** 2 + mean_fy ** 2))

    # Net vertical/lateral movement takes priority over rotation.
    # Pick-up/place arcs produce a rotation-like cross product — suppress that
    # by requiring that rotation only wins when net displacement is small
    # (object spinning in place, not travelling through space).
    if mean_fy < -2.5 and abs(mean_fy) > abs(rot_score) * 2:
        return "upward", avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    if mean_fy > 2.5 and abs(mean_fy) > abs(rot_score) * 2:
        return "downward", avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    if abs(rot_score) > 0.35 and net_displacement < avg_mag * 0.6:
        return ("rotation-cw" if rot_score < 0 else "rotation-ccw"), avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    if mean_fy < -1.5:
        return "upward", avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    if mean_fy > 1.5:
        return "downward", avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    if abs(mean_fx) > 2.5:
        return ("lateral-left" if mean_fx < 0 else "lateral-right"), avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy
    return "complex", avg_mag, activity_zone, mean_fx, mean_fy, rot_score, left_fy, right_fy


def _build_motion_summary(seg_frames: list[dict]) -> str:
    """
    Run optical flow analysis on the segment's frames and return
    a structured text block to prepend to the LLM prompt.

    Two layers of analysis:
    1. Per-pair events (what happened between each consecutive frame pair)
    2. Segment-level trajectory + velocity profile (what the whole segment shows)
    """
    if len(seg_frames) < 2:
        return ""

    # Collect raw per-pair data
    flow_events = []  # (frame_idx, motion_type, avg_mag, zone)
    raw_vectors = []  # (mean_fx, mean_fy, rot_score, avg_mag, left_fy, right_fy)
    zones = []
    prev_gray = None

    for i, f in enumerate(seg_frames):
        bgr = _decode_frame(f["b64"])
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        if prev_gray is not None:
            motion, mag, zone, mean_fx, mean_fy, rot_score, left_fy, right_fy = _classify_optical_flow(prev_gray, gray)
            if motion != "static":
                flow_events.append((i, motion, mag, zone))
                raw_vectors.append((mean_fx, mean_fy, rot_score, mag, left_fy, right_fy))
                if zone not in ("minimal", "spread across frame"):
                    zones.append(zone)
        prev_gray = gray

    if not flow_events:
        return ""

    lines = [
        "LOCAL MOTION ANALYSIS (supplementary context — do not override a human label based on this alone):",
        "EGOCENTRIC CONVENTION: right hand → appears on RIGHT side of frame | left hand → appears on LEFT side of frame",
    ]

    # ── Segment-level trajectory analysis ────────────────────────────────────
    if raw_vectors:
        all_fx      = [v[0] for v in raw_vectors]
        all_fy      = [v[1] for v in raw_vectors]
        all_rot     = [v[2] for v in raw_vectors]
        all_mags    = [v[3] for v in raw_vectors]
        all_left_fy = [v[4] for v in raw_vectors]
        all_right_fy= [v[5] for v in raw_vectors]
        n = len(raw_vectors)

        # Cumulative displacement — where did all motion add up to?
        cum_fx = sum(all_fx)
        cum_fy = sum(all_fy)
        cum_mag = (cum_fx ** 2 + cum_fy ** 2) ** 0.5

        # Zone-specific cumulative vertical displacement
        # Positive = downward, Negative = upward (screen coords)
        cum_left_fy  = sum(all_left_fy)
        cum_right_fy = sum(all_right_fy)

        # Path length — total distance travelled
        path_length = sum(all_mags)

        # Directness ratio — 1.0 = straight line, ~0 = circular/random
        directness = (cum_mag / path_length) if path_length > 0 else 0.0

        # Velocity profile — compare first-half vs second-half mean magnitude
        first_half  = all_mags[: max(1, n // 2)]
        second_half = all_mags[max(1, n // 2) :]
        avg_first  = sum(first_half)  / len(first_half)
        avg_second = sum(second_half) / len(second_half)
        vel_ratio = (avg_second / avg_first) if avg_first > 0 else 1.0
        if vel_ratio > 1.35:
            vel_trend = "accelerating (motion intensified toward end)"
        elif vel_ratio < 0.70:
            vel_trend = "decelerating (motion slowed toward end)"
        else:
            vel_trend = "steady speed throughout"

        # Rotational consistency — fraction of pairs with same-sign rot_score
        rot_same_sign = sum(1 for r in all_rot if r * all_rot[0] > 0) / n if n > 0 else 0
        rot_consistent = rot_same_sign > 0.65 and all(abs(r) > 0.2 for r in all_rot)

        traj_lines = []

        # ── Zone-specific hand activity ───────────────────────────────────────
        # Reports what each hand (left/right zone) is doing independently.
        # Key for distinguishing "picking up with right hand while left hand holds".
        LIFT_THRESH = -2.0   # cumulative fy strongly upward
        PLACE_THRESH = 2.0   # cumulative fy strongly downward
        STATIC_THRESH = 1.0  # near-zero = holding / not moving vertically

        def _zone_verdict(cum_fy_zone: float) -> str:
            if cum_fy_zone < -PLACE_THRESH:
                return f"net UPWARD (cum={cum_fy_zone:.1f}) — lifting / pick up"
            elif cum_fy_zone > PLACE_THRESH:
                return f"net DOWNWARD (cum={cum_fy_zone:.1f}) — placing / lowering"
            elif abs(cum_fy_zone) <= STATIC_THRESH:
                return f"near-static (cum={cum_fy_zone:.1f}) — holding or minimal motion"
            else:
                return f"mixed vertical (cum={cum_fy_zone:.1f})"

        # Count per-zone upward events (each frame pair where that zone's fy < threshold)
        # Repeated upward events in one zone = that hand is repeatedly lifting from a surface
        right_up_count = sum(1 for fy in all_right_fy if fy < -1.2)
        left_up_count  = sum(1 for fy in all_left_fy  if fy < -1.2)

        right_verdict = _zone_verdict(cum_right_fy)
        left_verdict  = _zone_verdict(cum_left_fy)
        traj_lines.append(
            f"  RIGHT ZONE (right hand): {right_verdict}"
            + (f", upward events: {right_up_count}/{n}" if right_up_count > 0 else "")
        )
        traj_lines.append(
            f"  LEFT ZONE  (left hand):  {left_verdict}"
            + (f", upward events: {left_up_count}/{n}" if left_up_count > 0 else "")
        )

        # Flag the clearest hand-attribution case directly
        right_up     = cum_right_fy < LIFT_THRESH
        left_up      = cum_left_fy  < LIFT_THRESH
        right_down   = cum_right_fy > PLACE_THRESH
        left_down    = cum_left_fy  > PLACE_THRESH
        right_static = abs(cum_right_fy) <= STATIC_THRESH
        left_static  = abs(cum_left_fy)  <= STATIC_THRESH

        # Repeated pick-up pattern: one zone has significantly more upward events than the other.
        # We use a 2× dominance ratio rather than requiring the other side to be zero,
        # because the picking hand often crosses into the opposite zone during the pass phase,
        # creating spurious upward events there.
        right_dominant = right_up_count >= 2 and right_up_count > left_up_count * 2
        left_dominant  = left_up_count  >= 2 and left_up_count  > right_up_count * 2

        if right_dominant:
            traj_lines.append(
                f"  ★ RIGHT zone has {right_up_count} upward events vs LEFT zone {left_up_count} — "
                "RIGHT HAND is the primary picker (lifts from surface). "
                "LEFT hand is holding/accumulating — NOT performing pick-up."
            )
        elif left_dominant:
            traj_lines.append(
                f"  ★ LEFT zone has {left_up_count} upward events vs RIGHT zone {right_up_count} — "
                "LEFT HAND is the primary picker (lifts from surface). "
                "RIGHT hand is holding/accumulating — NOT performing pick-up."
            )
        elif right_up and left_static:
            traj_lines.append(
                "  ★ RIGHT hand is lifting; LEFT hand is static/holding — "
                "hand doing pick-up is RIGHT HAND"
            )
        elif left_up and right_static:
            traj_lines.append(
                "  ★ LEFT hand is lifting; RIGHT hand is static/holding — "
                "hand doing pick-up is LEFT HAND"
            )
        elif right_up and left_up:
            traj_lines.append("  ★ Both zones show upward motion — both hands picking up / lifting together")
        elif right_down and left_static:
            traj_lines.append(
                "  ★ RIGHT hand is placing/lowering; LEFT hand is static/holding — "
                "hand doing place is RIGHT HAND"
            )
        elif left_down and right_static:
            traj_lines.append(
                "  ★ LEFT hand is placing/lowering; RIGHT hand is static/holding — "
                "hand doing place is LEFT HAND"
            )

        traj_lines.append("")

        # ── Overall trajectory ────────────────────────────────────────────────
        if cum_fy < -3.0 and directness > 0.45:
            confidence = "high" if directness > 0.65 else "moderate"
            traj_lines.append(
                f"  TRAJECTORY: net upward displacement (cum_fy={cum_fy:.1f}), "
                f"directness={directness:.2f} — {confidence}-confidence PICK UP"
            )
        elif cum_fy > 3.0 and directness > 0.45:
            confidence = "high" if directness > 0.65 else "moderate"
            traj_lines.append(
                f"  TRAJECTORY: net downward displacement (cum_fy={cum_fy:.1f}), "
                f"directness={directness:.2f} — {confidence}-confidence PLACE"
            )
        elif abs(cum_fx) > 4.0 and abs(cum_fy) < abs(cum_fx) * 0.5 and directness > 0.40:
            direction = "left" if cum_fx < 0 else "right"
            traj_lines.append(
                f"  TRAJECTORY: net lateral displacement to the {direction} "
                f"(cum_fx={cum_fx:.1f}), directness={directness:.2f} — possible SMOOTHEN or PASS"
            )
        elif rot_consistent and directness < 0.35:
            rot_dir = "clockwise" if all_rot[0] < 0 else "counter-clockwise"
            traj_lines.append(
                f"  TRAJECTORY: low directness ({directness:.2f}) with consistent {rot_dir} "
                f"rotation across {int(rot_same_sign * n)}/{n} frame pairs — ROTATE"
            )
        else:
            traj_lines.append(
                f"  TRAJECTORY: mixed/complex motion — directness={directness:.2f}, "
                f"cum_fy={cum_fy:.1f}, cum_fx={cum_fx:.1f}"
            )

        traj_lines.append(f"  VELOCITY PROFILE: {vel_trend} (speed ratio end/start={vel_ratio:.2f})")

        if vel_ratio < 0.70 and cum_fy > 2.0:
            traj_lines.append("  → Downward + decelerating: high-confidence PLACE (contact deceleration)")
        if vel_ratio > 1.35 and cum_fy < -2.0:
            traj_lines.append("  → Upward + accelerating: high-confidence PICK UP (lifting acceleration)")
        if vel_ratio > 1.20 and abs(cum_fx) > 3.0 and abs(cum_fy) < 2.0:
            traj_lines.append("  → Lateral + accelerating: consistent SMOOTHEN or PUSH motion")

        lines.extend(traj_lines)
        lines.append("")  # blank separator before per-pair detail

    # ── Per-pair event detail ─────────────────────────────────────────────────
    hints = {
        "rotation-cw":   "→ rotating clockwise",
        "rotation-ccw":  "→ rotating counter-clockwise",
        "upward":        "→ upward lift",
        "downward":      "→ downward movement",
        "lateral-left":  "→ moving left",
        "lateral-right": "→ moving right",
        "complex":       "→ multi-directional",
    }
    for frame_num, motion, mag, zone in flow_events:
        strength = "strong" if mag > 5 else "moderate" if mag > 2.5 else "subtle"
        hint = hints.get(motion, "")
        zone_note = f", {zone}" if zone not in ("minimal", "spread across frame") else ""
        lines.append(f"  Frames {frame_num}→{frame_num + 1}: {strength} {motion}{zone_note} {hint}")

    # ── Zone transitions → hand transfer events ───────────────────────────────
    if len(zones) >= 2:
        seq = []
        for z in zones:
            if not seq or z != seq[-1]:
                seq.append(z)
        for i in range(len(seq) - 1):
            a, b = seq[i], seq[i + 1]
            if a == "right side of frame" and b == "left side of frame":
                lines.append("  Zone transition RIGHT→LEFT: likely pass from right hand to left hand")
            elif a == "left side of frame" and b == "right side of frame":
                lines.append("  Zone transition LEFT→RIGHT: likely pass from left hand to right hand")

    # ── Dominant activity zone ────────────────────────────────────────────────
    if zones:
        from collections import Counter
        dominant = Counter(zones).most_common(1)[0][0]
        lines.append(f"  Primary activity zone: {dominant}")

    return "\n".join(lines)


TIER_MAX_FRAMES = {"basic": 6, "standard": 10, "premium": 14}

CONSISTENCY_SYSTEM_PROMPT = """
You are a quality controller for egocentric video action labels. You will receive a complete sequence of labeled segments. Your ONLY task is to fix inconsistencies — do NOT change labels that are already correct or rephrase them stylistically.

Fix ONLY these issues:

1. OBJECT NAME CONSISTENCY — same physical object referred to by different names → standardize to the most specific name used:
   e.g. "shears", "wire stripper", "orange pliers" if clearly the same tool → use one name throughout
   e.g. "green container", "green plastic container", "green lid container" → pick the most descriptive and be consistent

2. LOGICAL CONTINUITY — fix impossible sequences:
   - An object cannot be picked up if the previous segment already has it in hand (no put-down in between)
   - A hand cannot perform two different primary actions simultaneously unless both are listed
   - If seg N ends with placing an object, seg N+1 should not still hold it (unless it was immediately picked back up)

3. LANGUAGE violations:
   - -ing verb forms → base form (stripping → strip, holding → hold)
   - Articles (the/a/an) → remove
   - "and" between actions → replace with ", "
   - Forbidden words: adjust, manipulate, move, transfer, inspect, check, examine, take, handover, give

Return the COMPLETE corrected sequence as valid JSON — all segments, unchanged IDs/timestamps:
{"segments": [{"id": N, "start": "HH:MM:SS", "end": "HH:MM:SS", "label": "..."}, ...]}
""".strip()


def _consistency_pass(segments: list, api_key: str, model: str,
                      base_url: str) -> tuple[list, int, float]:
    """Pass 3: text-only global consistency review across all segment labels."""
    if not segments:
        return segments, 0, 0.0

    emit("consistency_check", total=len(segments))

    seq_text = "\n".join(
        f'  Seg {s["id"]} ({s["start"]}→{s["end"]}): "{s["label"]}"'
        for s in segments
    )
    user_msg = f"Review and fix the following {len(segments)} segment labels:\n\n{seq_text}"

    max_retries = 3
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": CONSISTENCY_SYSTEM_PROMPT},
                        {"role": "user",   "content": user_msg},
                    ],
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data["choices"][0]["message"]["content"]
            tokens = data.get("usage", {}).get("total_tokens", 0)

            corrected = _extract_json(raw).get("segments", [])
            if len(corrected) != len(segments):
                # Segment count mismatch — discard and keep originals
                emit("log", message=f"Consistency pass returned {len(corrected)} segments (expected {len(segments)}), keeping originals.")
                return segments, tokens, 0.0

            # Merge corrected labels back, sanitize, keep original id/timestamps
            result = []
            for orig, fix in zip(segments, corrected):
                label, warnings = _sanitize_label(fix.get("label", orig["label"]))
                for w in warnings:
                    emit("log", message=f"Consistency pass seg {orig['id']}: {w}")
                result.append({"id": orig["id"], "start": orig["start"], "end": orig["end"], "label": label})
            return result, tokens, 0.0

        except requests.exceptions.HTTPError as exc:
            if exc.response.status_code == 429 and attempt < max_retries - 1:
                time.sleep(30 * (attempt + 1))
                continue
            emit("log", message=f"Consistency pass failed ({exc}), keeping originals.")
            return segments, 0, 0.0
        except Exception as exc:
            emit("log", message=f"Consistency pass failed ({exc}), keeping originals.")
            return segments, 0, 0.0


def _label_with_timestamps(frames: list[dict], timestamp_segments: list, context: str,
                            api_key: str, model: str, base_url: str,
                            max_frames_per_seg: int = 10) -> tuple[list, int, float]:
    """Pass 2: label each pre-defined segment with its own API call (3-5 frames each)."""

    def hms_to_seconds(hms: str) -> float:
        parts = hms.strip().split(":")
        if len(parts) == 3:
            h, m, s = parts
            return int(h) * 3600 + int(m) * 60 + float(s)
        elif len(parts) == 2:
            m, s = parts
            return int(m) * 60 + float(s)
        else:
            return float(parts[0])

    video_name_hint = f"Context: {context}" if context else ""

    def sample_frames_for_seg(seg: dict) -> list:
        start_s = hms_to_seconds(seg["start"])
        end_s = hms_to_seconds(seg["end"])
        duration_s = max(0.1, end_s - start_s)
        sf = [f for f in frames if start_s <= f["timestamp"] <= end_s]
        if not sf:
            mid = (start_s + end_s) / 2
            return [min(frames, key=lambda f: abs(f["timestamp"] - mid))]
        # Dynamic cap: 2 frames/sec, min 4, capped by tier max
        target = min(max_frames_per_seg, max(4, int(duration_s * 2)))
        if len(sf) <= target:
            return sf
        # Always anchor on first + last frame (catches put-down / pick-up at boundaries)
        # then fill the middle evenly
        if target <= 2:
            return [sf[0], sf[-1]]
        middle = sf[1:-1]
        n_fill = target - 2
        if not middle:
            return [sf[0], sf[-1]]
        if n_fill >= len(middle):
            return sf
        step = (len(middle) - 1) / (n_fill - 1) if n_fill > 1 else 0
        mid_indices = sorted({round(i * step) for i in range(n_fill)})
        return [sf[0]] + [middle[i] for i in mid_indices] + [sf[-1]]

    n_segs = len(timestamp_segments)
    emit("annotating", frame_count=len(frames), chunks_total=n_segs)

    total_tokens = 0
    total_cost = 0.0
    label_map: dict[int, str] = {}
    accumulated: list[dict] = []

    for seg_idx, seg in enumerate(timestamp_segments):
        seg_frames = sample_frames_for_seg(seg)
        seg_id = seg.get("id", seg_idx + 1)

        # Run local analysis — fast, runs before the LLM call
        motion_summary = _build_motion_summary(seg_frames)

        motion_cues = (
            "HAND CONVENTION (egocentric video): the ego's RIGHT hand appears on the RIGHT side of the frame; "
            "LEFT hand appears on the LEFT side. Use the activity zone in the motion analysis to assign the correct hand.\n"
            "Object transfer between hands → use: pass, hand over, put, switch, set (NOT: transfer, give, handover)\n\n"
            "TEMPORAL ANALYSIS — compare Frame 1 to the last frame:\n"
            "  • Did the fabric/object orientation rotate in-plane? → 'rotate [object]'\n"
            "  • Did the fabric flip over (reverse side now faces up)? → 'flip [object]'\n"
            "  • Did an object leave a surface? → 'pick up [object]'\n"
            "  • Did an object land on a surface? → 'place [object]'\n"
            "  • Did activity zone shift from one side to the other? → 'pass [object] to [hand]'\n"
            "  • Are hands pressing flat along fabric? → 'smoothen [object]'\n"
            "  • Are hands bringing fabric edges together? → 'fold [object]'\n\n"
        )
        generate_add_hint = "If a motion is clearly visible but NOT in the label, add it.\n\n"
        existing_label = seg.get("label", "").strip()
        local_analysis = (f"\n{motion_summary}\n\n") if motion_summary else ""

        # Previous segment context — helps resolve boundary actions (pick-up vs put-down)
        prev_context = ""
        if accumulated:
            prev_segs = accumulated[-2:]
            prev_lines = ["Previously labeled segment(s) — use for continuity and object name consistency:"]
            for ps in prev_segs:
                prev_lines.append(f'  Seg {ps["id"]} ({ps["start"]}→{ps["end"]}): "{ps["label"]}"')
            prev_context = "\n".join(prev_lines) + "\n\n"

        if existing_label:
            task_text = (
                f"The annotator labeled this segment as:\n"
                f'  "{existing_label}"\n\n'
                f"{prev_context}"
                f"Review the {len(seg_frames)} video frames for Segment {seg_id}: {seg['start']} → {seg['end']}. {video_name_hint}"
                f"{local_analysis}"
                f"{motion_cues}"
                "YOUR ROLE: Quality-assure the annotator's label. The annotator watched the full video — trust their action words.\n\n"
                "━━━ GOLDEN RULE — Action verbs are the authority ━━━\n"
                "The annotator's ACTION VERBS (pick up, rotate, fold, flip, place, smoothen, etc.) ARE CORRECT.\n"
                "Do NOT replace or remove any action verb the annotator wrote based on optical flow or visual ambiguity.\n"
                "Your output must preserve all of the annotator's core action verbs.\n\n"
                "━━━ EXCEPTION — Physically incompatible verbs ━━━\n"
                "You MAY replace an annotated verb ONLY when all three conditions hold:\n"
                "  1. The TRAJECTORY block shows HIGH-confidence evidence (directness > 0.65) for a different action\n"
                "  2. The annotated verb is PHYSICALLY INCOMPATIBLE with that trajectory — meaning the two actions\n"
                "     cannot co-occur in the same time window. Use these incompatibility rules:\n"
                "       • 'rotate' or 'flip' → object stays in-plane; incompatible with net vertical travel\n"
                "         – TRAJECTORY shows high-confidence PLACE  → replace 'rotate'/'flip' with 'place'\n"
                "         – TRAJECTORY shows high-confidence PICK UP → replace 'rotate'/'flip' with 'pick up'\n"
                "       • 'place' → object moves downward to surface; incompatible with sustained upward motion\n"
                "         – TRAJECTORY shows high-confidence PICK UP → replace 'place' with 'pick up'\n"
                "       • 'pick up' → object leaves surface; incompatible with sustained downward motion\n"
                "         – TRAJECTORY shows high-confidence PLACE   → replace 'pick up' with 'place'\n"
                "  3. The VELOCITY PROFILE is consistent with the replacement (decelerating → place; accelerating → pick up)\n"
                "If any condition is not met, keep the annotator's verb.\n\n"
                "━━━ RULE 1 — Dual-hand format + correct hand specifications ━━━\n"
                "Output MUST label both hands separately. If the annotator's label only mentions\n"
                "one hand, expand it by adding the other hand's action (usually 'hold [object] with [hand]').\n"
                "  Example: annotator wrote 'cut wire with right hand'\n"
                "  → output: 'hold wire with left hand, cut wire with right hand'\n"
                "Only use 'with both hands' when both hands do the IDENTICAL action symmetrically.\n\n"
                "Hand specifications (left hand / right hand / both hands) CAN be corrected.\n"
                "Use the ★ zone verdict lines in the motion analysis:\n\n"
                "CRITICAL — 'pick up' means taking an object FROM A SURFACE (table, shelf, floor).\n"
                "A hand that is RECEIVING or HOLDING objects passed from the other hand is NOT picking up.\n"
                "  • '★ RIGHT zone has N upward events; LEFT zone has none' → ONLY the right hand picks up.\n"
                "    The left hand is holding/accumulating. Remove any 'pick up with left hand' label.\n"
                "  • '★ LEFT zone has N upward events; RIGHT zone has none' → ONLY the left hand picks up.\n"
                "    The right hand is holding/accumulating. Remove any 'pick up with right hand' label.\n"
                "  • '★ RIGHT hand is lifting; LEFT hand is static/holding' → correct hand to RIGHT HAND\n"
                "  • '★ LEFT hand is lifting; RIGHT hand is static/holding' → correct hand to LEFT HAND\n"
                "  • 'near-static' in a zone = that hand is holding, not picking up\n\n"
                "When one hand repeatedly picks up and passes objects to the other hand:\n"
                "  → Label: 'pick up [object] with [active hand]' only.\n"
                "  → Do NOT add a second 'pick up' for the receiving/holding hand.\n\n"
                "SPECIAL CASE — Two 'pick up' labels in the same segment:\n"
                "If the annotator wrote 'pick up with [hand A]' AND 'pick up with [hand B]' in the same segment,\n"
                "this almost always means one hand is the picker and the other is the accumulator/holder.\n"
                "  • Check the ★ line: whichever zone has more upward events is the picking hand.\n"
                "  • Remove the 'pick up' for the hand with fewer upward events.\n"
                "  • If the motion analysis is ambiguous, default to keeping only 'pick up with right hand'\n"
                "    (in egocentric video the dominant hand is typically the right hand).\n\n"
                "━━━ RULE 2 — Only add a missing action if evidence is overwhelming ━━━\n"
                "You may add ONE extra action ONLY when ALL of the following are true:\n"
                "  a) The action is completely absent from the annotator's label (not implied by existing words)\n"
                "  b) The local motion analysis shows clear, unambiguous evidence for it across the majority of frame pairs\n"
                "  c) The new action is a different event, not a different interpretation of an existing one\n"
                "  d) Total actions after adding ≤ 3\n"
                "If uncertain, DO NOT add it. When in doubt, keep the annotator's label as-is.\n\n"
                "━━━ RULE 3 — Fix guideline violations (language only) ━━━\n"
                "  - Forbidden word used: adjust, manipulate, move, transfer, inspect, check, examine, reach, pick (alone), take, grasp, handover, give\n"
                "  - Verb is in -ing form → use base form (smoothening → smoothen, folding → fold)\n"
                "  - Hand specification entirely absent and it would add meaningful information → add it; don't force it awkwardly per-action\n"
                "  - Articles present (the/a/an) → remove them\n"
                "  - Multiple actions joined with 'and' → replace with ', ' (comma)\n"
                "  - Label exceeds 20 words → shorten\n\n"
                f"Return ONLY valid JSON with exactly 1 segment:\n"
                f'{{"segments": [{{"id": {seg_id}, "start": "{seg["start"]}", "end": "{seg["end"]}", "label": "<corrected label>"}}]}}'
            )
        else:
            task_text = (
                f"Label this segment — Segment {seg_id}: {seg['start']} → {seg['end']}. {video_name_hint}\n"
                f"{prev_context}"
                f"{local_analysis}"
                f"Study the {len(seg_frames)} frames as a sequence.\n"
                f"{motion_cues}"
                f"{generate_add_hint}"
                "DUAL-HAND FORMAT: always label both hands. Non-dominant hand is usually 'hold [object] with [hand]'.\n"
                "  ✓ hold wire with left hand, cut wire with shears in right hand\n"
                "  ✓ hold cup with left hand, pick up lid with right hand\n"
                "Only use 'with both hands' when both hands do the identical, symmetrical action.\n\n"
                "DENSE labeling: this segment may contain 2–3 distinct atomic actions. Do NOT collapse into one generic verb.\n"
                "Separate multiple actions with ', ' (comma) — never use 'and' between actions.\n"
                "Do NOT default to 'fold towel' when uncertain — if the orientation changed but you cannot tell how, use 'rotate' or 'flip' based on the cues above.\n\n"
                f"Return ONLY valid JSON with exactly 1 segment:\n"
                f'{{"segments": [{{"id": {seg_id}, "start": "{seg["start"]}", "end": "{seg["end"]}", "label": "<label with hand specification>"}}]}}'
            )

        content = [{"type": "text", "text": task_text}]
        for f in seg_frames:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{f['b64']}"}})

        output_segs, tokens, cost = _call_label_batch_request(content, api_key, model, base_url)
        total_tokens += tokens
        total_cost += cost

        raw_label = output_segs[0].get("label", "no action") if output_segs else "no action"
        label, warnings = _sanitize_label(raw_label)
        for w in warnings:
            emit("log", message=f"Segment {seg_id} ({seg['start']}→{seg['end']}): {w}")
        label_map[seg_idx] = label

        accumulated.append({"id": seg_idx + 1, "start": seg["start"], "end": seg["end"], "label": label})
        emit("partial_segments", segments=list(accumulated))
        emit("annotating_progress", chunks_done=seg_idx + 1, chunks_total=n_segs, from_cache=False)

    merged = [
        {"id": i + 1, "start": ts["start"], "end": ts["end"], "label": label_map.get(i, "no action")}
        for i, ts in enumerate(timestamp_segments)
    ]

    # Pass 3: global consistency review (text-only, no images)
    merged, consistency_tokens, consistency_cost = _consistency_pass(
        merged, api_key, model, base_url
    )
    total_tokens += consistency_tokens
    total_cost += consistency_cost

    return merged, total_tokens, total_cost


def _call_llm_single(frames: list[dict], context: str, api_key: str, model: str,
                     base_url: str) -> tuple[list, int, float]:
    """Send one batch of frames to the LLM and return (segments, tokens, cost_usd)."""
    video_name_hint = f"Context: {context}" if context else ""
    start_ts = frames[0]["time_str"] if frames else "00:00:00"
    end_ts = frames[-1]["time_str"] if frames else "00:00:00"
    content = [
        {
            "type": "text",
            "text": (
                f"Annotate ALL actions in this video segment ({len(frames)} frames, {start_ts} to {end_ts}). "
                f"{video_name_hint}\n"
                "Return only valid JSON matching the format in your instructions."
            ),
        }
    ]

    for f in frames:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{f['b64']}"}})

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": ANNOTATION_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "max_tokens": 1024,
    }

    payload["stream"] = True

    raw_text = ""
    tokens_used = 0
    generation_id = ""
    last_emit = 0

    max_retries = 5
    for attempt in range(max_retries):
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=300,
                stream=True,
            )
            resp.raise_for_status()

            raw_text = ""
            tokens_used = 0
            generation_id = ""
            last_emit = 0

            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    if not generation_id:
                        generation_id = chunk.get("id", "")
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        raw_text += delta
                        if len(raw_text) - last_emit >= 40:
                            emit("stream_chars", chars=len(raw_text))
                            last_emit = len(raw_text)
                    usage = chunk.get("usage") or {}
                    if usage.get("total_tokens"):
                        tokens_used = usage["total_tokens"]
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass
            break  # success
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code
            if status == 429 and attempt < max_retries - 1:
                wait = 30 * (attempt + 1)  # 30s, 60s
                emit("stream_chars", chars=0)
                time.sleep(wait)
                continue
            if status == 402:
                try:
                    detail = exc.response.json().get("error", {}).get("message", "")
                except Exception:
                    detail = ""
                raise RuntimeError(f"Token exhaustion: OpenRouter account has insufficient credits. {detail}".strip())
            raise
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError) as exc:
            if attempt == max_retries - 1:
                raise
            wait = 2 ** (attempt + 1)  # 2s, 4s
            emit("stream_chars", chars=0)
            time.sleep(wait)

    cost_usd = fetch_generation_cost(generation_id, api_key, base_url) if generation_id else 0.0

    segments = _extract_json(raw_text).get("segments", [])
    return segments, tokens_used, cost_usd


def call_llm(frames: list[dict], context: str, api_key: str, model: str,
             base_url: str, screenshots: list = [], video_path: str = "",
             fps: float = 1.0, max_frames_per_seg: int = 10) -> tuple[list, int, float]:
    if screenshots:
        # Pass 1: extract timestamps from screenshots (shown as indeterminate in UI)
        emit("annotating", frame_count=len(frames), chunks_total=1)
        timestamp_segments = _extract_timestamps(screenshots, api_key, model, base_url)
        if not timestamp_segments:
            raise RuntimeError("Could not extract any timestamps from the reference screenshots")
        # Pass 2: _label_with_timestamps emits its own annotating event + per-segment progress
        segments, tokens, cost = _label_with_timestamps(
            frames, timestamp_segments, context, api_key, model, base_url,
            max_frames_per_seg=max_frames_per_seg,
        )
        return segments, tokens, cost

    # Small jobs: single call (no chunking)
    if len(frames) <= CHUNK_SIZE:
        emit("annotating", frame_count=len(frames), chunks_total=1)
        return _call_llm_single(frames, context, api_key, model, base_url)

    # Large jobs: split into parallel chunks for speed, with per-chunk caching for resume
    chunks = [frames[i:i + CHUNK_SIZE] for i in range(0, len(frames), CHUNK_SIZE)]

    # Count how many chunks are already cached (from a previous failed run)
    cached_count = sum(1 for i in range(len(chunks)) if _load_chunk_cache(video_path, fps, i))
    workers = min(len(chunks), 4)
    emit("annotating", frame_count=len(frames), chunks_total=len(chunks), cached=cached_count)

    chunk_lock = threading.Lock()
    chunks_done = [0]

    def _process_chunk(args):
        chunk, chunk_idx = args
        # Try cache first (resume support)
        cached = _load_chunk_cache(video_path, fps, chunk_idx)
        if cached:
            with chunk_lock:
                chunks_done[0] += 1
                emit("annotating_progress", chunks_done=chunks_done[0],
                     chunks_total=len(chunks), from_cache=True)
            return cached["segments"], cached["tokens"], cached["cost"]

        segments, tokens, cost = _call_llm_single(chunk, context, api_key, model, base_url)
        _save_chunk_cache(video_path, fps, chunk_idx, segments, tokens, cost)
        with chunk_lock:
            chunks_done[0] += 1
            emit("annotating_progress", chunks_done=chunks_done[0],
                 chunks_total=len(chunks), from_cache=False)
        return segments, tokens, cost

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_process_chunk, (chunk, i)) for i, chunk in enumerate(chunks)]
        chunk_results = [f.result() for f in futures]

    # Merge chunks: renumber segment IDs sequentially
    all_segments, total_tokens, total_cost, seg_id = [], 0, 0.0, 1
    for segments, tokens, cost in chunk_results:
        for seg in segments:
            seg["id"] = seg_id
            seg["label"], warnings = _sanitize_label(seg.get("label", ""))
            for w in warnings:
                emit("log", message=f"Segment {seg_id}: {w}")
            all_segments.append(seg)
            seg_id += 1
        total_tokens += tokens
        total_cost += cost

    return all_segments, total_tokens, total_cost


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--tier", default="standard", choices=["basic", "standard", "premium"])
    parser.add_argument("--frames-per-sec", type=float, default=None)
    parser.add_argument("--context", default="")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--model", default="google/gemini-2.5-flash:free")
    parser.add_argument("--api-url", default="https://openrouter.ai/api/v1")
    parser.add_argument("--annotation-id", type=int, default=None)
    parser.add_argument("--screenshots", nargs="*", default=[])
    args = parser.parse_args()

    # Default frames per second per tier (overridable by backend setting)
    tier_defaults = {"basic": 2.0, "standard": 4.0, "premium": 8.0}
    fps = args.frames_per_sec or tier_defaults[args.tier]
    max_frames_per_seg = TIER_MAX_FRAMES[args.tier]

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
            video_path=args.video,
            fps=fps,
            max_frames_per_seg=max_frames_per_seg,
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
