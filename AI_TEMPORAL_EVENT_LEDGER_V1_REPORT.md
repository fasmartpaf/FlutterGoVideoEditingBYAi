# Temporal Event Ledger + Video Evidence Store V1 — CTO Report

**Date:** 2026-09-12  
**Milestone:** Evidence Store + Temporal Event Ledger only  
**Verdict:** **PASS_WITH_LIMITATIONS**

This milestone does **not** complete the Video Cognition Agent. It gives OpenScreen an internal, provenance-backed memory of what evidence already exists.

---

## A. Existing architecture audit (reused)

Inspected before coding. Reused directly (not duplicated):

| Concern | Existing module | Reuse |
|---|---|---|
| Canonical duration / SOURCE_MEDIA_TIME | `electron/ai-edition/sourceTiming` | Clamp + `SOURCE_TIMESTAMP_TOLERANCE_SEC`; ledger `meta.timebase = "SOURCE_MEDIA_TIME"` |
| Visual frames + reasons | `visualEvidence` (`VisualEvidenceFrame`, extract/sample) | Frame → `visual_sample` events |
| Visual change scores/classes | `visualEvidence/change` | Moderate/significant → `visual_transition` (pixel change only) |
| Speech segments + status | `speechEvidence` (`no_audio` / `available` / …) | → `speech` / `speech_pause` / `spoken_correction` / `speech_status` |
| Cursor non-move interactions | cursor telemetry + `interactionInstantsFromSamples` | → `cursor_interaction` |
| Semantic surfaces | `visualEvidence/semantic` + groundedDiagnosis fields | Optional `frontmost_surface` / `passive_chrome` tagged `modelDerived` |
| Context routing | `mediaContextNeeds` | Untouched |
| Source Story | `sourceStory` | Untouched operationally; ledger is parallel internal memory |
| Agent / 34 tools / Axcut / compositor | `deep-agent`, tools, document schema | Untouched except optional `InvokeResult.temporalEventLedger` |
| Benchmark locked baseline | `perceptionBenchmark` CURRENT_OPENSCREEN | Not modified; separate `*.temporal-ledger.json` diagnostics only |

**Persistence decision:** turn-local / derived (option A+B-lite). Not written into `.openscreen` / AxcutDocument. Rebuild is cheap (sub-ms). Invalidation = rebuild from prepared evidence next turn.

---

## B. Exact files changed

### Added

- `electron/ai-edition/temporalEventLedger/types.ts`
- `electron/ai-edition/temporalEventLedger/build.ts`
- `electron/ai-edition/temporalEventLedger/store.ts`
- `electron/ai-edition/temporalEventLedger/fromPrepared.ts`
- `electron/ai-edition/temporalEventLedger/diagnostics.ts`
- `electron/ai-edition/temporalEventLedger/index.ts`
- `electron/ai-edition/temporalEventLedger/temporalEventLedger.test.ts`
- `AI_TEMPORAL_EVENT_LEDGER_V1_REPORT.md` (this report)
- Diagnostic examples under `tmp/perception-benchmark/ledger-v1-diagnostics/` (gitignored)

### Modified

- `electron/ai-edition/deep-agent/service.ts` — attach turn-local `temporalEventLedger` on `InvokeResult` (not user prose)
- `electron/ai-edition/perceptionBenchmark/runCurrentStack.ts` — write separate ledger diagnostic artifact per case run

---

## C. Ledger architecture (data flow)

```
VIDEO / AxcutDocument
  → existing sensors (unchanged):
      prepareVisualEvidenceForTurn
      prepareSpeechEvidenceForTurn
      cursor read (non-move)
      optional VisualSemanticGrounding (existing model turn)
  → buildLedgerFromPreparedEvidence / buildTemporalEventLedger   ← 0 LLM calls
  → TemporalEventLedger (turn-local)
  → createVideoEvidenceStore (in-memory queries)
  → (future) Source Story / Investigator Agent

Source Story today still builds from prepared speech/frames/changes as before.
Ledger is additive internal memory, not a replacement.
```

---

## D. Event / claim schema

**Epistemic states:** `observed | spoken | inferred | verified | contradicted | unknown`

**Event types (minimal V1):**  
`visual_sample`, `visual_transition`, `passive_chrome`, `frontmost_surface`, `speech`, `speech_pause`, `spoken_correction`, `cursor_interaction`, `speech_status`, `contradiction`, `uncertain`

**Claims** carry `epistemic` + `evidence[]` provenance refs (frame times, change edges, speech segment ids, cursor times, `modelDerived` flag).

**Note:** V1 rarely emits `verified`. Deterministic sensors produce `observed` / `spoken`; contradictions use `contradicted`; passive chrome open/work stays `unknown`. `verified` is reserved for future multi-sensor confirmation — not invented here.

---

## E. Evidence provenance

Every event/claim links back via `EvidenceProvenanceRef`:

- Visual: `frameSourceTimeSec`, `frameReason`, `frameImagePath`, change from/to + classification
- Speech: `speechSegmentId`, source range
- Cursor: `cursorTimeSec`, `cursorInteractionType`
- Model semantic: `modelDerived: true`
- Audio state: `speechStatus=…` note

Store API: `evidenceForEvent(eventId)` returns the supporting refs.

---

## F. Observed vs inferred vs verified (examples)

From generated diagnostics (`tmp/perception-benchmark/ledger-v1-diagnostics/`):

- **Observed:** visual sample “presence of pixels, not a user action”; material change between 16s–18s samples
- **Spoken:** transcript segments retained as speech claims
- **Inferred:** only when semantic `inferred[]` is supplied — never auto-promoted to verified
- **Verified:** not auto-created from passive tabs or spoken intent alone
- **Unknown / contradicted:** spoken “open timeline/effects/Settings” without nearby moderate/significant `VisualChange`

---

## G. Upwork / passive-context proof

Fixture: frontmost Cursor + background Upwork tab.

- Emits `passive_chrome` OBSERVED: Upwork visible as tab chrome  
- Emits UNKNOWN: whether user opened/worked in Upwork  
- `ledgerHasVerifiedOpenAction(ledger, "Upwork") === false`

Artifact: `example_upwork_passive.temporal-ledger.json`

---

## H. Case 4 proof (spoken correction)

Speech correction retained as `spoken_correction`. Static screen (`minimal` change only) → `contradiction` that timeline/effects open is **not** visually supported. No verified “panel opened” claims.

Artifact: `example_case04_correction.temporal-ledger.json`  
Epistemic mix: observed / spoken / unknown / contradicted

---

## I. Case 2 proof (and honest miss)

Without semantic recognition of the Restart tooltip:

- Ledger knows: samples at 16s & 18s; material `visual_transition` with `temporallyUncertain: true`
- Ledger does **not** invent “Restart recording tooltip”
- GT knows the tooltip; production ledger does not — by design

Artifact: `example_case02_missed_tooltip.temporal-ledger.json`

---

## J. Contradiction proof

“I am opening Settings now.” + no material visual change → `contradiction` with spoken + contradicted claims.

Artifact: `example_contradiction_settings.temporal-ledger.json`

---

## K. No-audio regression

Ledger preserves `speechStatus: "no_audio"` distinctly (not collapsed to `unavailable` / `failed`). Unit proof in ledger test #8 + `example_case01_no_audio.temporal-ledger.json`.

SpeechEvidence module unit tests remain green. One live runtime (`case1-no-audio.runtime.test.ts`) returned empty model text in this environment (provider/empty response) — **not** a ledger contract regression; speechStatus path in prepare/ledger is intact.

---

## L. Timing

All events clamped to canonical duration ± `SOURCE_TIMESTAMP_TOLERANCE_SEC`.  
`meta.timebase === "SOURCE_MEDIA_TIME"`. No virtual/timeline mixing in the ledger.

---

## M. Performance

Measured on Case-4-shaped ledger (unit run):

| Metric | Value |
|---|---|
| Construction | ~0 ms (≪ Whisper/visual extract) |
| Range query | ~0 ms |
| Events / claims / evidence refs | 7 / 8 / 18 (example) |
| Serialized size | ~4.6 KB |
| Additional model calls | **0** |

---

## N. Existing regression tests

| Suite | Result |
|---|---|
| `temporalEventLedger` | **14 passed** |
| Unit regressions (speechEvidence unit, semantic, change, sourceTiming, mediaContextNeeds, sourceStory, groundedDiagnosis + ledger) | **130 passed / 0 failed** |
| Broader run including live `*.runtime.test.ts` | 133 passed, **1 failed**: `case1-no-audio.runtime.test.ts` (empty user-facing model text; environmental / live provider) |

Locked CURRENT_OPENSCREEN baseline artifacts: **not modified**.

---

## O. Benchmark impact

- No change to locked CURRENT_OPENSCREEN scores or history.
- New optional artifact per benchmark case run: `<caseOut>/<caseId>.temporal-ledger.json`
- Example diagnostics under `tmp/perception-benchmark/ledger-v1-diagnostics/`
- Ground truth is still scorer-only; ledger builder never reads GT files.

---

## P. Remaining limitations

1. Ledger does not improve perception (Restart tooltip, OCR, webcam detail still miss if sensors miss).
2. `verified` multimodal confirmation is not implemented yet (reserved).
3. Source Story is not yet *fed by* the ledger (parallel; future migration).
4. No persistence / invalidation cache across sessions (intentional for V1 safety).
5. Contradiction detection is heuristic (spoken open/panel regex + absence of nearby material VisualChange) — not full causal reasoning.
6. Cursor “move” samples still excluded (existing product convention).
7. User-facing prose still comes from the existing agent path; ledger is internal only.

---

## Q. Verdict

**PASS_WITH_LIMITATIONS**

OpenScreen now has an internal temporal evidence representation that distinguishes what was seen, spoken, inferred, contradicted, and unknown — with SOURCE_MEDIA_TIME provenance — without breaking the existing AI/video/editor architecture, and without extra LLM calls.

**Do not begin the Master Video Investigator Agent until this report is reviewed.**
