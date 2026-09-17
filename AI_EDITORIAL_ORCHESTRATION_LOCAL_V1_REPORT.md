# OpenScreen — Local Editorial Orchestration V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_EDITORIAL_ORCHESTRATION_LOCAL_V1`  
**Code:** `electron/ai-edition/editorialOrchestration/`  
**Artifacts:** `tmp/perception-benchmark/editorial-orchestration-local-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** OpenScreen can assemble precomputed local signals into a coherent, review-only `EditorialRecommendationSetV1` without auto-applying edits or calling paid AI. Dead-air → trim, loudness → gain path, captions → optional `enableCaptions`, with hard restraints on zoom/crop/speed. Preservation and conflict/redundancy rules suppress unsafe or duplicate suggestions. Do-nothing is an explicit product outcome. Limitations: orchestration consumes **injected** signal bundles (does not itself run ffmpeg detectors); zoom/crop/speed execution args from older proposal builders remain incomplete and are tracked honestly as `MISSING_ARGS`.

---

## 2. Available local signals

Inventoried in `signal-audit.json`:

| Signal | Module | Proves | Does not prove | Families |
|--------|--------|--------|----------------|----------|
| Transcript / pauses | speechEvidence, deadAir | Speech timing, gaps | Semantic importance | CAPTIONS, TRIM, PRESERVATION |
| Dead-air candidates | deadAir | Safe pause-shorten ranges | Every silence should be cut | TRIM |
| VisualAnalysisV1 | visualAnalysis | Activity/stability/scene/black/freeze | Where to zoom | NONE, PRESERVATION |
| Focal / cursor geometry | cursor / prior focal | Spatial target | Aesthetic taste | ZOOM |
| Loudness classification | loudness | Quiet/loud/peak risk | Need for compressor | LOUDNESS |
| Caption layout | captionLayout | Safe placement / density | Audience need | CAPTIONS |
| Timeline edits | AxcutDocument | Existing user edits | Desire for more | PRESERVATION |

---

## 3. Finding contract

`EditorialFindingV1` — observation only (not an edit):

- `category`: PACING | AUDIO | VISUAL_FOCUS | FRAMING | CAPTIONS | PRESERVATION | UNKNOWN  
- `findingType`, `severity`, `confidence`, `evidence[]`, `constraints[]`  
- Optional `recommendationCandidate` (family hint)  
- Example: “1.4 sec low-activity pause” ≠ “apply trim”

---

## 4. Recommendation contract

`EditorialRecommendationV1` — reviewable suggestion:

- `operationFamily`, `rationale`, `reviewCopy`, `evidenceRefs`  
- `risk`, `prerequisites`, `conflictsWith`, `dependencies`  
- `verifiedApplyCapability`, `recommendationStatus`, `executionReadiness`  
- `expectedOperationType`, `missingParameters[]`  
- **No** raw multi-tool apply payloads; no auto execution

---

## 5. Dead-air adapter

Safe `DeadAirCandidateV1` → PACING finding + TRIM `RECOMMEND` / `READY_TO_APPLY` / `addTrim`.  
Unsafe/uncertain → `DO_NOT_RECOMMEND` (safety gates unchanged).

---

## 6. Loudness adapter

| Classification | Outcome |
|----------------|---------|
| ALREADY_ACCEPTABLE | Finding only; no recommend |
| TOO_QUIET / TOO_LOUD + safe | LOUDNESS `RECOMMEND` → `loudness_audioGainDb` |
| TRUE_PEAK_RISK / DYNAMIC_RANGE | `NEEDS_HUMAN_JUDGMENT` |
| NO_AUDIO / UNSUPPORTED_COMPLEX_MIX | `DO_NOT_RECOMMEND` |

No compressor/limiter recommendations.

---

## 7. Caption adapter

Recommend only when speech + usable transcript + layout `ok` + not already enabled + no manual conflict.  
Default status: **OPTIONAL** (unless `intents.wantCaptions`).  
`expectedOperationType`: `enableCaptions`.

---

## 8. Visual-focus policy

Activity alone → `VISUAL_ACTIVITY_PRESENT` finding; zoom status `NEEDS_HUMAN_JUDGMENT` / `MISSING_ARGS` (`depth`, `focus`).  
ZOOM `RECOMMEND` only with known focal geometry (cursor / protected UI / explicit target).

---

## 9. Crop policy

No crop unless framing evidence (`unused_margins` / aspect conversion / explicit geometry).  
Capability existence ≠ recommendation.

---

## 10. Speed restraint

Without explicit speed/duration intent → `NO_SPEED_INTENT`; no fabricate.  
With intent → `NEEDS_HUMAN_JUDGMENT` / `MISSING_ARGS` (`speed`); still subject to TRIM redundancy.

---

## 11. Preservation constraints

Findings for protected speech, visual activity, manual annotations/captions, user edits.  
They constrain other recommendations; they do not propose edits.

---

## 12. Conflict graph

Deterministic edges:

- TRIM/SPEED/CROP/ZOOM overlapping preserved range → suppress  
- TRIM overlapping ZOOM → mark conflict; zoom → human judgment  
- CROP overlapping ZOOM → mark conflict  

Represented as `conflictsWith[]` / `dependencies[]` + `conflictEdges` on the orchestrate result.

---

## 13. Redundancy rules

Documented in `policy.json`:

1. Prefer **TRIM** over **SPEED** for the same silence gap  
2. Prefer `READY_TO_APPLY` over incomplete args when redundant  
3. Preservation wins over structural edits  

---

## 14. Precedence (review-only)

1. Preservation  
2. TRIM  
3. SPEED  
4. CROP  
5. ZOOM  
6. CAPTIONS  
7. LOUDNESS  

Does **not** auto-apply in this order.

---

## 15. Recommendation budget

`maxRecommendations: 5` (configurable). Excess surfaceable items demoted with `budget_cap`. Findings may remain internal while cards stay compact.

---

## 16. Confidence / safety

Bounded classes HIGH | MEDIUM | LOW from detector gates (not invented precision).  

Safety tiers:

- **Lower:** safe trim, safe loudness, captions when layout ok  
- **Medium:** zoom/crop with strong evidence  
- **Higher:** speed (restrained)

---

## 17. Recommendation set

`EditorialRecommendationSetV1` includes findings, recommendations, preservedRanges, unresolvedQuestions, deterministic `summary`, and status:

- `ACTIONS_AVAILABLE`  
- `NO_ACTION_RECOMMENDED`  
- `NEEDS_HUMAN_JUDGMENT`  

---

## 18. Review copy

Human-readable, no detector IDs / hashes / thresholds. Examples:

- “Shorten a 1.4-second pause around 8 seconds.”  
- “Raise programme loudness by about 2.3 dB while staying below the peak limit.”  
- “Captions are available for 17 seconds of narration.”

---

## 19. Verified-apply bridge readiness

| Family | Bridge | Notes |
|--------|--------|-------|
| TRIM | `addTrim` | READY when dead-air safe |
| LOUDNESS | `loudness_audioGainDb` | Separate settings path |
| CAPTIONS | `enableCaptions` | READY when layout ok |
| ZOOM | `addZoom` | READY only with focal args |
| CROP | `setClipCrop` | READY only with geometry |
| SPEED | `addSpeed` | Usually MISSING_ARGS |

**No execution** in this milestone.

---

## 20. Incomplete args findings

`execution-readiness.json` records proposal-builder gaps:

- ZOOM: missing `depth`, `focus.cx/cy` in provisional args  
- CROP: missing `cropRegion` / `clipId`  
- SPEED: missing rate  
- CAPTIONS: legacy `generateCaptions` incomplete; `enableCaptions` is the verified path  

Orchestration does **not** invent geometry to paper this over.

---

## 21. Corpus

Signal-driven fixtures under `corpus/<case-id>/` (findings, recommendations, conflicts, final-set):

- bug5-narrated  
- case4-correction  
- case020  
- case2-hud  
- longest-29s  
- no-audio  
- visually-stable  
- visually-changing  

---

## 22. Case4

Correction speech preserved; unresolved question surfaces discrepancy.  
**No** “open effects panel” or other hallucinated UI edit. No zoom recommend from correction alone.

---

## 23. Case020

Activity finding for ~12–16s. **No** ZOOM `RECOMMEND` without focal geometry (`NEEDS_HUMAN_JUDGMENT` / `MISSING_ARGS`).

---

## 24. No-audio

No loudness recommend; no captions recommend. Visual findings allowed. No errors.

---

## 25. Already-good

Fixture: no safe dead air, loudness acceptable, captions already enabled, no focal target → **`NO_ACTION_RECOMMENDED`**. Artifact: `already-good.json`.

---

## 26. Conflict fixture

Safe-ish trim overlapping protected visual → preservation wins; trim `DO_NOT_RECOMMEND`. Artifact: `conflict-fixture.json`.

---

## 27. Manual precision review

From `manual-review.json` (policy heuristic labels on surfaced cards):

| Label | Count |
|-------|-------|
| USEFUL | 5 |
| OPTIONAL | 3 |
| UNNECESSARY | 0 |
| UNSAFE | 0 |
| UNSUPPORTED | 4 |

**recommendationPrecision = 0.667** (USEFUL+OPTIONAL) / all labeled. Precision prioritized over recall; unsupported zoom-without-focus cards counted against precision intentionally.

---

## 28. Performance

Orchestration on precomputed bundles: **0 additional media decode passes**. Metrics recorded per case in `performance.json` (signal/finding/conflict/rank/total ms).

---

## 29. Cache

Key includes media, programme, transcript, visual, dead-air, loudness, caption-layout fingerprints + policy version + intents. Programme edits invalidate via fingerprint change. Cache hit proven in tests (`cache.json`).

---

## 30. Tests

`editorialOrchestrationV1.test.ts` — 15 tests covering adapters, restraints, preservation, redundancy, budget, already-good, corpus artifact write, Case4/Case020/no-audio asserts, zero paid AI / zero auto-mutations.

---

## 31. Paid AI proof

```json
{
  "OPENAI_CALLS": 0,
  "ANTHROPIC_CALLS": 0,
  "GEMINI_CALLS": 0,
  "OTHER_PAID_AI_CALLS": 0,
  "TOTAL_PAID_AI_CALLS": 0,
  "AUTO_MUTATIONS": 0
}
```

See `zero-paid-ai-proof.json`.

---

## 32. Limitations

- Does not replace human editorial judgment  
- Relies on upstream analyses being supplied (adapters do not re-run detectors by default)  
- Zoom/crop/speed often lack executable geometry/rate until a later bridge fills args  
- Captions stay OPTIONAL without audience/platform context  
- Conflict graph is range-overlap heuristic, not full timeline solver  

---

## 33. What AI reasoning must eventually add

- Goal-aware prioritization (“make this demo tighter for a 30s cut”)  
- Semantic importance of pauses vs dramatic hold  
- Ambiguous focal selection among multiple UI targets  
- Cross-edit storytelling (when a trim changes caption/zoom story)  
- Natural-language explanation beyond template copy  

Deterministic orchestration remains the **gate**; LLM reasoning should propose within these constraints, not bypass them.

---

## 34. Next milestone recommendation

**`editorial_recommendation_product_surface_v1`** — present the recommendation set in the editor UI for one-at-a-time consented verified apply (reuse existing applyPreview / loudness / enableCaptions paths). No multi-edit auto-apply; no new effects.

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
LOCAL_SIGNAL_REUSE: PASS
EDITORIAL_FINDINGS: PASS
PRESERVATION_CONSTRAINTS: PASS
CONFLICT_RESOLUTION: PASS
REDUNDANCY_CONTROL: PASS
DO_NOTHING_BEHAVIOR: PASS
DEAD_AIR_RECOMMENDATION: PASS
LOUDNESS_RECOMMENDATION: PASS
CAPTION_RECOMMENDATION: PASS
ZOOM_RESTRAINT: PASS
CROP_RESTRAINT: PASS
SPEED_RESTRAINT: PASS
EXECUTION_READINESS_TRACKING: PASS
MANUAL_RECOMMENDATION_PRECISION: 0.667
ADDITIONAL_MEDIA_DECODE_PASSES: 0
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
EDITORIAL_ORCHESTRATION_LOCAL_V1: READY_FOR_AI_REASONING_BRIDGE
NEXT_MILESTONE: editorial_recommendation_product_surface_v1
```

HARD STOP.
