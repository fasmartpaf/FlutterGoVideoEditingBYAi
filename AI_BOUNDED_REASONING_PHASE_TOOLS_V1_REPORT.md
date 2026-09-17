# OpenScreen — Bounded Reasoning Packet + Phase Tool Exposure V1

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/bounded-reasoning-phase-tools-v1/`  
**Paid provider generation this milestone:** **0** (`PAID_SMOKE: NOT_RUN`)

Experimental path only. Defaults unchanged: `CURRENT_FULL_CONTEXT`. Retrieval/Compact unchanged and **not** promoted.

---

## 1. Executive verdict

`PASS_WITH_LIMITATIONS`

Shipped an opt-in packing mode that:

1. Builds a typed **ReasoningPacketV1** from canonical local evidence (**0 LLM** to construct)
2. Exposes tools by **cognition phase** (UNDERSTAND/PLAN/PROPOSE/APPLY/VERIFY)
3. Uses **CORE_INVARIANTS + phase policy** instead of the ~23.5k FULL system essay
4. Replaces the giant open-project JSON with a **bounded projection** (~313 chars vs ~6.5k sample snapshot)
5. Keeps mutationAuthority / consent / apply / verify authoritative

Offline matrix A–J: **10/10** mutation invariants pass; providerCalls=0.  
Paid smoke **not run** (external health probe blocked in-session; avoid TPM burn before CTO review of offline numbers).

---

## 2. Before provider surface

See `reasoning-packet-before-map.json`.

---

## 3. Cognition phase architecture

Module: `electron/ai-edition/reasoningPacket/phase.ts`

| Phase | Role |
| ----- | ---- |
| UNDERSTAND | Inspect / answer |
| PLAN | Editorial strategy (no mutate schemas) |
| PROPOSE | Proposal language (schemas ok; authority refuses writes) |
| APPLY | Fast-path skip provider — consent/applyPreview |
| VERIFY | Fast-path skip provider — local verify |

Not five agents — one phase state per turn.

---

## 4. Tool-family mapping

`toolFamilies.ts` — hard invariant proven in unit tests:

- UNDERSTAND/PLAN/APPLY/VERIFY: **0 mutating tools**
- PROPOSE: mutate schemas allowed for naming only
- APPLY/VERIFY: **0 tools**

---

## 5–6. ReasoningPacket contract + canonical mapping

`buildPacket.ts` / `serialize.ts` — projects known/spoken/supported/contradicted/unknown + selected speech/visual + preserve + editorial briefing. Full Ledger/Claims/Story stay local.

---

## 7. System prompt decomposition

`systemPolicy.ts` — CORE_INVARIANTS retain Restart/Upwork/Settings/correction/speech≠visual rules. Phase policy appended. Legacy tool recipes **not** included on Bounded path.

---

## 8. Project snapshot reduction

Offline sample: full snapshot **6476** chars → bounded projection **~313** chars (~95% smaller on that fixture). Fields removed listed in `buildBoundedProjectProjection`.

---

## 9. History policy

`historyPolicy.ts` — constraint-like user turns only; no LLM summarizer. Bounded agent messages = current turn only (constraints inside packet).

---

## 10. Fast paths

`IMPLEMENTED_SAFE_SUBSET`: APPLY + VERIFY skip provider. Aspect/background exact edits remain **candidate_unshipped** (existing deterministicEdit path).

---

## 11. Evidence sufficiency

Packet carries `packetEvidenceSufficient` / `missingEvidenceKinds`. Offline stubs without memory correctly flag speech insufficiency when windows absent; live path still uses Retrieval frame selection + Investigator sufficiency.

---

## 12. Offline real-case matrix

See `offline-matrix.json`.

| Case | Phase | Tools | Sys+tool+proj+packet chars | Images |
| ---- | ----- | ----: | -------------------------: | -----: |
| A speech | UNDERSTAND | 5 | ~2460 | 0 |
| B visual | UNDERSTAND | 5 | ~2566 | 1 stub |
| C cross | UNDERSTAND | 5 | ~2651 | 1 |
| D professional | PLAN | 3 | ~2808 | 1 |
| E shorter | PROPOSE | 28 | ~3813 | 1 |
| F zoom | PLAN | 3 | ~2817 | 1 |
| G–J | UNDERSTAND | 5 | ~2.5–2.7k | 0–1 |

All `mutationInvariantOk=true`, `providerCalls=0`.

---

## 13. Safety regressions (local)

| Check | Result |
| ----- | ------ |
| Restart/Upwork/Settings text in CORE_INVARIANTS | PASS |
| UNDERSTAND cannot mutate | PASS |
| PLAN cannot mutate | PASS |
| PROPOSE proposal-only (authority unchanged) | PASS |
| APPLY/VERIFY no tools + skip provider | PASS |
| Production default still FULL | PASS |

---

## 14. Token/context comparison (`ESTIMATED_ONLY`)

See `token-comparison-estimated.json`.

Control surface (system+tools): FULL ~40.4k chars → Bounded UNDERSTAND ~1.7k chars → **~95.8% reduction**.

Total billed tokens still image-dominated on visual turns (live Bounded reuses Retrieval frame budgets). Do not claim EXACT billed savings without paid smoke.

**OFFLINE_CONTEXT_REDUCTION:** ~90–96% on provider control surface (system+tools); overall turn ESTIMATED_ONLY pending images.

---

## 15. Provider-call comparison

| Path | Typical |
| ---- | ------- |
| FULL/RET/COMPACT | 1–3 |
| Bounded UNDERSTAND/PLAN/PROPOSE | target **1** |
| Bounded APPLY/VERIFY | **0** |

---

## 16–18. Paid smoke / cost / quality

**NOT_RUN** — offline complete; external health probe not executed in this session. No answer patching.

---

## 19. Files changed

- `electron/ai-edition/reasoningPacket/*` (new)
- `electron/ai-edition/videoMemory/productionPath.ts` (add mode)
- `electron/ai-edition/deep-agent/service.ts` (opt-in wire)
- `electron/ai-edition/perceptionBenchmark/boundedReasoningPhaseTools/*`
- tests: `reasoningPacket.test.ts`, `bounded-reasoning-offline.runtime.test.ts`

---

## 20. Tests

Unit 9/9 + offline 1/1 passed. Provider calls in offline tests: **0**.

---

## 21. Remaining limitations

- Live packet quality vs FULL/RET not provider-proven
- Offline matrix uses stub memory/frames (sufficiency flags noisy without STT)
- PROPOSE still exposes ~28 mutate schemas (intentional)
- Image token cost remains for visual/editorial
- Org TPM 30k still constrains FULL; Bounded helps control tax but images matter

---

## 22. Production recommendation

**DO_NOT_PROMOTE.** Keep experimental. Next: TPM-aware ≤6 paid smoke, then CTO review.

---

## 23. Next milestone

1. Bounded paid smoke (≤6) with diagnostics  
2. ReasoningPacket fill from live memory on real corpus  
3. Only then consider default freeze / bake-off  

---

## Final decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

BOUNDED_REASONING_PACKET:
PASS

PHASE_SPECIFIC_TOOL_EXPOSURE:
PASS

SYSTEM_PROMPT_DECOMPOSITION:
PASS

PROJECT_SNAPSHOT_REDUCTION:
PASS

DETERMINISTIC_FAST_PATHS:
IMPLEMENTED_SAFE_SUBSET

EPISTEMIC_INVARIANTS:
PASS

MUTATION_AUTHORITY:
PASS

OFFLINE_CONTEXT_REDUCTION:
~90-96% control-surface (system+tools) vs FULL; total-turn ESTIMATED_ONLY

PAID_SMOKE:
NOT_RUN

PRODUCTION_DEFAULT:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY

PAID_MATRIX:
KEEP_PAUSED
```
