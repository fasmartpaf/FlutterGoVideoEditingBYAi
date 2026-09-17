# OpenScreen Edit Gap V1 — Source vs Target Editorial Delta

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_EDIT_GAP_V1`  
**Prerequisites:** Source Story V2, Target Story V1, Claim Promotion V1, Investigator V1.1, Ledger V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Edit Plan and autonomous editing not started. No AxcutDocument mutation. No tool selection.

---

## Executive verdict

Edit Gap V1 deterministically compares **Source Story V2** (what happened) with **Target Story V1** (desired viewer experience) and emits a compact editorial delta: gaps, preservation requirements, hard constraints, and unresolved honesty notes. It does **not** choose tools, emit edit commands, or execute edits. **0 additional model calls.**

---

## Edit Gap architecture

```text
SOURCE STORY V2
       +
TARGET STORY V1
       ↓
EDIT GAP V1  (CURRENT_OPENSCREEN_EDIT_GAP_V1)
       ↓
structured EditGapV1 (+ validator)
```

Module: `electron/ai-edition/editGap/`. Wired via `prepareEditGapForTurn` after Target Story prep in `deep-agent/service.ts` → `InvokeResult.editGapV1`.

Preserved upstream: mediaContextNeeds, visual/speech evidence, sourceTiming, Ledger, Investigator V1.1, Reuse Visual, Claim Promotion, Source Story V2, Target Story V1, benchmark harness, locked provider identities, AxcutDocument, timeline/render/compositor, editing tools.

---

## Input contract

```ts
type EditGapInput = {
  sourceStoryV2: SourceStoryV2
  targetStoryV1: TargetStoryV1
  userIntent?: string  // optional echo; Target Story is desired-state authority
}
```

User intent is **not** re-derived independently when Target Story already normalized it.

---

## Gap taxonomy

Small editorial set (V1):

| Category | Role |
|----------|------|
| `pacing_excess` / `pacing_too_fast` | Tempo mismatch |
| `repetition` | Redundant content |
| `hesitation_or_correction_friction` | Superseded spoken intent |
| `unclear_focus` | Emphasis mismatch |
| `distracting_temporary_ui` | Recording HUD / temporary chrome |
| `passive_context_noise` | Passive app chrome (e.g. Upwork tab) |
| `visual_story_mismatch` / `speech_visual_mismatch` | Modal mismatch (used sparingly) |
| `unsupported_story_implication` | Speech without visual support |
| `weak_transition` | Transition clarity |
| `clarity_gap` / `continuity_gap` | Clarity / continuity |
| `missing_target_support` | Requested focus without source support |
| `preservation_requirement` | Must survive later shortening |

No tool names. No edit commands.

---

## Source/Target comparison logic

Deterministic rules over Target dispositions + Source epistemics:

1. **Preserve list** → `preservation_requirement` + `hardConstraints`
2. **Corrections** → `hesitation_or_correction_friction` (preserve corrected meaning)
3. **Contradictions** → `unsupported_story_implication`
4. **Recording chrome + polish/remove** → `distracting_temporary_ui` (visibility ≠ restart action)
5. **Passive context + Target de-emphasize** → `passive_context_noise` only (never workflow removal)
6. **remove_candidate / de_emphasize / compress** → pacing/clarity/focus gaps (editorial, not trim)
7. **unsupportedRequests** → `missing_target_support`
8. Soft caps + validator keep the set compact (≤16)

---

## Importance policy

Deterministic score from: Target disposition, contradiction, core communication, source beat importance, shorten/polish intent, confusion risk, unsupported-implication risk. Mapped to `critical | high | medium | low`. Tool availability is never a signal.

---

## Preservation requirements

Every Target `preserve` item becomes a preservation gap/constraint so future Edit Plan cannot optimize blindly (e.g. shorten must keep core explanation / corrected Effects meaning).

---

## Contradiction handling

Speech-vs-visual contradictions produce `unsupported_story_implication`: avoid implying unverified actions completed. No invented confirmation.

---

## Missing-source-support handling

Target `requested_but_not_source_supported` → `missing_target_support`. Explicitly forbids fabricating footage/UI state.

---

## Validation/sanitizer

`validateAndSanitizeEditGapV1` rejects/downgrades gaps that:

- invent restart-action cleanup or Upwork workflow removal
- leak tool/edit-plan language or exact edit timestamps
- lack Source/Target provenance (except `missing_target_support`)
- use unknown categories

---

## Case 2 result

Intent: “Make this professional.”

Observed gaps (live regression): `distracting_temporary_ui`, `weak_transition`, `preservation_requirement`, `passive_context_noise` (optional).

Forbidden absent: restart-action cleanup, invented Upwork workflow edit.

---

## Upwork result

Passive context only. Either no gap or `passive_context_noise`. Never “Upwork workflow removal.”

---

## Case 4 result

Intent: “Make this shorter and clearer.”

Gaps: `hesitation_or_correction_friction`, `unsupported_story_implication`, `preservation_requirement`, optional `pacing_excess`.

Preserve corrected Effects meaning. No panel-open cleanup (panels never verified).

---

## Settings result

`unsupported_story_implication` when speech asserts Settings without visual proof. With explicit “Focus on Settings”: also `missing_target_support`.

---

## Stable narration result

Stable screen + useful narration → pacing/preservation only. No automatic “missing visual action” gap.

---

## Whole-video result

Compact summary pattern:

1. Preserve meaning-bearing items  
2. Reduce correction friction  
3. De-emphasize recording HUD  
4. Maintain accurate transition  
5. Avoid unsupported implications  

---

## Live tests

Offline deterministic live regressions (`editGapV1.live.runtime.test.ts`):

| Case | Gaps | Model calls | Notes |
|------|------|-------------|-------|
| Case 2 professional | 6 | 0 | HUD distraction + transition preserve |
| Case 4 shorter/clearer | 7 | 0 | Correction friction + honesty |
| Narrated | 2 | 0 | Preserve + pacing |

Artifact: `tmp/perception-benchmark/edit-gap-v1/live-regressions.json`  
Wall latency (three cases): ~12–13 ms.

---

## Quality rubric

| Criterion | Status |
|-----------|--------|
| Source grounding | Pass (live) |
| Target fidelity | Pass |
| Epistemic honesty | Pass |
| Gap usefulness | Pass |
| No tool leakage | Pass |
| No edit-plan leakage | Pass |
| Preservation awareness | Pass |
| Contradiction awareness | Pass |
| Unsupported-target awareness | Pass |
| Compactness | Pass (≤16) |

---

## Model-call count

**0** additional model calls for Edit Gap V1 core path.

---

## Latency

~12–13 ms for Case 2 + Case 4 + narrated offline build (machine-local). Serialized sizes ~2–7 KB per case.

---

## Tests

`electron/ai-edition/editGap/editGapV1.test.ts` + live runtime — 21 tests covering:

preserve / de-emphasize / remove_candidate, unknown action, passive context, contradiction, correction, preservation, missing support, no tools/commands/timestamps, provenance mapping, Case 2/Upwork/Case 4/Settings/stable narration, compactness, no GT leakage, Source/Target compose green, prepare path, no timeline mutation surface.

Source Story V2 + Target Story V1 regression suites remain green.

---

## Benchmark impact

New identity: **`CURRENT_OPENSCREEN_EDIT_GAP_V1`**. All prior identities preserved. No GT leakage into Edit Gap outputs. Deterministic edit path unchanged (Edit Gap does not mutate documents or call editing tools).

---

## Remaining limitations

- Taxonomy is heuristic; some Target dispositions may under/over-produce pacing gaps.
- Optional LLM prose refinement not implemented (by design: 0 calls).
- Importance scoring is hand-tuned, not learned.
- Does not yet consume multi-asset / multi-take stories.
- Soft caps may hide secondary instances of the same category.

---

## Recommended next milestone

**Edit Plan V1** — map Edit Gap items to candidate OpenScreen tool *families* and ordered editorial intentions **without** executing edits, still governed by Edit Gap hard constraints and Source epistemics.

Do **not** jump to autonomous editing.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Edit Gap V1 delivers a grounded Source↔Target editorial delta with epistemic honesty, preservation awareness, and zero tool/edit-plan leakage. Limitations are expected V1 scope (heuristic taxonomy, no LLM refine). **STOP.**
