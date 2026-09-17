# OpenScreen — Bounded Reasoning Reliability V2

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1` (Reliability V2)  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/bounded-reasoning-reliability-v2/`  
**Prior:** `AI_BOUNDED_REASONING_LIVE_SMOKE_V1_REPORT.md`  
**Default packing:** unchanged (`CURRENT_FULL_CONTEXT`). **DO_NOT_PROMOTE.**

---

## 1. Executive verdict

`PASS_WITH_LIMITATIONS`

Reliability V2 fixed the **architecture contracts** that broke V1 smoke:

| Contract | Offline | Live |
| -------- | ------- | ---- |
| Modality requirements (listen/correction → speech+visual) | PASS | PASS (Case4 STT ran) |
| Sufficiency cannot be true when speech `not_requested` | PASS | PASS |
| 0 tools when packet sufficient | PASS | PASS (all 6 calls) |
| 1 model call per case (budget 6) | — | **PASS (6×1)** |
| Cross-modal typed relations | PASS | PARTIAL (model quality) |
| Case4 correction scaffold | PASS | **PASS** |
| Focal-target candidates | PASS | PARTIAL (model skipped eval) |
| Settings epistemic | — | **PASS** |

Live quality is still **not promotion-ready**: Call 1 packet never reached the model (append bug), Call 2 still invents “no audio,” Call 5 is generic editorial.

---

## 2. Root causes from V1

1. Listen/correction language hit visual-only families → `speechStatus=not_requested`
2. Sufficiency used queryClass only → true with empty speech
3. UNDERSTAND always exposed 5 read tools → tool loops burned the 6-call budget
4. Cross-modal packet listed modalities independently → model asserted agreement
5. Focal OCR present but no candidate contract → soft decline without evaluation

---

## 3. Modality requirement architecture

New: `reasoningPacket/requiredModalities.ts`  
Also expanded `mediaContextNeeds/classify.ts` phrase families (`listen`, `what I first say`, `correct myself`, listen↔screen).

`resolveRequiredModalities` is separate from `queryClass`. Bounded path merges into `MediaContextNeeds` **before** STT/visual prepare.

---

## 4. Sufficiency contract

`reasoningPacket/sufficiency.ts` — modality states including `NOT_REQUESTED_BUG`.

`packetEvidenceSufficient=true` only if every required modality is sufficient / N/A.  
`speech required + not_requested` → **insufficient** (offline D_case4_not_requested_must_fail).

---

## 5. Media-state semantics

Preserved distinct states: `available | no_audio | no_speech_detected | unavailable | failed | not_requested`.  
Unknown notes must not equate `not_requested` with `no_audio`.

---

## 6–7. Packet self-containment + tool-loop discipline

`toolPolicy.ts`: sufficient UNDERSTAND/PLAN → **tools=[]**.  
Live: all six calls `toolCount=0`, `modelCalls=1`, `toolLoopCount=0`.  
Optional `maxProviderModelCalls: 1` aborts extra generations.

---

## 8. Cross-modal relationship model

`crossModal.ts` emits `CrossModalEvidenceRelation` with  
`VERIFIED_MATCH | POSSIBLE_MATCH | NOT_VISUALLY_VERIFIED | CONTRADICTED | UNKNOWN`.  
Default for action-like speech: **NOT_VISUALLY_VERIFIED**.  
Phase policy forbids “no discrepancy” when unverified.

---

## 9. Case4 correction model

`correctionScaffold.ts` — initial / marker / corrected, visual=`NOT_VERIFIED`.  
Live Call 3: spoken Timeline → correction → Effects; panels not confirmed open. **PASS.**

---

## 10. Focal-target contract

`focalTargets.ts` — candidates from editorial_focus / OCR / coverage.  
Live Call 4: 8 candidates in packet; model did not score them. **PARTIAL.**

---

## 11. Offline matrix

A–J offline: **PASS** (see `offline-matrix.json`). Provider calls: **0**.

---

## 12. Token estimates (offline ESTIMATED_ONLY)

Zero-tool sufficient packets shrink control surface further vs V1 live (system+tools).  
See `token-estimates.json`. Live actuals below.

---

## 13–14. Paid smoke + call-by-call

Health: green. **6 model calls total** (exactly one per case).

| Call | In tokens | Images | Tools | ModelCalls | Quality |
| ---- | --------- | ------ | ----- | ---------- | ------- |
| 1 Speech | **419** | 0 | 0 | 1 | **FAIL** — packet not delivered to provider |
| 2 Cross-modal | 8160 | 5 | 0 | 1 | **PARTIAL** — invents “no audio” |
| 3 Case4 | 10490 | 6 | 0 | 1 | **PASS** |
| 4 Case020 zoom | 10572 | 6 | 0 | 1 | **PARTIAL** — no per-candidate zoom eval |
| 5 Professional | 10310 | 6 | 0 | 1 | **FAIL** — generic clutter/audio advice |
| 6 Settings | 8103 | 4 | 0 | 1 | **PASS** |

### Critical live finding (Call 1)

Packet JSON shows `speechMediaState=available`, `spoken×3`, `sufficient=true`.  
Provider `inputTokens≈419` ≈ system prompt only.  

**Root cause:** `appendReasoningPacketToUserMessage` returns `{role,content}` objects **unchanged** (only handles `string` / `array`). Speech-only turns use plain `{role:"user", content:string}` → **packet never appended**. Model then echoed the system-policy mention of `not_requested`.

**Not patched in this milestone** (hard stop). Next milestone should fix append + add a regression that asserts provider-bound user text contains `REASONING_PACKET_V1`.

---

## 15. Model-call counts

All completed cases: **1**. Global paid generations: **6**. Discipline: **PASS**.

---

## 16. Cost (ESTIMATED)

gpt-4o list $2.50 / $1.25 cached / $10 per 1M.

| | |
| -- | -- |
| Average / call | ~**$0.021** |
| Total 6 calls | ~**$0.128** |

Speech call under-counted tokens due to missing packet attachment.

Vs historical FULL ~34k visual: live visual/editorial ~8–10.5k (**~69–76% reduction**).

---

## 17. Failures

| Call | Primary layer |
| ---- | ------------- |
| 1 | PACKET_CONSTRUCTION (delivery/append) |
| 2 | MODEL_REASONING |
| 4 | MODEL_REASONING |
| 5 | MODEL_REASONING (generic editorial) |

---

## 18. Remaining limitations

1. Packet append for message objects (blocks speech-only quality)
2. Model may still invent “no audio” despite `available`
3. Focal candidates not forced into answer structure by validator
4. Professional editorial still drifts to generic advice
5. Trusted briefing boilerplate can override focal evaluation on PLAN

---

## 19. Broader validation decision

**NOT_READY** — Case4 + Settings + call discipline succeeded, but Call 1 delivery bug and editorial/cross-modal quality gaps remain.

---

## 20. Next recommendation

1. Fix `appendReasoningPacketToUserMessage` for `{role, content}` (+ tests).  
2. Re-run **≤3** paid calls: speech, cross-modal, professional.  
3. Optional: PLAN response checklist requiring per-focal decisions.  
4. Still **DO_NOT_PROMOTE**; keep paid FULL/RET matrix paused.

---

## Files changed (additive)

- `electron/ai-edition/mediaContextNeeds/classify.ts`
- `electron/ai-edition/reasoningPacket/{requiredModalities,sufficiency,crossModal,correctionScaffold,focalTargets,toolPolicy}.ts`
- `electron/ai-edition/reasoningPacket/{buildPacket,serialize,systemPolicy,types,index}.ts`
- `electron/ai-edition/deep-agent/service.ts` (modality merge, tool policy, maxProviderModelCalls)
- `electron/ai-edition/perceptionBenchmark/boundedReasoningReliabilityV2/*`

---

## Final decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

MODALITY_REQUIREMENT_CONTRACT:
PASS

PACKET_SUFFICIENCY:
PASS

CROSS_MODAL_RELATIONSHIP:
PARTIAL

CASE4_CORRECTION_PACKET:
PASS

FOCAL_TARGET_CONTRACT:
PARTIAL

PACKET_SELF_CONTAINMENT:
PARTIAL

MODEL_CALL_DISCIPLINE:
PASS

EPISTEMIC_INVARIANTS:
PASS

EDITORIAL_SPECIFICITY:
FAIL

ACTUAL_CONTEXT_REDUCTION:
~69–76% vs historical FULL visual/editorial (~8–10.5k vs ~34k); speech call invalid for reduction due to append miss (419 tok)

PAID_SMOKE:
PARTIAL

BROADER_BOUNDED_VALIDATION:
NOT_READY

PRODUCTION_DEFAULT:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY

PAID_MATRIX:
KEEP_PAUSED
```
