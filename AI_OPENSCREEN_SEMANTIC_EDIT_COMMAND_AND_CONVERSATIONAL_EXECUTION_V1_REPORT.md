# AI_OPENSCREEN_SEMANTIC_EDIT_COMMAND_AND_CONVERSATIONAL_EXECUTION_V1_REPORT

**Milestone:** `OPENSCREEN_SEMANTIC_EDIT_COMMAND_AND_CONVERSATIONAL_EXECUTION_V1`  
**Date:** 2026-09-17

```
SEMANTIC_EDIT_EXECUTION_STATUS = FUNCTIONAL_WITH_GAPS
```

Routing / authority bridge between ordinary language and frozen edit tools.  
Frozen families were not retuned. HARD STOP after this report.

---

## 1. Exact root cause of the generic refusal loop

| Failure | Root cause |
|---------|------------|
| A “improve it?” → no useful edit | Orch KEEP + assessment honesty; improve authorized `you_decide` but weak evidence → conservative KEEP (acceptable for autonomous). Not the main bug. |
| B “professional + zooming” | `forceLocalProfessionalOrch` replaced the user message with a canned professional prompt that **never said zoom**, so `parseProfessionalEditIntent` invented trim/speed and **dropped zoom**. |
| C “zoom when … landing page” | Semantic WHEN had no seconds → orch path; orch message **discarded the cue**; zoom stayed click-gate KEEP → generic “no safe edit”. |
| D “yes” / “go ahead” | Bare `"yes"` → `UNKNOWN` → escalate_cloud → Edit-Plan honesty refusal. No pending-proposal slot. Auth ask required magic “yes proceed”. |

Exact canned refusal string still lives in `editorialGrounding/briefing.ts` `enforceFinalPlanConsistency` — now avoided for these turns because they stay local-resolved.

---

## 2. Command / intent authority model (before → after)

| Mode | Before | After |
|------|--------|-------|
| Autonomous | system WHAT+WHERE; KEEP OK | unchanged |
| Explicit timed | direct execute | unchanged |
| **Semantic command** | treated as autonomous propose → often KEEP | **user WHAT; local resolver WHERE; direct EXECUTE** |
| **Confirmation** | escalate / reassess | **execute pending proposal** |
| Advice question | escalate_cloud → honesty refusal | **propose + pending; no mutate until yes** |

Critical rule enforced: explicit semantic commands do **not** pass through autonomous APPLY/KEEP usefulness veto.

---

## 3. Semantic event resolver architecture

New module: `electron/ai-edition/localEditorialChat/semanticEventResolve.ts`

```
semantic phrase
  → tokenize / classify (VISUAL_OR_UI | SPOKEN | CLICK)
  → transcript segments+words
  → cursor clicks (near transcript or global for click intents)
  → weak cursor-jump proxy (LOW only)
  → merge candidates
  → FOUND | AMBIGUOUS | NOT_FOUND
  → existing frozen addZoom (direct path)
```

No new Director / planner / TCS.

---

## 4. Evidence used for WHERE

| Priority | Source |
|----------|--------|
| Spoken | transcript words/segments |
| Click | cursor click/mouseup + nearby transcript label |
| Visual/UI | transcript UI nouns + optional cursor jump (LOW) |
| Not used yet | full OCR frame packs / source-story beats as first-class inputs (gap) |

---

## 5. Pending-proposal / “yes do it”

Session field: `LocalEditorialSessionStateV1.pendingProposal`

Kinds: `direct_zoom` | `advice_zoom` | `orch_plan`

| User | Behavior |
|------|----------|
| advice → “yes” / “go ahead” | resolveFollowUp → direct zoom execute |
| orch auth-ask → “go ahead” | orch message forced to Proceed; bare yes allowed only with `orch_plan` pending |
| after successful apply | pending cleared |

**Restart:** pending is **in-memory only** — does **not** survive app restart (honest L).

---

## 6. Mixed professional + explicit-command

`buildOrchestratorMessage` now appends:

- `Explicitly requested families: …`
- semantic WHEN clause when present
- `Original user request: …`

`invokeOpenScreenAgent` no longer replaces the user text wholesale; it **appends** the original request under the orch prompt so zoom cannot be dropped.

---

## 7. Real utterance → resolved event → operation table

| Case | Utterance | Result |
|------|-----------|--------|
| A | zoom from 5 to 10 seconds | direct ADD_ZOOM EXECUTE |
| B | zoom when I switch to the landing page | resolve → addZoom at grounded range |
| C | when I click Export | click+transcript → zoom |
| D | when I start talking about pricing | transcript → zoom |
| E | professional + zooming | orch message retains zoom family |
| F | Do you think … needs a zoom? → yes | propose → execute pending |
| G | go ahead (orch pending) | proceed orch, not reassessment |
| H | two landing pages | AMBIGUOUS clarification |
| I | unknown event | specific “couldn’t locate”, not generic unsafe |
| J | make that stronger | existing frozen zoom follow-up |

---

## 8. Ambiguous / absent-event behavior

- Ambiguous: short clarification with candidate times; no guessed mutation.
- Absent: specific grounding failure + optional “around 12s” hint.
- Never: “I don't see a safe, recording-specific edit…” for these cases.

---

## 9. Timeline + native preview evidence

Unit + live smoke (`semanticEditExecutionV1.live.runtime.test.ts`) on real recording path `recording-1789587327859.mp4` with grounded transcript overlay:

- timed zoom mutates `zoomRanges`
- semantic landing-page zoom mutates
- advice→yes mutates
- `TOTAL_CLOUD_CALLS = 0`

Artifacts: `tmp/perception-benchmark/openscreen-semantic-edit-execution-v1/`

Full Electron Chat UI walkthrough of the user’s exact failing session was not re-driven in this pass (gap).

---

## 10. Follow-up behavior

Uses existing frozen zoom anaphora (`make that stronger`, earlier/later/remove) via `resolveFollowUp` + direct zoom — unchanged family implementation.

---

## 11. Files changed

| File | Role |
|------|------|
| `localEditorialChat/semanticEventResolve.ts` | WHERE resolver |
| `localEditorialChat/types.ts` | `semanticEventCue`, `pendingProposal` |
| `localEditorialChat/session.ts` | pending get/set/clear |
| `localEditorialChat/parse.ts` | semantic/advice routing; orch message preserve |
| `localEditorialChat/resolveFollowUp.ts` | confirmation → execute |
| `localEditorialChat/index.ts` | advice propose; semantic direct apply |
| `professionalEditOrchestrator/intent.ts` | `add the zoom`; proceed helpers |
| `professionalEditOrchestrator/authorization.ts` | bare affirm gated |
| `professionalEditOrchestrator/assessment.ts` | auth-ask copy |
| `professionalEditOrchestrator/run.ts` | `allowBareAffirmation` |
| `deep-agent/service.ts` | keep original user text; store orch pending |
| `semanticEditExecutionV1.test.ts` / `.live.runtime.test.ts` | matrix |

Frozen Zoom/Trim/Speed/Captions/Title/Callout/Transition apply implementations **not** modified.

---

## 12. Frozen-family regression

`zoomControlMaturityV1.test.ts` + `transitionsProductMaturityV1.test.ts` pass. No freeze-marker edits to family apply code.

---

## 13. TOTAL_CLOUD_CALLS

```
TOTAL_CLOUD_CALLS = 0
```

on the local semantic / confirm / timed paths tested.

---

## 14. Remaining genuine limitations

1. Visual-only events with **no** transcript/cursor support still under-ground (LOW jump proxy only).  
2. Pending proposals **do not survive** app restart.  
3. Full product Chat reproduction of the user’s exact live failure session not re-run in UI this pass.  
4. OCR/source-story beats not yet first-class resolver inputs.  
5. “do the same when I open settings” (style transfer across events) only partially covered via new semantic resolve + existing zoom depth defaults.

---

## 15. Final status

```
SEMANTIC_EDIT_EXECUTION_STATUS = FUNCTIONAL_WITH_GAPS
```

Refusal loop root causes for B/C/D addressed; semantic WHERE + confirmation work with tests and real-media smoke. Gaps above prevent MATURE.

**HARD STOP.** Do not begin another editing family. Do not reopen frozen editing implementations.
