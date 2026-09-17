# OpenScreen Source Story V2 — Evidence-Grounded Story Understanding

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_SOURCE_STORY_V2`  
**Prerequisites:** Ledger V1, Investigator V1/V1.1, Reuse Visual V1, Claim Promotion V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Target Story and autonomous editing not started.

---

## Executive verdict

Source Story V2 adds a **deterministic evidence-constrained story layer** above Claim Promotion / Ledger / Investigator. Allowed facts, context, spoken intent, contradictions, and unknowns are structurally separated before any narrative LLM grouping. Passive LLM may still summarize in the same turn, but cannot freely promote OCR/passive visibility into actions; post-validators sanitize residual prose. Locked baselines unchanged.

---

## Current Source Story audit

| Topic | Finding |
|-------|---------|
| Inputs | Speech segments, visual frame times, visual changes, cursor times via scaffold |
| Observations | Not typed into Source Story; investigator/OCR entered same turn via briefing only |
| Transcript | Scaffold speech windows |
| Raw OCR | Not in Source Story types; leaked via investigator/specialist briefing |
| Investigator | Not typed into Source Story API (operational contamination only) |
| Claim Promotion | `buildSourceStoryClaimBridge` unused before this milestone |
| Beats | Model-authored JSON + pause gap-fill |
| Actions | Freeform `interactionMeaning` / summaries |
| Contradictions | Prompt + settings-only hedge |
| Uncertainty | `confidence` + optional notes |
| Temporal ranges | Scaffold boundaries; model chooses beat ranges |
| Passive→action | Possible (weak guards) |
| Speech→visual | Partially blocked (settings-specific) |
| LLM | Same main agent turn (not a dedicated second call) |

---

## Trust-boundary problems found

1. Claim Promotion did not constrain Source Story.  
2. Investigator/OCR context could influence SOURCE_STORY without typed gates.  
3. Speech→visual leaks beyond settings.  
4. Passive visibility could become action prose.  
5. Semantic interpretation could ship as story “fact” with only confidence downgrade.  
6. Gap-fill could invent mild visual continuity claims.

---

## Source Story V2 architecture

```text
speech / visual / cursor
    → Temporal Event Ledger
    → Investigator V1.1 (optional deepen)
    → Reuse Visual / Claim Promotion
    → SourceStoryEvidenceInput (typed refs)
    → SourceStoryV2 (deterministic beats + epistemic items)
    → constrained prompt (+ legacy scaffold)
    → same-turn LLM narrative SourceStory (optional)
    → constrainSourceStoryWithV2 sanitizer
```

Module: `electron/ai-edition/sourceStory/v2/`.

---

## Evidence input contract

`SourceStoryEvidenceInput` carries:

- `promotedClaims[]` / `unresolvedClaims[]` / `contradictions[]` (claim refs + IDs)  
- `ledgerEvents[]`  
- `speechSegments[]`  
- `visualTimes` / `visualChanges`  
- `cursorEventTimes`  
- `investigation` observation/claim IDs + focus  
- metrics (`additionalModelCalls: 0`)

Full payloads are not copied; IDs preferred.

---

## Epistemic-state handling

Items carry: `observed | spoken | supported | verified | contradicted | unknown`.

Not flattened into undifferentiated prose internally.

---

## Story fact vs context

| Kind | Meaning |
|------|---------|
| `story_fact` | Supported/verified/observed change or non-action observation eligible for narrative |
| `context` | Passive visibility / OCR text — **never** narrated as user action (`isContextOnly`) |
| `spoken_intention` / `spoken_correction` | Speech only |
| `unresolved_action` | Action claim remains `unknown` |
| `contradiction` | Explicit conflict |

Upwork tab → context. Restart OCR → context/supported visibility; restart action → unresolved.

---

## Speech intent / correction handling

Corrections recorded in `SourceStoryV2.corrections` with from→to and supersession IDs. Earlier intention retained as history but marked superseded for narrative.

---

## Contradiction handling

First-class `contradictions[]` with claim, modalities, range, `resolutionStatus`. Prompt + mediaSummary require honest wording; facts must not assert contradicted actions.

---

## Temporal beat construction

Boundaries from speech edges, material visual changes, claim/ledger significance — **not** one beat per periodic frame. Windows below `MIN_BEAT_IMPORTANCE` skipped. Cap 12 beats (keep first/last + highest importance).

---

## Importance policy

Additive scores: significant/moderate change, speech/topic, correction, contradiction, temporary UI, unresolved action, passive context, cursor, begin/end anchors. Periodic frames alone do not clear the threshold.

---

## Investigator integration

Investigation observation/claim IDs attached to evidence input + beat provenance when present. Story does not require deep inspection of every beat.

---

## Claim Promotion integration

Claim set is a **first-class** prepare input. Promoted → facts/context/spoken; unresolved actions → unresolved; contradicted → contradictions. `buildSourceStoryClaimBridge` remains as lightweight summary helper.

---

## Provenance

Per-item and story-level refs: claim IDs, ledger event IDs, speech segment IDs, investigation observation IDs. Internal only.

---

## Case 2 result

Deterministic live regression (`sourceStoryV2.live.runtime.test.ts` + artifact `tmp/perception-benchmark/source-story-v2/`):

- File / visual-change facts allowed  
- Restart recording visibility as context/supported observation  
- Restart **action** remains unresolved/unknown  
- Forbidden: “User restarted the recording” as fact  

Real Case 2 ledger snapshot from an earlier investigator run (visual transitions only) produced compact change beats without restart OCR (that ledger lacked OCR events). Synthetic Case-2-complete evidence path covers Restart+Upwork invariants.

---

## Upwork result

Diagnostic ledger → persistent **context** “Passive visibility: Upwork”; unresolved action retained; **no** opened/worked/visited facts.

---

## Case 4 result

Correction recorded; contradiction present; no verified panel-open facts.

---

## Settings result

Contradictions first-class; no story **fact** “User opened Settings.”

---

## Whole-video result

Compact beat hierarchy (≤12), importance-ranked; not one beat per frame.

---

## Live regression

| Path | Result |
|------|--------|
| Vitest Case 2 evidence path | **PASS** (artifact written) |
| Real investigator Case 2 ledger normalize → V2 | **PASS** (10 beats, no restart-action facts; OCR absent in that ledger) |
| Upwork / Case4 / Settings diagnostic ledgers | **PASS** invariants |

No manual rewrite of outputs.

---

## Model-call count

| Stage | Calls |
|-------|-------|
| Evidence input + SourceStoryV2 build | **0** |
| Prompt construction | **0** |
| Constrain/sanitize | **0** |
| Optional same-turn LLM narrative (existing Source Story) | **1 shared agent turn** (unchanged; not an extra verification call) |

`SourceStoryV2.metrics.additionalModelCalls: 0`.

---

## Latency

| Measurement | Value |
|-------------|-------|
| V2 build on Case 2 live fixture | ≪ 5 ms (test asserts < 500 ms) |
| Real ledger normalize → V2 | ~1.6 ms |
| Evidence input chars | recorded in metrics |

No 60s pipeline introduced.

---

## Tests

| Suite | Result |
|-------|--------|
| `sourceStory/v2/sourceStoryV2.test.ts` | **16 passed** (items 1–25 coverage) |
| `sourceStory/v2/sourceStoryV2.live.runtime.test.ts` | **1 passed** |
| Existing `sourceStory.test.ts` + Claim Promotion + Investigator | green (85 combined earlier) |

---

## Benchmark impact

| Identity | Status |
|----------|--------|
| `CURRENT_OPENSCREEN` | preserved |
| `CURRENT_OPENSCREEN_INVESTIGATOR_V1` | preserved |
| `CURRENT_OPENSCREEN_REUSE_VISUAL_V1` | preserved |
| `CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1` | preserved |
| `CURRENT_OPENSCREEN_INVESTIGATOR_V1_1` | preserved |
| **`CURRENT_OPENSCREEN_SOURCE_STORY_V2`** | **new** |

---

## Remaining limitations

- Same-turn LLM can still emit SOURCE_STORY JSON; trust is enforced by constrained evidence + sanitizer, not by removing the model entirely.  
- Some older ledger dumps lack OCR/passive events → story cannot invent Restart/Upwork facts (correct), but live Case 2 completeness depends on Reuse Visual having run.  
- Importance heuristics are rule-based (not learned).  
- Target Story still consumes V1-shaped SourceStory (derived/constrained).

---

## Recommended next milestone

Source Story V2 → Target Story **consumption** of epistemic beats (still no autonomous editing). Optionally harden product turn to prefer `sourceStoryFromV2` when model JSON is weak.

---

## Verdict

**PASS_WITH_LIMITATIONS**
