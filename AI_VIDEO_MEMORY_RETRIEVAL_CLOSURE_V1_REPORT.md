# OpenScreen — Video Memory Retrieval Closure V1

**Identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_CLOSURE_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-closure-v1/`  
**Prior preserved:** Context Audit V1, Retrieval Production V1, Baseline, Recoveries 1–4, Post-Recovery Validation

This is a validation + architectural closure milestone. Default packing remains `CURRENT_FULL_CONTEXT` until promotion criteria all hold.

---

## 1. Executive verdict

### `PASS_WITH_LIMITATIONS`

Live **source-asset memory reuse now works** after the duration-in-fingerprint fix:

| Turn | Query | sourceMemoryHit | sessionReuse | ledgerReused | images | inputTokens |
| ---- | ----- | --------------- | ------------ | ------------ | -----: | ----------: |
| F1 | visual | **false** (cold) | false | false | 5 | 19884 |
| F2 | speech | **true** | **true** | **true** | **0** | 12273 |
| F3 | action_verify | **true** | **true** | false | 4 | 20130 |
| F4 | visual | **true** | **true** | false | 5 | 20241 |
| F5 | editorial | **true** | **true** | false | 5 | 21130 |

A claimed memory architecture with no hits was the Production V1 fail. That specific fail is closed.

Also newly live-proven vs Production V1:

- **Restart** completed (`invariantOk`) — visible `Restart recording` ≠ user restarted
- **Upwork / Settings / Case 4** all `invariantOk`
- Dedicated **cross-modal** turn used speech + frames and listed match / differ / cannot verify
- **Case 020** A/B completed on the real 21.4s clip; C completed but **not visually judged**

Still **not** closed:

- `programmeMemoryHit` never true in the live matrix (harness rebuilt `durationSec=30` documents; programme hash still included probed duration). Unit-fixed this milestone; live persist-document retry hit `provider_quota_exhausted`.
- Case 020 zoom (`C020_C`) classified `general`, **0 images**, canned “no safe edit”.
- FULL vs RETRIEVAL vs COMPACT quality A/B incomplete after quota exhaustion (compact speech/editorial + ED_* + ABC_EDIT retrieval).
- Corpus longest usable file is **24.35s** — not enough to claim 5× duration scaling.
- Tool-schema gating is **COMPACT-only**. Retrieval still exposes all **35** tools.
- System + tool schemas still dominate Retrieval (~10.1k of ~12–21k tokens).

```text
PRODUCTION_RETRIEVAL_PROMOTION:
DO_NOT_PROMOTE

COMPACT_RETRIEVAL_STATUS:
EXPERIMENTAL

MODEL_BAKEOFF_READINESS:
NOT_READY
```

---

## 2. Live fingerprint-fix proof

Production V1 reported `sourceMemoryHit=false` because `fingerprintSourceAsset` hashed probed `durationSec`. That hash **no longer includes duration**.

**Live same-video session** (`recording-bug5-narrated.mp4`, 16.90s, packing `VIDEO_MEMORY_RETRIEVAL`, shared session store `closure_follow_v1`):

- F1 source fingerprint `11945130daff…` / programme (post-prep) `a20e1e531c60…`
- F2–F5 **same source fingerprint**, `sourceMemoryHit=true`, `sessionReuse=true`
- F2 `ledgerReused=true`, `claimsReused=true`, Investigator skipped (`speech windows available; frames not required`)
- F3 Investigator **invoked** (`action_verify always requires bounded Investigator deepen`) — correct, not skipped

This is live proof, not only unit proof.

Harness STT cache dirs were **per row id**, so `sttCacheHit=false` across F1–F5 is a harness artifact, not a product miss. Visual cache on F1: 5 hits / 1 miss (disk from prior runs).

---

## 3. Source-memory reuse

**Works** for source-keyed ledger/claims when the query is speech (`maxFrames=0`).

Visual / action_verify / editorial follow-ups still **rebuild** the ledger from this turn’s frames by design (`canReuseLedger` requires `frameBudget.maxFrames === 0`). Source memory hit is still real: session bundle is found; Investigator can be skipped when sufficiency says so (F4/F5 `ranInvestigator=false`).

Source Story was **recomputed every turn** in this matrix (`sourceStoryReused=false`, `programmeMemoryHit=false`). See §4.

---

## 4. Programme invalidation

Controlled trim on the same source (`PROG_BEFORE` → `PROG_AFTER`):

```text
srcUnchanged: true
progChanged:  true
PROG_AFTER sourceMemoryHit: true
PROG_AFTER programmeMemoryHit: false
```

Fingerprints: source `11945130daff…` unchanged; programme `cebe0bc9cc54…` → `7d6edfeefa04…`.

Required negatives:

- Did **not** need a full source re-perception miss — source hit after trim.
- Target/Gap/Plan were not reused as stale programme story (`sourceStoryReused=false`).
- Answer stayed in **source** narrative (intro / timeline explanation / audit walkthrough), not claiming the trim was already the viewed programme.

**Gap:** programme-valid reuse was never observed (`programmeMemoryHit` always false), including F2–F5 where clips/trims did not change.

Cause: `fingerprintProgramme` previously delegated to `fingerprintDocument`, which hashes `assets[].durationSec`. Each harness turn started at `durationSec=30`; probe refined duration; peek vs stored hash diverged. Same class of bug as the source fingerprint.

**This milestone:** `fingerprintProgramme` now hashes clips/trims/zooms/speeds/asset identity **without** probed duration. Unit tests: duration probe keeps programme story; trim still invalidates. Live persist-document confirmation **blocked by quota**.

---

## 5. Restart

Media: `recording-1789020958404.mp4` (19.89s, **no audio stream**).  
Prompt: temporary UI near the end / did I restart?  
Status: **completed** on attempt 1 (Production V1 was `provider_error` / NOT_VERIFIED).

Answer (abbrev.): control panel shows **Restart recording**; sampled frames do **not** show the recording was restarted.

`invariantOk: true` (must-not: `restarted recording` / `I restarted` / `user restarted`).

**PASS.**

---

## 6. Upwork

Media: `recording-1789018604635.mp4` (16.83s).  
`invariantOk: true`. Answer: Cursor frontmost; Upwork tab **background**; no evidence of opening/working in Upwork.

**PASS.**

---

## 7. Settings

Media: `recording-1788930909064.mp4` (11.80s).  
`invariantOk: true`. Answer: Settings window not visibly open; mention ≠ opened.

F3 on the narrated clip independently refused an open-Settings claim.

**PASS.**

---

## 8. Case 4

Media: `case4-spoken-correction.mp4` (17.0s).  
Query class: **speech** (0 images) — classifier treated “what did I say / correct myself” as speech.

Transcript path:

1. “First I will open the timeline panel.”
2. Correction: “I mean, actually, let me go back.”
3. Final: “I meant the effects panel.” / “now looking at the effects panel.”

Final intended meaning = **effects panel**, not timeline. `invariantOk: true` (must-not: opened Timeline / opened Effects). Did **not** invent either panel as visually opened.

**PASS** for correction + epistemic. **PARTIAL** for “corrected meaning dominates downstream *editorial* reasoning”: this turn never entered editorial packing (no frames, no trusted plan about Effects vs Timeline as a visual programme).

---

## 9. Case 020

Media: `recording-1788978271417.mp4` — **21.44s** (not the 17s narrated clip). Session reuse: C020_B/C `sourceMemoryHit=true`.

| Turn | Prompt | class | images | inputTokens | Notes |
| ---- | ------ | ----- | -----: | ----------: | ----- |
| C020_A | what could genuinely be improved | editorial | 6 | 22850 | Investigator yes; frames **12.33–14.79s only** |
| C020_B | make this feel more professional | editorial | 5 | 20854 | session hit; canned closer |
| C020_C | where would zoom actually help | **general** | **0** | 12190 | STT skipped; no frames |

A/B: Cursor + background Chrome/Upwork; cursor activity ~12–15s; pacing comments; then the **trusted-plan canned sentence** (“no safe, recording-specific edit”). Not a zoom-everywhere hallucination — also not a grounded zoom *judgment*.

C: **FAIL** as visual editorial evidence. `general` + media-needs `fallback` (`needs.visual=false`) skipped frames. Classifier/routing **unit-fixed after the run** (`editorial-judgment` family + `\bzoom\b` → editorial). Not re-run live (quota).

Do **not** treat “no zoom is necessary” as a pass here: the model did not inspect frames on C.

---

## 10. Cross-modal

Media: Settings clip (11.80s). Prompt required match / differ / cannot verify.

- Speech quoted (“sent this one command…”, “this is the meeting…”)
- 3 frames (`cross_modal_compare` at 0s / 6s / 11.26s)
- Matches: general Cursor activity
- Differs / unverified: command sent, meeting, named project — **cannot verify** from samples

**PASS** (no speech-only shortcut).

---

## 11. Multi-duration corpus

ffprobe canonical durations (usable corpus files):

| Role in this run | File | Duration |
| ---------------- | ---- | -------: |
| short/simple (silent) | `recording-1788958840550.mp4` | 4.88s |
| short UI | `recording-1788894882204.mp4` | 5.02s |
| Settings / cross-modal | `recording-1788930909064.mp4` | 11.80s |
| short/narrated (F1–F5, ABC) | `recording-bug5-narrated.mp4` | **16.90s** |
| correction | `case4-spoken-correction.mp4` | 17.00s |
| Upwork | `recording-1789018604635.mp4` | 16.83s |
| Restart / DUR_UI | `recording-1789020958404.mp4` | 19.89s |
| DUR_LONG (case-010) | `recording-1789234858783.mp4` | 20.81s |
| Case 020 | `recording-1788978271417.mp4` | 21.44s |
| longest probed | `recording-1789233035387.mp4` | **24.35s** |

Live duration rows (same visual prompt, Retrieval):

| Row | Duration | speech segs | images | inputTokens | outputTokens | totalMs |
| --- | -------: | ----------: | -----: | ----------: | -----------: | ------: |
| DUR_SHORT | 16.90s | 3 | 5 | 19886 | 296 | 38698 |
| DUR_UI | 19.89s | 0 | 5 | 19726 | 234 | 39630 |
| DUR_LONG | 20.81s | 5 | 5 | 19936 | 165 | 40085 |
| CROSS (11.8s) | 11.80s | 2 | 3 | 17491 | 246 | 33639 |
| C020_A (21.4s editorial) | 21.44s | 3 | 6 | 22850 | 236 | 47060 |

Input tokens did **not** scale with duration on these clips. They sat on the system+tools+bounded-frame floor. **Cannot** extrapolate to 5× longer media: the longest usable file is 24s (~1.4× the 17s narrated clip).

Harness still built documents at `durationSec=30`, so sampling is budgeted against probed media but the document clock is not the authority. Closure recorded actual ffprobe durations in `DURATIONS.json`.

---

## 12. Fixed context tax

Measured on F1 (Retrieval visual, typical):

| Section | chars | est. tokens | Why it is present |
| ------- | ----: | ----------: | ----------------- |
| system instructions + open-project snapshot | 23660 | ~5915 | Identity, time-bases, tool-recipe essay, one-pass finish, evidence contract, Source/Target JSON recipes, snapshot |
| tool schemas (35) | 16759 | ~4190 | Full mutate+capture surface on Retrieval (gating is COMPACT-only) |
| chat history | 0 | 0 | Cold turn |
| user multimodal text (packed + reasons + frames captions) | 10667 | ~2667 | Retrieval pack + frame reasons + remaining briefing |
| images (5 JPEG data-URLs) | 1.32e6 | ~3825 (image tok) | Query-aware budget |
| Source Story (telemetry component) | 8098 | ~2025 | Local cognition; Retrieval pack is supposed to *replace* a full dump — this component still measures leftover / parallel text |
| trusted editorial | 637 | ~160 | Compact trusted plan |

**Speech Retrieval (F2 / ABC_SPEECH_RET):** user text collapses to ~1052 chars; images 0. Remaining ~12.1–12.3k input tokens ≈ **system + tools**.

**COMPACT speech (failed generation, telemetry still recorded):**

| Section | chars | est. tokens |
| ------- | ----: | ----------: |
| compact system (invariants + snapshot) | **1284** | ~321 |
| gated tools (5) | **3059** | ~765 |
| user text | 1052 | ~263 |

Control tax 4343 vs 40418 chars (~89% smaller) **before** counting images. Quality of the answer: **NOT_VERIFIED** (rate limit / quota).

No extra summarizer LLM was added. Orchestration model calls: **0**.

---

## 13. Tool-schema audit

35 tools on `OPENSCREEN_TOOL_NAMES`. Gating implemented only for `VIDEO_MEMORY_RETRIEVAL_COMPACT`.

| Query class | Required | Optional | Irrelevant (examples) | Retrieval today | Compact |
| ----------- | -------- | -------- | --------------------- | --------------- | ------- |
| speech | getCurrentDocument, getTranscript, getTranscriptRange, getTranscriptWords | getCursorTrack | all mutate + capture | **35** | **5** |
| visual / cross_modal / action_verify | document + transcript range + cursor | getTranscriptWords | mutate + capture | 35 | 5 |
| editorial | document, transcript, addTrim, addZoom, addAnnotation | other mutate | listSources, recordScreen, exportProject | 35 | ~32 |
| direct_edit | full surface | capture | none | 35 | 35 |
| general | document | rest | none | 35 | 35 |

“What did I say near the end?” does **not** need mutation schemas to *answer*. Compact therefore drops them. Retrieval does **not**, because Planning Closure / later editorial turns on the same session must still be able to name tools, and Compact must not hide tools needed for a later execution phase merely to win a benchmark.

Cognition vs mutation authority remain separated: even with mutate schemas present, proposal_only / consent / apply are unchanged.

Compact editorial keeps mutate schemas **on purpose** so proposal language can stay specific.

---

## 14. System-prompt audit (~23.5k chars)

Classification of `BASE_SYSTEM_PROMPT` (plus open-project snapshot):

| Section | Kind | Compact policy |
| ------- | ---- | -------------- |
| Agent identity / local CLI | universal | keep short |
| Time-bases SOURCE vs VIRTUAL | universal cognition | keep compact |
| How-tools-map essay (silences→addTrims, zoom depths, graphics, capture…) | duplicated by tool schemas | **drop_or_gate** |
| One-pass finish / promo zoom recipes | legacy; superseded by trusted plan + Recovery 4 | **drop** |
| Trusted editorial chain + mutation authority | duplicated by typed Gap/Plan/Proposal/consent | keep **one** compact invariant |
| Evidence contract (timelineMetadata / cursor / transcript / visualFrames / semanticUi) | epistemic, still provider-facing | keep compact |
| Cursor blindness vs no-sidecar | epistemic | keep compact |
| Honesty / getCurrentDocument reconcile | universal | keep short |
| SOURCE_STORY / TARGET_STORY JSON emit instructions | duplicated by **local** Source Story V2 / Target V1 | drop when stories computed offline |
| VISUAL_SEMANTIC_GROUNDING JSON emit | duplicated by local visual specialist / ledger | drop or shrink |
| Open-project snapshot JSON | media understanding | keep (still large) |

We are **paying tokens to instruct the model to enforce rules the typed pipeline already enforces** (Restart ≠ restarted, trusted plan, mutation refuse). Those lines stay as compact provider-facing invariants in COMPACT; they were **not** deleted from Retrieval.

Safeguards were not removed from the default path.

---

## 15. Compact packing architecture

```text
query
  → classifyMediaContextNeeds + classifyVideoMemoryQuery
  → VIDEO_MEMORY_RETRIEVAL_COMPACT
  → same local Ledger / Claims / Investigator / Source / Target / Gap / Plan
  → compact system (epistemic invariants + snapshot)
  → toolGateForQuery (schemas only)
  → packProviderContextFromMemory
```

Experimental. Opt-in via `InvokeArgs.contextPacking` or `OPENSCREEN_CONTEXT_PACKING`. Does **not** replace `VIDEO_MEMORY_RETRIEVAL`. Default remains `CURRENT_FULL_CONTEXT`.

No summarizer model. No extra orchestration calls.

---

## 16. A/B/C quality results

Speech (“What did I say near the end?”) on 16.90s narrated clip:

| Mode | status | input | images | quote |
| ---- | ------ | ----: | -----: | ----- |
| FULL | completed | 15598 | 4 | architecture-notes sentence **PASS** |
| RETRIEVAL | completed | 12082 (−22.5%) | **0** | same sentence **PASS** |
| COMPACT | `provider_rate_limited` | n/a (est. ~1.5k control) | 0 | **NOT_VERIFIED** |

Editorial (“more professional” + what **not** to edit):

| Mode | status | input | images | quality |
| ---- | ------ | ----: | -----: | ------- |
| FULL | completed | 34657 | 13 | PARTIAL — preservation-heavy, generic |
| RETRIEVAL | `provider_quota_exhausted` | n/a | 6 prepared | **NOT_VERIFIED** (F5 is the live Retrieval editorial proxy: PARTIAL) |
| COMPACT | `provider_quota_exhausted` | n/a | 6 prepared | **NOT_VERIFIED** |

F5 Retrieval editorial: recording-specific (Cursor vs Chrome tabs); did not invent zooms; canned trusted-plan closer. **PARTIAL**, not a quality regression vs FULL’s similar preservation language.

---

## 17. Editorial challenge results

| Prompt | Row | Result |
| ------ | --- | ------ |
| Improve the pacing | ED_PACING | NOT_VERIFIED (`provider_quota_exhausted`) |
| What is distracting | ED_DISTRACT | NOT_VERIFIED |
| What edits would you NOT make | ED_NOT | NOT_VERIFIED |
| Is there anywhere a zoom would actually help | ED_ZOOM | NOT_VERIFIED |
| F5 professional + keep explanation | F5 | PARTIAL (see §16) |
| C020 A/B/C | C020_* | PARTIAL / FAIL (see §9) |

The “what would you **not** edit” prompt did not get a completed live answer after quota. Do not invent one.

---

## 18. Context scaling

On 12–21s clips with a 5–6 frame cap, **provider input stayed ~17–23k** for visual/editorial Retrieval and ~12k for speech. That is **relevant-evidence bounded** (plus a huge fixed tax), not duration-linear.

Insufficient corpus diversity to claim behavior at 5× duration (~85s+). Longest file **24.35s**. Honest conclusion: **NOT_VERIFIED beyond ~25s**.

---

## 19. Token usage

Completed Retrieval vs FULL (this run):

| Class | FULL in | RET in | Δ |
| ----- | ------: | -----: | -- |
| Speech | 15598 | 12082 | **−22.5%** |
| Visual (F1 vs Production FULL ~34k) | ~34190 (prior) | 19884 | **~−42%** (prior A/B; this run no new FULL visual) |
| Editorial FULL this run | 34657 | F5 21130 (proxy) | **~−39%** vs this FULL; ABC_EDIT RET not completed |

Cached input tokens appeared on several Retrieval turns (e.g. F1 2560, F2 2816, F5 3584) — provider prompt-cache, not Video Memory.

---

## 20. Image usage

| Class | FULL | Retrieval |
| ----- | ---: | --------: |
| Speech | 4 | **0** |
| action_verify | — | 4 |
| visual | 13 (prior) | 5–6 |
| editorial | 13 | 5–6 |
| C020_C zoom | — | **0** (classifier miss) |

Every attached Retrieval frame has `FrameAttachReason`. C020_A reasons were all `editorial_focus` in a 2.5s cluster — change-boundary bias, not coverage of the 21s clip.

---

## 21. Cost

Completed-turn `estimatedUSD` this matrix ≈ **$0.97**. gpt-4o. Failed compact/editorial turns: **NOT_VERIFIED** (no usage). Retry abort: quota, $0 extra generation.

Speech Retrieval ~$0.027 vs FULL ~$0.039 (−31%). Editorial FULL $0.089. Retrieval editorial proxy F5 $0.050.

---

## 22. Latency

Provider-dominated. Speech + memory hit **F2 = 2.5s** total (stt 693ms, provider 1.8s). Visual/editorial/invariants typically **25–47s**. FULL editorial **65s**. Compact failures returned in 4–6s (error before/at provider).

---

## 23. Provider calls

One chat completion per completed turn (no extra summarizer). Investigator V1.1 remains **0 investigator LLM** (local). Visual specialist reuse is local.

Completed generations this matrix: **22**. Provider errors: **7** (rate limit then quota), plus retry abort.

---

## 24. Epistemic regressions

None observed on completed invariant rows.

| Guard | Production V1 | Closure V1 |
| ----- | ------------- | ---------- |
| Restart | NOT_VERIFIED | **PASS** |
| Upwork | PASS | **PASS** |
| Settings | PASS | **PASS** |
| Case 4 opened-panels | PASS | **PASS** |

F1/Upwork answers treat Upwork as chrome, not workflow.

---

## 25. Editorial regressions

No new “add zoom everywhere” regression on completed Retrieval editorials.

Opposite risk: **trusted-plan canned refusal** repeating on C020_A/B/C and F5, which can starve specific (including honest no-zoom) judgment when frames are missing or clustered.

Mutation / consent / apply / compositor / audio verify: **not changed**.

---

## 26. Tests

- `videoMemory/*.test.ts` — fingerprint duration-omit, session trim vs duration-probe, zoom→editorial, frame budgets, packing, compact system/tool gate (**32** in the three files run this milestone).
- `mediaContextNeeds` — `editorial-judgment` family for zoom-help (**PASS**).
- Runtime: `video-memory-retrieval-closure.runtime.test.ts` **1 passed** (29 rows, ~13 min).
- Retry runtime: aborted after `provider_quota_exhausted`; still wrote `DURATIONS.json`.

---

## 27. Remaining blockers

1. Live `programmeMemoryHit` / `sourceStoryReused` after duration-omit fix (quota blocked persist-document retry).
2. Case 020 zoom with **frames attached** (classifier/routing now unit-fixed; not live-reproven).
3. COMPACT quality vs FULL/Retrieval (quota).
4. Editorial challenge set (quota).
5. Tool gating on Retrieval itself — not done; Compact-only by design.
6. System snapshot still ~open-project JSON on Compact.
7. Corpus max 24s — no long-form scaling proof.
8. Harness `durationSec=30` + per-turn STT cache dirs distort some telemetry.

---

## 28. Production promotion decision

Promotion requires all 12 gates. Score:

| # | Criterion | Result |
| - | --------- | ------ |
| 1 | Live source-memory reuse after fingerprint fix | **PASS** |
| 2 | Programme invalidation | **PARTIAL** (invalidate yes; valid reuse unproven live) |
| 3 | Restart | **PASS** |
| 4 | Case 4 correction | **PASS** (editorial downstream PARTIAL) |
| 5 | Upwork | **PASS** |
| 6 | Settings | **PASS** |
| 7 | Dedicated cross-modal | **PASS** |
| 8 | Case 020 editorial grounded | **FAIL / PARTIAL** (C ungrounded) |
| 9 | No meaningful quality regression vs FULL | **PARTIAL** (speech equal; editorial ABC RET missing) |
| 10 | Meaningful context/cost improvement | **PASS** on images + 23–42% tokens; **not** 60%; architecture still better |
| 11 | No new unsupported-action regression | **PASS** on completed invariants |
| 12 | No mutation/consent/apply change | **PASS** |

**DO_NOT_PROMOTE** as default / canonical cognition path.

Keep `VIDEO_MEMORY_RETRIEVAL` opt-in. The ≥60% target is **not** an absolute product requirement; even with honest smaller savings, Case 020 zoom + programme-hit + Compact quality remain open.

---

## 29. Model bake-off readiness

**NOT_READY.**

There is not a frozen common context architecture:

- Default is still FULL.
- Compact is experimental and quality-unproven.
- Retrieval still ships all tool schemas; Compact does not.
- Case 020 visual packing is not stable (classifier miss in this run).
- Programme reuse telemetry is not live-green.

A bake-off now would compare **architectures**, not models.

---

## 30. Recommended next milestone

**`VIDEO_MEMORY_RETRIEVAL_PROMOTION_GATE_V1`** (still not a model bake-off, not local inference):

1. Persist the same `AxcutDocument` across turns and live-prove `programmeMemoryHit` after the duration-omit fix.
2. Re-run Case 020 C (and ED_ZOOM / ED_NOT) with the editorial-judgment routing fix.
3. Complete FULL vs RETRIEVAL vs COMPACT on speech + editorial + “what not to edit” after quota recovers.
4. Only then decide whether Compact stays experimental or Retrieval can become the default **opt-in production** path.

STOP. Do not download models. Do not bake off. Do not expand autonomy / multi-edit / consent / verify.

---

## Architecture map (post-closure)

```text
computed each turn: needs, query class, STT, budgeted frames, ledger (reuse if speech+session),
                    optional Investigator, Source/Target/Gap/Plan (local)
persisted: STT disk cache, visual disk cache, session source bundle (ledger/claims/story)
invalidates: source path/id/kind change → drop bundle
             clip/trim/zoom/speed change → drop story/plan, keep source ledger
             probed durationSec → must NOT drop source or programme (unit-fixed)
reaches provider:
  FULL     → 23.5k system + 16.7k tools + stacked briefings + many JPEGs
  RETRIEVAL→ same system+tools + packed KNOWN/SPOKEN/… + budgeted JPEGs
  COMPACT  → ~1.3k system + gated tools + same packed evidence (experimental)
local only: ledger/claims objects, Gap/Plan/Proposal, consent/apply/verify
```

---

## Final decision

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

PRODUCTION_RETRIEVAL_PROMOTION:
DO_NOT_PROMOTE

COMPACT_RETRIEVAL_STATUS:
EXPERIMENTAL

MODEL_BAKEOFF_READINESS:
NOT_READY
```

**STOP.**
