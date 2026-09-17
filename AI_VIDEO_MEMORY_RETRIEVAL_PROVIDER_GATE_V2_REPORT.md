# OpenScreen — Retrieval Provider Promotion Gate V2

**Identity:** `CURRENT_OPENSCREEN_VIDEO_MEMORY_RETRIEVAL_PROVIDER_GATE_V2`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/`  
**Prior preserved (not overwritten):** Context Audit, Retrieval Production, Closure, Promotion Gate V1, Evidence Coverage V1, Evidence Deepening V1

This gate asks:

> Does `VIDEO_MEMORY_RETRIEVAL` preserve or improve OpenScreen's actual reasoning quality while materially reducing unnecessary context compared with `CURRENT_FULL_CONTEXT`?

Answer: **not measurable on this run.** The configured provider is quota-blocked. Architecture was not changed to work around billing.

---

## 1. Executive verdict

`BLOCKED_PROVIDER`

Health probe (`openai` / `gpt-4o`) returned `quotaBlocked: true` / `provider_quota_exhausted` / HTTP 429 after **one** diagnostic request. Remaining A/B/C matrix, Case 020 provider answers, invariants, follow-up, and Compact comparison were **not started**. No further provider calls were made.

This is the same billing wall as Promotion Gate V1 (every generation exhausted). Prepare-only Coverage + Deepening work is **not** a substitute for answer quality.

Default packing remains `CURRENT_FULL_CONTEXT`. Retrieval stays opt-in. Compact stays experimental.

**Dominant blocker (exactly one):** OpenAI quota exhaustion on `gpt-4o`. Restore quota, rerun this same harness without architectural edits.

---

## 2. Provider health

Recorded in `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/provider-health.json`.

| Field | Value |
| ----- | ----- |
| provider | `openai` |
| model | `gpt-4o` |
| credentialsPresent | `true` |
| requestOk (`simpleRequestOk`) | `false` |
| quotaBlocked | `true` |
| rateLimited | `false` |
| latency | `1403` ms |
| httpStatus | `429` |
| failureReason | `provider_quota_exhausted` |
| configured | `true` |
| modelAvailable | `true` (probe classification; request still failed) |
| summary | `probe failed: provider_quota_exhausted` |

No generation usage, cached tokens, output tokens, images, or estimated generation cost exist. Health-probe cost is a single short ChatOpenAI invoke; it is not mixed into a quality matrix.

---

## 3. What was not run

Planned manifest: `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/case-manifest.json`.

| Block | Status |
| ----- | ------ |
| Q1–Q7 × FULL / RETRIEVAL / COMPACT (narrated) | **NOT_RUN** |
| Case 020 Q4 / Q5 / Q7 × three modes | **NOT_RUN** |
| Case 4 correction, Restart, Upwork, Settings (Retrieval) | **NOT_RUN** |
| Narrated stable recording as product answers | **NOT_RUN** (media exists; no provider turn) |
| Longest ~28.94s recording | **NOT_RUN** |
| Same-video F1–F5 follow-up | **NOT_RUN** |
| Final-answer claim audit | **NOT_RUN** (no answers) |
| Manual editorial rubric | **NOT_RUN** |
| FULL vs RETRIEVAL quality parity | **NOT_VERIFIED** |
| COMPACT vs RETRIEVAL quality parity | **NOT_VERIFIED** |
| Cost/latency quality-to-cost table | empty except health probe |

Harness: `electron/ai-edition/perceptionBenchmark/videoMemoryRetrievalProviderGateV2/video-memory-retrieval-provider-gate-v2.runtime.test.ts`  
It aborts remaining turns on health `quotaBlocked` and on later `provider_quota_exhausted`.

---

## 4. Prior proven state (not re-measured here)

Unchanged from Coverage V1 + Deepening V1 and Promotion Gate V1 telemetry. **Not re-proven by provider answers in this gate.**

**Memory (prior live telemetry):** sourceMemoryHit, programmeMemoryHit, programme mutation invalidation, duration probes do not invalidate.

**Retrieval (prepare-only + prior live classifier):** QueryScope; local/bounded/whole-media; coverage floor; relevance deepening; event-region dedup; speech-only 0 images; cross-modal speech+visual; evidence sufficiency contract.

**Case 020 prepare-only (Deepening V1, not this provider gate):** editorial, whole_media, coverage sufficient, mixed global + one representative event frame in 12–15s, no local cluster domination.

**Still not proven (this gate):** answer quality, FULL vs RETRIEVAL parity, COMPACT answer quality, whether grounded evidence improves editorial judgment, whether retrieval should become default, whether context architecture can freeze for model bake-off.

---

## 5. FULL / RETRIEVAL / COMPACT matrix

Empty. Zero `finalText` rows.

Claim audits: none. Unsupported-zoom FAIL criteria cannot be applied without answers. “No zoom needed” cannot pass or fail.

---

## 6. Editorial quality / epistemic invariants / follow-up / cost

All **NOT_VERIFIED**.

Follow-up product proof (memory reuse helping answers, not only telemetry): **NOT_VERIFIED**.

Mutation / consent / apply: **not touched** in this milestone.

---

## 7. Phase-specific tool packing (decision only)

No A/B/C evidence on whether query-class Compact gating is enough vs phase-specific tool exposure.

Recommendation: **NEEDS_MORE_EVIDENCE**. Do not implement phase packing until a provider-complete gate exists.

Coverage V1 still recommended phase packing as architecture *direction*; this gate cannot confirm or reject it from live answers.

---

## 8. Promotion criteria vs this run

| Criterion | Result |
| --------- | ------ |
| 1 source/programme memory remains correct | **NOT_VERIFIED** this run (prior live telemetry stands) |
| 2 no evidence starvation | **NOT_VERIFIED** on answers |
| 3 Case 020 zoom judgment grounded | **NOT_VERIFIED** (prepare-only coverage is not judgment) |
| 4 cross-modal grounded | **NOT_VERIFIED** |
| 5 epistemic invariants | **NOT_VERIFIED** |
| 6 editorial recording-specific | **NOT_VERIFIED** |
| 7 no quality regression vs FULL | **NOT_VERIFIED** |
| 8 retrieval reduces unnecessary context | **NOT_VERIFIED** this run (prior audit numbers exist; quality not paired) |
| 9 mutation/consent/apply unchanged | **PASS** (no code path change for those systems in this gate) |

Retrieval **cannot** be promoted. Compact **cannot** be promoted. Architecture **cannot** be frozen for bake-off: FULL / RETRIEVAL / COMPACT remain distinct surfaces with no quality winner.

---

## 9. Long-form honesty

Current real corpus max remains ~28.94s. Not tested this run.

`LONG_FORM_SCALING: NOT_VERIFIED`

---

## 10. What not to do next

Do **not**: download models, run bake-off, integrate Ollama, expand autonomy, add multi-edit, change consent/apply, tune Case 020, add another retrieval subsystem, rewrite editorial cognition, or change packing because quota is empty.

**Next:** restore `gpt-4o` quota (or wait for billing reset), rerun the V2 harness **unchanged**, then complete claim audit + editorial rubric on actual answers.

---

## 11. Final decisions (BLOCKED_PROVIDER_RUN — historical)

```text
ENGINEERING_VERDICT:
BLOCKED

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

QUALITY_PARITY_RETRIEVAL_VS_FULL:
NOT_VERIFIED

QUALITY_PARITY_COMPACT_VS_RETRIEVAL:
NOT_VERIFIED

EDITORIAL_GROUNDING:
NOT_VERIFIED

EPISTEMIC_INVARIANTS:
NOT_VERIFIED

PHASE_SPECIFIC_TOOL_PACKING:
NEEDS_MORE_EVIDENCE

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```

---

# QUOTA_RESTORED_RUN

**Attempted:** 2026-09-14 (quota-restored rerun only; no architecture changes)  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/quota-restored-run/`  
**Prior `BLOCKED_PROVIDER_RUN` artifacts:** preserved at parent `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/` (not overwritten)

## Status

`BLOCKED_PROVIDER`

Exactly **one** health probe was run. Quota is still exhausted. Matrix was **not** started. No additional provider requests were made. Hard freeze held (no retrieval/packing/cognition edits).

### Health (quota-restored attempt)

| Field | Value |
| ----- | ----- |
| provider | `openai` |
| model | `gpt-4o` |
| credentialsPresent | `true` |
| requestOk | `false` |
| quotaBlocked | `true` |
| rateLimited | `false` |
| httpStatus | `429` |
| latencyMs | `1174` |
| failureReason | `provider_quota_exhausted` |

Recorded: `quota-restored-run/provider-health.json`

### Matrix

**NOT_RUN** — Q1–Q7 × FULL/RETRIEVAL/COMPACT, Case 020, invariants, follow-up, claim audit, editorial review: all skipped after health fail.

### Dominant blocker (unchanged)

OpenAI quota exhaustion on `gpt-4o`. Restore billing/quota, then rerun the same harness into a new child run directory.

## Final decisions (QUOTA_RESTORED_RUN — blocked health retry; historical)

```text
ENGINEERING_VERDICT:
BLOCKED

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

QUALITY_PARITY_RETRIEVAL_VS_FULL:
NOT_VERIFIED

QUALITY_PARITY_COMPACT_VS_RETRIEVAL:
NOT_VERIFIED

EDITORIAL_GROUNDING:
NOT_VERIFIED

EPISTEMIC_INVARIANTS:
NOT_VERIFIED

PHASE_SPECIFIC_TOOL_PACKING:
NEEDS_MORE_EVIDENCE

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```

---

# QUOTA_RESTORED_RUN_LIVE

**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/quota-restored-run-live/`  
**Harness:** unchanged methodology; OUT redirected via `OPENSCREEN_PROVIDER_GATE_V2_OUT` so blocked-run artifacts were not overwritten.  
**Manual review:** `quota-restored-run-live/manual-review.md`

## Health

| Field | Value |
| ----- | ----- |
| provider | `openai` |
| model | `gpt-4o` |
| credentialsPresent | `true` |
| requestOk | `true` |
| quotaBlocked | `false` |
| rateLimited | `false` |
| latencyMs | `1365` |
| summary | `simple request ok` |

## Matrix outcome

Harness **passed** (exit 0, ~934s). **18** turns `completed`, **22** turns `provider_error` / `failureReason=unknown` (not classified as quota; matrix did not abort).

| Block | Status |
| ----- | ------ |
| Q1–Q6 × FULL / RETRIEVAL / COMPACT | completed |
| Q7 × 3 | provider_error |
| Case 020 Q4/Q5/Q7 × 3 | provider_error |
| INV Restart / Upwork / Settings / Case4 | provider_error |
| Longest ~28.94s Q2 | provider_error |
| Follow-up F1–F5 | provider_error (memory hits on F2–F5 error telemetry) |

## Quality findings (completed subset)

- **Speech (Q1):** all modes correct; RETRIEVAL/COMPACT 0 images; COMPACT slightly worse boilerplate.
- **Visual (Q2):** RETRIEVAL often cleaner than FULL (less speech-as-visual chronology); Upwork chrome without “opened”.
- **Cross-modal (Q3):** all modes handle match/differ/unverifiable; COMPACT especially clear on timeline speech≠screen.
- **Editorial (Q4–Q6):** restraint closers appear (“no safe recording-specific edit”), but preceding bullets often generic; COMPACT Q4 weakest (mic/transitions).
- **Case 020 zoom judgment:** **NOT_VERIFIED** (no answers).
- **Dedicated epistemic INV cases:** **NOT_VERIFIED** (no answers). Completed narrated prose did not trip the Upwork/restart/Settings false-action scan.
- **Context cost:** RETRIEVAL ~20k input vs FULL ~34k on visual turns; COMPACT speech ~3k vs RETRIEVAL ~12k.

Architecture/packing **not** modified after seeing answers (hard stop).

## Dominant blocker (exactly one)

Incomplete provider matrix after Q6: 22 turns failed with `provider_error`/`unknown`, including the Case 020 zoom gate and all dedicated epistemic invariant prompts.

## Final decisions (QUOTA_RESTORED_RUN_LIVE — historical; superseded by resume)

```text
ENGINEERING_VERDICT:
PARTIAL

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

QUALITY_PARITY_RETRIEVAL_VS_FULL:
PARTIAL

QUALITY_PARITY_COMPACT_VS_RETRIEVAL:
PARTIAL

EDITORIAL_GROUNDING:
PARTIAL

EPISTEMIC_INVARIANTS:
PARTIAL

PHASE_SPECIFIC_TOOL_PACKING:
NEEDS_MORE_EVIDENCE

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```

---

# PROVIDER_STABILITY_MATRIX_RESUME_V1

**Date:** 2026-09-14  
**Full report:** `AI_PROVIDER_STABILITY_MATRIX_RESUME_V1_REPORT.md`  
**Artifacts:** `tmp/perception-benchmark/provider-stability-matrix-resume-v1/`  
(Does not overwrite `quota-restored-run-live/`.)

## Root cause

OpenAI `gpt-4o` organization **TPM limit 30 000**. After ~18 expensive turns, later calls hit `429 rate_limit_exceeded` / tokens. Gate V2 recorded these as `unknown` because diagnostics were not persisted. Isolated Q7 FULL **succeeds** in a fresh window → not a Q7-specific cognition bug.

Additional hard limit: Case 020 **FULL** requests ask for ~34 3xx tokens, which is **larger than the 30k TPM ceiling** (“Request too large”) — cooldown cannot fix.

## Resume + quality (summary)

- Q7 all modes completed; RET/COMPACT Case 020 Q4/Q5/Q7 completed; invariants PASS; longest answered; F1–F3/F5 completed (F4 429).
- Epistemic invariants on provider prose: **PASS**.
- Case 020 zoom (RET/COMPACT): **no unsupported zoom** (PASS restraint).
- Editorial still **PARTIAL** (generic polish bullets).
- FULL vs RET: RET fits TPM and was more disciplined on narrated Q7 resume.

## Final decisions (current)

```text
PROVIDER_FAILURE_ROOT_CAUSE:
OpenAI gpt-4o org TPM limit 30000; Gate V2 exhausted the window then discarded 429 diagnostics as unknown; FULL multimodal requests (~34k) can exceed the TPM ceiling entirely

PROVIDER_ERROR_CLASSIFICATION:
PASS

PROVIDER_RUN_STABILITY:
PARTIAL

MATRIX_RESUME:
PARTIAL

ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

VIDEO_MEMORY_RETRIEVAL:
DO_NOT_PROMOTE

VIDEO_MEMORY_RETRIEVAL_COMPACT:
KEEP_EXPERIMENTAL

QUALITY_PARITY_RETRIEVAL_VS_FULL:
PARTIAL

QUALITY_PARITY_COMPACT_VS_RETRIEVAL:
PARTIAL

EDITORIAL_GROUNDING:
PARTIAL

EPISTEMIC_INVARIANTS:
PASS

PHASE_SPECIFIC_TOOL_PACKING:
RECOMMENDED

CONTEXT_ARCHITECTURE:
NOT_FROZEN

MODEL_BAKEOFF_READINESS:
NOT_READY

LONG_FORM_SCALING:
NOT_VERIFIED
```
