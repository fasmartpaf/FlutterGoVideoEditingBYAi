# OpenScreen — Local Dead-Air Visual Safety V1.1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1`  
**Extends:** `CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/local-dead-air-visual-safety-v1-1/`  
**Code:** `electron/ai-edition/deadAir/visualSafety.ts`, `visualActivityTypes.ts`, `visualPolicy.ts`, `ffmpegVisualProbes.ts`  
**Paid AI:** **0**

---

## 1. Executive verdict

Visual activity safety upgraded from cursor-only to a multi-signal gate. `safeToPropose` now requires speech + programme + **visual** pass. Useful silent visuals (significant change / OCR text / clicks) are blocked. Safe-candidate precision on the offline corpus: **1.0**. Critical false positives: **0**.

---

## 2. V1 safety gap

V1 blocked non-move cursor hits only. Silent screen changes, scene cuts, and text appearance could still be proposed for removal.

---

## 3. Existing visual evidence audit

See `visual-signal-audit.json`.

| Signal | Class |
| ------ | ----- |
| Bug-3 change scores | AVAILABLE_REUSABLE |
| Ledger `visual_transition` / cursor | AVAILABLE_REUSABLE |
| Cursor sidecar | AVAILABLE_REUSABLE |
| Bounded FFmpeg scene select | AVAILABLE_REUSABLE |
| blackdetect / freezedetect | AVAILABLE_REUSABLE (observe only) |
| OCR cache | AVAILABLE_BUT_EXPENSIVE (reuse only) |
| Full visual prepare turn | AVAILABLE_BUT_EXPENSIVE |
| Model semantic chrome | NOT_RELEVANT |

---

## 4. VisualActivity contract

`VisualActivityEvidence` + `VisualActivityAssessment` (`visualActivityTypes.ts`):

Kinds: `CURSOR_INTERACTION`, `SIGNIFICANT_VISUAL_CHANGE`, `MODERATE_VISUAL_CHANGE`, `SCENE_CHANGE`, `VISIBLE_TEXT_CHANGE`, `BLACK_FRAME`, `FREEZE`, …

States: `NO_MATERIAL_VISUAL_ACTIVITY` | `MATERIAL_VISUAL_ACTIVITY` | `UNCERTAIN_VISUAL_ACTIVITY`

---

## 5. Change detection integration

Prepared `VisualChange[]` (Bug-3) preferred. Significant → block. Moderate → uncertain; density ≥2 → material.

---

## 6. Cursor integration

Non-move sidecar + ledger `cursor_interaction` → blocking. Move-only ignored.

---

## 7. OCR reuse

Cached / injected OCR observations and ledger `observed_visible_text` block. **No OCR provider / no paid AI OCR.**

---

## 8. scdet fallback

When speech-safe and no prepared changes: bounded `probeSceneTimesInRange` (ffmpeg `select='gt(scene,thr)'`) on silence ± padding. Scene hits inside proposed removal → block. Not whole-video.

---

## 9. Black / freeze

`blackdetect` / `freezedetect` → **observational only**. Never unlock `safeToPropose` alone. Never imply disposable.

---

## 10. Visual safety policy

`DEFAULT_VISUAL_SAFETY_POLICY` / `visual-policy.json`: edge padding 0.2s, scene thr 0.08, moderate density 2, cursor block, text block, scdet fallback on.

---

## 11. Source / programme

Visual analysis SOURCE_MEDIA_TIME. Silence analysis cache unchanged. Programme remap still recomputes candidate removability.

---

## 12. Real corpus

| Case | Result |
| ---- | ------ |
| narrated stable pause | safe + scdet fallback ran, NO_MATERIAL |
| cursor / click-heavy families | no silence intervals or no-audio |
| useful silent visual (injected significant) | MATERIAL, not safe |
| case4 trailing | trailing block (speech policy) |
| short pauses | TOO_SHORT |

---

## 13–15. Ground truth / precision / critical FP

- Safe-candidate precision: **1.0** (1/1 TRUE_DEAD_AIR)
- Critical false positives (USEFUL_SILENT_VISUAL marked safe): **0**

---

## 16. Performance

Existing-evidence path is ms-scale. FFmpeg fallback only when speech-safe without prepared changes (~seconds per candidate window, not whole file). Silence cache warm hits unchanged.

---

## 17. Apply regression

- Visual-blocked → no proposal / no mutation  
- Safe → consent → addTrim → compositor + audio verify  
- No consent → 0 mutation  
- V1 speech/keep-pause/trailing/already-removed regression: **green** (40 tests in `deadAir/`)

---

## 18. Tests

- `deadAirVisualSafetyV1_1.test.ts`  
- `deadAirVisualSafetyV1_1.corpus.runtime.test.ts`  
- `deadAirV1.test.ts` + corpus still pass  

---

## 19. Paid AI proof

```text
TOTAL_PAID_AI_CALLS = 0
```

---

## 20. Remaining limitations

- Scene fallback uses existing `select=gt(scene)` wrapper (not filter name `scdet`)
- OCR only when observations already available
- Black/freeze not used as positive dead-air unlockers (by design)
- Some click-heavy recordings have no FFmpeg silence intervals under V1 detector params

---

## 21. Next local capability

**loudness_normalize_v1** (FFmpeg `loudnorm` → reviewable proposal)

---

## Final decisions

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS

VISUAL_ACTIVITY_SAFETY: PASS
EXISTING_VISUAL_EVIDENCE_REUSE: PASS
SCDET_FALLBACK: PASS
OCR_SAFETY_REUSE: PARTIAL
BLACK_FREEZE_HANDLING: PASS
USEFUL_SILENT_VISUAL_PROTECTION: PASS
SAFE_CANDIDATE_PRECISION: 1.0
CRITICAL_FALSE_POSITIVES: 0
APPLY_PATH_REGRESSION: PASS
TOTAL_PAID_AI_CALLS: 0
DEAD_AIR_V1: READY_FOR_PRODUCT_INTEGRATION
NEXT_LOCAL_CAPABILITY: loudness_normalize_v1
```

---

## HARD STOP

Stopped after report. Did **not** implement loudness, multi-silence auto-apply, cognition changes, paid providers, or consent/apply redesign.
