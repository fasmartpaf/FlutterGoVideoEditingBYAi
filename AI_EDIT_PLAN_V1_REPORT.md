# OpenScreen Edit Plan V1 — Gap → Editorial Action Plan

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_EDIT_PLAN_V1`  
**Prerequisites:** Edit Gap V1, Target Story V1, Source Story V2, Claim Promotion, Investigator V1.1, Ledger V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: No edits executed. No AxcutDocument mutation. No autonomous editing.

---

## Executive verdict

Edit Plan V1 maps trusted **Edit Gap** items to ranked **candidate strategy families** (trim / crop / zoom / preserve / avoid_implication / needs_more_evidence / …) using an audited OpenScreen capability registry. Feasibility is honest about unsupported tools (transitions, denoise, stabilize, upscale, TTS). **0 additional model calls. No execution.**

---

## Existing editing-tool capability audit

Authority: `OPENSCREEN_TOOL_NAMES` / `buildTools` in `electron/ai-edition/agent-tools.ts` + `deep-agent/service.ts`.

| Family | Supported? | Tools |
|--------|------------|-------|
| trim | yes | `addTrim`, `addTrims`, `setTrim`, `removeTrim` |
| zoom | yes | `addZoom`, `addZooms`, `setZoom` |
| crop | yes | `setClipCrop` |
| speed | yes | `addSpeed`, `setSpeed` |
| annotation | yes | `addAnnotation`, `setAnnotation` |
| graphic | yes | `addGraphic` |
| captions | yes (partial: CLI/STT) | `generateCaptions`, `setWordText` |
| audio overlay | yes | `addAudio`, `setAudio` |
| aspect / background | yes | `setAspectRatio`, `setBackground` |
| transitions | **no** | — |
| denoise | **no** | — |
| stabilize | **no** | — |
| upscale | **no** | — |
| TTS | **no** | — |

---

## Edit Plan architecture

```text
SOURCE STORY V2
        ↓
TARGET STORY V1
        ↓
EDIT GAP V1
        ↓
EDIT PLAN V1  (CURRENT_OPENSCREEN_EDIT_PLAN_V1)
```

Module: `electron/ai-edition/editPlan/`. Wired via `prepareEditPlanForTurn` after Edit Gap in `deep-agent/service.ts` → `InvokeResult.editPlanV1`.

Upstream layers preserved; planner does not bypass Edit Gap to reason from raw frames.

---

## Input contract

```ts
type EditPlanInput = {
  sourceStoryV2: SourceStoryV2
  targetStoryV1: TargetStoryV1
  editGapV1: EditGapV1
  availableCapabilities?: EditCapabilityRegistry
}
```

Tools constrain feasibility only — they do **not** redefine Target Story.

---

## Capability registry

`defaultEditCapabilityRegistry()` mirrors the audit above. Unsupported historical families remain `false`.

---

## Gap → strategy mapping

| Gap category | Candidate families (ranked) |
|--------------|-----------------------------|
| `preservation_requirement` | preserve |
| `distracting_temporary_ui` | trim → crop → annotation → preserve → no_safe_edit |
| `hesitation_or_correction_friction` | trim (superseded wording) → preserve → caption → speed |
| `unsupported_story_implication` | avoid_implication → trim implication → preserve honesty |
| `missing_target_support` | needs_more_evidence → no_safe_edit |
| `pacing_excess` / `repetition` | trim → speed → preserve explanation |
| `unclear_focus` | zoom/crop/annotation **if grounded**, else needs_more_evidence |
| `weak_transition` | preserve (no dissolve) → optional trim dead air |
| `passive_context_noise` | **no plan item** (not an editing target) |

Gap determines candidates; registry filters feasibility.

---

## Strategy ranking

Deterministic `rankScore` with feasibility penalties for unsupported families. Preferred strategy = highest feasible score. Plan order: honesty → preservation → pacing → clarity/focus → distracting UI → polish.

---

## Preservation handling

Edit Gap preserve list + hard constraints are copied onto every related plan item. Conflict detector prefers preserve over trim when overlapping beats disagree.

---

## Epistemic safety

- Restart tip → HUD strategies only; never “remove restart action”
- Upwork passive → no trim/zoom/emphasize plan
- Settings speech without visual → avoid_implication; never zoom/annotate Settings
- Case 4 correction → trim/preserve speech; never zoom Timeline/Effects panels

---

## Needs-more-evidence handling

Ungrounded focal targets (e.g. “Publish button” without verified UI) emit `needs_more_evidence` with required evidence notes. No silent guessing. Planning→investigation loop **not** implemented yet.

---

## Unsupported-capability handling

Requested denoise (etc.) → `feasibility = unsupported` + `unsupportedCapability`. No unrelated tool substitution.

---

## No-safe-edit handling

`no_safe_edit` is a first-class strategy when HUD overlays essential content or transitions are requested but unavailable.

---

## Dependencies

Correction/compression items may `dependsOn` overlapping preserve items (structural only — not executed).

---

## Conflict detection

Detects preserve-vs-trim and speech-vs-speed on shared beats; marks `conflictsWith` and recommends safer strategy.

---

## Validator/sanitizer

Rejects executable tool args (`addTrim(…)`, `startSec`/`endSec` JSON), Upwork workflow plans, restart-action plans, unverified panel zooms; downgrades weak provenance.

---

## Case 2 result

Professional intent: HUD candidates ranked (trim/crop/preserve/no_safe_edit); transition preserved. No restart-action or Upwork workflow plans.

---

## Upwork result

No plan item targeting Upwork under generic professional request (hard invariant).

---

## Case 4 result

Correction friction → trim superseded wording / preserve corrected Effects meaning. No panel zoom strategies.

---

## Settings result

avoid_implication / needs_more_evidence / no_safe_edit. No fabricated Settings visuals.

---

## Stable narration result

Pacing / preserve / caption candidates only. No manufactured zoom for “engagement.”

---

## Live tests

Artifact: `tmp/perception-benchmark/edit-plan-v1/live-regressions.json`

| Case | Plan items | Model calls | Notes |
|------|------------|-------------|-------|
| Case 2 professional | compact | 0 | HUD + preserve |
| Case 4 shorter/clearer | compact | 0 | correction + honesty |
| Narrated concise | compact | 0 | no zoom preference |

Wall latency (three cases): tens of ms.

---

## Quality rubric

| Criterion | Status |
|-----------|--------|
| Gap coverage | Pass |
| Source grounding | Pass |
| Target Story fidelity | Pass |
| Preservation safety | Pass |
| Epistemic honesty | Pass |
| Feasibility accuracy | Pass |
| Unsupported-capability honesty | Pass |
| No execution leakage | Pass |
| Conflict handling | Pass (basic) |
| Evidence-awareness | Pass |
| Compactness | Pass (≤16) |

---

## Model-call count

**0** additional LLM calls.

---

## Latency

Planner builds in low tens of ms for the three offline live cases; serialized plan sizes typically a few KB.

---

## Tests

`editPlanV1.test.ts` + live runtime — 18 tests covering gap mapping, preservation, Upwork, unknown action, contradiction, unsupported capability, no-safe-edit / needs-more-evidence, registry feasibility, no tool args, conflicts/deps/ordering, Case 2/4/Settings/stable narration, compose with Source/Target/Gap green, prepare path, 0 model calls.

Upstream Edit Gap / Target Story / Source Story regressions remain green.

---

## Benchmark impact

New identity: **`CURRENT_OPENSCREEN_EDIT_PLAN_V1`**. All prior identities preserved. Deterministic edit path unaffected (plan does not call tools or mutate documents).

---

## Remaining limitations

- Strategy ranking is heuristic, not learned.
- Conflict detection covers primary preserve/trim and speech/speed cases only.
- Captions marked partially_supported (CLI/STT) but not deeply probed per turn.
- No planning→investigation loop yet for `needs_more_evidence`.
- Evidence ranges are contextual only — still not edit landings (by design).

---

## Recommended next milestone

**Plan Execution Preview V1** (or **Constrained Edit Proposal V1**): turn preferred strategies into *reviewable* proposed tool calls with arguments — still requiring explicit user/agent consent before mutation — OR a **needs-more-evidence → Investigator loop** before any mutation.

Do **not** start autonomous editing.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Edit Plan V1 delivers gap-driven, epistemically safe, capability-honest candidate strategies with zero execution. Limitations are expected V1 scope. **STOP.**
