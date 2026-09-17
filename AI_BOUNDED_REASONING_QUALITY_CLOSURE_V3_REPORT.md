# OpenScreen — Bounded Reasoning Quality Closure V3

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1`  
**Date:** 2026-09-14  
**Prior:** `AI_BOUNDED_REASONING_RELIABILITY_V2_REPORT.md`  
**Artifacts:** `tmp/perception-benchmark/bounded-reasoning-quality-closure-v3/`  
**Paid generation invocations this milestone:** **2** (hard cap 3; call-3 blocked pre-provider)  
**Default packing unchanged:** `CURRENT_FULL_CONTEXT`. **DO_NOT_PROMOTE.**

---

## 1. Executive verdict

`PASS_WITH_LIMITATIONS`

Closed the V2 **packet delivery** bug and proved it on a live speech turn. Live **cross-modal** no longer collapses `NOT_VISUALLY_VERIFIED` into agreement. **Editorial paid smoke did not run**: self-containment over-required `crossModalRelations` for editorial PLAN when both speech and visual modalities were flagged, despite 12 editorial findings already in the packet.

| Call | Paid? | Quality | Notes |
| ---- | ----- | ------- | ----- |
| 1 Speech | yes (1) | **PASS** | Marker + SELECTED_SPEECH in provider-bound text; 739 input tokens; correct end quote; 0 images; 0 tools |
| 2 Cross-modal | yes (1) | **PASS** | Typed relations present; prose keeps unverified claims unverified; no “no discrepancy” |
| 3 Professional | **no** (blocked) | **BLOCKED** | `bounded_packet_not_self_contained:crossModalRelations` — findings existed; provider correctly not called |

Hard stop honored: **no post-smoke patch**, no 4th paid attempt, no promotion.

---

## 2. What changed (engineering)

### 2.1 Packet delivery (primary V2 failure)

- New helper: `electron/ai-edition/reasoningPacket/packetDelivery.ts`
- Supports: raw string, content arrays, `{role, content:string|array}`, LangChain-like wrappers
- Marker: `REASONING_PACKET_V1`
- Pre-provider invariant: if Bounded media reasoning and packet built but delivery fails → **no provider call** → `bounded_packet_delivery_failed`
- Diagnostics: `providerBoundUserTextPreview`, `packetDelivered`

### 2.2 Cross-modal truth boundary

- Structured `CROSS_MODAL_RELATIONS` in packet serialize path (V2 relations retained)
- Compact instruction: do not promote `UNKNOWN` / `NOT_VISUALLY_VERIFIED` to match
- Deterministic validator: `applyBoundedResponseValidators` downgrades false-agreement prose

### 2.3 Focal-target decision contract

- Offline focal decision tests + packet candidates for zoom/crop/focus PLAN
- Validator flags “no zoom needed” without candidate evaluation sidecar
- **Not exercised on paid smoke** (call set was speech / cross-modal / professional)

### 2.4 Editorial findings + generic-advice validator

- `editorialFindings.ts` reuses Edit Gap / Plan grounded items
- Generic polish list flagged only when ungrounded
- Live editorial path **never reached the model** due to self-containment

### 2.5 Self-containment gate

- `evaluatePacketSelfContainment` runs before provider
- If `selfContained=false` → local insufficient-evidence completion (no silent system-only call)
- **Defect:** requires `crossModalRelations` whenever `speech ∧ visual` modalities are required — including editorial / action_verify — not only `queryClass=cross_modal`

Offline matrix already recorded this for F (zoom), G (professional), H (Settings). Live call-3 confirmed.

---

## 3. Offline matrix (0 paid)

Harness: `bounded-reasoning-quality-closure-v3-offline.runtime.test.ts`  
Unit validators: `reasoningPacket/qualityClosureV3.test.ts` — **8 tests passed**

Artifacts:

| File | Role |
| ---- | ---- |
| `packet-delivery-tests.json` | A–K message shapes deliver marker |
| `self-containment-matrix.json` | required/present sections |
| `cross-modal-validator-tests.json` | false-agreement downgrade |
| `editorial-specificity-validator-tests.json` | generic vs grounded |
| `focal-decision-tests.json` | candidate evaluation contract |
| `offline-matrix.json` | A–K delivery + tools + sufficiency |

Offline highlights:

- **A/B speech shapes:** delivery PASS, selfContained PASS, tools=0
- **C cross-modal / E Case4:** selfContained PASS
- **F zoom / G professional / H Settings:** delivery PASS, **selfContained FAIL** (`crossModalRelations`)
- **I/J:** insufficient speech as expected (not self-contained)
- **K no-audio:** selfContained PASS (honest empty speech path)

---

## 4. Provider health

```json
{
  "configured": true,
  "credentialsPresent": true,
  "simpleRequestOk": true,
  "modelAvailable": true,
  "rateLimited": false,
  "quotaBlocked": false,
  "latencyMs": 2071,
  "summary": "simple request ok"
}
```

---

## 5. Paid smoke (max 3)

Media: narrated `recording-bug5-narrated.mp4` (case-001) for all three planned calls.  
Model: `gpt-4o` @ OpenAI. Pricing used for estimates: $2.50 / $1.25 cached / $10 per 1M tokens.

### CALL 1 — Speech

**Prompt:** `What did I say near the end?`

| Metric | Value |
| ------ | ----- |
| status | completed |
| inputTokens | **739** (V2 broken speech was ~419) |
| outputTokens | 35 |
| images | 0 |
| modelCalls | 1 |
| tools | 0 |
| packetChars | 1232 |
| packetDelivered | true |
| latencyMs | 2986 |
| est. USD | ~0.00220 |

**Provider-bound message:** contains `REASONING_PACKET_V1` + `SELECTED_SPEECH` + spoken windows.  
**Answer:** correctly quotes end narration about opening the technical audit document.  
**Primary failure layer:** none.  
**Verdict:** **PASS** — packet delivery closed.

### CALL 2 — Cross-modal

**Prompt:** Compare speech vs visible; match / differ / cannot verify.

| Metric | Value |
| ------ | ----- |
| status | completed |
| inputTokens | 8883 |
| outputTokens | 252 |
| images | 5 |
| modelCalls | 1 |
| tools | 0 |
| crossModalRelations | 3 (mostly `NOT_VISUALLY_VERIFIED`) |
| packetDelivered | true |
| latencyMs | 7161 |
| est. USD | ~0.02473 |

**Answer quality:** Itemizes spoken claims; states visuals do not confirm OpenScreen demo / timeline; summary says most spoken actions **cannot be directly verified**. No false “no discrepancy.”  
**Primary failure layer:** none for truth boundary.  
**Verdict:** **PASS** for `CROSS_MODAL_TRUTH_BOUNDARY` on this smoke.

### CALL 3 — Professional editorial

**Prompt:** Recommend only recording-supported professional improvements.

| Metric | Value |
| ------ | ----- |
| status | completed (local) |
| provider called | **false** |
| modelCalls | 0 |
| tools | 0 |
| editorialFindings | **12** (present in packet) |
| selfContained | false |
| missing | `crossModalRelations` |
| reason | `bounded_packet_not_self_contained:crossModalRelations` |
| final text | insufficient-evidence stub |

**Primary failure layer:** `PACKET_SELF_CONTAINMENT`  
**Verdict:** **BLOCKED** — editorial specificity **NOT_VERIFIED** on paid path. Did **not** burn a third generation call.

---

## 6. Cost vs prior Bounded smoke

| | V2 Reliability (valid Bounded turns) | V3 Quality Closure |
| - | ------------------------------------ | ------------------ |
| Speech input | ~419 (invalid / undelivered) | **739** (delivered) |
| Cross-modal-ish input | ~8.1–10.6k | **8883** |
| Paid gen calls | 6 | **2** |
| Est. gen USD (this milestone) | (prior suite) | **~$0.0269** |

Assumptions: list prices above; cached=0 on both completed calls; health probe tokens excluded from “generation” total; STT is local (not OpenAI).

**ACTUAL_CONTEXT (paid completed):** ~739 (speech) / ~8883 (cross-modal) input tokens.  
**AVERAGE_PROVIDER_COST (2 completed gen calls):** ~$0.0135 / call; suite gen total ~$0.0269.

---

## 7. Failure classification

| Symptom | Layer |
| ------- | ----- |
| V2 speech append miss | **PACKET_DELIVERY** — **CLOSED** (live call-1) |
| Editorial blocked despite findings | **PACKET_SELF_CONTAINMENT** — **OPEN** (over-require relations when speech∧visual) |
| Cross-modal false agreement | **CROSS_MODAL_RELATION** / **FINAL_VALIDATOR** — offline covered; live call-2 clean |
| Focal ignore candidates | **FOCAL_TARGET_DECISION** — offline only; not in paid set |
| Generic professional polish | **EDITORIAL_FINDINGS** — unpaid path blocked before model |

No post-smoke code patch applied.

---

## 8. Invariants preserved

- UNDERSTAND/PLAN mutating tools = 0 on sufficient / completed Bounded turns
- Sufficient packets expose 0 tools (calls 1–2)
- Model-call discipline: 1 call per completed provider turn; call-3 = 0
- Consent / apply / verify untouched
- No architecture redesign; no provider change; no Retrieval expansion
- Max paid generation invocations ≤ 3 (actual 2)

---

## 9. Artifacts checklist

```
tmp/perception-benchmark/bounded-reasoning-quality-closure-v3/
  NOTICE.md
  packet-delivery-tests.json
  self-containment-matrix.json
  cross-modal-validator-tests.json
  editorial-specificity-validator-tests.json
  focal-decision-tests.json
  offline-matrix.json
  provider-health.json
  live-matrix.json
  live-cost-summary.json
  call-1/{packet,provider-bound-message,provider-usage,final-response,validation,quality-review}
  call-2/{...}
  call-3/{...}
```

---

## 10. Final decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

PACKET_DELIVERY:
PASS

PACKET_SELF_CONTAINMENT:
PARTIAL

CROSS_MODAL_TRUTH_BOUNDARY:
PASS

FOCAL_TARGET_DECISION:
PARTIAL

EDITORIAL_GROUNDING_CONTRACT:
PARTIAL

FINAL_VALIDATION:
PASS

MODEL_CALL_DISCIPLINE:
PASS

PAID_SMOKE:
PARTIAL

EDITORIAL_SPECIFICITY:
NOT_VERIFIED

EPISTEMIC_INVARIANTS:
PASS

ACTUAL_CONTEXT:
~739 (speech) / ~8883 (cross-modal) input tokens on completed paid calls

AVERAGE_PROVIDER_COST:
~$0.0135 per completed gen call; ~$0.0269 for this smoke (2 calls; gpt-4o list pricing; cached=0)

BOUNDED_REASONING_ARCHITECTURE:
NOT_READY

PRODUCTION_DEFAULT:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY

PAID_MATRIX:
KEEP_PAUSED
```

---

## HARD STOP

Stopped after this report.

Did **not**: promote Bounded, exceed 3 paid gen calls, start bake-off, download local models, change provider, change Retrieval, expand autonomy, change consent/apply, or add multi-edit.
