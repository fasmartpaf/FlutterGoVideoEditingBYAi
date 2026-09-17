# OpenScreen Constrained Edit Proposal V1

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_EDIT_PROPOSAL_V1`  
**Prerequisites:** Edit Plan V1, Planning Closure V1, Edit Gap V1, Target Story V1, Source Story V2  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Proposals only. No AxcutDocument mutation. No tool execution. No autonomous editing.

---

## Executive verdict

Constrained Edit Proposal V1 turns trusted Edit Plan items (+ optional Closure snapshots) into **precise, executable-shaped proposals** that must answer four questions before they are proposal-ready: evidence justification, landing, what must survive, and what could be damaged. Tool-shaped `proposedCall` objects are always `proposal_only` / `notExecuted: true`. **0 additional model calls.**

Case 2 and Case 4 skipping unnecessary closure remains a success; this layer adds concrete landings and honesty about unsafe HUD/spatial edits and correction preservation.

---

## Architecture

```text
Evidence → Understanding → Target → Gap → Plan → Closure → Proposal
                                                              ↓
                                                         STOP (no apply)
```

Module: `electron/ai-edition/editProposal/`. Wired after Closure in `deep-agent/service.ts` → `InvokeResult.editProposalV1`.

---

## Proposal vs Plan

| Layer | Example |
|-------|---------|
| Edit Plan | “Trim the superseded correction.” |
| Edit Proposal | Landing ≈ superseded speech window; must survive corrected Effects meaning; damage = speech jump / corrected-intent loss; `proposedCall: { toolName: "addTrim", status: "proposal_only", … }` |

---

## Four proofs (required)

Every mutating proposal carries:

1. **Evidence justification** + `evidenceRefs` (plan/gap/beats/preservation)  
2. **Landing** in `SOURCE_MEDIA_TIME` with `boundaryBasis`, `boundaryConfidence`, `finalizedForApply: false`  
3. **mustSurvive** (preservation / corrected meaning / constraints)  
4. **damageRisks** + `continuityRisk` / `preservationViolationRisk`

If any proof fails → `provisional`, `no_safe_proposal`, or `needs_more_evidence`.

---

## Status model

- `proposal_ready` — evidence + landing + survival OK (still not executed)  
- `provisional` — usable shape but boundary/continuity caution  
- `no_safe_proposal` — honest refusal (e.g. HUD crop without safety)  
- `needs_more_evidence` — cannot land yet  
- `unsupported` — capability missing  

---

## Case results

### Case 2 (professional / HUD)

Temporary Restart UI does **not** auto-justify crop. Crop → `no_safe_proposal`. Trim proposals must carry damage awareness. No Upwork workflow proposals. No restart-action proposals.

### Case 4 (shorter/clearer)

Correction friction produces trim-oriented proposals (often **provisional** when Plan preferred preserve due to conflict). Must-survive / corrected-intent damage risks required. No Timeline/Effects panel zooms.

**Compactness:** Case 4 plan-item redundancy remains a recorded limitation — not force-tuned this milestone.

### Settings

No zoom proposals when Settings is unverified. Prefer avoid_implication / no_safe / deferred preserve.

### Stable narration

No manufactured zoom proposals for “engaging” visuals.

---

## Edit-quality metrics (V1)

`quality` on `EditProposalV1`:

- proposalReady / provisional / noSafe / needsMore / unsupported counts  
- avgBoundaryConfidence  
- highContinuityRiskCount  
- preservationBlockingCount  

Rubric: evidence grounding, landing precision, preservation safety, damage awareness, no execution leakage, epistemic honesty, feasibility honesty, compactness.

---

## Live tests

Artifact: `tmp/perception-benchmark/edit-proposal-v1/live-regressions.json`  
Offline suite latency: tens of ms. Model calls: **0**.

---

## Tests

`editProposalV1.test.ts` + live runtime cover the four proofs, Case 2/4/Upwork/Settings/narration, proposal_only shape, no GT leakage, prepare gating, rubric. Edit Plan + Planning Closure regressions remain green.

---

## Benchmark impact

New identity: **`CURRENT_OPENSCREEN_EDIT_PROPOSAL_V1`**. Prior identities preserved. Deterministic edit path unaffected (proposals never applied).

---

## Remaining limitations

- Landings are evidence-derived intervals, not Whisper-word-accurate cut points.  
- Crop proposals lack pixel-level cropRegion (intentionally blocked without safety).  
- Conflict→preserve plans yield provisional trims rather than fully resolved landings.  
- Case 4 proposal/plan compactness not force-optimized (await broader corpus).  
- No post-edit verification (correct — apply loop not started).

---

## Recommended next milestone

**Proposal Review / Consent Gate V1** or **Apply Preview V1**: present proposal_ready items for human/agent consent, then optionally apply a *single* consented proposal and verify preservation/continuity — still not autonomous multi-edit execution.

Do **not** jump to fully autonomous editing.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Constrained Edit Proposal V1 delivers evidence-backed, survival-aware, damage-aware proposals without execution. **STOP.**
