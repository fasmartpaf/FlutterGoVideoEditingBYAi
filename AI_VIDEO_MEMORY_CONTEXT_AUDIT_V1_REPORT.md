# OpenScreen — Video Memory & Context Cost Audit V1

**Identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1`  
**Video Memory foundation identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-context-audit-v1/`  
**Prior milestones preserved:** Baseline V1, Recoveries 1–4, Post-Recovery Validation, Apply/Verify suites

---

## Verdict

`PASS_WITH_LIMITATIONS`

---

## Executive verdict

We measured **real gpt-4o provider usage** on corpus recordings and located the 30K-class cost in concrete payload parts—not a vague “large prompt.”

**Root cause of expensive turns:** JPEG frame attachments (typically **13–16 images**, ~10k–12k estimated image tokens) plus a **~23.5k-char system snapshot** and **~16.7k-char tool schemas**, with Source Story / Investigator briefings stacked into the multimodal user message. Ledger and Claim Promotion objects are large locally but **are not wholesale dumped** into the provider unless summarized into briefings/tools.

**Follow-up turns still reconstruct and retransmit essentially the same media payload** (~34k actual input tokens on F1 vs F2). Provider prompt caching helped slightly (`cachedInputTokens: 3584` on F2) but did **not** remove images or evidence prep.

Video Memory V1 foundation (index, fingerprints, query-aware retrieval, session cache API, telemetry) is implemented **without** switching production cognition. A/B comparison is **diagnostic only** (retrieval briefing ~0.1–1k chars vs ~35k multimodal text + images). Quality equivalence for a retrieval-first path is **not yet demonstrated**.

**Not ready for model bake-off** until follow-up reuse and query-aware frame attachment are proven without quality loss.

---

## Current provider-request architecture

Traced from code (`invokeOpenScreenAgent` in `electron/ai-edition/deep-agent/service.ts`):

```text
user message
  → classifyMediaContextNeeds
  → prepareVisualEvidenceForTurn  (frames / changes)     [local]
  → prepareSpeechEvidenceForTurn  (STT)                  [local]
  → Temporal Event Ledger + Claim Promotion              [local]
  → Investigator V1.1 (+ optional Visual Specialist)     [local tools; briefing → provider]
  → Source Story V2 / Target / Gap / Plan / Closure / Proposal  [local; sections → provider]
  → createAgent(systemPrompt + tools) + multimodal messages
  → LangGraph streamEvents (tool loops re-send growing messages)
  → sanitizers / mutation authority / consent surfaces   [local]
```

### What reaches the provider

| Payload | Reach |
| ------- | ----- |
| System instructions + `documentSnapshotForModel` (includes mediaContext / transcript outline) | Every model step |
| Full tool name+description schemas | Every model step |
| Chat history (text turns) | Every model step |
| Multimodal user message: JPEG `image_url` parts + investigator/source/target/trusted editorial text | First and subsequent steps (images retained in thread) |
| Tool results (e.g. `getTranscript`) | After tool calls, then re-sent |

### What stays deterministic / local

| Artifact | Reach |
| -------- | ----- |
| STT / frame extract / change scores | Local prep |
| Temporal Event Ledger JSON | Local (unless tool dumps) |
| Claim Promotion set | Local (summaries may appear in briefings) |
| Edit Gap / Edit Plan / Proposal objects | Local; compact trusted briefing may go to provider |
| Apply Preview / Compositor / Audio verify / UI Consent | Local post-path |
| Video Memory retrieval briefing (this milestone) | **Diagnostic only — not substituted into prompt** |

---

## Actual context composition

Representative **visual/editorial** turn (Probe B, `recording-bug5-narrated.mp4`):

| Component | chars | estimated tokens | actual if known | repeated? |
| --------- | ----: | ---------------: | --------------: | --------- |
| Provider billed input (authoritative) | — | — | **34202** | — |
| Provider billed output | — | — | **157** | — |
| imageDataUrls (base64 transport) | 2 859 395 | ~9945 (image est.) | not_available | yes across tool-loop steps |
| userMessageMultimodalText | 35 109 | ~8778 | not_available | includes derived briefings |
| systemInstruction | 23 676 | ~5919 | not_available | every call |
| sourceStory prompt section | 21 768 | ~5442 | not_available | speech-derived |
| ledger (local measure) | 20 069 | ~5018 | LOCAL_ONLY | derived from speech/visual |
| claimPromotion (local, truncated measure) | 20 000 | ~5000 | LOCAL_ONLY | derived |
| toolSchemas | 16 759 | ~4190 | not_available | every call |
| investigator briefing | 3 538 | ~885 | not_available | speech/visual derived |
| videoMemoryRetrieval (diagnostic) | 433 | ~109 | not sent | — |
| conversationHistory | 0 | 0 | — | — |

**Speech-leaning** turn (Probe A, “What did I say near the end?”):

| Metric | Value |
| ------ | ----- |
| Actual input tokens | **15613** |
| Images attached | **4** (not zero) |
| Estimated image tokens | 3060 |
| System + tools still dominate fixed tax | ~23.6k + ~16.7k chars |

Estimates are tagged `estimated`. Provider usage is retained separately via `langchain_usage_metadata`.

---

## Actual provider-call count

| Probe | modelCalls | toolLoopCount | status |
| ----- | ---------: | ------------: | ------ |
| A–E, F1, F2, FU4, INV_* (this run) | **1** each | 0 | completed |

No multi-step tool loops observed on these prompts. Cost is dominated by **single-call context size**, not retry storms.

---

## Image contribution

| Probe | imageCount | JPEG bytes | est. image tokens | actual input tokens |
| ----- | ---------: | ---------: | ----------------: | ------------------: |
| A (speech Q) | 4 | 0† | 3060 | 15613 |
| B / D / E / F1 / F2 | 13 | ~1.79 MB | 9945 | ~34.2k–34.8k |
| INV_RESTART | 16 | ~1.41 MB | 12240 | 34881 |

† Byte counter can be 0 when frames are path-referenced before data-URL expansion; data-URL char count still shows ~474k for A.

Images are the primary driver of **30K-class** and TPM overflow historically (~32k–35k requested vs 30k TPM on longer clips).

---

## Tool-schema contribution

Stable across probes: **~16 759 chars (~4190 estimated tokens)** of tool names/descriptions on every call. Fixed tax independent of query.

---

## Conversation-history contribution

First-turn probes: **0**.  
F2 with stub prior turns: history text is small vs media; **images + system + tools still fully reattached**.

---

## Cognition-layer contribution

On editorial turns, Source Story section alone is ~22k chars into the user message; Target may be compacted when Plan exists (Recovery 4 packing); Gap/Plan remain largely LOCAL_ONLY with a compact trusted briefing (~0.6–2k chars) entering the provider.

---

## Duplication map

```text
RAW speech segments
  → mediaContext / system snapshot          [PROVIDER]  RAW_EVIDENCE / CONTROL_POLICY
  → Ledger speech events                    [LOCAL]     DERIVED_EVIDENCE
  → Claim Promotion                         [LOCAL]     DERIVED_EVIDENCE
  → Investigator briefing                   [PROVIDER]  DERIVED_EVIDENCE
  → Source Story V2 section                 [PROVIDER]  EDITORIAL_STATE
  → Target / Gap / Plan                     [mostly LOCAL; briefing → PROVIDER]
  → Trusted editorial briefing              [PROVIDER]  EDITORIAL_STATE
  → (optional) getTranscript tool dump      [PROVIDER]  DUPLICATE_OR_REDUNDANT risk

RAW frames
  → JPEG image_url parts                    [PROVIDER]  RAW_EVIDENCE  ★ dominant
  → change scores / OCR specialist          [LOCAL→partial briefing]
  → Source Story visual beats               [PROVIDER]  DERIVED/EDITORIAL
```

Classification used in telemetry: `RAW_EVIDENCE | DERIVED_EVIDENCE | EDITORIAL_STATE | TOOL_CONTRACT | CONVERSATION | CONTROL_POLICY | DUPLICATE_OR_REDUNDANT | LOCAL_ONLY`.

**How many simultaneous LLM representations of the same speech?** Typically **3+** on understanding turns: system mediaContext, investigator briefing, Source Story (and sometimes tool transcript). Frames are not duplicated as text but are **re-sent wholesale** on every model step in a tool loop.

---

## Real 30K-class turn root cause

Concrete contributors (Probe B-class):

1. **~13 JPEG attachments** → ~10k estimated image tokens (often the difference between 15k and 34k).  
2. **System snapshot ~23.5k chars** (capabilities + mediaContext + policy).  
3. **Tool schemas ~16.7k chars**.  
4. **Source Story + investigator text** stacked into multimodal user message (~25k+ chars combined on rich turns).  
5. Historical TPM failures on longer clips: same packing with **more frames** → 32k–35k requested vs 30k TPM (Post-Recovery Validation).

Not “the prompt is large” generically — it is **frames + fixed system/tool tax + stacked derived briefings**.

---

## Latency breakdown

| Probe | sttMs | visualMs | investigatorMs | providerMs | totalMs |
| ----- | ----: | -------: | -------------: | ---------: | ------: |
| A | 1405 | 0 | 2995 | 3724 | 8142 |
| B | 606 | 174 | 2687 | 29542 | 33021 |
| D | 617 | 222 | 2753 | 64262 | 67871 |
| E | 609 | 208 | 2656 | 71377 | 74862 |
| F1 | 614 | 209 | 2820 | 58069 | 61725 |
| F2 | 658 | 211 | 2701 | 58453 | 62031 |

Provider wall time dominates editorial turns (tens of seconds). Evidence prep is usually **&lt;1.5s** after STT cache warm; Investigator ~2.5–4.5s.

---

## Actual / estimated API cost

Pricing config: `GPT4O_PRICING` in `contextTelemetry` (separate from cognition): gpt-4o **$2.50 / $1.25 cached / $10 out** per 1M tokens (asOf 2025-09; verify before finance use).

| Probe | input | cached | output | estimated USD |
| ----- | ----: | -----: | -----: | ------------: |
| A | 15613 | 0 | 31 | **0.039** |
| B | 34202 | 0 | 157 | **0.087** |
| D | 34821 | 0 | 138 | **0.088** |
| E | 34650 | 0 | 278 | **0.089** |
| F1 | 34199 | 0 | 272 | **0.088** |
| F2 | 34220 | 3584 | 182 | **0.083** |
| FU4 | 31238 | 2560 | 140 | **0.076** |
| INV_RESTART | 34881 | 2560 | 143 | **0.085** |
| INV_UPWORK | 32479 | 0 | 242 | **0.084** |

Per successful editorial task on this short clip: **~$0.08–0.09** (actual usage × configured rates). Longer TPM-overflow clips: **cost of failed calls NOT_VERIFIED** as completed editorial tasks.

---

## Initial-turn vs follow-up cost

| | F1 initial | F2 follow-up |
| - | ---------: | -----------: |
| Actual input tokens | 34199 | 34220 |
| Images | 13 | 13 |
| STT + visual + investigator | rebuilt | **rebuilt** |
| Estimated USD | 0.088 | 0.083 |
| Cached input | 0 | 3584 |

**Conclusion:** Same-video follow-up still pays nearly the full understanding tax. Prompt cache saves a little; **Video Memory reuse is not yet on the production path.**

---

## Existing reusable evidence audit

Already canonical and reusable as an index substrate:

- Speech evidence + disk STT cache  
- Visual frames / change scores  
- Temporal Event Ledger + Video Evidence Store  
- Claim Promotion  
- Source Story V2 / Target / Gap / Plan (programme-derived)  
- Investigator briefing + role policy bounds  

Missing today: **persistent cross-turn index + query-aware attachment policy** (foundation added; not production-switched).

---

## Video Memory V1 architecture

Implemented under `electron/ai-edition/videoMemory/`:

```text
MEDIA → Perception (existing) → VideoMemoryV1 index
         speechWindows / transitions / temp UI / passive chrome /
         corrections / contradictions / coverage / fingerprints
              ↓
         retrieveFromVideoMemory (deterministic query class)
              ↓
         (future) Editorial Agent + Investigator deepen only if needed
```

Identity: `CURRENT_OPENSCREEN_VIDEO_MEMORY_V1`. Built each turn for diagnostics; retrieval briefing **not** injected into provider prompts this milestone.

---

## Canonical source of truth

| Concern | Canonical |
| ------- | --------- |
| Programme / mutations | `AxcutDocument` |
| Source-time evidence events | Temporal Event Ledger |
| Promoted claims | Claim Promotion |
| Chronology essay-structure | Source Story V2 (derived) |
| Cross-turn index | VideoMemoryV1 (refs + fingerprints; not a second ledger) |

---

## Persistence decision

**Recommend D:** Source-asset keyed reusable evidence + document/programme-specific derived memory.

| Option | Verdict |
| ------ | ------- |
| A Turn-local only | Status quo; fails follow-up economics |
| B Session cache | Useful intermediate; lost on reload |
| C Document-adjacent only | Mixes source vs programme invalidation |
| **D Source + programme split** | **Chosen** — matches fingerprint design |

Do **not** persist raw provider prompts or base64 images in memory store.

---

## Fingerprint / invalidation policy

| Change | Source evidence | Programme-derived (story/plan) |
| ------ | --------------- | ------------------------------ |
| Same asset bytes/path+duration identity | Reusable | Keep if programme fingerprint matches |
| New / replaced asset | Invalidate | Invalidate |
| Timeline trim / clip reorder / crop / speed / annotations | Retain source | Invalidate programme |
| Project reload | Rehydrate from source-keyed cache if fingerprints match | Recompute if programme changed |

`validateVideoMemory` encodes this split.

---

## Query-aware retrieval

| Query class | Default frames | Primary retrieval |
| ----------- | -------------- | ----------------- |
| speech | **off** | late speech windows, corrections, contradictions |
| visual | on | transitions, temp UI, passive chrome |
| cross_modal | on | speech + contradictions; deepen if unresolved |
| action_verify | on | claims/contradictions; **Investigator deepen** |
| editorial | on (until proven otherwise) | Source Story summary, pacing, temp UI, corrections |

Complements Investigator V1.1; does not replace bounded investigation.

---

## Adaptive Investigator deepening

```text
Video Memory retrieve → reason → evidence sufficient?
   yes → continue cognition
   no  → Investigator targeted request (existing stop/role policy) → merge → continue
```

No infinite loops; no “send every modality just in case” as the target architecture. Production still currently over-attaches frames for many speech queries (Probe A still got 4 images).

---

## Implementation performed

| Path | Role |
| ---- | ---- |
| `electron/ai-edition/contextTelemetry/*` | Turn telemetry, usage extraction, pricing config |
| `electron/ai-edition/videoMemory/*` | Index, retrieval, fingerprints, cache API |
| `electron/ai-edition/deep-agent/service.ts` | Wire telemetry + build memory (no prompt substitution) |
| `…/videoMemoryContextAudit/*.runtime.test.ts` | Real probes A/B/D/E/F + invariants |
| Unit tests | 21 passing |
| Artifacts | `tmp/perception-benchmark/video-memory-context-audit-v1/` |

**Not done (by design):** production switch to retrieval path; model replacement; autonomy; consent/mutation changes.

---

## A/B comparison

Diagnostic only (retrieval **not** driving finals):

| Probe | Current multimodal text chars | Est. image tokens | Retrieval briefing chars | Est. retrieval tokens |
| ----- | ----------------------------: | ----------------: | -----------------------: | --------------------: |
| A | 3993 | 3060 | 375 | 94 |
| B | 35109 | 9945 | 433 | 109 |
| D/E/F | ~35–38k | 9945 | ~1005 | ~252 |

Potential headroom is large **if** frames and stacked briefings can be gated without quality loss. **Not promoted** — equivalence unproven.

---

## Follow-up-turn results

F1→F2 on the same short recording: **~identical input tokens and full evidence rebuild**. Target architecture (Turn 1 expensive; Turn 2+ reuse) is **not met** on the current production path. Memory index exists for reuse; wiring is the next safe milestone.

---

## Case 2 / Case 4 / Upwork / Settings invariants

| Check | Result |
| ----- | ------ |
| INV_RESTART (Restart ≠ restarted) | `invariantOk: true` |
| INV_UPWORK (passive ≠ workflow) | `invariantOk: true` |
| FU4 action verify (no false Settings open in mustNot list) | `invariantOk: true` |
| Epistemic guards in code | Unchanged |

---

## Quality comparison

Automated: invariants held on measured probes. Manual editorial quality for retrieval-first path: **NOT_VERIFIED** (path not live). Current path quality unchanged by telemetry.

---

## Token comparison

| Mode | Typical actual input |
| ---- | -------------------: |
| Speech-leaning (A) | ~15.6k |
| Visual/editorial (B/D/E/F) | ~34–35k |
| Diagnostic retrieval text only | ~0.1–0.3k (+ frames if needed) |

---

## Cost comparison

| Mode | Est. USD / turn (gpt-4o config) |
| ---- | -----------------------------: |
| Speech-leaning | ~0.04 |
| Editorial understanding | ~0.08–0.09 |
| Follow-up today | ~0.08 (almost no savings) |
| Retrieval-first (hypothetical) | NOT_VERIFIED |

---

## Model-call comparison

All completed probes: **1** provider call. Investigator remains local/bounded. No extra orchestration model calls added by telemetry/memory.

---

## Tests

| Suite | Result |
| ----- | ------ |
| `contextTelemetry.test.ts` | pass (6) |
| `videoMemory.test.ts` | pass (15) — fingerprint, trim invalidation, speech avoids frames, Upwork passive, bounded retrieval, no doc mutation, cache isolation, deepen hints |
| Runtime audit probes | 9/9 completed with usage capture |

Required matrix coverage: foundation tests cover 1–16, 18, 20; live probes cover A/B/D/E/F follow-up + Restart/Upwork/Settings-style FU4; locked baselines untouched (19).

---

## Benchmark artifacts

`tmp/perception-benchmark/video-memory-context-audit-v1/`:

- `summary.json`, `probes.json`, per-probe JSON  
- `speech-cache/`  
- `NOTICE.md`  

No overwrite of baseline / R1–R4 / post-recovery / verify artifacts.

---

## Remaining limitations

1. Production path still **reattaches full frames + briefings** every turn.  
2. Speech queries still attach some images (A: 4).  
3. A/B quality equivalence for retrieval-first: **NOT_VERIFIED**.  
4. Persistence not yet document-adjacent on disk (in-memory cache API only).  
5. Claim Promotion size measure is truncated at 20k for diagnostics; object is local.  
6. Full follow-up series FU1–FU3 not re-run live in the quick set (F1/F2 cover the critical reuse question).  
7. Longer corpus clips still risk TPM overflow until frame policy changes.

---

## Recommendation for model bake-off

**Do not start downloading or swapping models yet.**

Benchmark contract when ready:

1. Freeze `CURRENT_OPENSCREEN_*` cognition identities.  
2. Require context telemetry + actual usage on every bake-off turn.  
3. Score grounding / unsupported-action / editorial specificity **before** cost.  
4. Compare cloud vs self-hosted **on the same Video Memory retrieval budget**, not on today’s “send all frames” baseline.  
5. Fail any candidate that reduces unsupported-action rate or Restart/Settings/Upwork invariants.

---

## Five CTO questions

1. **Why did expensive real turns consume so much context?**  
   Primarily **13–16 JPEG frames** plus a **fixed ~23.5k-char system snapshot** and **~16.7k-char tool schemas**, with Source Story / Investigator text stacked on top. Measured ~34k actual input tokens on visual/editorial turns.

2. **How much of that context was genuinely necessary?**  
   For speech-only questions: **most of the image pack is unnecessary** (A still worked with 4 frames / 15.6k tokens). For editorial work: some frames and Source Story are necessary; **full Claim/Ledger JSON dumps are not** (already local). Tool schemas + system policy are necessary but should be treated as a fixed tax to minimize elsewhere.

3. **How much can Video Memory/retrieval remove without reducing quality?**  
   Diagnostic gap: multimodal text **~35k chars → ~0.25–1k retrieval chars**; image tokens **~10k → 0** for speech-class queries. Safe removal magnitude is **NOT_VERIFIED** until an equivalence A/B is promoted. Upper bound of waste is large; quality floor is the gate.

4. **What should remain deterministic/local vs model-reasoned?**  
   **Local:** STT, frames, ledger, claims, fingerprints, retrieval selection, Gap/Plan/Proposal construction, consent/apply/verify, mutation authority.  
   **Model:** query interpretation over a **bounded retrieved slice**, unresolved action verification after deepen, user-facing phrasing constrained by trusted plan.

5. **Are we architecturally ready for the cloud-vs-self-hosted-vs-hybrid model bake-off?**  
   **NO.** Blocker: production still rebuilds/retransmits full multimodal understanding on follow-ups; bake-off on that baseline would measure **provider packing noise**, not model ability. Unblock by shipping query-aware attachment + same-video memory reuse behind `CURRENT_OPENSCREEN_VIDEO_MEMORY_V1` with quality gates green—**then** run the bake-off contract above. Do not download models in this milestone.

---

## Verdict

`PASS_WITH_LIMITATIONS`

Measurement + safe foundation complete. Production cognition unchanged. Follow-up reuse and retrieval-first equivalence remain the promotion gate—not model shopping.
