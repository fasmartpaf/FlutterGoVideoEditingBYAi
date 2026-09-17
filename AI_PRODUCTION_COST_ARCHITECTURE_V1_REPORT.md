# OpenScreen — Production AI Cost Architecture V1

**Identity:** `CURRENT_OPENSCREEN_PRODUCTION_COST_ARCHITECTURE_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/production-cost-architecture-v1/`  
**Paid provider generation this milestone:** **0**

This is an architecture / economics design milestone. Editorial quality remains the first priority. We do **not** promote Retrieval/Compact, run the paid matrix, download models, or weaken epistemic safeguards.

---

## 1. Executive answer

**Why do short videos cost 12k–35k tokens today?**

Because the default path (`CURRENT_FULL_CONTEXT`) pays a **fixed control tax** every turn (~23.5k-char system + ~16.8k-char tool schemas) **plus** a large multimodal evidence blob (FULL ~13 JPEGs ≈ ~10k est. image tokens) — even though OpenScreen already computed Ledger, Claims, Investigator, Story, Gap, and Plan **locally for $0 LLM**.

**What actually needs expensive model intelligence?**

Nuanced multimodal editorial judgment, ambiguous visual interpretation, and hard cross-modal reasoning (**T3**). Not STT, not frame extract, not Investigator, not Claim Promotion, not Apply, not Verify.

**What should scale with users?**

`DEEP_REASONING_CALLS_PER_SESSION × tokens/images × users` — **not** “rebuild the whole video every follow-up.”

Video Memory + Retrieval packing are the right **direction**, but quality gates are incomplete → **DO_NOT_PROMOTE**, **PAID_MATRIX: KEEP_PAUSED**, **MODEL_BAKEOFF: NOT_READY**.

---

## 2. Current pipeline (from code)

See `architecture-current.json` / `.md`.

Critical fact: **Investigator / Visual Specialist / Claim Promotion / Source·Target prepare / Gap / Plan / Closure / Proposal / STT / ffmpeg = 0 extra provider calls.**  
Story JSON may be emitted **inside** the same agent turn — still not a second service.

Typical paid surface: **`invokeOpenScreenAgent` → `streamEvents`** (min 1 call; typical 1–3; worst tool-loop with `recursionLimit: 1000`).

Optional extras: caption translate batches; manual chat compact; settings model list (MiniMax probes).

**No embeddings APIs. No remote Whisper.**

---

## 3. Provider-call graph

See `provider-call-graph.json`.

| Metric | Value (from code) |
| ------ | ----------------- |
| MIN_PROVIDER_CALLS_PER_TURN | **1** |
| TYPICAL_PROVIDER_CALLS_PER_TURN | **1–3** |
| WORST_CASE_PROVIDER_CALLS_PER_TURN | tool-loop many + optional caption batches |

---

## 4. Token attribution (existing telemetry)

See `token-attribution.json`. Precision labels: EXACT / MEASURED_APPROXIMATION / UNKNOWN.

### FULL visual turn (Context Audit probe-B)

| Contributor | Size | Precision |
| ----------- | ---- | --------- |
| EXACT provider inputTokens | **34 202** | EXACT |
| Images (13 JPEG) est. | ~9 945 tok | MEASURED_APPROX |
| Multimodal user text | ~8 778 est | MEASURED_APPROX |
| System | ~5 919 est (23 676 chars) | MEASURED_APPROX |
| Tool schemas | ~4 190 est (16 759 chars) | MEASURED_APPROX |
| Trusted editorial briefing | ~160 est | MEASURED_APPROX |
| Ledger / Claims / full Source Story objects | ~5k+ est each | LOCAL_ONLY (not dumped wholesale) |

### Mode comparison (Gate V2 EXACT)

| Class | FULL | RETRIEVAL | COMPACT |
| ----- | ---: | --------: | ------: |
| Speech | 15 613 | 12 089 | 3 022 |
| Visual | 34 281 | 20 063 | 10 973 |
| Editorial | 34 660 | 23 281 | 19 686 |

Images: FULL speech 4 / visual-editorial 13; RET/COMPACT speech **0**, visual/editorial **5**.

**Largest provider-facing drivers (ranked):**

1. Multimodal images under FULL  
2. Fixed system + tool-schema tax  
3. Large multimodal user evidence text under FULL  
4. Editorial packed briefing under RET (still << FULL)  
5. Tool-loop extra calls (when they happen)

---

## 5. Cognition duplication

See `cognition-duplication-audit.json`.

Local layers are **valuable**. The cost bug is **serializing too much control surface + raw evidence** to the provider every turn, not having Ledger/Claims at all.

FULL also still teaches a long tool-recipe essay that **typed schemas + mutationAuthority already enforce**.

---

## 6. Intelligence tiers

See `intelligence-tier-matrix.json`.

| Tier | Role |
| ---- | ---- |
| T0 | Deterministic editor / apply / verify |
| T1 | Cached perception + memory retrieval |
| T2 | Bounded semantic verification |
| T3 | Deep multimodal editorial |

Apply after consent is **T0 / LOCAL_ONLY** — the model must not be mandatory to press Apply.

---

## 7. Video Memory production value

See `video-memory-production-design.json`.

Foundations exist (source/programme fingerprints, session reuse, packProviderContext). Not yet durable `.openscreen` persistence.

**Production value: HIGH** — measured follow-ups drop to ~12k speech with 0 images when memory hits (RESUME_F2).

Compute once: STT, frame pool, ledger, investigator, claims, source story.  
Invalidate programme on timeline mutation; source survives.

---

## 8. Query → evidence → reasoning policy

See `query-evidence-reasoning-policy.json` (design only; not implemented this milestone).

---

## 9. Model boundary / ReasoningPacket

See `reasoning-packet-design.json`.

**PROVIDER_AS_REASONER_NOT_ENGINE: RECOMMENDED**

Packet = intent + selected evidence + known/unknown + preserve + trusted plan briefing + phase.  
Not the entire debug universe.

**BOUNDED_REASONING_PACKET: RECOMMENDED**

---

## 10. Tool schema + system prompt audits

See `tool-schema-cost-audit.md`, `system-prompt-cost-audit.md`.

Phase packing (design): UNDERSTAND ~2.4k schema chars vs FULL ~16.8k.

**PHASE_SPECIFIC_TOOL_PACKING: RECOMMENDED** (do not ship yet).

Epistemic invariants must survive any prompt shrink.

---

## 11. Follow-up economics

See `follow-up-economics.json`.

Key metric: **NEW_REASONING_COST_PER_FOLLOWUP**, not FULL_VIDEO_COST_PER_FOLLOWUP.

Turn 5 “apply the safe change” → **0 provider calls** if consent/apply stays local.

---

## 12. Cost model & scale

See `costModel.ts`, `cost-model.json`, `cost-model.md`.

Assumptions exposed: gpt-4o audit pricing; 4 sessions/user/month; measured Gate V2 turn shapes.

| Profile | $/session | 10k users ×4 sess/mo |
| ------- | --------: | -------------------: |
| LIGHT | ~$0.06 | ~$2.5k |
| STANDARD | ~$0.12 | ~$4.9k |
| HEAVY | ~$0.32 | ~$12.8k |
| BAD_CURRENT (5× FULL visual) | ~$0.44 | ~$17.6k |
| TARGET_MEMORY_FIRST | ~$0.15 | ~$6.1k |

**Dev usage cited by product owner (~4.96M tokens / ~$12.57 / ~232 requests)** is consistent with repeated FULL-class turns on a low TPM tier — not with “STT is expensive” (STT is local).

Also: org TPM **30k** makes FULL ~34k requests structurally painful (Stability Resume V1).

---

## 13. Economic metrics to track

- PROVIDER_CALLS_PER_SESSION  
- DEEP_REASONING_CALLS_PER_SESSION  
- INPUT_TOKENS_PER_SESSION  
- IMAGE_ATTACHMENTS_PER_SESSION  
- CACHE_HIT_RATE / SOURCE_MEMORY_REUSE_RATE / PROGRAMME_MEMORY_REUSE_RATE  
- COST_PER_SESSION / COST_PER_COMPLETED_EDIT / COST_PER_SUCCESSFUL_EDITORIAL_DECISION  

---

## 14. Quality guardrail

See `quality-cost-guardrail.md`.

Cheaper path promotes only if **QUALITY ≥ baseline AND cost materially improves**.

---

## 15. Self-hosted boundary (no download)

| Candidates later | Stay frontier multimodal (likely) |
| ---------------- | --------------------------------- |
| routing classifiers | whole-video editorial judgment |
| embeddings/rerank if added | ambiguous visuals |
| transcript utilities | hard cross-modal cases |

**SELF_HOSTED_MODEL_REQUIRED_NOW: NO**

---

## 16. Target architecture

See `target-architecture.md`.

Local perception → persistent memory → router → retrieval → sufficiency → local fast path **or** ReasoningPacket → model reasoner → local safety → consent → apply → verify.

---

## 17. Migration plan (ordered)

See `migration-plan.json`.

**Next:** complete provider quality gate (**G**) with TPM-aware pacing → then ReasoningPacket (**B**) / phase tools (**C**) / prompt decomposition (**D**) under the quality guardrail → freeze → bake-off (**H**) → long-form (**I**).

---

## 18. Rejected fake savings

- Slash frames to 1 without sufficiency  
- Blind transcript truncation  
- Delete epistemic instructions  
- Disable Investigator for cost  
- Unverified tiny models  
- Char counts sold as billed tokens  
- Local CPU work counted as OpenAI savings  

---

## 19. Final decisions

```text
CURRENT_COST_ARCHITECTURE:
UNSUSTAINABLE

PRIMARY_COST_DRIVERS:
1. CURRENT_FULL_CONTEXT multimodal images + large user evidence blob (~34k-class turns)
2. Fixed system (~23.5k chars) + tool schemas (~16.8k chars) on every deep turn
3. Rebuilding / re-sending deep context on follow-ups when memory should answer
4. Tool-loop extra provider calls on mutating agent turns
5. Account TPM ceiling (30k) amplifying FULL failure/retry waste

UNNECESSARY_PROVIDER_WORK:
1. Paying FULL 13-frame packs for speech / many follow-ups
2. Exposing 35 mutate schemas to understand/speech turns
3. Re-teaching tool recipes already in schemas + mutationAuthority
4. Re-running deep editorial when user only adds a preserve constraint
5. Using the model as the apply/verify engine

LOCAL_DETERMINISTIC_OPPORTUNITY:
HIGH

VIDEO_MEMORY_PRODUCTION_VALUE:
HIGH

BOUNDED_REASONING_PACKET:
RECOMMENDED

PHASE_SPECIFIC_TOOL_PACKING:
RECOMMENDED

PROVIDER_AS_REASONER_NOT_ENGINE:
RECOMMENDED

SELF_HOSTED_MODEL_REQUIRED_NOW:
NO

RETRIEVAL_PROMOTION:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY

PAID_MATRIX:
KEEP_PAUSED
```

---

## 20. Hard stop

No implementation of the target architecture. No paid matrix. No model download. No bake-off. No Retrieval/Compact promotion. Bring this package to CTO review.
