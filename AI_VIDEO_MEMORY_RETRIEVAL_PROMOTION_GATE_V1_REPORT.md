# OpenScreen — Video Memory Retrieval Promotion Gate V1

**Identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-promotion-gate-v1/`  
**Canonical live run:** `run-3-story-merge/` (preserves `run-2-error-telemetry/` and the first quota-abort dump)  
**Prior preserved:** Context Audit, Retrieval Production, Closure V1

This gate asks one question: **is the context/memory architecture stable enough to freeze so the next milestone can compare models rather than packing paths?**

Answer: **no.**

---

## 1. Executive verdict

### `BLOCKED`

Provider (`openai/gpt-4o`) returned `provider_quota_exhausted` on every generation. **Zero user-facing answers.** Quality, FULL vs RETRIEVAL vs COMPACT parity, invariants, and Case 020 zoom *judgment* are **NOT_VERIFIED** on this gate.

Local cognition **did** run. After two small correctness fixes, programme-memory **telemetry** is live:

| Turn | sourceMemoryHit | programmeMemoryHit | sourceStoryReused | notes |
| ---- | --------------- | ------------------ | ----------------- | ----- |
| P1 cold visual | false | false | false | duration 30→16.896; programme hash **stable inside the turn** |
| P2 speech, no doc change | **true** | **true** | false (speech does not request Source Story) | ledger reused; 0 images |
| P3 follow-up, no doc change | **true** | **true** | false (class=`general`) | was **false** in run-2 before story-merge fix |
| P4 after trim | **true** | **false** | false | source fp unchanged; programme fp changed |
| P5 persist new programme | **true** | **true** | false (class=`general`) | new programme now reusable |

Case 020 C1 is **editorial**, `needs.visual=true`, **frames > 0** — classifier fix is live. Attached times are **12.33–14.79s (span 2.46s) on a 21.44s clip**. That is **inadequate whole-video coverage**. Treating any zoom conclusion from this packing as grounded would be a FAIL.

Longest local recording: **28.94s**. Not 1–5 minutes.

```text
ENGINEERING_VERDICT:
BLOCKED

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```

Default packing remains `CURRENT_FULL_CONTEXT`.

---

## 2. Fixes made in this gate (required for intended architecture)

### Fix A — programme fingerprint vs duration probe (clip ends)

**Root cause:** Closure omitted `assets[].durationSec` from `fingerprintProgramme`, but `ensureCanonicalSourceDuration` also rewrites **full-source clip** `sourceEndSec` / `timelineEndSec` from the stale 30s placeholder to probed duration. That still looked like a programme mutation, so `programmeMemoryHit` stayed false even on a persisted document.

**Before:** full-source 0–30 vs 0–16.896 → different programme hash.  
**After:** full-source placements hash as `placement: "full_source"`; intentional trims keep exact bounds.

**Regression:** `videoMemory.test.ts` 3c; session duration-probe test repairs clips.

**Live after:** P1 `durationBefore=30` → `durationAfter=16.896` and `programmeFpBefore === programmeFpAfter` (`bf98ca789078…`).

### Fix B — error-path retrieval telemetry

**Root cause:** quota/error returns omitted `retrievalPath`, so failed turns looked like “no memory architecture.”

**After:** `retrievalPath` attached on provider_error / empty / sanitizer returns.

### Fix C — speech/general put clobbering Source Story

**Root cause:** P2 speech put `sourceStoryV2: null` over P1’s story → P3 `programmeMemoryHit=false`.

**Before (run-2):** P2 progHit=true, P3 progHit=**false**.  
**After (run-3):** P2 and P3 both progHit=**true**. `mergeProgrammeStoryForPut` keeps a still-valid cached story.

**Regression:** `retrievalProduction.test.ts` “speech follow-up without computed story does not clobber.”

No consent/apply/mutation-authority changes. No prompt optimization. No Case 020 frame retune (coverage failure is reported, not papered over).

---

## A. Live programme-memory proof

Same `AxcutDocument` instance: each turn persists `result.document`. Same session store. Shared STT cache `speech/prog_narrated`. Media: `recording-bug5-narrated.mp4` (16.896s). Packing: `VIDEO_MEMORY_RETRIEVAL`.

Source fingerprint (stable all P1–P5): `11945130daff6c8d8eb032088b94a9d4571c803ce340fb03e580089e9eb6b62a`

| | Programme fingerprint |
| - | --- |
| P1–P3 (unchanged programme) | `bf98ca789078959ff075bbaba288ce3f4c57b2d7a4a0bcbf6cf8d2cdd9eb733f` |
| P4–P5 (after trim) | `968509bff2248015d4830dc110d2ad0f8438b9d00f6a040f6ddfad7de01b787d` |

P4_FINGERPRINTS: `srcUnchanged=true`, `progChanged=true`.

Duration probe alone did **not** invalidate programme memory (P1 clip 30→16.896, hash unchanged).

`sourceStoryReused=true` only when the turn actually requested Source Story (C2/C3 editorial). Speech/general keep the story in session (`programmeMemoryHit`) but do not inject it as a reused briefing. That matches “only when valid.”

**Unnecessary full re-perception:** speech P2 skipped visual (`img=0`, `ledgerReused=true`, Investigator skipped). Visual/editorial still rebuild ledgers when `maxFrames>0` (existing design).

**Answers:** empty (quota). Architectural hits: **PASS**. User-facing programme reasoning: **NOT_VERIFIED**.

---

## B. Case 020 — live visual editorial re-proof

Media: `recording-1788978271417.mp4` (21.438s). Same session + persisted document.

### C1 pre-judgment (this is the gate that matters)

Prompt: *Where would a zoom actually help… Only recommend zooms when the visible evidence supports a specific focal target.*

| Check | Result |
| ----- | ------ |
| `needs.category` | `editingContext` |
| `classifiedQueryClass` / `retrievalQueryClass` | **editorial** (not `general`) |
| `needs.visual` | **true** |
| images attached | **6** (frameMeta length **5**) |
| reasons | all `editorial_focus` |
| times | 12.331, 13.131, 13.538, 14.288, 14.788 |
| span | **2.46s** |
| coverageFrac vs 21.44s | **~0.11** |
| clustered | **true** |
| inadequateForWholeVideo | **true** |

Classifier/routing live-proof: **PASS**.  
Temporal coverage for whole-recording zoom judgment: **FAIL**.

Do **not** score “no zoom needed” as a PASS. There is no completed answer, and even if there were, 2.5s of clustered samples cannot support a whole-video zoom map.

Change-boundary scoring (`change_refinement` +30 vs `periodic` +5) is why the cluster exists. Not retuned this gate.

C2 / C3: editorial, session `sourceMemoryHit=true`, `programmeMemoryHit=true`, `sourceStoryReused=true`, **same 2.46s cluster**. Same coverage FAIL.

---

## C. FULL vs RETRIEVAL vs COMPACT

Same media (`recording-bug5-narrated.mp4`), same prompts, gpt-4o. **All `provider_quota_exhausted`.** Pre-LLM packing still measured.

### Pre-LLM packing (chars)

| Cell | images | system | tool schemas | user text | packed evidence |
| ---- | -----: | -----: | -----------: | --------: | --------------: |
| Q1 speech FULL | 4 | 23652 | 16759 | 3993 | — |
| Q1 speech RET | **0** | 23654 | 16759 | 1052 | 1008 |
| Q1 speech COMPACT | **0** | **8286** | **3059** | 1052 | 1008 |
| Q2 visual FULL | **13** | 23669 | 16759 | 35119 | — |
| Q2 visual RET | 5 | 23671 | 16759 | 10633 | 1175 |
| Q2 visual COMPACT | 5 | **8205** | **3059** | 10633 | 1175 |
| Q3 editorial FULL | 13 | 23691 | 16759 | 37251 | — |
| Q3 editorial RET | 6 | 23693 | 16759 | 20181 | 5396 |
| Q3 editorial COMPACT | 6 | **8339** | 15992 | 20181 | 5396 |
| Q5 cross FULL | **0** | 23172 | 16759 | 5303 | — |
| Q5 cross RET | **0** | 23174 | 16759 | 7921 | 2592 |
| Q5 cross COMPACT | **0** | 7793 | 3059 | 7921 | 2592 |

Provider input/output tokens: **not_available** (no successful completion).

Q5 **0 images** on all three modes is evidence starvation for a required cross-modal prompt. Duration stayed 30 (probe did not run) — visual prepare did not attach frames. **FAIL** as a packing cell, independent of quota.

Answers: **NOT_VERIFIED**.

---

## D. Quality judging

Every completed-answer axis is **NOT_VERIFIED** (empty `finalText`).

Do not recycle Closure V1 answer scores as this-gate PASSes. Closure still exists as **prior** evidence for Restart/Upwork/Settings/Case4/cross-modal *answers*; this gate did not re-prove them.

C1 coverage: **FAIL** (pre-answer).

---

## E. Compact architecture audit

COMPACT does not replace local Ledger / Claims / Source / Target / Gap / Plan. It only shrinks **provider-facing** system + schemas.

| Query class | System invariants retained | Schemas retained | Schemas removed | Evidence |
| ----------- | -------------------------- | ---------------- | --------------- | -------- |
| speech | epistemic block + snapshot | 5 read tools | 30 mutate/capture | packed speech windows; **0** frames (intended) |
| visual / cross_modal / action_verify | same + class line | 5 read tools | all writes | packed + budgeted frames when attached |
| editorial | same + editorial line | 32 (mutate kept, drop list/record/export) | 3 capture | packed + frames; trusted plan still appended |
| direct_edit / general | full-ish | 35 | none | full surface |

**Phase vs query-only gating:** Compact gates on **query class**, not on understanding → planning → mutation phase. A later “apply this trim” turn on Compact speech would lack `addTrim` until the query reclassifies as `direct_edit` / `editorial`. That is **not** a hidden unsafe cognition path; it is **phase-blind tool exposure**. Report only — not redesigned.

Compact “win” on speech is mostly **D unnecessary schemas** + **C dropped recipe essay**. Snapshot is still ~7–8k of the 8.3k system string (**B/A** open-project JSON). Editorial Compact barely cuts tools (16759→15992).

Cannot promote Compact on cost: **no quality evidence this gate**.

---

## F. Longer-context reality check

All mp4s under `~/Library/Application Support/openscreen/recordings`:

- min 2.93s, max **28.94s** (`recording-1789325019656.mp4`)
- previous corpus max 24.35s

LONG_VISUAL Retrieval: 5 frames, span 28s on 28.94s, `inadequateForWholeVideo=false`. **No answer** (quota).

**LONG_FORM_SCALING = NOT_VERIFIED.** Do not extrapolate to 1–5 minute videos. No synthetic long media.

---

## G. Token / context accounting

Remaining cost buckets (measured, not optimized):

| Bucket | Retrieval typical | Compact speech | Kind |
| ------ | ----------------: | -------------: | ---- |
| Universal system + recipes | ~23.5k chars (~5.9k tok est.) | ~invariants only, drowned by snapshot | C legacy on Retrieval; Compact drops recipes |
| Open-project snapshot | inside system | **dominates Compact system (~8k)** | A necessary-ish / still large |
| Tool schemas | 16.7k chars / **35 tools** | 3.1k / **5** (speech) | D on Retrieval speech; Compact OK for understanding |
| Retrieved evidence text | 0.7–5.4k packed | same packed | A |
| Source/Target/trusted reaching provider | trusted ~637–1.6k; source component still measured locally | same local objects | B/A |
| Images | 0 (speech) / 5–6 (visual/editorial) vs 13 FULL | same as Retrieval | E |
| History | 0 on ABC cold cells | 0 | — |

Retrieval still pays **~10k tokens of system+tools** before evidence. Compact speech cuts that roughly in half **before** images, still snapshot-heavy. **Not frozen:** Compact and Retrieval are different architectures.

---

## H. Promotion gates (independent)

| Gate | Result | Evidence |
| ---- | ------ | -------- |
| G1 source memory reuse | **PASS** (telemetry) | P2–P5 `sourceMemoryHit=true` |
| G2 programme memory valid reuse | **PASS** (telemetry) | P2, P3, P5 `programmeMemoryHit=true` after fixes |
| G3 programme mutation invalidation | **PASS** (telemetry) | P4 src stable, prog hash changes, progHit=false |
| G4 Restart | **NOT_VERIFIED** this gate (quota); prior Closure PASS | empty text |
| G5 Upwork | **NOT_VERIFIED** this gate | |
| G6 Settings | **NOT_VERIFIED** this gate | |
| G7 Case 4 | **NOT_VERIFIED** this gate | speech class, 0 frames, no answer |
| G8 cross-modal grounding | **FAIL packing** (0 frames on Q5) + **NOT_VERIFIED** answers | |
| G9 Case 020 zoom grounding | **FAIL** coverage; classifier **PASS**; answers **NOT_VERIFIED** | 2.46s cluster |
| G10 what not to edit | **NOT_VERIFIED** answers; C2 frames still clustered | |
| G11 FULL vs RETRIEVAL quality parity | **NOT_VERIFIED** | |
| G12 COMPACT quality parity | **NOT_VERIFIED** | |
| G13 meaningful context/cost reduction | **PARTIAL** packing (images/schemas); tokens billed **n/a** | |
| G14 no mutation/consent/apply regression | **PASS** (no those semantics touched) | |
| G15 no evidence starvation | **FAIL** | C1 cluster; Q5 0 frames; P3/P5 general 0 frames |
| G16 no new unsupported-edit hallucination | **NOT_VERIFIED** (no answers) | |

**Blocking (this gate):** G9 coverage, G15 starvation, G11/G12 unverified, provider quota, architecture still two packing paths plus Compact.

---

## I. Decisions

```text
ENGINEERING_VERDICT:
BLOCKED

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```

**Why not FROZEN / READY:** competing models would still see different tool surfaces (35 vs 5 vs 32), different system prompts (~23.5k vs ~8k), and Retrieval editorial frames that can silently cluster. That compares architectures, not models.

**Why BLOCKED rather than FAIL:** programme reuse telemetry is now live-true after correctness fixes; the gate is blocked on **quota + coverage + quality**, not on “memory never hits.”

---

## J. Tests

- `videoMemory.test.ts` — full-source duration probe ≠ programme change; trim still invalidates  
- `retrievalProduction.test.ts` — duration probe with clip repair keeps story; speech put does not clobber  
- `mediaContextNeeds.test.ts` — C1 zoom phrasing → `editingContext` + visual  
- Live harness: `electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalPromotionGate/video-memory-retrieval-promotion-gate.runtime.test.ts`

---

## Remaining blockers (next, still not bake-off)

1. Restore provider quota and complete **answers** for P-series, C1–C3, ABC, invariants.  
2. Fix editorial **temporal coverage** (spread vs change-cluster) without Case-020-only tuning.  
3. Diagnose Q5 **0-frame** cross-modal packing.  
4. Decide query-gating vs **phase-specific** tool exposure before freezing Compact.  
5. Longer real recordings or explicitly keep LONG_FORM_SCALING=NOT_VERIFIED.

**STOP.** No local models. No bake-off. Retrieval not default. No autonomy / multi-edit / consent changes.
