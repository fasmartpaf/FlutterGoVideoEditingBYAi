# AI Real Corpus Baseline V1 Report

**Identity:** `CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1`  
**Date:** 2026-09-13  
**Scope:** Frozen measurement milestone — **no production behavior changes**

---

## Benchmark execution verdict

### `PASS_WITH_LIMITATIONS`

The frozen corpus ran end-to-end on **30 real-recording cases**, wrote complete per-case artifacts, preserved user-facing answers, and produced clusterable failures **without modifying product prompts, thresholds, Investigator/Story/Proposal/Apply/verify layers, tools, or UI**.

Limitations (do not treat as green product proof):

1. **Corpus-wide speech failure** — Whisper/STT returned `failed` or empty segments on essentially every audio-bearing case in this run. Speech and cross-modal speech↔visual grades are largely **NOT_VERIFIED / blocked by evidence absence**, not proven correct.
2. **Automated `score.json` PASS rate is inflated** — many dimensions are `NOT_VERIFIED` yet overall still lands PASS. Prefer **`manual-review.json`** + this report for CTO decisions.
3. **No natural `proposal_ready` apply path** appeared — Apply Preview / compositor / audio verify were **not exercised** (honest: eligibility never appeared).
4. Heuristic scoring cannot invent ground truth; visual recall remains mostly `NOT_VERIFIED`.

This verdict rates **benchmark execution quality**, not “OpenScreen is ready.”

---

## Product readiness assessment

### `EARLY`

**Why not higher:** On this frozen corpus the system often produces calm visual chronology and good negative epistemic answers (Restart / Upwork / Settings / unsupported), but it **did not demonstrate working speech understanding**, frequently **skipped investigation when mediaContextNeeds fell through to fallback**, returned **empty finals on several editorial asks**, and produced **zero `proposal_ready` proposals**. Editorial Target→Gap→Plan exists on a minority of turns and did not land safe executable proposals.

**Why not `NOT_READY`:** Real product path (`invokeOpenScreenAgent`) ran; Source Story V2 / Claim Promotion / Investigator artifacts appear; historical negative invariants held where scored; unsupported capabilities were refused clearly.

---

## Freeze compliance

| Rule | Status |
| ---- | ------ |
| No prompt / threshold / policy / Story / Proposal / Apply / verify / tool / UI changes | **Held** |
| New evaluation identity only | `CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1` |
| Prior `CURRENT_OPENSCREEN_*` baselines not overwritten | **Held** |
| Benchmark-only harness under `perceptionBenchmark/realCorpusBaseline/` | **Added** |
| No automatic P0/P1/P2 product fixes after Case 3 | **Held — STOP after this report** |

**Benchmark-only infrastructure:** corpus definitions, runner, scorer, summarizer, artifact writers. No product fix for Whisper or mediaContextNeeds.

---

## Recording inventory

| Item | Value |
| ---- | ----- |
| Primary media root | `~/Library/Application Support/openscreen/recordings/` |
| Inventory artifact | `tmp/perception-benchmark/real-corpus-baseline-v1/inventory.json` |
| Distinct recordings used | **17** (+ Case 4 synthetic MP4) |
| Usable pool discovered | **21** files (durations ~3–40s; mix of audio / silent / webcam / cursor) |
| Limitation | Fewer than 30 unique longform recordings — diversity via **genuinely different tasks** on shared media where needed |

`corpus.json` lists all 30 cases. Historical anchors ≤30% (8/30 ≈ 27%); ≥70% non-anchor.

---

## Corpus design

Families covered: A understanding, B speech, C cross-modal, D temporary UI, E passive chrome, F correction, G editorial, H target story, I edit gap, J edit plan, L proposal, M preservation, O unsupported.

**Safe execution (N):** attempted only if natural `proposal_ready` — **none occurred**.

---

## Aggregate results

### Automated harness (`summary.json`)

| Mark | Count |
| ---- | ----- |
| PASS | 23 |
| PARTIAL | 4 |
| FAIL | 3 |
| Total | 30 |

Treat as **under-strict**.

### Manual review overlay (`manual-review.json`)

| Mark | Count |
| ---- | ----- |
| PASS | 2 |
| PARTIAL | 22 |
| FAIL | 3 |
| NOT_VERIFIED | 3 |

### Latency (measured)

| Metric | Value |
| ------ | ----- |
| n | 30 |
| avg | **~38.8 s** |
| p50 | **~36.6 s** |
| p95 | **~83.9 s** |

Pathological: editorial turns ~75–84 s; short understanding ~9–21 s when evidence skipped.

### Model / tool accounting

| Signal | Observation |
| ------ | ----------- |
| Main agent | ~1 `invokeOpenScreenAgent` turn / case (LangGraph may multi-step internally) |
| Investigator model calls | **0** (V1.1 design held where Investigator ran) |
| Investigator tool calls | typically 0–5; **0 when `deterministic_edit_skip`** |
| OCR / vision | Reuse Visual / specialist present on some turns; not uniformly logged as call counts |
| Speech | **0 successful segment sets** in this corpus run |

### Proposal / apply

| Signal | Count |
| ------ | ----- |
| `proposal_ready` | **0** |
| `no_safe_proposal` (explicit) | 1 |
| Empty proposal lists | majority |
| Mutations attempted | **0** |
| Mutations accepted | **0** |
| Rollbacks | **0** |
| Closure artifacts | sparse / often absent |

---

## Case table (condensed)

Full table: `tmp/perception-benchmark/real-corpus-baseline-v1/REAL_CORPUS_BASELINE_V1_REPORT.md` and `summary.json#rows`.

| Case | Task family | Manual | Notable |
| ---- | ----------- | ------ | ------- |
| 001 | Understanding (narrated) | PARTIAL | Visual chronology OK; **speech failed**; denies audio |
| 002 | Temp UI / Restart | **PASS** | Restart controls visible; **did not claim restart** |
| 003 | Spoken correction | PARTIAL/FAIL speech | **No transcript** — correction unevaluable |
| 004 | Settings grounding | PARTIAL | Correctly: Settings **not** shown opened; speech missing |
| 005 | Passive chrome | PASS-ish | Upwork tabs ≠ worked in Upwork |
| 006–013 | Speech / cross-modal / editorial | PARTIAL | Speech miss dominates |
| 015 | Stability ask | FAIL/PARTIAL | **No visual frames** (`mediaCapabilities` leak) |
| 017 / 027 / 030 | Editorial / gap | **FAIL** | **Empty final response** |
| 020 | Safe edits | PARTIAL | Suggested zooms **without** visual frames |
| 021 | Unsupported | **PASS** | Clear refuse stabilize/denoise/upscale |
| 023 | no_audio honesty | PARTIAL | Hedged; confusing vs inventory no-audio |
| 024 | Brief UI | PARTIAL | Lab wording “Across the sampled frames” |

---

## Historical invariant checks

| Invariant | Result |
| --------- | ------ |
| Restart recording visible ≠ user restarted | **PASS** (case-002) |
| Upwork chrome ≠ Upwork workflow | **PASS** (case-005; also careful language elsewhere) |
| Settings speech/label ≠ Settings opened | **PASS** (case-004 user-facing) |
| Speech ≠ automatic visual truth | **NOT_VERIFIED** (speech unavailable) |
| Timeline/Effects correction preserved | **NOT_VERIFIED** (case-003 speech failed) |
| `no_audio` ≠ provider failure | **PARTIAL** — case-023 hedged oddly; silent cases usually OK |
| segments + unexplained `speechStatus=failed` | **N/A** (no segments coexisting) |
| Unsupported not silently substituted | **PASS** (case-021) |
| Structural ≠ render; ffmpeg ≠ compositor; visual ≠ audio | **N/A** (no apply) |
| No mutate without consent gates | **PASS** (0 mutations) |

---

## Failure clusters (CTO priority)

### Cluster A — Speech path unavailable across the corpus

- **Cases:** essentially all audio-bearing (001, 003, 006–013, 016–019, …)
- **Layer:** speechEvidence / Whisper STT runtime
- **Evidence:** `perception.json` → `speechStatus=failed` or null + `segmentCount=0`; user answers apologize for missing transcript
- **Severity:** **P0** for any speech/correction/cross-modal product claim
- **Confidence:** high
- **Architecture answers:**
  1. Failed: no usable transcripts in this frozen run  
  2. First error: STT prepare (`speechStatus=failed`)  
  3. Propagated: Source Story speech, Claim spoken*, Target/Gap editorial that needs narration, user-facing speech answers  
  4–5. Audio streams exist per inventory; evidence **absent** at speech layer (not ignored later)  
  6. Primarily **provider/runtime / evidence quality**, not prompt wording  
  7. Prompt tuning **will not** fix missing STT  
  8. Deterministic rule: surface `speechStatus` honestly (partially done); need STT reliability  
  9. Requires **tooling/runtime** diagnosis (whisper server, model load, ffmpeg extract)  
  10. Research: existing whisper.cpp server already in-tree — fix ops before new libs  
  11. Smallest principled fix: restore STT health + fail-closed diagnostics with reason codes (later milestone)  
  12. Regression: Case 1 narrated + Case 4 correction must yield segments again  

### Cluster B — `mediaContextNeeds` fallback starves visual evidence

- **Cases:** 015, 020, 022, 025 (Investigator `deterministic_edit_skip` despite non-deterministic asks)
- **Layer:** mediaContextNeeds classify → visual prepare skipped → Investigator skip reason reused as `deterministic_edit_skip`
- **Evidence:** case-015 final: “mediaCapabilities indicate that visualFrames are not available”
- **Severity:** **P1**
- **Confidence:** high
- **Diagnosis:** Regex families miss natural questions (“mostly stable?”, “what safe edits?”). Fallback sets `visual:false`. Misleading stop reason blames “deterministic edit.”
- Prompt tuning alone is brittle; needs **broader understanding/editing default** or safer fallback = prepare multimodal for open questions.
- Smallest fix (later): fallback → `mediaUnderstanding` when message references recording/screen/edits; rename skip reason.

### Cluster C — Empty user-facing finals on editorial asks

- **Cases:** 017, 027, 030
- **Layer:** main agent stream / final text assembly
- **Evidence:** `final-response.txt` and `raw-model.txt` length 0
- **Severity:** **P1**
- **Confidence:** high
- **Diagnosis:** Product failure regardless of ledger quality. Capture `InvokeResult.reason` in harness next time. Likely provider/stream empty or tool-loop with no text — **not** fixed here.

### Cluster D — Target Story / editorial stack rarely completes to proposals

- **Cases:** editorial set; Target V1 present in only ~4/30; Gap/Plan sparse; **0 proposal_ready**
- **Layer:** Target Story → Edit Gap → Plan → Proposal gating + speech poverty
- **Evidence:** case-007 has Target/Gap/Plan but proposals `[]` with preserve-only plan; OCR crop notes pollute preserve text
- **Severity:** **P1** (editorial product path)
- **Confidence:** medium-high
- Prompt tuning may help specificity; **cannot** invent proposal_ready without sound evidence + eligibility. Preserve strings leaking specialist OCR jargon is a **SOURCE_STORY / CLAIM** quality issue.

### Cluster E — Lab / internal wording in user-facing answers

- **Cases:** 015 (`mediaCapabilities`), 024 (“Across the sampled frames”)
- **Layer:** final response / system style
- **Severity:** **P2**
- **Confidence:** high
- Smallest fix (later): response filter / prompt discipline already partially present — reinforce.

### Cluster F — Advice without evidence (aggressiveness in prose)

- **Cases:** 020
- **Layer:** final response (not proposal artifact)
- **Evidence:** recommends zooms from cursor telemetry while stating no visual frames
- **Severity:** **P1**
- **Confidence:** medium
- Conservatism in Proposal layer may be correct; **user-facing** still over-suggested.

---

## Architectural diagnosis summary

| Question | Corpus answer |
| -------- | ------------- |
| Can it understand unfamiliar recordings visually? | **Partially** — often yes when frames attach; fails when needs fallback |
| Speech understanding? | **Not demonstrated** this run |
| Evidence-grounded story? | Source Story V2 sometimes; weak without speech; OCR noise in claims |
| Editorial goal → Target? | Intermittent; generic/absent often |
| Sensible improvements + preserve meaning? | Plan often preserve-only; no safe executable proposals |
| Refuse unsafe / unsupported? | **Yes** for stabilize/denoise/upscale; Restart/Upwork/Settings negatives **good** |
| Communicate naturally? | Often calm; sometimes empty or lab-leaky |

**Unit tests green ≠ this.** This benchmark is the measurement the architecture lacked.

---

## Artifact paths

```text
tmp/perception-benchmark/real-corpus-baseline-v1/
  inventory.json
  corpus.json
  summary.json
  failures.json
  latency.json
  manual-review.json
  run-log.json
  full-run.log
  REAL_CORPUS_BASELINE_V1_REPORT.md
  cases/case-001/ … case-030/
    input.json
    perception.json
    investigator.json
    ledger.json
    claims.json
    source-story.json
    target-story.json
    edit-gap.json
    edit-plan.json
    closure.json
    proposal.json
    apply-receipt.json
    final-response.txt
    raw-model.txt
    score.json
    latency.json
    model-calls.json
    (+ visual-specialist.json when present)

electron/ai-edition/perceptionBenchmark/realCorpusBaseline/
  NOTICE.md
  cases.ts
  runCase.ts
  summarize.ts
  score.ts
  types.ts
  realCorpusBaseline.runtime.test.ts
```

Root report (this file): `AI_REAL_CORPUS_BASELINE_V1_REPORT.md`

---

## What should be built next (authorized later — **not implemented**)

Priority order suggested by clusters:

1. **Restore and instrument STT** (Cluster A) — reason codes, health check, Case1/Case4 speech regressions  
2. **Fix mediaContextNeeds fallback** (Cluster B) — open questions must still prepare multimodal evidence; honest Investigator skip reasons  
3. **Empty-final hard fail diagnostics** (Cluster C)  
4. **Editorial completion quality** (Cluster D) — Target specificity + claim text hygiene + proposal landing only with evidence  
5. **User-facing language gate** (Cluster E/F)

Do **not** start multi-edit, autonomy, or auto-repair until CTO reviews this evidence.

---

## STOP

Measurement milestone complete. **No product fixes applied.** Awaiting CTO review of failure clusters before the next engineering milestone.
