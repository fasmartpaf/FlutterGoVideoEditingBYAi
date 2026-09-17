# OpenScreen — Provider Stability + Matrix Resume V1

**Identity:** `CURRENT_OPENSCREEN_PROVIDER_STABILITY_MATRIX_RESUME_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/provider-stability-matrix-resume-v1/`  
**Prior Gate V2 live run (preserved):** `tmp/perception-benchmark/video-memory-retrieval-provider-gate-v2/quota-restored-run-live/`

This milestone isolates **provider-run reliability**. Cognition / packing / retrieval were not redesigned. Diagnostics + benchmark pacing only.

---

## 1. Executive verdict

| Axis | Result |
| ---- | ------ |
| PROVIDER_FAILURE_ROOT_CAUSE | OpenAI `gpt-4o` org **TPM limit = 30 000**. Gate V2 burned the window with ~34k FULL multimodal turns; later 429s were collapsed to `unknown` because the harness discarded `result.reason`. Separately, some FULL requests are **structurally larger than the TPM ceiling** (`Requested ~34 313 > Limit 30 000`). |
| PROVIDER_ERROR_CLASSIFICATION | **PASS** (raw fields preserved; new typed reasons) |
| PROVIDER_RUN_STABILITY | **PARTIAL** (healthy with pacing; FULL visual often incompatible with this account TPM) |
| MATRIX_RESUME | **PARTIAL** (hard rows mostly restored; Case 020 FULL ×3 blocked by request-too-large TPM; F4 one rate-limit miss) |

Architecture promotion decisions remain conservative: Retrieval still **DO_NOT_PROMOTE** (editorial still partly generic). Context **NOT_FROZEN**. Bake-off **NOT_READY**.

---

## 2. First failure forensic (prior Gate V2 live)

| | Last success | First failure |
| - | ------------ | ------------- |
| Index | 18 | 19 |
| Id | `Q6_VIDEO_MEMORY_RETRIEVAL_COMPACT` | `Q7_CURRENT_FULL_CONTEXT` |
| Mode | COMPACT | FULL |
| Media | narrated | same |
| Prompt | shorter/clearer | zoom judgment |
| Latency | 41 644 ms | **60 444 ms** |
| Tokens | in 19 890 / out 144 / 5 images | **not_available** |
| Recorded reason | completed | `unknown` |

**Diagnostic gap:** Gate V2 harness stored `failureReason` only — not `reason` / HTTP / raw provider fields. Raw cause was lost.

**Reconstructed rate window at Q7 start:** ~43 k input tokens in prior 60s (approx from sequential latencies). Consistent with hitting a 30k TPM ceiling after FULL turns.

**Concurrency:** single Vitest `it()`, sequential `await` — **no overlap**.

**Retries:** `ChatOpenAI maxRetries: 2`; product `PROVIDER_RETRY_POLICY` for retryable only. Quota must not retry.

See `forensic-prior-run.json`.

---

## 3. Isolated Q7 (mandatory A/B)

Fresh process/session after tiny+realistic controls:

| Result | Value |
| ------ | ----- |
| `ISOLATED_Q7_FULL` | **completed** (~55 s, ~34 701 input tokens) |
| Outcome | **A — isolated Q7 succeeds** → prior cascade was long-run / TPM window, not an inherent Q7 prompt defect |

---

## 4. Stability controls

| Control | Result |
| ------- | ------ |
| 10 tiny sequential completions | **10/10 completed** |
| Realistic RET speech | completed |
| Realistic RET visual | completed |
| Realistic RET editorial | completed |
| Realistic FULL visual | completed |
| Realistic COMPACT speech | **429 TPM** (`Used 28408, Requested 2353`, retry in ~1.5s) |

Raw evidence (COMPACT speech):

```text
httpStatus=429
rawProviderCode=rate_limit_exceeded
rawProviderType=tokens
Limit 30000 TPM
```

---

## 5. What we fixed (infrastructure only)

1. **`deliveryStatus`:** preserve `providerDiagnostics` (type/code/message/requestId/network/cause); add typed reasons (`context_length`, `payload_too_large`, `5xx`, `overloaded`, `bad_request`, `request_aborted`, `sdk_transport_error`). `unknown` only when unresolved.
2. **`service.ts`:** return `providerDiagnostics` on provider errors.
3. **Resume harness:** persist diagnostics; sequential pacing cooldown (2 s) — **benchmark policy only**, not product cognition.
4. **Unit tests:** deliveryStatus 12/12 pass.

**Not changed:** Video Memory, QueryScope, frames, packing modes, prompts, Investigator→Plan chain, consent/apply.

### Product vs benchmark

| | Policy |
| - | ------ |
| PRODUCT | Classify errors correctly; bounded retry for transient 429/5xx/network; never retry hard quota; user-safe copy unchanged |
| BENCHMARK | Sequential calls; cooldown; do not assume account TPM ≥ FULL payload; capture diagnostics always |

---

## 6. Matrix resume results

Reused Gate V2 completed Q1–Q6 (18 answers). Resumed missing rows:

| Block | Outcome |
| ----- | ------- |
| Q7 × FULL/RET/COMPACT | **3/3 completed** |
| Case 020 Q4/Q5/Q7 RET+COMPACT | **6/6 completed** |
| Case 020 Q4/Q5/Q7 FULL | **0/3** — `Request too large … Limit 30000, Requested ~34 3xx` (waiting cannot fix) |
| Restart / Upwork / Settings / Case4 | **4/4 completed** |
| Longest ~29s Q2 RET | **completed** |
| F1–F5 | F1–F3,F5 **completed**; F4 **429 TPM** (not re-burned) |

Reliability (this harness, excl. health/meta): **33/38 success (86.8%)**; all 5 failures = `provider_rate_limited`.  
p50 latency ~16.4 s; p95 ~59.3 s.

Memory RSS: start ~191 MB → after realistic ~85 MB → end ~151 MB — no leak smoking gun.

---

## 7. Quality review (Gate V2 rubric; manual authoritative)

### Epistemic invariants (provider prose)

| Case | Verdict |
| ---- | ------- |
| Restart | **PASS** — continuous timeline; no “user restarted” |
| Upwork | **PASS** — tab visible ≠ opened/worked |
| Settings | **PASS** — not visually opened |
| Case 4 | **PASS** — Timeline → correction → Effects; no false panel-open |

### Case 020 zoom (Q7)

| Mode | Verdict |
| ---- | ------- |
| RETRIEVAL | **PASS** — no zoom; stable layout; restraint closer |
| COMPACT | **PASS** — no unsupported zoom |
| FULL | **NOT_VERIFIED** (TPM request-too-large) |

Narrated Q7 FULL (resume) recommended timeline/document zooms **without a concrete visible focal target** → **FAIL** on that cell. Isolated FULL correctly said no zoom. Mode is unstable for zoom discipline.

### Editorial (Q4–Q6 prior + C020/F5)

Still **PARTIAL**: restraint closers appear, but bullets often generic (tabs, mic, transitions, pacing). COMPACT still weakest on polish lists.

### Follow-up memory (product)

| Turn | Memory | Answer quality |
| ---- | ------ | -------------- |
| F1 | miss (cold) | OK overview |
| F2 | source+programme hit | Correct end speech; 0 images |
| F3 | + story reuse | Correct “did not open Settings” |
| F4 | hits on error path | empty (429) |
| F5 | hits | Partly generic professional tips |

Memory reuse **does** help product turns when the provider succeeds — not only telemetry.

### FULL vs RETRIEVAL

- Token fit: RET ~20–24k fits 30k TPM; FULL ~34k often **cannot**.
- Q7: RET more restrained than narrated FULL resume.
- Prior Q1–Q6: RET visual often cleaner.
- Parity: **PARTIAL** (RET not worse; FULL unavailable on hard Case 020 cells here).

### COMPACT vs RETRIEVAL

Speech/cross-modal OK when not TPM-blocked; editorial still weaker. **PARTIAL** → **KEEP_EXPERIMENTAL**.

---

## 8. Cost (estimates only; harness formula $2.5/M in + $10/M out)

| Bucket | Est. USD |
| ------ | -------- |
| Prior Gate V2 completed 18 | ~1.02 |
| This milestone completed turns | ~1.28 |
| Tiny controls | ~0 (not metered in harness) |
| Failed 429 turns | usage unknown / not counted |

Do not treat estimates as invoices.

---

## 9. Dominant architecture blocker (one)

Editorial answers remain partly **generic** (and FULL is a poor bake-off surface on this TPM tier). Provider reliability is no longer the sole blocker, but quality is not promotion-grade yet.

---

## 10. Final decisions

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

---

## 11. Hard stop

No retrieval/frame/Compact/phase-packing/model-bakeoff/Ollama/consent/apply/cognition changes after this report.
