# OpenScreen Target Story V1 — Epistemic Source → Desired Viewer Experience

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_TARGET_STORY_V1`  
**Prerequisites:** Source Story V2, Claim Promotion V1, Investigator V1.1, Ledger V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Edit Gap, Edit Plan, and autonomous editing not started.

---

## Executive verdict

Target Story V1 builds a **deterministic viewer-experience plan** from Source Story V2 + user intent. It maps preserve / de-emphasize / remove-candidate dispositions, carries epistemics (context ≠ action, contradictions, corrections, unknowns), and blocks tool leakage. Optional same-turn LLM may refine prose; sanitizer enforces constraints. **No edits executed.**

---

## Target Story architecture

```text
Source Story V2 + userIntent
        ↓
TargetStoryInput
        ↓
buildTargetStoryV1 (deterministic, 0 LLM)
        ↓
constrained TARGET_STORY_V1_EVIDENCE prompt
        ↓
same-turn LLM TARGET_STORY JSON (optional)
        ↓
constrainTargetStoryWithV1 / targetStoryFromV1 fallback
```

Module: `electron/ai-edition/targetStory/v1/`. Wired in `prepareTargetStoryForTurn` + `deep-agent/service.ts`.

---

## Input contract

`TargetStoryInput`:

- `sourceStoryV2` (required for V1 path)
- `userIntent`
- optional tone/platform/length/audience/constraints
- optional precomputed `editingIntent` (else `inferEditingIntentHints`)

---

## User-intent handling

Deterministic objective kinds: polish / shorten / clarify / focus / restructure / repurpose / custom.  
Qualities and constraints from the user message drive pacing and disposition — not tool catalogs.

---

## Source Story V2 consumption

Consumes beats, facts, context, spoken items, corrections, contradictions, unresolved actions, persistent context, provenance IDs.

---

## Epistemic handling

| Source kind | Target handling |
|-------------|-----------------|
| story_fact / supported visual | eligible preserve / emphasize |
| passive context (Upwork) | ignore unless user asks; never workflow goal |
| spoken intention / correction | preserve corrected meaning; de-emphasize mistake |
| unresolved action | unresolved honesty note — never a goal |
| contradiction | avoid presenting as completed |
| recording chrome (Restart tooltip) | remove_candidate / de-emphasize for polish |

---

## Target beat model

Each beat: `sourceBeatIds`, purpose, `viewerShouldUnderstand`, emphasize / deEmphasize, pacingIntent, clarityIntent, disposition, confidence, provenance.

No orphan beats without source mapping (except unsupported-request markers).

---

## Preserve/de-emphasize/remove policy

Explicit lists:

- **preserve** — meaning-carrying content  
- **de_emphasize** — may remain, should not dominate  
- **remove_candidate** — likely unnecessary for viewer experience (**not** a trim command)

---

## Correction handling

Preserve corrected spoken meaning; de-emphasize superseded initial wording. Never invent “show Timeline then Effects.”

---

## Contradiction handling

Unresolved entries require honesty: do not present contradicted actions as completed viewer facts.

---

## Unsupported request handling

`requested_but_not_source_supported` when user asks for Settings focus / Upwork workflow / testimonial without source support — not treated as existing story content.

---

## Tool-independence proof

Guards reject zoom/trim/crop/dissolve/lower-third/ffmpeg-style instructions and edit timestamps. Sanitizer rewrites leaks to viewer-experience language. Prompt forbids tool commands. Tests assert no tool leakage after constrain.

---

## Case 2 result

Professional intent: keep meaningful transitions; Restart tooltip → remove/de-emphasize candidate; no restart-action goal; Upwork not a target beat.

---

## Upwork result

Passive tab ignored for “Make this professional.” No Upwork workflow target beat.

---

## Case 4 result

Preserve correction; de-emphasize mistaken wording; no dual panel-open target.

---

## Settings result

Contradiction → avoid completed Settings workflow; explicit “Focus on Settings” → unsupported marker.

---

## Stable narration result

Narration-only phases become target beats for spoken clarity without inventing visuals.

---

## Whole-video result

Desired arc from evidence-backed phase sequence; chronological continuity default.

---

## Live tests

`targetStoryV1.live.runtime.test.ts` — Case 2 + Case 4 + narrated professional/shorter intents. Artifact: `tmp/perception-benchmark/target-story-v1/live-regressions.json`. **No edits executed.**

---

## Quality rubric

`TargetStoryQualityRubric`: factualGrounding, faithfulToUserIntent, communicationClarity, pacingCoherence, sourcePreservation, contradictionHandling, uncertaintyHandling, noInventedSourceEvents, noToolLeakage.

---

## Model-call count

| Stage | Calls |
|-------|-------|
| `buildTargetStoryV1` | **0** |
| Prompt construction | **0** |
| Constrain / derive | **0** |
| Optional same-turn LLM TARGET_STORY JSON | **1 shared agent turn** (existing editingContext path; not a new call) |

`metrics.additionalModelCalls: 0` for the deterministic V1 core.

---

## Latency

Deterministic V1 build ≪ 5 ms on fixtures (live suite < 500 ms). Prompt size recorded in `metrics.promptChars`.

---

## Tests

| Suite | Result |
|-------|--------|
| `targetStory/v1/targetStoryV1.test.ts` | **14 passed** |
| `targetStory/v1/targetStoryV1.live.runtime.test.ts` | **1 passed** |
| Source Story V2 + existing Target Story tests | green (51 passed / 7 skipped in combined run) |

---

## Benchmark impact

| Identity | Status |
|----------|--------|
| Prior locked identities | preserved |
| **`CURRENT_OPENSCREEN_TARGET_STORY_V1`** | **new** |

---

## Remaining limitations

- Same-turn LLM can still emit TARGET_STORY JSON; trust relies on V1 evidence + sanitizer.  
- Disposition heuristics are rule-based (not learned editorial taste).  
- `remove_candidate` is advisory only until a future Edit Gap milestone.  
- Does not yet score multi-turn style consistency across conflicting user constraints.

---

## Recommended next milestone

**Edit Gap analysis** (desired vs source — still no autonomous execution), then optional Edit Plan. Do not auto-mutate AxcutDocument.

---

## Verdict

**PASS_WITH_LIMITATIONS**
