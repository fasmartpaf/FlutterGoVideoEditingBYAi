# OpenScreen Planning → Investigation Closure V1

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_PLANNING_CLOSURE_V1`  
**Prerequisites:** Edit Plan V1, Edit Gap V1, Target Story V1, Source Story V2, Investigator V1.1, Claim Promotion, Ledger  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: No executable edit proposals. No AxcutDocument mutation. No autonomous editing.

---

## Executive verdict

Planning Closure V1 closes the first real reasoning loop: when Edit Plan prefers `needs_more_evidence`, it issues **typed, bounded** evidence requests to Investigator V1.1, recomputes the full cognition chain (Ledger → Claims → Source → Target → Gap → Plan), and either resolves, invalidates toward safer strategies, or stops honestly. **0 orchestration/policy model calls.** Already-grounded plans (Case 2 HUD, Case 4 correction) skip closure.

---

## Planning Closure architecture

```text
Edit Plan V1
   ↓ (only if needs_more_evidence / crop-safety)
PlanningEvidenceRequest[]
   ↓
Investigator V1.1 (bounded roles + range)
   ↓
Claim Promotion → Source Story V2 → Target Story V1 → Edit Gap → Edit Plan
   ↓
material-change? → next round (max 2) or stop
```

Module: `electron/ai-edition/planningClosure/`. Wired in `deep-agent/service.ts` after Edit Plan prep → `InvokeResult.planningClosureV1` (+ updated stories/gap/plan when rounds ran).

---

## Evidence request contract

`PlanningEvidenceRequest`: id, identityKey, planItemId, gapIds, question enum, bounded sourceRange, modalitiesNeeded, investigatorRoles, requiredOutcome, provenanceRefs, priority, focusedUserMessage.

Questions: identify_visual_target, verify_action, read_ui_text, verify_temporary_state, verify_cursor_target, resolve_speech_visual_conflict, verify_timing, verify_crop_safety, other.

No editing commands in requests.

---

## Request generation policy

Requests only when:

- preferred strategy / feasibility is `needs_more_evidence`, or
- preferred strategy is `crop` for temporary HUD (crop-safety)

Skip: confidence &lt; 1.0 alone, Upwork workflow hunting, already-grounded trim/preserve HUD plans.

---

## Investigator role mapping

| Question | Roles |
|----------|-------|
| identify_visual_target | GROUNDING → VISUAL → OCR → VERIFY → STOP |
| verify_cursor_target | GROUNDING → CURSOR → VISUAL → VERIFY → STOP |
| read_ui_text | GROUNDING → OCR → VERIFY → STOP |
| resolve_speech_visual_conflict | GROUNDING → SPEECH → VISUAL → CONTRADICTION → VERIFY → STOP |
| verify_crop_safety / temporary | GROUNDING → VISUAL → OCR → VERIFY → STOP |

Thin adapter encodes focus into `focusedUserMessage` + tight `roleBudgets` / investigation budgets. No new agents.

---

## Recompute pipeline

After investigation: **Claim Promotion → Source Story V2 → Target Story V1 → Edit Gap V1 → Edit Plan V1** (full chain; not leaf-only patch).

---

## Closure budgets

| Budget | V1 |
|--------|----|
| Max rounds / turn | 2 |
| Max requests / round | 3 |
| Max same identityKey | 1 |
| Full-video rescan | forbidden (bounded range messaging) |

Unresolved after budget → `budget_exhausted` / `insufficient_evidence` / `no_safe_edit` path via recomputed plan.

---

## Request dedupe

Deterministic `identityKey` = planItemId | question | range | modalities | subject. Duplicate identities suppressed within the turn.

---

## Plan versioning

Turn-local `planVersions[]`: initial + after each closure round (final labeled). Retains Source/Target/Gap/Plan snapshots. Not persisted into AxcutDocument.

---

## Material-change policy

Compares preferred strategy / feasibility signatures. No material change → stop (`no_material_change`). Wording-only changes do not continue the loop.

---

## Cache reuse

Investigator metrics report frame cache hits/misses. Closure passes existing frames/ledger/claims into Investigator; does not force full re-extract when frames are supplied.

---

## Unknown-target result

Forced `needs_more_evidence` Publish-button fixture: generates identify/cursor request → investigation → recompute with version chain. Without verified identity, does **not** invent a zoom. Live A: 1 request, 2 plan versions, 0 orch model calls.

---

## Case 2 result

Professional / Restart HUD: **0 evidence requests**, `stopReason: no_requests_needed`. Closure not used for already-grounded HUD de-emphasis. Crop-safety request only if preferred strategy is crop.

---

## Case 4 result

Shorter/clearer correction: **0 investigation calls**. Trim/preserve strategies already grounded. No over-investigation.

---

## Case 4 redundancy analysis

Live plan item count: **8** (≤16). Notes:

- Multiple `preservation_requirement|preserve` items (distinct beat provenance may justify)
- Multiple `hesitation_or_correction_friction|trim` items (same)
- Preserve/trim overlap flagged for future execution review
- Not force-merged in V1 (report-only)

---

## Upwork result

Passive Upwork does not generate workflow evidence hunts. Final plan has no Upwork trim/zoom/emphasize strategies.

---

## Settings result

“Zoom into Settings when I open it.”: final preferred strategies include `avoid_implication` / `no_safe_edit` / `preserve` — **no zoom**. Missing source support remains honest.

---

## Stable narration result

Concise/professional narration: `no_requests_needed`, 0 investigator invocations.

---

## Model-call count

| Layer | Calls |
|-------|-------|
| Closure orchestration / policy | **0** |
| Investigator (deterministic path) | **0** investigator model calls (metrics) |
| Additional orch calls | **0** |

Provider visual-model costs only if a future Investigator path uses the shared chat model for semantics — reported separately when present; V1 offline mocks: 0.

---

## Latency breakdown

Live offline suite (~20 ms wall for A–D). Per unknown-target closure (~1 ms): requestGen ≪1 ms, investigation mock ≪1 ms, recompute ~0.6 ms (claims + source + target + gap + plan).

---

## Tests

`planningClosureV1.test.ts` + live runtime — request policy, roles, bounded range, dedupe, budgets, support/invalidate paths, versioning, material stop, Upwork, Case 2/4, Settings, stable narration, preservation, no GT/execution leakage, 0 orch model calls.

Edit Plan / Edit Gap regressions remain green (46 tests in combined run).

---

## Benchmark impact

New identity: **`CURRENT_OPENSCREEN_PLANNING_CLOSURE_V1`**. Prior identities preserved (including Edit Plan V1). Deterministic edit path unaffected — closure never calls mutating tools.

Artifact: `tmp/perception-benchmark/planning-closure-v1/live-regressions.json`

---

## Remaining limitations

- Investigator focus is still message+budget encoded (no first-class `focusRange` API on the runner).
- Support→zoom eligibility depends on claim/source-story promotion quality after investigation.
- Case 4 redundancy is analyzed, not auto-merged.
- Real video OCR/ROI closure quality not exercised in offline mocks (injectable investigator used).
- Closure runs on the product path only for editingContext with a full story/gap/plan stack.

---

## Recommended next milestone

**Constrained Edit Proposal V1** — turn *resolved* preferred strategies into reviewable, non-applied tool proposals with arguments — still requiring explicit consent before any Axcut mutation.

Alternatively: deepen Investigator `focusRange` API + real Case 2 crop-safety live media pass.

Do **not** start autonomous editing.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Planning Closure V1 delivers a bounded, epistemically honest plan↔investigate↔recompute loop with zero execution. Limitations are expected V1 scope. **STOP.**
