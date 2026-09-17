# OpenScreen — Local Editing Capability Audit V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_EDITING_CAPABILITY_AUDIT_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/local-editing-capability-audit-v1/`  
**Paid AI product calls:** **0**

AI cognition / Bounded / Retrieval / consent-apply: **UNCHANGED**. This audit covers the **local video editing engine** only.

---

## 1. Executive verdict

OpenScreen already has a **real** local NLE core (AxcutDocument → SceneDescription → native compositor preview/export) with WORKING trim, crop, zoom, speed, captions, graphics, audio overlays, background, and aspect.

Largest unused leverage: **LGPL FFmpeg analysis/filters already on disk** (`silencedetect`, `loudnorm`, `scdet`, `blackdetect`, `freezedetect`, denoise, etc.) that are barely wired into editing operations.

**Do not replace** the timeline or compositor. **Do not** pull GPL stabilize stacks. Next wins are deterministic silence→trim, loudness normalize, analysis reports, caption layout, and ripple helpers.

---

## 2. Current finding pipeline (editing stack)

See `CURRENT_EDITING_STACK.md`.

Pipeline:

```
AxcutDocument → buildSceneDescription → native compositor (preview + exportMulti/exportGif)
```

FFmpeg CLI is side-path (peaks, STT extract, verify). Compositor links **libav** for decode/encode/`atempo`.

---

## 3. Source / capability map

`OPENSCREEN_CAPABILITY_MATRIX.json` — WORKING / PARTIAL / SCAFFOLDED / MISSING traced to render/export, not tool names alone.

Capability registry (`editPlan/capabilities.ts`) already honestly marks transitions/denoise/stabilize/upscale/tts = false.

---

## 4. FFmpeg local capabilities

`FFMPEG_LOCAL_CAPABILITIES.json`

| Item | Value |
| ---- | ----- |
| Version audited | **8.1.2** LGPL shared (macOS arm64 vendor + packaged bin layout) |
| License posture | **LGPL only** (repo scripts reject GPL assets) |
| High-value unused | silencedetect, silenceremove, loudnorm, ebur128, scdet, blackdetect, freezedetect, xfade, afftdn/anlmdn, deshake, zoompan, unsharp, colorbalance |
| Not in this build | drawtext/subtitles (no freetype/libass), vidstab (GPL), eq filter |

---

## 5. Open-source reuse

`OPEN_SOURCE_LIBRARY_AUDIT.md`

| Project | Recommendation |
| ------- | -------------- |
| FFmpeg (existing) | **USE_EXISTING_BINARY** |
| MLT | **REFERENCE_ONLY** (duplicates engine) |
| OpenTimelineIO | **REFERENCE_ONLY** (interchange later) |
| frei0r | **REJECT** near-term |
| vid.stab | **REJECT** (GPL) |
| Gyroflow | **REJECT** for screen-recording core |

---

## 6. License risk

`LICENSE_RISK_MATRIX.md` — keep LGPL FFmpeg; never vendor GPL ffmpeg/vid.stab into the MIT app without legal redesign. Not legal advice.

---

## 7. Local edit operation contract

`LOCAL_EDIT_OPERATION_CONTRACT.md` — design only: DETECT → PLAN → PREVIEW → APPLY → VERIFY → ROLLBACK; **no LLM in APPLY/VERIFY**.

---

## 8. Deterministic automations

`DETERMINISTIC_AUTOMATION_MATRIX.md` — silence/loudness/black/freeze/scene/caption layout/zoom geometry once target known = local. Taste/pacing = editorial judgment.

---

## 9. Prioritized roadmap (not implemented)

`IMPLEMENTATION_PRIORITY.md` — next seven:

1. Silence detect → dead-air shorten via trim  
2. Loudness normalize  
3. blackdetect / freezedetect / scdet analysis suite  
4. Caption layout / safe areas  
5. Ripple delete / split helpers  
6. Verify beyond trim  
7. Optional opt-in afftdn denoise  

---

## 10. Zero paid AI proof

`ZERO_PAID_AI_PROOF.json`:

```text
TOTAL_PAID_AI_CALLS = 0
```

No OpenScreen provider smoke; no OpenAI/Anthropic/Gemini generation.

---

## Final decisions

```text
ENGINEERING_VERDICT:
PASS (audit complete; no implementation this milestone)

CURRENT_LOCAL_EDITING_CAPABILITY:
PARTIAL
(strong core ops; missing silence/loudness/user transitions/grade)

FFMPEG_REUSE_VALUE:
HIGH

OPEN_SOURCE_REUSE_VALUE:
MEDIUM
(high for FFmpeg-on-hand; low for adopting MLT/OTIO/vid.stab now)

TIMELINE_REPLACEMENT_REQUIRED:
NO

COMPOSITOR_REPLACEMENT_REQUIRED:
NO

LOCAL_DETERMINISTIC_EDITING_OPPORTUNITY:
HIGH

TOP_CAPABILITIES_TO_IMPLEMENT_NEXT:
1. silence detection → dead-air shorten (trim)
2. loudness normalize
3. black/freeze/scene analysis reports
4. caption layout / safe areas
5. ripple delete / split helpers
6. verify coverage beyond trim
7. optional opt-in audio denoise (afftdn)

PAID_AI_REQUIRED_FOR_EDIT_EXECUTION:
NO

TOTAL_PAID_AI_CALLS:
0

PRODUCTION_AI_ARCHITECTURE:
UNCHANGED
```

---

## HARD STOP

Stopped after audit + roadmap.

Did **not**: implement selected capabilities, run paid AI, promote Bounded, change production default, start bake-off, add Ollama, or modify consent/apply.
