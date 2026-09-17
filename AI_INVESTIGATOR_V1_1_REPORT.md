# OpenScreen Master Video Investigator V1.1 — Role Policy + Adaptive Grounding

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_INVESTIGATOR_V1_1`  
**Prerequisites:** Ledger V1, Investigator V1, Reuse Visual V1, Claim Promotion V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Target Story and autonomous editing not started.

---

## Executive verdict

Investigator V1.1 adds a **deterministic role-policy layer** (grounding → modality roles → verify → stop) inside the existing Investigator runner—**no new top-level LLM agents**, **0 policy-classifier model calls**. Claim Promotion lazy signals now schedule bounded verification work. Locked baselines remain untouched.

---

## Reference architectures audited

| Project | Commit | Pattern used |
|---------|--------|--------------|
| **LongVideoAgent** | `6edd180b0c5b41c0c5f00e3d96f482a4eb5b27e2` | Master loop with grounding then vision; step budget K; stop when evidence enough |
| **VideoMind** | `6721d2564eeb9ea8ab6c0ab8eaa39bd231ee8927` | Planner / Grounder / Verifier / Answerer as **roles** (not separate OpenScreen agents) |
| **LongVT** | `08d755b973e4ad990ac5cdd64fb992c804d840db` | Global→local crop/zoom until grounded; avoid full-video re-scan |

Findings (idea-level only):

- **Ground first, then deepen** — localize question-relevant ranges before fine visual/OCR work.
- **Role separation** — planning states gate which tool family runs next.
- **Bounded stop** — terminate when evidence suffices; do not “inspect until something appears.”
- **Global→local** — coarse hierarchy for whole-video questions; local ranked ranges for focused ones.

---

## License constraints

| Project | License | Reuse stance |
|---------|---------|--------------|
| LongVideoAgent | **No LICENSE file on repo** | **Reference-only** — architecture ideas; no code copy |
| VideoMind | **BSD-3-Clause** | Compatible for clean-room adaptation of ideas |
| LongVT | **Apache-2.0** | Compatible for clean-room adaptation of ideas |

Attribution: `electron/ai-edition/videoInvestigator/rolePolicy/NOTICE.md`

---

## Role-policy architecture

Internal roles (planning states, not agents):

`GROUNDING → VISUAL_INSPECTION | SPEECH_INSPECTION | OCR_INSPECTION | CURSOR_INSPECTION → CONTRADICTION_CHECK → VERIFICATION → STOP`

Existing tools only. Runner: `runMasterVideoInvestigatorV1_1` (production path via `deep-agent/service.ts`). V1 planner remains available.

---

## Question intent classification

Deterministic heuristics (+ `mediaContextNeeds`), **0 LLM calls**:

`chronology | visual_state | speech_content | spoken_correction | action_verification | temporary_ui | text_ui_reading | cursor_interaction | contradiction_check | whole_media_understanding`

Speech-primary questions strip visual/OCR intents.

V1.1 also runs when `mediaContextNeeds` is `fallback` but intents clearly require media work (e.g. “Did I open Upwork?”), while still skipping `deterministicEdit`.

---

## Grounding algorithm

Collect candidates from:

- user begin/end hints  
- ledger transitions / visible text / passive chrome / speech / contradictions / cursor  
- Claim Promotion unresolved/contradicted claims (lazy signal)  
- whole-video: coarse thirds (`hierarchy_coarse`)

Never default to “OCR everything.”

---

## Range-ranking formula

Additive deterministic score (examples):

| Signal | Weight (approx) |
|--------|-----------------|
| time hint / end hint | +4 |
| temporary UI + late window | +4 |
| speech/contradiction (when relevant) | +4 |
| claim_promotion | +3.5 |
| visual change | +3 |
| passive (action questions) | +3 |
| hierarchy_coarse | +1.2 (lower priority) |
| near-full-span windows | **penalty** |

Top `maxRankedRanges` (default 3) inspected. Spans >45% of duration skipped for visual inspect.

---

## Role-transition policy

| Question | Path |
|----------|------|
| Did I open Upwork? | GROUNDING → CURSOR → VERIFICATION → STOP |
| What did I say near the end? | GROUNDING → SPEECH → early STOP |
| Brief popup near end? | GROUNDING → VISUAL → OCR (selective ROI) → STOP |
| Timeline/Effects? | SPEECH → CONTRADICTION (+ light compare) → STOP |
| Open Settings? | CONTRADICTION (not verify-open) |

---

## Claim Promotion integration

Pre-investigator `buildClaimPromotionSet` (lazy) feeds candidates + `lazyScheduledClaimIds`.  
Post-turn claim promotion still recomputes after specialist/ledger (closed loop).

Irrelevant already-supported claims → `skippedIrrelevant`.

---

## Lazy verification closed loop

```text
Claim Promotion (lazy mark)
    → Investigator V1.1 schedules modality roles for relevant unresolved claims
    → evidence set updated
    → Claim Promotion rebuild at end of turn
```

Bounded by role budgets; no infinite planner.

---

## Stop policy

Stop when:

- speech-primary transcript retrieved (early stop)  
- action verification has passive/cursor provenance without OCR need  
- budget exhausted  
- plan insufficient → `insufficient_evidence`  
- never “keep scanning until something appears”

---

## Case 2 result

Question: visible/brief UI near end → intents `temporary_ui` + `visual_state`; ranked late window; VISUAL + selective OCR ROI; no whole-video OCR sweep.

---

## Upwork result

GROUNDING on passive visibility ranges; CURSOR/VERIFY; action remains **not verified** via Claim Promotion `unknown`. No keyword shortcut.

---

## Case 4 result

SPEECH + CONTRADICTION roles; light visual compare only; no irrelevant region OCR.

---

## Settings contradiction result

`contradiction_check` preferred over verify-open; keyword coincidence does not promote action.

---

## Whole-video chronology result

Coarse thirds + ranked locals; rejects near-full-duration brute-force `inspect_video_range`.

---

## Tool-count comparison vs Investigator V1

| Scenario | V1.1 vs V1 |
|----------|------------|
| Transcript-only (“What did I say…”) | **Fewer** visual/OCR tools (often 0); early stop |
| Temporary UI / late popup | Targeted late range + ≤2 ROI (not mid/early unless ranked) |
| Whole-video chronology | ≤ `maxVisualInspections` coarse/local ranges, not full span |

Exact corpus deltas depend on ledger density; unit fixtures show speech-path visual tools ≤ V1.

---

## Latency

Planning typically ≪ 5 ms on fixture ledgers (`planningMs` on metrics). Tool latency dominated by ffmpeg when video present (unchanged).

---

## Model-call count

| Path | Extra model calls |
|------|-------------------|
| Intent classification | **0** |
| Role planning / ranking | **0** |
| Investigator tools | **0** |
| Policy classifier LLM | **0** |

`metrics.investigatorModelCalls: 0`, `RolePolicyPlan.additionalModelCalls: 0`.

---

## Tests

| Suite | Result |
|-------|--------|
| `rolePolicy/rolePolicy.test.ts` | **17 passed** (intents, roles, Upwork, Case4, Settings, lazy, ranking, budgets, stop, hierarchy, vs V1) |
| `videoInvestigator.test.ts` | green |
| `claimPromotion.test.ts` | green |
| `sourceStory.test.ts` | green |

---

## Benchmark comparison

| Identity | Status |
|----------|--------|
| `CURRENT_OPENSCREEN` | preserved |
| `CURRENT_OPENSCREEN_INVESTIGATOR_V1` | preserved (still callable) |
| `CURRENT_OPENSCREEN_REUSE_VISUAL_V1` | preserved |
| `CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1` | preserved |
| **`CURRENT_OPENSCREEN_INVESTIGATOR_V1_1`** | **new** (production invoke path) |

Compare dimensions for future harness: event recall, unsupported claims, temporal correctness, tool count, frames, OCR calls, latency, model calls.

---

## Remaining limitations

- Intent classification is heuristic; some phrases still land in `mediaContextNeeds` fallback (V1.1 compensates via intent gate).
- Early-stop covers speech-primary and some action paths; not every modality has a rich sufficiency detector.
- Specialist OCR still runs after investigation when video path exists (Reuse Visual); V1.1 reduces *investigator-planned* OCR/ranges, not necessarily specialist budgets.
- No GT; ranking not Case-2-overfit but still rule-based.

---

## Recommended next milestone

Source Story **consumption** of Claim Promotion bridge (promoted / unresolved / contradicted)—still no Target Story / autonomous editing.

---

## Verdict

**PASS_WITH_LIMITATIONS**
