# OpenScreen — Local Visual Analysis Suite V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_VISUAL_ANALYSIS_V1`  
**Date:** 2026-09-15  
**Code:** `electron/ai-edition/visualAnalysis/`  
**Artifacts:** `tmp/perception-benchmark/local-visual-analysis-v1/`  
**Paid AI:** **0**

Canonical deterministic visual-analysis service over `SOURCE_MEDIA_TIME`. Not an editing effect. No LLM.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** One reusable `VisualAnalysisV1` path now answers change / scene / black / freeze / stable / activity with provenance, cache, and source→programme mapping. Dead-air can consume it without re-decoding when coverage exists. Sparse Bug-3 sampling and non-semantic detectors remain hard limits (HUD OCR not replaced; scene ≠ narrative).

---

## 2. Existing analysis audit

See `current-audit.json` / `visual-analysis-current-audit.json`.

| Path | Classification |
|------|----------------|
| Bug-3 `visualEvidence/change.ts` | **UNIFY** (canonical change thresholds) |
| Frame extract | **KEEP** |
| `sceneDetect` + deadAir ffmpeg parsers | **WRAP** |
| deadAir `visualSafety` | **UNIFY** (adapter to suite) |
| Temporal Event Ledger | **SPECIALIZED_ONLY** |
| compositorVerify | **SPECIALIZED_ONLY** (programme-time) |
| VisualAnalysisV1 | **KEEP** (new canonical) |

Nothing deleted; duplication deferred (`DEPRECATE_LATER` none this milestone).

---

## 3. Canonical architecture

```text
SOURCE VIDEO
  → reuse prepared Bug-3 changes (if any)
  → else sample frames (~2s) + Bug-3 MAD
  → parallel FFmpeg: blackdetect / freezedetect / scene
  → cursor sidecar (non-move)
  → derive activity + stable
  → cache SOURCE_VISUAL_ANALYSIS
  → VisualAnalysisV1
```

Timebase: **SOURCE_MEDIA_TIME** only. No model-generated semantics.

---

## 4. Change events

`VisualChangeEvent` with `MINIMAL | MODERATE | SIGNIFICANT`.  
Thresholds reused: `CHANGE_MINIMAL_MAX=0.04`, `CHANGE_MODERATE_MAX=0.09` (Bug-3 validated).

---

## 5. Scene events

FFmpeg `select=gt(scene,0.08)`.  
**SCENE_CHANGE = pixel/content transition only** — not chapter, not safe trim, not narrative scene.

---

## 6–7. Black / freeze

`blackdetect` / `freezedetect` → intervals with `observationOnly: true`.  
Never imply removable.

---

## 8–9. Stable / activity

- **Stable** = visual state changes little (`meaning: visual_state_changes_little`). Speech may continue.
- **Activity** = material visible activity (significant, scene, cursor, moderate density). No UI meaning inferred.

---

## 10. Cache

Key: path + size + mtime + detector suite version + parameters.  
Programme trims do **not** invalidate source analysis.  
Warm cache: ~30–70 ms, **0 decode passes** after cold write.

---

## 11. Source → programme mapping

`mapSourceRangeToProgramme` / `mapSourceInstantToProgramme` via `resolvePlaybackSegments`.  
Trimmed-away source ranges → `removed` / empty programme ranges (unit-proven).

---

## 12. Corpus results

10 local media cases (macOS). Highlights:

| id | dur | sig | mod | scene | freeze | stable | active | cold decode |
|----|-----|-----|-----|-------|--------|--------|--------|-------------|
| bug5-narrated | 16.9 | 0 | 3 | 0 | 10 | 11.9 | 4.3 | 13* |
| case020 | 21.4 | 0 | 4 | 0 | 12 | 16.8 | 4.6 | 15* |
| case2-hud | 19.9 | 2 | 2 | 1 | 6 | 15.6 | 4.3 | 14* |
| upwork | 16.8 | 4 | 2 | 3 | 6 | 8.2 | 8.6 | 13* |
| longest-29s | 28.9 | 10 | 0 | 7 | 12 | 7.3 | 20.9 | 19* |
| no-audio-silent | 4.9 | 0 | 0 | 0 | 0 | 4.0 | 0.8 | 7* |

\*Cold decode counts after frame-JPEG reuse from prior run; first-ever cold is higher (~frame seeks + 3 filter passes). Warm: **0** decode passes, cache hit.

Black intervals: **0** across this corpus (none truly black).

---

## 13. Manual event review

Heuristic labels only (not exhaustive GT). Sampled significant/moderate/scene from bug5, case020, visually-changing, case2-hud.  
Do **not** claim full recall. Precision proxies recorded in `manual-event-review.json`.

---

## 14. Case020

No hardcoded 12–15s times in production suite sources.  
Natural find in post-hoc 10–18s inspect window: **6** change pairs, **3 moderate** (12–14 @0.080, 14–16 @0.073), **0 significant**, **0 scene**, **1 activity** interval. Useful local activity captured via moderate density — not special-cased.

---

## 15. Case2 HUD

Honest: general change detection ≠ OCR. This media also showed larger motion (2 significant, 1 scene, max magnitude ~0.15) — not HUD-only. A tiny Restart control alone may still score only MINIMAL and miss scene.

---

## 16. Dead-air integration

Adapter: `assessVisualActivityFromAnalysis` → prepared changes + scene/black/freeze from analysis; skips FFmpeg when coverage includes silence.

Regression (`dead-air-regression.json`):

- useful visual during silence **blocks** (`MATERIAL_VISUAL_ACTIVITY`)
- stable silence **passes** (`NO_MATERIAL_VISUAL_ACTIVITY`)
- legacy significant-change parity held; **no ffmpeg fallback** on canonical path
- V1.1 unit tests still green

---

## 17. Performance / decode passes

| Mode | Typical | Decode passes |
|------|---------|---------------|
| Cold (filters + sample) | ~1.5–9 s | frame seeks + **3** FFmpeg VFs (+ gray thumbs) |
| Warm cache | ~30–70 ms | **0** |
| Source→programme map | &lt;1 ms | 0 |

Goal advanced: one source analysis feeds many consumers; dead-air no longer needs per-silence scene decode when analysis is supplied.

---

## 18. Cross-platform

**Proven live:** macOS (`darwin`) arm64 with bundled LGPL FFmpeg.  
Windows / Linux: **NOT_RUN** — do not claim verification.

---

## 19. Tests

- Unit: `visualAnalysisV1.test.ts` (change normalize, derive, map, cache, Case020 no hardcode, dead-air adapter, observationOnly, paid AI=0)
- Corpus: `visualAnalysisV1.corpus.runtime.test.ts`
- Dead-air V1.1 units: still pass

---

## 20. Paid AI proof

`zero-paid-ai-proof.json`: **TOTAL_PAID_AI_CALLS = 0**

---

## 21. Limitations

- Bug-3 is sparse (~2s); sub-interval motion can be missed
- Scene threshold is pixel-only
- Black/freeze unused as edit signals by design
- Stable ≠ unimportant (must stay explicit)
- OCR / semantic UI not in this layer
- Cache is filesystem under `tmp/` (benchmark-oriented); product wiring later
- Programme map on corpus trim edges may report `partial` near boundaries; full removal proven in unit test

---

## 22. Consumers unlocked

Dead-air visual safety (adapter), future editorial signals (`VisualEditorialSignals`), chapter/cut candidates, transition diagnostics, post-edit verify, visual memory — **design documented, not wired to AI cognition**.

---

## 23. Next capability recommendation

**`caption_layout_safe_areas_v1`**

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS

CANONICAL_VISUAL_ANALYSIS: PASS
CHANGE_DETECTION: PASS
SCENE_DETECTION: PASS
BLACK_DETECTION: PASS
FREEZE_DETECTION: PASS
STABLE_RANGE_DERIVATION: PASS
ACTIVITY_RANGE_DERIVATION: PASS
SOURCE_PROGRAMME_MAPPING: PASS
CACHE_REUSE: PASS
DEAD_AIR_INTEGRATION: PASS

CASE020_EVENT_RECALL: moderate activity in 12–16s (3 moderate / 0 significant / 0 scene); no hardcode

TOTAL_PAID_AI_CALLS: 0
PRODUCTION_DEFAULT: UNCHANGED
NEXT_LOCAL_CAPABILITY: caption_layout_safe_areas_v1
```

**HARD STOP.** No chapters, transitions, captions, denoise, cognition, consent/apply, or paid provider work in this milestone.
