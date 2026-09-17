# OpenScreen — Evidence Retrieval Deepening V1

**Identity:** `CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_DEEPENING_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/evidence-retrieval-deepening-v1/`  
**Prior preserved:** Coverage V1, Promotion Gate, Closure, Production, Context Audit  

Narrow closure: prove Stage B **relevance deepening** works with Stage A coverage — not evenly spaced screenshots, and not a single event cluster.

No OpenAI answer generation. Retrieval not promoted. Consent/apply untouched.

---

## Decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

COVERAGE_FLOOR:
PASS

RELEVANCE_DEEPENING:
PASS

EVENT_REGION_DEDUP:
PASS

CASE_020_MIXED_EVIDENCE:
PASS

CROSS_MODAL_REGRESSION:
PASS

LOCAL_EFFICIENCY_REGRESSION:
PASS

SPEECH_EFFICIENCY_REGRESSION:
PASS

RETRIEVAL_ARCHITECTURE_READY_FOR_PROVIDER_GATE:
YES
```

Default packing remains `CURRENT_FULL_CONTEXT`. Compact still experimental. No bake-off.

---

## 1. Why Stage B lost (Coverage V1 audit)

Candidate lifecycle on Case 020 under Coverage V1:

1. **Raw periodics** every ~2s + clip boundaries (+ cursor if present).
2. **`coverageFirst` extract** reserved ~65% of `maxExtract=10` for duration-bucket anchors → live pool collapsed to **6 periodics**: `0, 2, 6, 10, 16, 20`.
3. **Change refinement** only fires on **significant** adjacent pairs. Sparse ~4s gaps on this recording often scored **minimal/moderate**, so **zero** `change_refinement` frames entered the pool. The known 12–15s activity sat *between* 10 and 16 and never became an extracted midpoint.
4. **Selection Stage A** took `max(bucketCount, ceil(0.5*maxFrames))` → **5 coverage anchors** of a 6-frame budget (~83–100% of attach).
5. **Stage B** had almost no independent relevance candidates left in the pool; diversity rules could not invent frames that were never extracted.
6. Attach: **`0, 2, 6, 10, 16, 20`** — excellent coverage, **periodic-only**.

So Stage B did not “lose a ranking fight” against 12–15s candidates. **Those candidates never entered the attach pool.** Ranking never saw them.

Promotion Gate’s earlier 12.33–14.79 cluster happened on a denser extract path where change midpoints *did* exist and then ate the budget. Coverage V1 fixed domination by starving deepen of raw material.

---

## 2–5. What Deepening V1 changed

| Piece | Behavior |
| ----- | -------- |
| **Budgets** | `allocateCoverageDeepeningBudgets` — for 6 frames / 5 buckets / editorial with regions → **coverage=4, deepen=2** (adaptive; not a hardcoded universal 5+1). Coverage cannot take 100% when deepen is warranted. |
| **Extract** | Coverage-first initial slots leave **≥35% extract cap** for midpoints. `planRefinementMidpoints(..., includeModerateLargeGaps)` on coverage-first path also refines **moderate** pairs with gap ≥ 3s (general sparse-sample fix, not Case 020 timestamps). |
| **EvidenceEventRegion** | Clusters nearby change_refinement / significant|moderate-large transitions / cursor / speech-alignment seeds. Cap **≤2 frames per region**. |
| **Merge** | Coverage anchors first; then event peaks. **Replace** in-bucket periodic with event frame when the coverage bucket stays occupied (information value per frame). |
| **Diagnostics** | `coverageUtilization`, `deepeningUtilization`, `eventRegionDiversity`, `redundancyRatio` — interpretable, not a fake scalar “quality score”. |
| **Trace** | Per-candidate: score, bucket, role, selected/rejected, rejection reason, nearest selected, diversity decision, event region id. |

QueryScope, VisualEvidenceCoverage sufficiency, speech-zero, and local windows were **not** redesigned.

---

## 7. Case 020 re-proof (exact zoom prompt)

| | Coverage V1 | Deepening V1 |
| - | ----------- | ------------ |
| Candidates | 6 periodics | **10** mixed (periodics + change_refinement + cursor_pre) |
| Times in pool | 0…20 even | includes **12.331**, **14.166**, … |
| Significant change | n/a in pool | **12.331→14.166 score 0.093 significant** |
| Event region | none | `evr_2` **12.331–14.166** (cursor + significant + change_refinement) |
| Attach | 0,2,6,10,16,20 | **4, 8, 10, 14.166, 20** |
| Coverage | sufficient | **sufficient**, not clustered |
| 12–15s domination | n/a (absent) | **1** frame (14.166) — not a 5-frame cluster |
| Budget | implied 6 coverage | **4 + 2** |

Detector **did** identify a meaningful region around 12–15 (significant transition + cursor). Deepening selected **14.166** as the representative peak, not five cluster frames. No hardcoded Case 020 timestamps.

Trace excerpt: periodic @2 rejected `replaced_by_event_region` → change_refinement @4 selected as deepen replacing coverage anchor; `evr_2` deepen at 14.166.

Artifacts: `C020_ZOOM.json`, `C020_AUDIT.json`, `before-c020-coverage-v1.json`.

---

## 8–9. Corpus (prepare-only)

18 rows across Case 020, Case 2, Case 4, narrated, longest 28.94s, silent, settings/action, extras. Families: whole visual/editorial, negative editorial, cross-modal, local, bounded UI, speech, action verify.

| Invariant | Result |
| --------- | ------ |
| Speech 0 images | PASS (`NARR_SPEECH`) |
| Local @12s stays local | PASS (`LOCAL_TS` visual+local, 1 frame @12) |
| Cross-modal speech+frames | PASS (`NARR_CROSS`, speechPrepared, selectedCount=5) |
| Whole-media not one event | PASS (C020 span + bucket coverage) |
| Whole-media not periodic-only when events exist | PASS (C020 + unit tests) |
| Event dedup | PASS (≤2 from 12–15; `duplicateRegionFrames=0`) |

Restart/Upwork/Settings: routing still visual/action_verify; epistemic pack language unchanged. No provider answers this milestone.

---

## 10. Metrics (C020 example)

```text
coverageBudget=4 deepeningBudget=2
coverageUtilization≈1.25  (replacement can keep a deepen frame also counted in coverage set — diagnostic quirk, not a score)
deepeningUtilization=1
eventRegionDiversity=0.75
redundancyRatio=0
relevanceCandidatesAvailable=5
relevanceCandidatesSelected=3
```

---

## Limitations

1. **`coverageUtilization` can exceed 1.0** when a replaced deepen frame remains marked in the coverage set. Treat as a diagnostic edge, not a quality grade.
2. **Long-form still NOT_VERIFIED** (max local media ~29s).
3. **No answer quality.** Next step is provider-backed Promotion Gate with quota restored.
4. Phase-specific tool packing still design-only (not this milestone).

---

## Tests

- `videoMemory/deepening.test.ts` — budget split, region cluster, mixed pack, monopolize guard, replace-anchor
- Existing coverage/queryScope/retrievalProduction regressions
- Live: `perceptionBenchmark/evidenceRetrievalDeepening/evidence-retrieval-deepening.runtime.test.ts`

---

## Architecture claim now live

OpenScreen retrieval for whole-media editorial is:

**global story coverage (duration buckets)**  
**+**  
**local information-rich deepen (event regions, ≤2 frames/region, replace-in-bucket)**  

bounded and query-aware — not “even screenshots” and not “one cluster.”

**STOP.** Do not promote Retrieval. Do not start bake-off. Provider gate is the next milestone when ready.
