# OpenScreen — Bounded Editorial Reasoning Over Temporal Context V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_BOUNDED_EDITORIAL_REASONING_OVER_TEMPORAL_CONTEXT_V1`  
**Code:** `electron/ai-edition/boundedEditorialReasoning/`  
**Artifacts:** `tmp/perception-benchmark/bounded-editorial-reasoning-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** OpenScreen can accept a broad goal (e.g. “make this professional”), load a bounded `TemporalReasoningPacketV1`, run a **provider-neutral** editorial reasoner, validate evidence binding, and emit a small reviewable `ReasonedEditorialRecommendationSetV1` — without rediscovering video, inventing geometry, exposing mutation tools, or auto-applying edits.

Primary path is the **DeterministicEditorialReasoningProviderV1** (zero model). A **GenericLocalChat** OpenAI-compatible localhost adapter is implemented; **LOCAL_MODEL_LIVE_TEST = NOT_RUN** (no local endpoint assumed). Paid cloud providers are interface-ready but not executed.

---

## 2. Previous reasoning audit

See `reasoning-architecture-audit.json`.

| Component | Class |
|-----------|--------|
| TemporalReasoningPacketV1 / Context Store | **REUSE** |
| Editorial orchestration + precision surface | **REUSE** |
| reasoningPacket phase/sufficiency/decisionKinds | **ADAPT** |
| deep-agent FULL LangGraph + giant tools | **DO_NOT_REUSE** |
| agent-tools mutation schemas to model | **DO_NOT_REUSE** |
| Source/Target/Gap/Plan/Proposal chain | **LEGACY_COMPAT** |

---

## 3. Provider abstraction

`EditorialReasoningProviderV1`: DETERMINISTIC | LOCAL_MODEL | LOCAL_SERVER | REMOTE_SERVER | COMMERCIAL_PROVIDER.

No editing tool schemas exposed. Capabilities describe structured text only for V1.

---

## 4. Request contract

`EditorialReasoningRequestV1`: goal, packet, currentRecommendations, unresolvedQuestions, constraints, allowed families, maxDecisions, knownEvidenceIds, coverage, optional followUp.

---

## 5. Goal normalization

Deterministic (`goals.ts`): MAKE_PROFESSIONAL / MAKE_TIGHTER / IMPROVE_CLARITY / IMPROVE_ACCESSIBILITY / CUSTOM_TEXT. No LLM for obvious phrases.

---

## 6. Response contract

`EditorialReasoningResponseV1` + `EditorialDecisionV1` (INCLUDE | EXCLUDE | OPTIONAL | ASK_USER | NO_ACTION). No raw mutation payloads.

---

## 7. Evidence binding

Every decision must cite known Temporal Context / orchestration evidence IDs. Unknown / missing refs → invalid.

---

## 8. Coverage / epistemic restraint

OCR NOT_AVAILABLE blocks OCR-style claims. Zoom without focal targets cannot INCLUDE. Heuristic cannot be upgraded to fabricated “observed UI” claims (Case4 guard).

---

## 9. Bounded packet usage

Reasoner consumes `store.buildTemporalReasoningPacketV1` (SUMMARY/STANDARD/DETAILED). No full video / frame dump / giant transcript.

---

## 10. Invariants

`CORE_EDITORIAL_INVARIANTS` (~small char count in `invariants.json`). Not a 20k tool manual.

---

## 11. Deterministic provider

Goal-aware selection over existing recommendations:

- PROFESSIONAL → safe TRIM + LOUDNESS INCLUDE; CAPTIONS OPTIONAL  
- TIGHTER → TRIM INCLUDE; exclude loudness/captions  
- ACCESSIBILITY → CAPTIONS INCLUDE  
- Ambiguous visual → ASK_USER / questions, not invented zoom  

---

## 12. Local / server adapter design

`createLocalChatEditorialReasoningProvider` → configurable OpenAI-compatible `baseUrl` (Ollama / vLLM / TGI-compatible later). Not coupled to proprietary cloud APIs.

---

## 13. Fallback

Timeout / unavailable / invalid schema → **Deterministic**. Never silent paid fallback (`fallback-policy.json`).

---

## 14. Validator

`validateEditorialReasoningResponseV1`: schema, known IDs, families, geometry honesty, coverage overclaim, preservation overlap, no mutation payloads.

---

## 15. Reconciliation

`reconcileReasonedRecommendations`: reasoner may narrow/prioritize; cannot override preservation, missing geometry, unsupported capability. Deterministic safety wins → `ReasonedEditorialRecommendationSetV1`.

---

## 16. Make-professional

bug5: includes safe trim (+ loudness when present); captions optional; no invented zoom.

---

## 17. Make-tighter

Prioritizes trim; excludes loudness/captions for duration goal.

---

## 18. Case4

No “effects panel” hallucination. Correction preserved as question/preservation context.

---

## 19. Case020

No fabricated zoom. ASK_USER / leave untouched via questions.

---

## 20. Already-good

NO_ACTION (or empty recommendations). No manufactured work.

---

## 21. Conflict

Preservation blocks trim; validator rejects INCLUDE-over-protect attempts.

---

## 22. Follow-up

Selected recommendation explanation via `followUp` + SUMMARY/DETAILED range packet. Typed support in session/store.

---

## 23. Selected-range reasoning

DETAILED packet when `requestedRange` set — not whole-video dump.

---

## 24. Local model test

**LOCAL_MODEL_LIVE_TEST = NOT_RUN** (adapter present; no live local runtime required for architecture PASS).

---

## 25. Reasoning-value review

`reasoning-value-review.json`: **POSITIVE** — goal filtering narrows recommendations (e.g. MAKE_TIGHTER drops loudness), preserves do-nothing / ask-user for weak visuals. Not human-editor parity.

---

## 26. Manual quality

`manual-review.json`: decision precision ≥ 0.8 on corpus labels; UNSUPPORTED/UNSAFE = 0 for deterministic path.

---

## 27. Prompt / control-surface size

Invariants ≪ old FULL (~23.5k). Packet + small request + invariants only (`prompt-size.json`: `much_smaller_than_old_full`).

---

## 28. Performance

Deterministic path: local CPU only; latency recorded in providerMetadata. Decode passes: 0. Paid calls: 0.

---

## 29. Tests

`boundedEditorialReasoningV1.test.ts`: goals, fallback, evidence rejection, zoom restraint, corpus cases, follow-up, local adapter smoke, zero paid AI.

---

## 30. Paid AI proof

```json
{ "TOTAL_PAID_AI_CALLS": 0, "AUTO_MUTATIONS": 0 }
```

---

## 31. Limitations

- Deterministic reasoner is policy heuristics, not deep semantic taste  
- Local model quality unmeasured (NOT_RUN)  
- No product UI / no multi-edit apply  
- Does not revive FULL tool-loop cognition  
- New recommendation families still blocked without evidence + readiness  

---

## 32. Readiness for product integration

**READY_FOR_PRODUCT_INTEGRATION** of the *reasoning decision surface* (review cards from reasoned set). UI wiring is the next milestone — not done here.

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
PROVIDER_ABSTRACTION: PASS
GOAL_NORMALIZATION: PASS
BOUNDED_REASONING_REQUEST: PASS
EVIDENCE_BINDING: PASS
COVERAGE_RESTRAINT: PASS
OUTPUT_VALIDATION: PASS
DETERMINISTIC_SAFETY_PRECEDENCE: PASS
MAKE_PROFESSIONAL_REASONING: PASS
MAKE_TIGHTER_REASONING: PASS
CASE4_HALLUCINATION_SAFETY: PASS
CASE020_ZOOM_RESTRAINT: PASS
ALREADY_GOOD_NO_ACTION: PASS
CONFLICT_PRESERVATION: PASS
FOLLOW_UP_REASONING: PASS
LOCAL_MODEL_ADAPTER: PASS
LOCAL_MODEL_LIVE_TEST: NOT_RUN
SELF_HOSTED_SERVER_COMPATIBILITY: YES
REASONING_VALUE_OVER_DETERMINISTIC: POSITIVE
MANUAL_DECISION_PRECISION: 1.000
PROVIDER_INPUT_SIZE_VS_OLD_FULL: ~3.1k vs ~23.5k (much_smaller_than_old_full)
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
BOUNDED_EDITORIAL_REASONING_V1: READY_FOR_PRODUCT_INTEGRATION
NEXT_MILESTONE: editorial_recommendation_product_surface_v1
```

HARD STOP.
