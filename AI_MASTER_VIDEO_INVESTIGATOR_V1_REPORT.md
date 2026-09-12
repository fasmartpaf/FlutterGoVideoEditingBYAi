# Master Video Investigator Agent V1 — CTO Report

**Date:** 2026-09-13  
**Prerequisite:** Temporal Event Ledger + Video Evidence Store V1 (`PASS_WITH_LIMITATIONS`)  
**Verdict:** **PASS_WITH_LIMITATIONS**

This milestone does **not** complete Target Story, autonomous editing, or the full Video Cognition Agent. It adds a bounded evidence-acquisition layer on top of the existing stack.

---

## A. Pre-change architecture audit

Baseline unit suite before edits: **131 passed** (`tmp/perception-benchmark/investigator-v1-baseline.txt`).

Confirmed (no rewrite):

| Layer | Status |
|---|---|
| `temporalEventLedger` + `createVideoEvidenceStore` | Reused as memory |
| `mediaContextNeeds` | Untouched gate |
| `visualEvidence` prepare/extract/change/cache | Reused by inspect tools |
| `speechEvidence` + `filterSpeechSegmentsBySourceRange` | Reused |
| Cursor telemetry non-move samples | Reused |
| `sourceTiming` / SOURCE_MEDIA_TIME | Preserved |
| Source Story | Untouched; parallel |
| deep-agent 34 tools + `recursionLimit: 1000` | Untouched for edit agent |
| CURRENT_OPENSCREEN locked baseline | Not overwritten |
| Editing tools | Investigator never calls them |

Prior gap: ledger built **after** the model turn and unused for acquisition. No `inspect_frame` / InvestigationEvidenceSet.

---

## B. Exact files added/changed

### Added

- `electron/ai-edition/videoInvestigator/types.ts`
- `electron/ai-edition/videoInvestigator/tools.ts`
- `electron/ai-edition/videoInvestigator/plan.ts`
- `electron/ai-edition/videoInvestigator/verify.ts`
- `electron/ai-edition/videoInvestigator/run.ts`
- `electron/ai-edition/videoInvestigator/briefing.ts`
- `electron/ai-edition/videoInvestigator/attachBriefing.ts`
- `electron/ai-edition/videoInvestigator/index.ts`
- `electron/ai-edition/videoInvestigator/videoInvestigator.test.ts`
- `electron/ai-edition/perceptionBenchmark/investigator-v1.runtime.test.ts`
- `electron/ai-edition/perceptionBenchmark/investigator-case2.runtime.test.ts`
- `AI_MASTER_VIDEO_INVESTIGATOR_V1_REPORT.md` (this file)
- Diagnostics under `tmp/perception-benchmark/investigator-v1/` (gitignored)

### Modified

- `electron/ai-edition/deep-agent/service.ts` — run investigator after prepare, before agent; attach briefing/stills; return `investigationEvidence` on success/empty/error paths
- `electron/ai-edition/perceptionBenchmark/runCurrentStack.ts` — optional `provider` identity; write `*.investigation-v1.json`

---

## C. Investigator architecture / data flow

```
USER REQUEST
  → mediaContextNeeds (unchanged)
  → prepare visual / speech / cursor (unchanged)
  → buildLedgerFromPreparedEvidence (pre-semantic)
  → createVideoEvidenceStore
  → Master Video Investigator V1 (deterministic, budgets)
       → bounded tools
       → InvestigationEvidenceSet + claim verification
       → internal briefing (+ optional stills) merged into agent user message
  → existing deep-agent turn (same provider/model; Source Story unchanged)
  → grounded diagnosis / strip internals
  → rebuild ledger (post-semantic) on InvokeResult
```

Investigator is **skipped** for `deterministicEdit` (e.g. “trim silences”).

---

## D. Investigation tools implemented/reused

| Tool | Implementation |
|---|---|
| `get_events_in_range` | Video Evidence Store |
| `get_transcript_range` | `filterSpeechSegmentsBySourceRange` |
| `get_cursor_events` | Prepared non-move cursor samples |
| `inspect_frame` | Existing frame cache or `extractVisualEvidenceFrames` |
| `inspect_video_range` | Bounded samples inside range (≤5) |
| `compare_visual_states` | `decodeGrayThumbnail` + `scoreGrayThumbnails` / `classifyChangeScore` |
| `get_evidence_for_event` | `store.evidenceForEvent` |
| `inspect_region` | ffmpeg crop presets: `bottom_center`, `top_chrome`, `center` |

Tool results are **evidence**, never conclusions like “Restart tooltip appeared.”

---

## E. Agent-loop budgets

| Budget | Default | Rationale |
|---|---|---|
| `maxSteps` | 12 | Far below edit-agent `recursionLimit: 1000` |
| `maxFrameInspections` | 4 | Cap extract cost |
| `maxRangeInspections` | 3 | Avoid rewatching whole video |
| `maxRoiInspections` | 2 | Peripheral UI only when justified |
| `maxCompareCalls` | 3 | Pixel diffs stay cheap |
| `maxRepeatedRangeInspections` | 1 | No infinite same-range loop |
| `maxBriefingChars` | 3500 | Bound prompt injection |

Stop reasons: `sufficient_evidence` | `budget_exhausted` | `deterministic_edit_skip` | `no_ledger` | `no_uncertainty` | `insufficient_evidence`.

**Investigator model calls: always 0.** Semantic interpretation of new stills uses the **existing** agent vision turn (not a second investigator LLM).

---

## F. Evidence Set schema

`InvestigationEvidenceSet` (`version: 1`):

- `focusRange`, `questionSummary`, `stopReason`
- `coverage` (ranges, frame times, ROI count, modalities, `absenceIsStrong: false` by default)
- `observations[]` (ledger/transcript/cursor/frame/range/compare/roi/provenance)
- `claims[]` with verdicts
- `toolTrace[]`, `metrics`, `additionalFrames[]`
- `internalBriefing` — for the reasoning layer only

---

## G. Claim-verification behavior

Verdicts: ledger epistemic + `supported` | `not_verified` | `insufficient_evidence`.

Examples:

- Passive Upwork tab → hypothesis “opened/worked in Upwork” → **`not_verified`**
- Spoken panel/Settings open without material visual change → **`contradicted`**
- Spoken correction → retained as **`spoken`**
- Pixel compare → **`supported`** material change only (no UI name)

Absence of observation ≠ “did not happen” (`absenceIsStrong: false`).

---

## H. Upwork passive-context test

Unit: investigator claims Upwork open/work as `not_verified`, never `verified`.  
Matches ledger invariant from V1.

---

## I. Case 4 correction test

Unit: spoken correction retained; timeline/effects/Settings open not verified; contradictions preserved.

---

## J. Case 2 targeted-inspection result

Artifact: `tmp/perception-benchmark/investigator-v1/case02-targeted-inspection.json`  
Media: locked recording-1789020958404 (production path). GT **not** injected.

| Question | Answer |
|---|---|
| Initial evidence | Samples at 16s & 18s; change class **minimal** (historical miss condition) |
| Why deeper inspection | `mediaUnderstanding` + late visual uncertainty / end-adjacent samples; plan adds late `inspect_video_range` + ROI presets (generic bottom_center / top_chrome — **not** hard-coded “Restart”) |
| Ranges inspected | ~13.92–19.89s |
| Frames | 13.921, 15.909, 17.898 (+ ROIs at ~19.39s) |
| ROIs | bottom_center 576×182; top_chrome 1280×99 |
| Restart tooltip recognized by Investigator? | **No** — investigator does not invent labels; `restartRecognizedByInvestigator: false` |
| Recognition from GT? | **No** — production evidence only |
| Latency/cost | **~423 ms** investigation; **0** investigator model calls; 5 newly extracted stills (~90 ms ROI) |

A separate live full-turn with provider `CURRENT_OPENSCREEN_INVESTIGATOR_V1` completed with investigation attached (`stopReason=sufficient_evidence`, tools included late `inspect_video_range` + 2× `inspect_region`, investigation ~81 ms). The model returned **empty user-facing text** in that environment, so Restart was **not** mentioned in narration (`restartMentionedInUserText: false`). Semantic Restart detection still depends on the existing vision model noticing attached ROI/stills — **not claimed fixed**.

---

## K. Contradiction test

Settings / panel open speech without material visual support → `contradicted` claims retained. Speech not rewritten as visual truth.

---

## L. Audio/speech-state regressions

`no_audio` preserved distinctly in transcript tool observation.  
Whisper not re-run by investigator.  
Status contract unchanged (`available` / `no_audio` / `no_speech_detected` / `unavailable` / `failed`).

Separately noted (not “fixed” here): historical `speechStatus=failed` while segments exist remains a prior issue outside this milestone.

---

## M. Source Story regression

`sourceStory.test.ts` remains green. Source Story still builds from prepared speech/frames/changes — **not** rewritten to consume the ledger. Investigator briefing is additive context for the same agent turn.

---

## N. Model-call count

| Stage | Calls |
|---|---|
| Investigator V1 | **0** |
| Existing agent turn | **1** (unchanged product path) |
| Extra investigator LLM | **0** |

---

## O. Latency before/after

| Measurement | Value |
|---|---|
| Pre-change related unit baseline | 131 tests, ~0.5s |
| Investigator Case 2 targeted (real ffmpeg) | **~0.42s** added before model |
| Live Case 2 full turn (env) | ~106s dominated by model; empty text — not a fair latency win claim |

**No claim of end-to-end latency improvement** vs CURRENT_OPENSCREEN for scored narration. Investigator overhead is small vs Whisper/vision.

---

## P. Test counts

| Suite | Result |
|---|---|
| Pre-change related units | 131 passed |
| Final related + investigator suite | **92 passed / 0 failed** (includes Case 2 targeted + live provider identity) |
| `videoInvestigator` unit | 12 passed |
| Case 2 targeted runtime (ffmpeg, no invented Restart) | passed (~423 ms) |
| Live Case 2 provider run | investigation present; empty model text (env); Restart not in user text |

---

## Q. Benchmark comparison

- Locked **`CURRENT_OPENSCREEN`** baseline: **not modified**
- New provider identity: **`CURRENT_OPENSCREEN_INVESTIGATOR_V1`**
- Diagnostics: `*.investigation-v1.json`, `case02-targeted-inspection.json`, `case02-plan-only.json`
- Scorer remains separate from production evidence
- Important-event recall vs locked baseline for Restart: **not improved by investigator alone** (no semantic invention). Architecture enables attaching ROI stills for the existing model to see.

---

## R. Remaining limitations

1. Investigator does not itself OCR/recognize small tooltips — only acquires better stills/ROIs.
2. Restart Case 2 perception miss can persist if the vision model still ignores ROI crops.
3. Source Story not yet consumed-from InvestigationEvidenceSet (incremental migration remaining).
4. Multimodal `verified` confirmation still sparse.
5. Live full-turn scoring vs CURRENT_OPENSCREEN not claimed as a score win in this report.
6. ROI presets are geometric heuristics, not learned attention.
7. Focus heuristics are keyword-based (narrowed so “beginning to end” ≠ “near the end”).

---

## S. Verdict

**PASS_WITH_LIMITATIONS**

OpenScreen can now: start from ledger/store memory, identify uncertainty, run **bounded** additional inspection (frames/ranges/ROI/transcript/cursor/compare), verify important claims without upgrading passive visibility to actions, stop cleanly under budgets, and feed an internal evidence set into the existing reasoning turn — **without** rewriting architecture, reading GT, executing edits, adding Target Story, or unbounded loops.

**STOP.** Do not start Target Story or autonomous editing until this report is reviewed.
