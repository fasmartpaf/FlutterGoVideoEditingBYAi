# OpenScreen — Editorial Precision Closure V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_EDITORIAL_PRECISION_CLOSURE_V1`  
**Code:** `electron/ai-edition/editorialOrchestration/` (`surface.ts`, policy `v1.1-precision-closure`)  
**Artifacts:** `tmp/perception-benchmark/editorial-precision-closure-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS.** Surfaced recommendation precision rose from **0.667 → 1.000** by excluding incomplete zoom cards from `recommendations[]` and routing ambiguity to `unresolvedQuestions[]`. `UNSAFE_SURFACED = 0`, `UNSUPPORTED_SURFACED = 0`. Do-nothing, preservation, and zero-mutation behavior preserved. No new effects; no auto-apply; no paid AI.

---

## 2. Why V1 precision was 0.667

V1 counted `NEEDS_HUMAN_JUDGMENT` zoom seeds as surfaceable “recommendations.” Four corpus cards were activity-without-focal geometry:

| Case | Rec | Family | Why unsupported |
|------|-----|--------|-----------------|
| case020 | `rec_zoom_human_1` | ZOOM | No focal target |
| case2-hud | `rec_zoom_human_1` | ZOOM | HUD motion ≠ zoom |
| no-audio | `rec_zoom_human_2` | ZOOM | Missing geometry |
| visually-changing | `rec_zoom_human_1` | ZOOM | Generic change ≠ zoom |

Useful+optional = 8; total surfaced = 12 → **8/12 = 0.667**.

---

## 3. Unsupported recommendation audit

See `unsupported-recommendation-audit.json`.

**Root cause:** surface set ≈ status ∈ {RECOMMEND, OPTIONAL, NEEDS_HUMAN_JUDGMENT}, so incomplete zoom ideas became edit cards.

**Closure:** remove zoom-without-focal seeds; `decideSurface` / `applySurfaceFilter` keep only actionable YES cards.

---

## 4. Surface eligibility contract

`RecommendationSurfaceDecisionV1`:

- `surface`: YES | NO | QUESTION_ONLY  
- `reason`, `evidenceStrength`, `executionReadiness`, `missingParameters`, `requiresSemanticJudgment`

**YES only when** evidence supports family, not DO_NOT_RECOMMEND, no preservation block, parameters actionable, capability supported, real user value.

`MISSING_ARGS` for unknown target geometry → **not** an edit card.

---

## 5. Zoom suppression

Activity without focal:

- Finding: `VISUAL_ACTIVITY_PRESENT`  
- Question: “Would emphasizing a specific UI element help?”  
- **0 ZOOM edit cards**

Focal geometry still may surface ZOOM when READY.

---

## 6. Crop suppression

No CROP card without validated framing geometry / aspect requirement. Framing findings may remain internal.

---

## 7. Speed suppression

No SPEED card without explicit intent **and** deterministic rate. Intent-only → question (or suppressed as redundant vs TRIM).

---

## 8. Editorial vs execution readiness

| Example | Editorial | Execution | Surface |
|---------|-----------|-----------|---------|
| Captions layout ok | OPTIONAL | READY | YES card |
| Safe trim | RECOMMENDED | READY | YES card |
| Zoom + focal, missing scale | supported | not ready | QUESTION_ONLY |
| Activity, no focal | finding only | n/a | question, no card |

Documented in `surface-policy.json`.

---

## 9. Unresolved-question routing

`unresolvedQuestions[]` is structured (`UnresolvedEditorialQuestionV1`) and **does not** count as recommendations.

`NEEDS_HUMAN_JUDGMENT` no longer implies an edit card — it routes to QUESTION_ONLY when meaningful.

---

## 10. Ranking

Prefer: useful+safe+ready → useful+safe+optional → actionable human choice (questions).  
Suppress: unsupported, missing geometry, speculative family, redundant, preservation conflict.

Budget applies **after** eligibility to YES cards only.

Policy version bumped to **`v1.1-precision-closure`** (cache key includes it).

---

## 11. Case4

Correction → finding / unresolved discrepancy. No fabricated visual edit. No unsupported zoom/crop/speed card. Optional captions may still surface.

---

## 12. Case020

Activity finding ~12–16s. **No zoom recommendation.** Meaningful unresolved question allowed. No unsupported card.

---

## 13. Case2 HUD

UI motion → finding (+ question). No zoom/crop/transition inference.

---

## 14. Already-good regression

Still **`NO_ACTION_RECOMMENDED`** with empty `recommendations[]`.

---

## 15. Corpus results

Same fixtures: bug5, case4, case020, case2-hud, longest-29s, no-audio, visually-stable/changing, already-good, conflict.

Surfaced cards are trim / loudness / optional captions only where evidence supports them.

---

## 16. Manual review V2

Surfaced recommendations only:

| Label | Count |
|-------|-------|
| USEFUL | 5 |
| OPTIONAL | 3 |
| UNNECESSARY | 0 |
| UNSAFE | 0 |
| UNSUPPORTED | 0 |

Unresolved questions (separate):

| Label | Count |
|-------|-------|
| USEFUL_QUESTION | 5 |
| UNNECESSARY_QUESTION | 0 |
| usefulQuestionRate | 1.0 |

---

## 17. Precision comparison

```text
V1: 0.667  (8/12; 4 unsupported zoom cards)
V2: 1.000  (8/8;  0 unsupported)
Δ:  +0.333
```

Target ≥ 0.85 **met**. Prefer fewer high-quality cards — recall not claimed improved.

---

## 18. Suppressed recommendation metrics

Typical pattern from surface pass:

- `rawCandidates` → conflict/redundancy → surface filter  
- `suppressedUnsupported`: zoom-without-focal / incomplete geometry  
- `suppressedConflicts` / `suppressedRedundant` unchanged in spirit  
- `QUESTION_ONLY` / `INTERNAL_ONLY` tracked in `execution-readiness-v2.json`

---

## 19. Performance

Surface eligibility + question routing + ranking only.  
**ADDITIONAL_MEDIA_DECODE_PASSES = 0.**

---

## 20. Tests

`editorialPrecisionClosureV1.test.ts` + updated orchestration V1 tests (30 total green): zoom/crop/speed restraint, optional captions, preservation, redundancy, already-good, budget, zero AI/mutation/decode.

---

## 21. Paid AI proof

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

---

## 22. Limitations

- Questions are template-level, not deep editorial interviews  
- Precision labels are deterministic policy heuristics on the same corpus  
- Does not fill missing zoom/crop/speed geometry  
- Does not add product UI  

---

## 23. Readiness for reasoning bridge

`recommendations[]` is now product-grade enough to hand to:

1. editor UI (one-at-a-time verified apply), or  
2. a future **bounded** AI reasoning layer that may discuss `unresolvedQuestions[]` but must not invent geometry or auto-apply  

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS
SURFACE_ELIGIBILITY: PASS
UNSUPPORTED_RECOMMENDATION_SUPPRESSION: PASS
UNRESOLVED_QUESTION_ROUTING: PASS
ZOOM_SURFACE_RESTRAINT: PASS
CROP_SURFACE_RESTRAINT: PASS
SPEED_SURFACE_RESTRAINT: PASS
DO_NOTHING_REGRESSION: PASS
MANUAL_RECOMMENDATION_PRECISION: 1.000
UNSUPPORTED_SURFACED: 0
UNSAFE_SURFACED: 0
USEFUL_QUESTION_RATE: 1.000
ADDITIONAL_MEDIA_DECODE_PASSES: 0
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
EDITORIAL_PRECISION_CLOSURE_V1: READY_FOR_BOUNDED_AI_REASONING
NEXT_MILESTONE: editorial_recommendation_product_surface_v1
```

HARD STOP.
