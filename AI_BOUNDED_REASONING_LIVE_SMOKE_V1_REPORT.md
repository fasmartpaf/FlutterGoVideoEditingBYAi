# OpenScreen — Bounded Reasoning Live Quality Smoke V1

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/bounded-reasoning-live-smoke-v1/`  
**Paid generation calls this milestone:** **6** (hard cap). Cases completed: **4/6**.  
**Default packing unchanged:** `CURRENT_FULL_CONTEXT`. **DO_NOT_PROMOTE.**

---

## 1. Executive verdict

`PARTIAL`

Bounded Reasoning V1 **does reduce provider context materially** on real media (speech ~6.9k input tokens / 0 images; visual/cross-modal ~8.9–10.9k vs historical FULL ~34k). Phase tool surface stayed **non-mutating** on UNDERSTAND/PLAN.

Quality is **not yet good enough** for broader validation:

| Call | Quality | Notes |
| ---- | ------- | ----- |
| 1 Speech | **PASS** | Correct end-of-narration quote; 0 images |
| 2 Cross-modal | **FAIL** | Packet had speech+frames; answer claimed “no discrepancies” |
| 3 Case4 | **FAIL** | **PACKET_FAILURE** — speech not requested; invented prose |
| 4 Case020 zoom | **PARTIAL** | Restraint OK; weak focal-target analysis |
| 5 Professional | **NOT_RUN** | Cap exhausted by call-1 tool loop |
| 6 Settings | **NOT_RUN** | Cap exhausted |

Hard stop honored: **no patches**, no extra paid calls, no promotion.

---

## 2. Provider health

```json
{ "simpleRequestOk": true, "quotaBlocked": false, "latencyMs": 2038, "model": "gpt-4o" }
```

Health probe succeeded before generation. See `provider-health.json`.

---

## 3. Real media used

| Call | Asset |
| ---- | ----- |
| 1–2, (5 skipped) | `recording-bug5-narrated.mp4` |
| 3 | `tmp/.../case4-spoken-correction.mp4` (has **AAC audio** per ffprobe) |
| 4 | `recording-1788978271417.mp4` (Case 020) |
| 6 skipped | Settings: `recording-1788930909064.mp4` |

Packets were built from the live chain (STT when requested → visual → ledger/investigator/claims/story → `ReasoningPacketV1`). No stub memory.

---

## 4. Packet integrity

| Call | Verdict | Critical finding |
| ---- | ------- | ---------------- |
| 1 | PASS | Spoken windows + claimIds; 0 images |
| 2 | PARTIAL | Both modalities present; missing explicit UNKNOWN for timeline visibility |
| 3 | **FAIL** | `speechStatus=not_requested`, `spoken=[]`, but `packetEvidenceSufficient=true` |
| 4 | PASS | PLAN packet with OCR known[], speech, coverage + editorial_focus frames |

Call 3 is the architecture-critical miss: listen/correction prompt classified as `queryClass=visual` → STT skipped → empty speech packet marked sufficient → model invented “no audio.”

---

## 5. Tool surface

All completed UNDERSTAND/PLAN turns: **mutatingToolCount = 0**.

| Call | Phase | Tools | Mutating |
| ---- | ----- | ----- | -------- |
| 1 | UNDERSTAND | 5 read tools | 0 |
| 2 | UNDERSTAND | 5 | 0 |
| 3 | UNDERSTAND | 5 | 0 |
| 4 | PLAN | 3 (`getCurrentDocument`, transcript×2) | 0 |

`PHASE_TOOL_SURFACE: PASS`

---

## 6. Call 1 — Speech

**PASS.** Quote matches packet spoken near end. 0 images. Natural, concise.

**Cost discipline issue:** `modelCalls=3`, `toolLoopCount=2` (transcript tools despite packet already carrying speech). Burned the 6-call budget early.

---

## 7. Call 2 — Cross-modal

**FAIL — MODEL_REASONING.**

Packet correctly carried timeline/demo speech + 5 frames. Answer claimed speech and screen “seem consistent” / “no discrepancies,” without quoting the timeline claim or marking it unverified. Extra “restart OpenScreen” style content is **NOT_VERIFIABLE** from packet.

---

## 8. Call 3 — Case4 correction

**FAIL — PACKET_CONSTRUCTION** (primary).

- Media **has audio** (h264+aac, ~17s).
- Live path: `speechStatus: "not_requested"`, no `speech/case4` cache.
- Packet: `spoken=[]`, sufficiency still true.
- Answer: false “no audio,” invents Cursor/Upwork/OpenScreen restart; **no** Timeline → correction → Effects structure.

Secondary: MODEL_REASONING on unsupported action-like prose.

---

## 9. Call 4 — Case020 zoom

**PARTIAL — MODEL_REASONING.**

Packet had whole_media coverage, editorial_focus @12.33s, dense OCR known[]. Answer declined zoom (good restraint / not generic “add zooms”) but did not evaluate the OCR focal region as a specific accept/reject with time+target+reason. Acceptable as soft editorial caution, not a zoom grounding pass.

---

## 10–11. Calls 5–6

**NOT_RUN** — cumulative `paidGenerationCalls` reached 6 after call 4 (3+1+1+1). Professional editorial + Settings negative invariant **not live-verified** this milestone.

---

## 12. Material claim audit

See per-call `claim-audit.json`. Highlights:

- Call1 end-speech quote: **SUPPORTED**
- Call2 “no discrepancies”: **UNSUPPORTED**
- Call3 “no audio”: **CONTRADICTED** (by ffprobe + classifier skip)
- Call3 OpenScreen restarted: **UNSUPPORTED**
- Call4 no-zoom: **PARTIALLY_SUPPORTED** (restraint)

---

## 13. Editorial genericness

Call4: **not** a GENERIC_EDITORIAL_FAILURE (declined inventing zooms). Still incomplete specificity. Call5 (professional) **NOT_RUN**.

---

## 14–18. Tokens, images, calls, cost, latency

Pricing: gpt-4o list **$2.50 / $1.25 cached / $10 per 1M** tokens — **ESTIMATED** from usage metadata.

| Call | In | Cached | Out | Images | ModelCalls | Est. USD | Latency ms |
| ---- | -- | ------ | --- | ------ | ---------- | -------- | ---------- |
| 1 | 6865 | 3712 | 76 | 0 | **3** | ~0.013 | 5714 |
| 2 | 8853 | 0 | 197 | 5 | 1 | ~0.024 | 8821 |
| 3 | 8857 | 0 | 160 | 5 | 1 | ~0.024 | 6198 |
| 4 | 10882 | 0 | 199 | 6 | 1 | ~0.029 | 9920 |

- **Average est. cost / completed case:** ~**$0.0226**
- **Total est. generation:** ~**$0.090** (excludes health probe)
- Control surface: system ~1.5k chars; tools ~1.4–3.1k; packet ~0.9–6.6k; project projection ~320 chars

---

## 19. Historical context comparison (ESTIMATED_ONLY)

| Mode (historical) | Speech | Visual/editorial |
| ----------------- | ------ | ---------------- |
| FULL | ~15k | ~34k |
| RETRIEVAL | ~12k | ~20–24k |
| **BOUNDED (this smoke)** | **~6.9k** | **~8.9–10.9k** |

Approx. input reduction vs FULL: **~54% speech**, **~68–74% visual/editorial**.  
Vs RETRIEVAL: **~43% speech**, **~45–55% visual**.

---

## 20. Failure classification

| Call | Primary layer |
| ---- | ------------- |
| 2 | MODEL_REASONING |
| 3 | PACKET_CONSTRUCTION |
| 4 | MODEL_REASONING |
| Budget miss 5–6 | MODEL_CALL_DISCIPLINE (tool loops on call 1) |

No PACKET/tool/apply patches applied after seeing answers.

---

## 21. Quality verdict

Bounded path **can** answer a simple speech question well at low tokens. It **does not yet** reliably do honest cross-modal comparison or Case4 correction under live classification. Epistemic Settings smoke **missing**. Context reduction is real; quality gate **fails**.

---

## 22. Broader validation?

**NOT_READY** — need packet sufficiency fixes for speech-required asks, classifier/STT request alignment, and a clean 6×1-call smoke including Settings + professional editorial **after** tool-loop discipline.

---

## 23. Remaining limitations

1. Tool loops still common on UNDERSTAND when transcript tools are exposed (packet already has speech).
2. Sufficiency can report true with empty speech on listen prompts.
3. QueryClass misroutes listen/correction → visual.
4. Cross-modal answers may assert agreement without grounding.
5. Cap accounting by `modelCalls` (correct for TPM) left editorial/Settings unverified.

---

## 24. Recommended next step

**CTO review this evidence.** Candidate follow-up (separate milestone, still DO_NOT_PROMOTE):

1. Fix packet sufficiency when request needs speech and STT was skipped/empty.
2. Ensure “listen / what I say / correct myself” forces speech prep.
3. UNDERSTAND: prefer answering from packet without routine transcript tool loops (or shrink tool surface further).
4. Re-run a **fresh ≤6** smoke with **1 call/case** targeting the two skipped cases + Case4 + cross-modal.

Do **not** promote, bake-off, or reopen paid FULL/RET matrix.

---

## Instrumentation note (non-behavioral)

`invokeOpenScreenAgent` now returns `boundedDiagnostics` (exact packet/tools/system) and preserves Bounded identity in `retrievalPath` after session put. Production default packing unchanged.

---

## Final decisions

```text
ENGINEERING_VERDICT:
PARTIAL

PACKET_INTEGRITY:
PARTIAL

LIVE_EVIDENCE_GROUNDING:
PARTIAL

EDITORIAL_SPECIFICITY:
NOT_VERIFIED

EPISTEMIC_INVARIANTS:
NOT_VERIFIED

PHASE_TOOL_SURFACE:
PASS

MODEL_CALL_DISCIPLINE:
FAIL

ACTUAL_CONTEXT_REDUCTION:
~54% speech / ~68–74% visual-editorial vs historical FULL; ~43% / ~45–55% vs RETRIEVAL (input tokens, ESTIMATED_ONLY)

AVERAGE_PROVIDER_COST_PER_CALL:
~$0.0226 ESTIMATED (gpt-4o $2.50/$1.25cached/$10 per 1M; 4 completed cases)

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
