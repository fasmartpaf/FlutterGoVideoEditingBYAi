# OpenScreen Real Corpus Recovery 2 — Multimodal Routing Report

**Identity:** `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_ROUTING_V1`  
**Date:** 2026-09-13  
**Baseline preserved:** `tmp/perception-benchmark/real-corpus-baseline-v1/` (not overwritten)  
**Recovery 1 preserved:** `tmp/perception-benchmark/real-corpus-recovery-1-stt/` (not overwritten)  
**Artifacts:** `tmp/perception-benchmark/real-corpus-recovery-2-routing/`

---

## Executive verdict

### `PASS_WITH_LIMITATIONS`

Known P1 routing starvation cases (015 / 020 / 022 / 025) now classify into visual or editingContext families, prepare real visual frames (8–15), and for editorial prompts also prepare STT (`speechStatus=available`). Misleading `deterministic_edit_skip` on non-deterministic skips is corrected to `media_not_required`. Negative routing stays selective (deterministic / capability / speech-only / visual-only). Recovery 1 STT remains green on narrated + Case4 + latest + `no_audio`.

**Limitations:** Provider finals were deliberately not run in this harness (`NOT_RUN_SEPARATED_FROM_ROUTING`); user-facing answer improvement for starved cases is **NOT_VERIFIED**. Several understanding/editorial Investigator turns stop at `insufficient_evidence` after preparing frames — downstream cognition gap for Recovery 3+, not a routing failure. Case 020 zoom-without-evidence hallucination cannot be A/B judged without a provider final.

---

## Baseline failure reference

Frozen baseline `CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1` showed `mediaContextNeeds` classifying natural recording questions as `category: fallback` with `visual:false` / `speech:false`, yielding:

| Case | Prompt (frozen) | Baseline routing | Frames | Investigator stop |
| ---- | --------------- | ---------------- | ------ | ----------------- |
| 015 | Was the screen mostly stable, or were there major visual changes? | fallback starved | 0 | `deterministic_edit_skip` |
| 020 | What safe edits would you propose… | fallback starved | 0 | `deterministic_edit_skip` |
| 022 | What applications or screens are visible? Is there a webcam? | fallback starved | 0 | `deterministic_edit_skip` |
| 025 | Make this suitable for a product demo… | fallback starved | 0 | `deterministic_edit_skip` |

Effect: no visual frames, no useful Investigator work, answers that could discuss media without seeing it.

---

## Current routing architecture audit

```text
user prompt
  → classifyMediaContextNeeds(userMessage)   [pure, no LLM]
       → isCheapDeterministic? → deterministicEdit (all false)
       → isCapabilityOrDefinition? → fallback (all false)
       → EDITING_CONTEXT_FAMILIES hit? → editingContext (V+S+C)
       → MEDIA_UNDERSTANDING_FAMILIES hit? → mediaUnderstanding (V+S+C)
       → speech-only hit? → speechInspection (speech)
       → visual-only hit? → visualInspection (visual)
       → both speech+visual → mediaUnderstanding
       → RECORDING_CONTEXT safer fallback → mediaUnderstanding
       → else → fallback (no media)
  → evidence prep (deep-agent / prepare*):
       visual? → prepareVisualEvidenceForTurn
       speech/injectSpeech? → prepareSpeechEvidenceForTurn
  → Investigator eligibility (shouldRunInvestigator + v1.1 intents)
       skip: deterministicEdit → deterministic_edit_skip
       skip: other !shouldRun → media_not_required
```

### Pattern families (Recovery 2)

| Family bucket | Role |
| ------------- | ---- |
| Deterministic edit | Exact trim/delete/speed/aspect math |
| Speech inspection | what-said / transcript / narration / hear |
| Visual inspection | on-screen / stability-change / UI events / popup / frames / panels / visual edit cues |
| Media understanding | watch/review recording / what happens / about recording / beginning-to-end / cross-modal |
| Editing context | polish/pro/demo/safe edits/pacing/improve |
| Capability/definition | Can OpenScreen… / What does crop mean |
| RECORDING_CONTEXT | Safer fallback only after families miss |

Precedence is intentional: cheap deterministic and capability first; editorial and whole-media before narrow speech/visual; starvation fallback last.

---

## Root cause

The pre-Recovery-2 classifier used narrow keyword surfaces. Natural editorial and visual language (“mostly stable”, “safe edits”, “applications or screens”, “product demo”) missed every family and fell through to **fallback → no evidence**. Investigator then labeled every non-run as `deterministic_edit_skip`, conflating “deterministic edit” with “classifier starved.”

---

## Files changed

| Path | Change |
| ---- | ------ |
| `electron/ai-edition/mediaContextNeeds/classify.ts` | Semantic families, safer recording-context fallback, policy hierarchy |
| `electron/ai-edition/mediaContextNeeds/routingRecovery.unit.test.ts` | Unit coverage for starvation + negatives + typos |
| `electron/ai-edition/mediaContextNeeds/routing-diagnose.runtime.test.ts` | Classification diagnose artifact writer |
| `electron/ai-edition/mediaContextNeeds/routing-recovery-live.runtime.test.ts` | Real-media routing/evidence subset |
| `electron/ai-edition/videoInvestigator/run.ts` | Skip-reason: deterministic vs `media_not_required` |
| `electron/ai-edition/videoInvestigator/types.ts` | `media_not_required` stop reason |
| `electron/ai-edition/videoInvestigator/rolePolicy/stop.ts` | Preserve new stop reason |
| `electron/ai-edition/videoInvestigator/videoInvestigator.test.ts` | Skip-reason assertions |

**Not modified:** Whisper/STT, visual sampling, OCR, Investigator tools, Ledger, Claim Promotion, Source/Target Story, Edit Gap/Plan/Closure/Proposal, apply/verify, model providers.

---

## Classification policy before

- Narrow regex / keyword families.
- Miss → `fallback` with **all modalities false** (evidence starvation).
- Ambiguous editorial treated like unrelated chat.
- Investigator: any skip → `deterministic_edit_skip`.

---

## Classification policy after

Hierarchy:

1. **deterministic edit** → minimal  
2. **capability / definition** → no media  
3. **editorial / editingContext** → multimodal (visual + speech + cursor)  
4. **whole-media / cross-modal understanding** → multimodal  
5. **speech-specific** → speech only  
6. **visual-specific** → visual only  
7. **safer fallback** if recording/screen/edit context language remains → `mediaUnderstanding`  
8. **true unrelated** → fallback / none  

False-negative starvation is treated as worse than occasional extra frames; cost still bounded by selective negative paths.

---

## Fallback policy

`RECORDING_CONTEXT` catches language that implies the current recording/screen/editing quality is in play when no specific family matched. It prefers `mediaUnderstanding` (prepare evidence) over starvation.

It does **not** fire for pure product/definition questions (`What does cropping do?`, `Can OpenScreen stabilize video?`) handled earlier as capability/definition → cheap fallback.

---

## Deterministic-edit policy

Exact timeline/aspect/speed commands remain `deterministicEdit` with all evidence flags false when no speech/visual/editorial language is also present. Live: `Trim 5–8s.` and `Set aspect ratio to 16:9` → 0 frames, 0 ms prep, Investigator `deterministic_edit_skip` (correct).

Ambiguous editorial (“safe edits”, “make this pro”) is **not** classified as deterministic.

---

## Visual routing

Stability / change / popup / apps-on-screen / webcam language → `visualInspection`, `visual=true`, speech not forced.

Live proof:

| Case | visual | frames |
| ---- | ------ | ------ |
| 015 | true | 15 |
| 022 | true | 8 |
| Did the screen change much? | true | 15 |
| What popup appears at the end? | true | 15 |

---

## Speech routing

“What did I say?”, narration/summarize/correction → `speechInspection`, speech only.

Live: speech-only + STT regression clips → `speechStatus=available` (or `no_audio` on silent media), `visualFrames=0`.

---

## Cross-modal routing

“Did what I said actually happen on screen?” → `mediaUnderstanding`, visual+speech+cursor.

Live: 9 frames, `speechStatus=available`, Investigator `sufficient_evidence` (2 tools).

---

## Editorial routing

Safe edits / product demo / shorter+clearer / pacing / “make this pro” → `editingContext`, multimodal.

Live: 11–14 frames, speech `available`, cursor true. Investigator often `insufficient_evidence` after 1 tool — **downstream observation**, not routing starvation.

---

## General/non-media routing

| Prompt | Category | Prep |
| ------ | -------- | ---- |
| What does cropping do? | fallback | 0 ms / 0 frames |
| Can OpenScreen stabilize video? | fallback | 0 ms / 0 frames |
| Investigator stop | `media_not_required` | |

---

## Natural language / typo handling

Unit + live cover paraphrases and shorthand (`make this pro`, screen-change paraphrases, editorial colloquialisms). Families are concept-oriented (stability-change, polish-professional, creative-edit), not historical case string traps.

---

## Investigator skip-reason fix

| Condition | Before | After |
| --------- | ------ | ----- |
| `category === deterministicEdit` | `deterministic_edit_skip` | unchanged (correct) |
| Non-media / capability / empty needs | `deterministic_edit_skip` (misleading) | `media_not_required` |

Developer strings stay internal; user-facing copy only notes investigation skipped when media not required.

Starvation cases 015/020/022/025 no longer emit `deterministic_edit_skip`.

---

## Real corpus cases tested

19 live cases under `routing-recovery-live.runtime.test.ts` (all PASS):

- Starvation: 015, 020, 022, 025  
- Visual paraphrases / popup  
- Speech-only  
- Cross-modal  
- Editorial shorter / pacing  
- Deterministic trim / aspect  
- General crop / unsupported stabilize  
- Typo “make this pro”  
- STT regression: narrated, Case4, latest, no_audio  

Artifacts: `selected-cases.json`, `routing-before-after.json`, `latency.json`, `real-media-results.json`.

---

## Case 015 result

| | Baseline | Recovery |
| - | -------- | -------- |
| Category | fallback starved | `visualInspection` |
| visual / speech | false / false | true / false |
| Frames | 0 | **15** |
| Investigator | `deterministic_edit_skip`, 0 tools | `insufficient_evidence`, 1 tool |
| Final | (baseline) | NOT_VERIFIED (provider not run) |

**routing = PASS** · **evidence preparation = PASS** · **final provider response = NOT_RUN**

---

## Case 020 result

| | Baseline | Recovery |
| - | -------- | -------- |
| Category | fallback starved | `editingContext` |
| visual / speech / cursor | all false | true / true / true |
| Frames | 0 | **11** |
| Speech | failed/null | **available** (3 segments) |
| Investigator | `deterministic_edit_skip` | `insufficient_evidence`, 1 tool |

**Case 020 A/B (zoom suggestion):** Provider final not executed in Recovery 2. Routing no longer starves visual evidence. Whether zooms are now evidence-backed (A) or remain editorial hallucination (B) is **NOT_VERIFIED** — recorded for Recovery 3+ / editorial honesty cluster. Do not claim A solely from `frames>0`.

---

## Case 022 result

| | Baseline | Recovery |
| - | -------- | -------- |
| Category | fallback starved | `visualInspection` |
| Frames | 0 | **8** |
| Speech forced? | — | no |
| Investigator | `deterministic_edit_skip` | `insufficient_evidence`, 1 tool |

**routing = PASS** · evidence prepared.

---

## Case 025 result

| | Baseline | Recovery |
| - | -------- | -------- |
| Category | fallback starved | `editingContext` |
| Frames | 0 | **13** |
| Speech | starved/failed | **available** |
| Investigator | `deterministic_edit_skip` | `insufficient_evidence`, 1 tool |

**routing = PASS** · multimodal prep for product-demo editorial language.

---

## STT Recovery regression

| Clip | Prompt class | speechStatus | Notes |
| ---- | ------------ | ------------ | ----- |
| Narrated Case 1 | speechInspection | `available` | Recovery 1 still green |
| Case 4 correction | speechInspection | `available` | |
| Latest narrated | speechInspection | `available` | |
| Silent / no_audio | speechInspection | `no_audio` | correct non-Whisper path |

No Whisper code changes in Recovery 2. Editorial multimodal cases also get `available` when routing requests speech.

---

## Negative routing tests

| Test | Expected | Observed |
| ---- | -------- | -------- |
| What does cropping do? | no media | fallback, 0 frames, `media_not_required` |
| Trim 5–8s. | cheap deterministic | deterministicEdit, 0 ms |
| Set aspect 16:9 | cheap deterministic | same |
| Can OpenScreen stabilize video? | capability, no media | fallback, 0 frames |
| What did I say? | speech only | 0 frames, STT available |
| What popup appears at the end? | visual, no forced STT | 15 frames, speech null |

Classifier is **not** “always multimodal.”

---

## Cost / latency impact

Prep latency (live harness, includes STT warm path where speech requested):

| Kind | Typical totalPrepMs | Frames |
| ---- | ------------------- | ------ |
| Starved→visual (015/022) | ~1.3–2.0 s | 8–15 |
| Editorial multimodal | ~2.3–2.7 s | 11–14 |
| Speech-only / STT regression | ~0.5–0.6 s | 0 |
| Deterministic / general | **0** | 0 |

Full suite wall clock ~25 s for 19 cases. Acceptable cost increase vs starvation; not “every prompt = 80 s.”

OCR/Investigator tool depth not expanded in this milestone; starvation cases typically 1 Investigator tool after frames land.

---

## Provider 429 status

```text
routing = PASS
evidence preparation = PASS
final provider response = NOT_RUN_SEPARATED_FROM_ROUTING
```

OpenAI quota issues from Recovery 1 are **not** conflated with routing. User-facing improvement remains NOT_VERIFIED until a provider final is available.

---

## Downstream observations (do not fix here)

1. After correct routing, several visual/editorial turns still stop at Investigator `insufficient_evidence` — cognition/budget/role gap for later recovery.  
2. Case 020 zoom-without-seeing-media remains an editorial honesty question once finals resume.  
3. Empty / blocked finals unchanged (Recovery 1 limitation; out of scope).  
4. Target Story / Edit Gap / Plan / Proposal untouched.

---

## Before-vs-after comparison

| Case | Baseline category | Recovery category | Visual frames | Speech | Investigator | Final |
| ---- | ----------------- | ----------------- | ------------- | ------ | ------------ | ----- |
| 015 | fallback_starved | visualInspection | 0→15 | null→null | deterministic_edit_skip→insufficient_evidence | NOT_VERIFIED |
| 020 | fallback_starved | editingContext | 0→11 | failed→available | deterministic_edit_skip→insufficient_evidence | NOT_VERIFIED |
| 022 | fallback_starved | visualInspection | 0→8 | null→null | deterministic_edit_skip→insufficient_evidence | NOT_VERIFIED |
| 025 | fallback_starved | editingContext | 0→13 | failed→available | deterministic_edit_skip→insufficient_evidence | NOT_VERIFIED |
| visual-stable-paraphrase | n/a | visualInspection | →15 | — | →insufficient_evidence | NOT_VERIFIED |
| visual-popup | n/a | visualInspection | →15 | — | →sufficient_evidence | NOT_VERIFIED |
| speech-only | n/a | speechInspection | →0 | →available | →sufficient_evidence | NOT_VERIFIED |
| cross-modal | n/a | mediaUnderstanding | →9 | →available | →sufficient_evidence | NOT_VERIFIED |
| editorial-shorter | n/a | editingContext | →14 | →available | →insufficient_evidence | NOT_VERIFIED |
| editorial-pacing | n/a | editingContext | →14 | →available | →insufficient_evidence | NOT_VERIFIED |
| det-trim | n/a | deterministicEdit | →0 | — | →deterministic_edit_skip | NOT_VERIFIED |
| det-aspect | n/a | deterministicEdit | →0 | — | →deterministic_edit_skip | NOT_VERIFIED |
| general-crop | n/a | fallback | →0 | — | →media_not_required | NOT_VERIFIED |
| unsupported-stabilize | n/a | fallback | →0 | — | →media_not_required | NOT_VERIFIED |
| typo-pro | n/a | editingContext | →13 | →available | →insufficient_evidence | NOT_VERIFIED |
| stt-* (4) | n/a | speechInspection | →0 | available / no_audio | →sufficient_evidence | NOT_VERIFIED |

---

## Tests

| Suite | Result |
| ----- | ------ |
| `mediaContextNeeds.test.ts` | PASS |
| `routingRecovery.unit.test.ts` | PASS |
| `videoInvestigator.test.ts` (skip-reason) | PASS |
| `routing-recovery-live.runtime.test.ts` (19 real-media) | PASS (~25s) |

Diagnose write: `diagnose-classifications.json`.

---

## Regressions

- Recovery 1 STT: **none** (available / no_audio intact).  
- Deterministic cheap path: **none**.  
- Capability / definition no-media: **none**.  
- Frozen baseline + Recovery 1 artifacts: **untouched**.

---

## Remaining limitations

- Provider finals not verified in this recovery.  
- Language coverage is family-based; rare phrasings may still hit safer multimodal fallback (conservative by design) or miss entirely.  
- Investigator `insufficient_evidence` after successful prep is outside Recovery 2.  
- Case 020 suggestion honesty unverified without LLM final.

---

## What was deliberately NOT fixed

- Empty final responses  
- Target Story / Edit Gap / Edit Plan / Closure / Proposal  
- Visual sampling / OCR / Whisper  
- Apply / verification  
- Lab wording / multi-edit / autonomy  

---

## Recommended next recovery cluster

**Recovery 3 — cognition after evidence** (or empty-final / provider-resilience): once frames + speech are present, Investigator sufficiency, claim honesty (esp. Case 020 zoom), and/or empty finals under quota — **not** more keyword routing.

---

## Verdict

### `PASS_WITH_LIMITATIONS`

Routing and evidence preparation for natural understand/improve language are recovered on real corpus media. User-facing answer quality awaits provider finals and downstream cognition work.

**STOP.** Recovery 2 complete; no automatic continuation into Recovery 3+.
