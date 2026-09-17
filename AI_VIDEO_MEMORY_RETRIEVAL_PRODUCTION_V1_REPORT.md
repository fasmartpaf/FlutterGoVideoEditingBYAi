# OpenScreen — Video Memory Retrieval Production Path V1

**Identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PRODUCTION_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-production-v1/`  
**Prior preserved:** Context Audit V1, Baseline, Recoveries 1–4, Post-Recovery Validation, Apply/Verify

---

## 1. Executive verdict

### `PASS_WITH_LIMITATIONS`

Video Memory + query-aware retrieval is now a **real selectable production packing path** (`VIDEO_MEMORY_RETRIEVAL`), not diagnostics-only.

Measured on real corpus media (`recording-bug5-narrated.mp4` and invariant clips):

| Prompt class | FULL input toks | RETRIEVAL input toks | Reduction | Images FULL→RET |
| ------------ | --------------: | -------------------: | --------: | --------------- |
| Speech | 15603 | **12084** | **22.6%** | 4→**0** |
| Visual | 34190 | **19883** | **41.8%** | 13→**5** |
| Editorial / professional | 34644 | **23129** | **33.2%** | 13→**6** |
| Shorter/clearer | 34807 | **23324** | **33.0%** | 13→**6** |

Follow-up series (retrieval): **F2 speech used 0 images / ~12.3k tokens** after F1 visual (~19.9k / 5 images). F3 action_verify deepened Investigator and refused unsupported Settings-open. Epistemic invariants **Upwork / Settings / Case4 held**. Restart probe hit `provider_error` (empty final) → **NOT_VERIFIED** for that clip this run.

**Efficiency gate (≥60% context cut) not met** on editorial turns — fixed system (~23.5k chars) + tool schemas (~16.7k chars) still dominate once images are reduced. Quality on measured prompts did not show material regression vs FULL for speech/visual/editorial specificity, but Restart was unverified and session `sourceMemoryHit` was false during the live follow-up (fingerprint included probed `durationSec`; **fixed after the run**).

Default packing remains **`CURRENT_FULL_CONTEXT`**. Retrieval is opt-in via `InvokeArgs.contextPacking` or `OPENSCREEN_CONTEXT_PACKING=VIDEO_MEMORY_RETRIEVAL`.

```text
PRODUCTION_RETRIEVAL_PROMOTION:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY
```

---

## 2. Previous architecture

```text
every turn → prepare ≤20 frames → always Investigator when ledger exists
         → append full Source Story (+ Target / trusted)
         → provider (system + tools + JPEGs + stacked briefings)
follow-up → rebuild/retransmit same package (~34k tokens)
Video Memory → diagnostic briefing only (not injected)
```

---

## 3. New architecture

```text
User Request
  → classifyMediaContextNeeds + classifyVideoMemoryQuery
  → packingMode = FULL | VIDEO_MEMORY_RETRIEVAL
  → frameBudgetForQuery (speech:0, action:≤4, visual:≤6, editorial:≤6)
  → prepareVisualEvidenceForTurn(maxFrames / skip)
  → STT + Ledger + Claims (local)
  → sufficiency gate → Investigator only if needed
  → local Target/Gap/Plan/Proposal (unchanged editorial cognition)
  → FULL: prior append chain
    RETRIEVAL: packProviderContextFromMemory (KNOWN/SPOKEN/…/PRESERVE)
             + compact trusted plan (no full Source Story dump)
  → sessionStore.put (source-keyed)
```

Mutation authority, consent, apply, compositor/audio verify: **unchanged**.

---

## 4. Exact files changed

| Path | Role |
| ---- | ---- |
| `electron/ai-edition/videoMemory/productionPath.ts` | Packing modes / identity / frame reason types |
| `electron/ai-edition/videoMemory/framePolicy.ts` | Query budgets, selection, reasons, dedupe |
| `electron/ai-edition/videoMemory/packProviderContext.ts` | Bounded provider packing |
| `electron/ai-edition/videoMemory/sufficiency.ts` | Evidence sufficiency / deepen |
| `electron/ai-edition/videoMemory/sessionStore.ts` | Source vs programme session reuse |
| `electron/ai-edition/videoMemory/index.ts` | `direct_edit` class; source fingerprint without duration |
| `electron/ai-edition/visualEvidence/prepare.ts` | `maxFrames` / `skipVisualAttachment` |
| `electron/ai-edition/deep-agent/service.ts` | Wire retrieval packing + telemetry |
| `electron/ai-edition/videoMemory/retrievalProduction.test.ts` | Unit tests |
| `…/videoMemoryRetrievalProduction/*.runtime.test.ts` | Live A/B + follow-up + invariants |

---

## 5. Source vs programme memory design

| Domain | Contents | Lifetime |
| ------ | -------- | -------- |
| **Source-asset** | Ledger, claims, speech windows, transitions, temp UI, passive chrome, corrections, contradictions, coverage | Reusable while `fingerprintSourceAsset` matches (id+path+kind) |
| **Programme** | Source Story V2, Target/Gap/Plan-derived packing | Invalid when `fingerprintProgramme` / document fingerprint changes; session returns ledger but clears stale story |

No raw provider prompts or base64 images stored.

---

## 6. Fingerprints / invalidation

- **Source:** sha256(asset id, path, kind) — duration omitted so probe refinement does not break reuse (post-run fix).
- **Programme:** existing `fingerprintDocument`.
- **Asset replace:** session entry deleted.
- **Timeline trim:** source reusable; programme story cleared in session get.

---

## 7. Query classifier

`speech | visual | cross_modal | action_verify | editorial | direct_edit | general`  
Aligned with `MediaContextNeeds` categories where present.

---

## 8. Retrieval contract

`retrieveFromVideoMemory` + `packProviderContextFromMemory` select speech windows, corrections, contradictions, temp UI, passive chrome, compact story beats, target preserve, plan items — **not** full Ledger/Claim JSON.

---

## 9. Frame attachment policy

| Class | maxFrames | Notes |
| ----- | --------: | ----- |
| speech / direct_edit | **0** | Measured: speech RET = 0 images |
| action_verify | 4 | + Investigator deepen |
| visual | 6 | Prefer change boundaries |
| cross_modal | 5 | |
| editorial | 6 | Reasons: `editorial_focus` / `transition_boundary` / `temporary_ui` |

Every attached frame records `FrameAttachReason`. Near-duplicate frames deduped (~0.35s).

---

## 10. Evidence sufficiency / deepen policy

- Speech + windows → **skip Investigator**
- Action verify → **always deepen**
- Editorial cold-start / temp UI without frames / contradictions → deepen
- Bounded existing Investigator V1.1 (no infinite loop; no “send everything” fallback)

---

## 11. Provider context packing

Sections labeled **REQUESTED / KNOWN / SPOKEN / CONTRADICTED / UNKNOWN / PRESERVE / SUPPORTED**. Soft cap ~12k chars. Soften/epistemic instructions retained (Restart ≠ restarted, Settings speech ≠ opened, passive chrome ≠ workflow).

---

## 12. Follow-up reuse results

Same recording, retrieval packing, shared session store:

| Turn | Query | inputTokens | images | Investigator | Notes |
| ---- | ----- | ----------: | -----: | ------------ | ----- |
| F1 | visual | 19884 | 5 | no | Understanding |
| F2 | speech | **12276** | **0** | no | Major cut vs F1 multimodal |
| F3 | action_verify | 20119 | 4 | **yes** | Correctly deepened; Settings not claimed open |
| F4 | editorial | 23446 | 6 | yes | Professional + preserve |

`sourceMemoryHit`/`sessionReuse` were **false** in this run (duration in fingerprint). **Fixed afterward.** Token/image drop on F2 still occurred via **query-aware frame budget**, not ledger skip. STT disk cache warmed across turns.

---

## 13. A/B results

All A/B pairs **completed** on narrated short clip. Retrieval answers remained grounded (speech quote near end; Cursor frontmost; Chrome/Upwork as background; editorial trim ranges / distraction reduction rather than generic “add zooms everywhere”).

Quality judgment (manual, short previews): **equivalent for speech and visual**; editorial retrieval stayed recording-specific (trim ranges, Cursor focus, background chrome caution). Not a full Case 020 zoom TPM re-score this run.

---

## 14. Real corpus results

| Case | Run? | Result |
| ---- | ---- | ------ |
| Narrated (case-001) | Yes — A/B + F1–F4 | Completed |
| Case 4 correction | Yes — INV_CASE4 | completed, invariantOk |
| Restart | Yes — INV_RESTART | **provider_error** — NOT_VERIFIED |
| Upwork | Yes | completed, invariantOk |
| Settings | Yes | completed, invariantOk |
| Case 020 zoom | **Not separate** | Covered only via editorial/shorter prompts on short narrated clip |
| Professional / shorter | Yes A/B | Completed |
| Speech / visual | Yes A/B | Completed |
| Cross-modal dedicated | **Not separate row** | F3/F4 partial; full cross-modal A/B NOT_VERIFIED |

---

## 15–18. Invariants

| Guard | Result |
| ----- | ------ |
| Restart | **NOT_VERIFIED** (provider_error, empty text; no false restart claim in empty body) |
| Upwork | **PASS** (invariantOk) |
| Settings | **PASS** (invariantOk; F3 also refused open claim) |
| Case 4 | **PASS** (invariantOk; no false opened Timeline/Effects) |

---

## 19. Editorial quality results

Retrieval editorial/shorter previews: recording-specific (Cursor, audit narration, trim windows, background tabs as distraction). Did **not** collapse into unsupported “add zooms/transitions everywhere” in measured previews. FULL path similarly restrained (Recovery 4). **Manual gate: no material regression observed on this clip; broader corpus still needed before promote.**

---

## 20–24. Comparisons

| Metric | FULL (editorial) | RETRIEVAL (editorial) |
| ------ | ---------------: | --------------------: |
| inputTokens | ~34644 | ~23129 |
| images | 13 | 6 |
| est. USD | ~0.088 | ~0.057 |
| provider calls | 1 | 1 |
| Latency | tens of seconds (provider-dominated) | typically lower payload; still multi-10s |

Speech: **0 images** on retrieval (hard requirement met).

≥60% reduction: **not achieved** on visual/editorial (system+tools floor).

---

## 25. Cache behavior

- STT disk cache: warm across turns (low sttMs after first).
- Visual extract: fewer candidates under budget.
- Session store: implemented; live hit metrics false until fingerprint fix; unit tests cover isolation + trim invalidation.

---

## 26. Tests

- 25+ unit tests in `videoMemory` (frame budget, reasons, sufficiency, packing epistemic language, session isolation, trim invalidation, no doc mutation).
- Runtime harness: 16 rows written under `tmp/perception-benchmark/video-memory-retrieval-production-v1/`.

---

## 27. Regressions

- None observed on Upwork/Settings/Case4.
- Restart delivery failure this run (provider) — treat as delivery flake / NOT_VERIFIED, not as epistemic pass.
- Session reuse metric incorrect until fingerprint fix (code fixed; re-measure pending).

---

## 28. Remaining limitations

1. System snapshot + tool schemas still ~fixed tax → hard to hit 60% on short clips once images are already cut.  
2. Default still FULL_CONTEXT.  
3. Case 020 / long-clip TPM A/B not re-run.  
4. Cross-modal dedicated A/B incomplete.  
5. Session reuse needs a follow-up live confirmation after fingerprint fix.  
6. Investigator skip on speech is correct for sufficiency but must never skip action_verify (enforced).

---

## 29. Should retrieval path be promoted?

**DO_NOT_PROMOTE** as the app default.

Reasons: efficiency gate unmet for editorial; Restart NOT_VERIFIED; session reuse not proven live; system/tool tax untouched.

**Keep available** behind `contextPacking: "VIDEO_MEMORY_RETRIEVAL"` / env for continued A/B.

---

## 30. Model bake-off readiness?

**NOT_READY.**

Blockers: (1) default path still FULL_CONTEXT, (2) bake-off would still be confounded by system/tool tax unless both candidates use the same retrieval packing, (3) Restart + longer-clip validation incomplete, (4) session reuse confirmation pending.

When ready: freeze retrieval packing, require telemetry, score grounding/unsupported-action before cost, then compare cloud vs self-hosted **on VIDEO_MEMORY_RETRIEVAL only**.

---

## Architecture map (post-change)

```text
computed each turn: needs, query class, STT (cacheable), frames (budgeted), ledger, claims,
                    optional Investigator, Source/Target/Gap/Plan (local), packed or full prompt
persisted/reusable: STT disk cache, visual frame disk cache, session source memory (ledger/claims/index)
recomputed: programme story/plan when document fingerprint changes; Investigator when sufficiency fails
reaches provider: system+tools+history + (FULL stacked briefings+many JPEGs | RET packed context+budgeted JPEGs)
local only: ledger/claims objects, Gap/Plan/Proposal objects, consent/apply/verify
invalidates after timeline edits: programme-derived story in session; source perception retained
```

---

## Final decision

```text
PASS_WITH_LIMITATIONS

PRODUCTION_RETRIEVAL_PROMOTION:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY
```

**STOP.** No model bake-off. No further recovery milestone. No autonomy expansion.
