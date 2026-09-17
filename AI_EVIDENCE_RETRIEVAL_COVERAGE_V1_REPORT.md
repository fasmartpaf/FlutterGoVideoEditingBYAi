# OpenScreen — Evidence Retrieval Coverage V1

**Identity:** `CURRENT_OPENSCREEN_EVIDENCE_RETRIEVAL_COVERAGE_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/evidence-retrieval-coverage-v1/`  
**Prior preserved:** Context Audit, Retrieval Production, Closure V1, Promotion Gate V1  

This milestone asks whether retrieval knows **what** evidence it needs, **where** in time it needs it, and **whether** that pack is sufficient — without provider generation.

It does **not** promote Retrieval, freeze architecture for a model bake-off, or change consent/apply.

---

## Decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

WHOLE_MEDIA_COVERAGE:
PASS

CASE_020_COVERAGE:
PASS

CROSS_MODAL_PACKING:
PASS

LOCAL_QUERY_EFFICIENCY:
PASS

SPEECH_QUERY_EFFICIENCY:
PASS

EVIDENCE_SUFFICIENCY_CONTRACT:
READY

PHASE_SPECIFIC_TOOL_PACKING:
RECOMMENDED

PROMOTION_GATE_READY_TO_RERUN:
YES
```

`VIDEO_MEMORY_RETRIEVAL` remains **opt-in**. Compact remains **experimental**. Default packing remains `CURRENT_FULL_CONTEXT`. No bake-off.

---

## What was broken (Promotion Gate) and what changed

| Blocker | Root cause | Fix |
| ------- | ---------- | --- |
| Case 020 editorial frames all in **12.33–14.79s** (2.46s of 21.44s) | `selectFramesForRetrieval` ranked `change_refinement +30` first; a local cluster consumed the attach budget. Prepare often fed that cluster because interaction/refine filled a small `maxFrames`. | **QueryScope** + **coverage floor** (duration buckets) **before** relevance deepen. **Temporal diversity** (`minSep`, `maxFramesPerBucket`, `localClusterBudget`). Extract uses `coverageFirst` so periodics/anchors are reserved. **Did not** lower the +30 score. |
| Q5 **0 visual frames** | `classifyMediaContextNeeds` treated “Compare what I **say** …” as **speechInspection** (`compare what I said` required past tense; “what is visibly happening” was not a visual family). `prepareVisualEvidenceForTurn` skipped because `needs.visual=false`. `classifyVideoMemoryQuery` also returned `speech` from that category before the compare regex. Duration stayed 30 because visual probe never ran. | Cross-modal family accepts `say\|said`; visual family includes `what is visibly happening`; speech+visual inspection → `mediaUnderstanding`; query class `cross_modal` attaches frames. Safety retry if class is cross-modal and frames are empty. Speech-segment **alignment times** used as priority deepen, bounded. |
| Compact query-class tool dump | Editorial Compact still ~32 tools | **Design only** — phase packing estimate. Not production. |

Source/programme memory fingerprints were **not** re-engineered.

---

## Query class vs QueryScope

Deterministic, no LLM.

| Example | Class | Scope |
| ------- | ----- | ----- |
| What's this popup near the end? | visual | bounded_range |
| What happens at 12 seconds? | visual | local |
| Where would zoom help in this recording? | editorial | whole_media |
| What would you NOT edit? | editorial | whole_media |
| Compare what I say with what is visibly happening. | cross_modal | whole_media |
| What did I say near the end? | speech | bounded_range |
| Did I open Settings? | action_verify | bounded_range |

Timestamp-only “what happens at Ns?” is **visualInspection**, not whole-recording `mediaUnderstanding` (that misfire packed LOCAL_TS as cross-modal on the first live pass; fixed generally, not Case-020-specific).

---

## Coverage contract

`VisualEvidenceCoverage` records:

- `coveredBuckets / bucketCount` as **coverageFraction** (not `(max−min)/duration`)
- `largestUnobservedGapSec`
- `clustered` (tight span on a longer clip)
- `EVIDENCE_SUFFICIENCY = sufficient | insufficient`

Two endpoint frames on a 21s clip occupy **2/5 buckets** → insufficient. The Promotion Gate 2.46s cluster is **insufficient** under this contract (unit-tested).

The packed briefing includes this block so a later model cannot be told it inspected the whole recording when it did not.

---

## Live prepare-only corpus (no OpenAI)

20 rows, 10+ recordings including Case 020, Case 2, Case 4 media, narrated, longest **28.94s**, plus extras. Artifacts: `matrix.json`, per-row JSON, `phase-packing-design.json`.

### Required Case 020 (C1 zoom prompt)

- class **editorial**, scope **whole_media**
- duration **21.438s**
- selected **0, 2, 6, 10, 16, 20s** (6 frames)
- **5/5 buckets**, `clustered=false`, `coverageSufficient=true`
- not a 2.46s cluster

**Limitation (Stage B):** this extract did **not** add `change_refinement` midpoints in 12–15s. Coverage floor won; local scene-change deepen is proven in **unit** selection (cluster + periodics → mixed pack) and on **LONG_VISUAL** (28.94s candidates include change_refinement; attach still 6 distributed). Case 020 live pack is coverage-first periodics, not “coverage + the 12s event.” That is reported, not hidden. Not timestamp-tuned.

### Required Q5 (narrated)

- class **cross_modal**, visual+speech needs **true**
- **6 frames** (0, 2, 6, 8, 12, 16s) on 16.896s
- **speechPrepared=true** (local Whisper, not OpenAI)
- alignment anchors ≈ 0, 2.25, 4.5, 6.5, 10.9, 13.95s
- no speech→visual promotion (Claim Promotion / epistemic pack language unchanged)
- `coverageSufficient=true`

### Efficiency

| Row | Frames to provider | Notes |
| --- | -----------------: | ----- |
| NARR_SPEECH | **0** | class speech; STT windows present |
| LOCAL_TS | **1** @ 12s | not whole-media |
| POPUP_END | **3** at 14/16/18s of 19.9s | late window |
| SETTINGS_VERIFY | **4** | bounded action_verify |
| Whole editorial/visual | **6** attach / extract cap 10 | vs historical FULL ~13 |

FULL context still uses the global visual sampler when packing is not Retrieval.

Restart / Upwork / Settings routing still requests visual for those prompts; packed epistemic lines still forbid action promotion from chrome/speech. No provider answers this milestone.

---

## Compact / phase tools (design only)

Today Compact gates **by query class**: speech 5 tools (~2.4k schema chars), editorial **32** (~15.3k), full **35** (~16.8k).

Recommended phase exposure (not implemented):

| Phase | Tools (est.) | Est. schema chars |
| ----- | -----------: | ----------------: |
| UNDERSTAND | 5 read | ~2.4k |
| PLAN | 2 | ~1.0k |
| PROPOSE | ~27 mutate+read | ~12.9k |
| APPLY | **0** (consent/applyPreview IPC) | 0 |
| VERIFY | 1 inspect | ~0.5k |

UNDERSTAND vs full surface ≈ **14.4k schema chars saved**. An edit workflow that starts as speech understanding would then gain mutate schemas at PROPOSE, without a second cognition architecture. Consent/apply authority unchanged.

---

## Cost / budget (measured, not optimized)

- Whole-media attach stays **6**, not 13.
- Speech stays **0 images**.
- Local stays **1–3**.
- Extract may go to **10** so coverage + refine can coexist; provider still sees the attach cap.
- Image-token impact: roughly **6/13** of FULL visual on whole-media Retrieval vs previous full dump. Exact billed tokens **not measured** (no provider generation).

---

## Limitations (do not over-claim)

1. **Stage B live uneven:** Case 020’s attached set is distributed periodics; change-cluster deepen did not appear in that extract. Policy + unit tests prevent the cluster from eating the budget when both candidate sets exist.
2. **No 1–5 minute media.** Longest real file 28.94s. Do not extrapolate.
3. **No answer quality.** Promotion Gate quota problem is untouched. Epistemic invariants were not re-judged as model text.
4. **Speech duration on speech-only rows** can remain the 30s placeholder (visual probe skipped by design).
5. Compact is still query-class gated until a later milestone implements phase packing.

---

## Tests

- `videoMemory/queryScope.test.ts`
- `videoMemory/coverage.test.ts` (cluster starvation, honest fraction, local, speech zero, editorial distribution)
- `videoMemory/phasePacking.design.test.ts`
- `mediaContextNeeds.test.ts` (Q5 both modalities; timestamp local visual)
- `retrievalProduction.test.ts` (Q5 class; Restart/Upwork/Settings not speech-starved)
- Live: `perceptionBenchmark/evidenceRetrievalCoverage/evidence-retrieval-coverage.runtime.test.ts`

---

## Promotion gate re-run

Coverage blockers that made G9/G15 packing FAILs are addressed. Re-run Promotion Gate **when provider quota exists** to judge answers. Do not treat this milestone as Retrieval promotion.

**STOP.** No local-model download. No bake-off. No default-Retrieval. No consent/apply/autonomy/multi-edit. No extra LLM classifier.
