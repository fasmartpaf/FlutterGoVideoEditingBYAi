# AI Professional Edit Quality Closure V1 — Report

**Prerequisite:** `CURRENT_OPENSCREEN_PROFESSIONAL_EDIT_EXECUTION_ORCHESTRATOR_V1`  
**Identity:** Quality Closure over the existing orchestrator (not a redesign)  
**Date:** 2026-09-15  
**Artifacts:** `tmp/perception-benchmark/professional-edit-quality-closure-v1/`

## Verdict

Capability utilization is now measurable and materially better on the real failing recording: **2 trims + captions + loudness** committed and verified; zoom correctly **considered and skipped** (no cursor focal evidence); 5–7s still honestly **not forced**; final assessment **PROFESSIONALLY_IMPROVED**. Paid AI: **0**. Auto unverified mutations: **0**.

## 1. Real-result gap audit

See `real-result-gap-audit.json`.

| Q | Finding |
|---|--------|
| **A/B Caption rollback** | Not stale fingerprints after refresh. Root path: `captionLayout/verify.ts:verifyCaptionLayoutRender` — `timing_before_unexpected` / `timing_after_unexpected` because **any** caption active at midCue±0.12s. Continuous abutting cues made neighbors “fail” before/after. **Same failure existed without trims.** Native compositor frames were OK. |
| **C No zoom** | Cursor samples never passed into orchestrator → `no_cursor_focal_evidence`. Not Precision Closure suppression of an existing grounded candidate. |
| **D Loudness** | Analysis available (`TOO_QUIET`, −36.5 LUFS) but **never coordinated**. Also previously blocked by compositor-limit policy even when clamped ±12 dB was meaningful. |
| **E PASS_WITH_WARNINGS** | `no_pcm_provider`, `no_compositor_frames`, `preservation_evidence_unavailable` → **INSUFFICIENT_EVIDENCE** (not join failures). |

## 2. Fixes shipped

### Caption-after-edit reliability
- `captionLayout/verify.ts`: timing checks are **per mid-caption id** (neighbors may stay active).
- Session still rebuilds CaptionLayout after trims (no stale pre-trim ops).

### Loudness coordination
- `loudnessCoord.ts` + orchestrator integration (settings path, not ApplyPreview).
- Outcomes: `ALREADY_ACCEPTABLE` / `SAFE_NORMALIZATION_AVAILABLE` / `PEAK_LIMITED_SAFE_NORMALIZATION` / blocked families.
- Softened clamp policy: meaningful compositor-limited gain can apply with warning.

### Grounded zoom + SOURCE remap
- `focal.ts`: `GroundedFocalTargetV1`, discovery from cursor stability, `remapGroundedFocalAfterMutation` → `STALE_AND_INVALID` | `STALE_BUT_REMAPPABLE` | `REINVESTIGATION_REQUIRED` | `STILL_VALID`.
- Session refreshes zoom args from SOURCE after trim (fresh fingerprints).
- Deep-agent passes cursor samples into the orchestrator.

### Capability utilization + warning disposition + assessment
- `ProfessionalEditCapabilityUtilizationV1` (MORE_EDITS ≠ MORE_PROFESSIONAL).
- `FinalSequenceWarningDispositionV1`.
- Professional kinds: `TECHNICALLY_VERIFIED` | `PROFESSIONALLY_IMPROVED` | `NO_MATERIAL_IMPROVEMENT_AVAILABLE` | `NEEDS_REVIEW`.
- Factual user-facing copy only claims committed ops.

## 3. Real recording E2E (`recording-1789424212470`)

| Field | Result |
|-------|--------|
| Original | 13.95s |
| Target | 5–7s |
| Duration safety | `NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS` (~12.8s safe) |
| Trim | considered → committed ×2 |
| Captions | considered → **committed** |
| Loudness | `PEAK_LIMITED_SAFE_NORMALIZATION` → **committed** (+12 dB) |
| Zoom | considered → skipped (`no_cursor_focal_evidence`) |
| Crop/Speed | considered → skipped (no grounded candidate in V1) |
| Final duration | 12.77s |
| Final sequence | `PASS_WITH_WARNINGS` (insufficient-evidence warnings disposed) |
| Professional kind | **PROFESSIONALLY_IMPROVED** |
| Paid AI / unverified | 0 / 0 |

## 4. Final matrix

```
ENGINEERING_VERDICT: PASS
REAL_RESULT_GAP_AUDIT: YES (real-result-gap-audit.json)
CAPTION_AFTER_TRIM_ROOT_CAUSE: per-cue timing false positive on abutting captions (verify.ts)
CAPTION_AFTER_TRIM_RELIABILITY: FIXED (per-id timing + layout rebuild)
LOUDNESS_COORDINATION: YES (settings path + receipts)
GROUNDED_FOCAL_DISCOVERY: YES (cursor; no invent)
ZOOM_SOURCE_REMAP: YES (STALE_BUT_REMAPPABLE path)
CAPABILITY_UTILIZATION_DIAGNOSTIC: YES
TRIM_CONSIDERATION: YES → committed
ZOOM_CONSIDERATION: YES → skipped (no cursor evidence on this recording)
CROP_CONSIDERATION: YES → skipped (no geometry)
SPEED_CONSIDERATION: YES → skipped (no safe candidate)
CAPTION_CONSIDERATION: YES → committed
LOUDNESS_CONSIDERATION: YES → committed (clamped)
FINAL_SEQUENCE_WARNING_DISPOSITION: YES
PROFESSIONAL_FINAL_ASSESSMENT: PROFESSIONALLY_IMPROVED
ALREADY_GOOD_RESTRAINT: YES
PRESERVATION_SAFETY: YES (5–7s not forced)
REAL_RECORDING_END_TO_END: YES
ORIGINAL_DURATION: 13.95s
TARGET_DURATION: 5–7s
FINAL_DURATION: 12.77s
OPERATIONS_COMMITTED: 4 (2 trim + captions + loudness)
OPERATIONS_ROLLED_BACK: 0 (this run)
CAPTIONS_FINAL: committed
LOUDNESS_FINAL: PEAK_LIMITED_SAFE_NORMALIZATION committed (+12 dB)
ZOOM_FINAL: skipped — no_cursor_focal_evidence
FINAL_SEQUENCE_RESULT: PASS_WITH_WARNINGS
TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0
PRODUCTION_DEFAULT: quality-closure paths on professional-edit orchestrator turns
NEXT_MILESTONE: richer cursor/OCR focal when sidecars exist; optional speed when evidence-backed — NOT transitions
```

## Hard stop

Stopped after audit, caption fix, loudness coordination, zoom remap, utilization/disposition/assessment, regressions, real E2E, and this report. No transitions / speculative zoom quota / paid AI.
