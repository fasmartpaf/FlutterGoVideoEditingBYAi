# OpenScreen Real Corpus Recovery 3 — Final Response Reliability Report

**Identity:** `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_FINALS_V1`  
**Date:** 2026-09-13  
**Preserved:** baseline `real-corpus-baseline-v1/`, Recovery 1 STT, Recovery 2 routing  
**Artifacts:** `tmp/perception-benchmark/real-corpus-recovery-3-finals/`

---

## Executive verdict

### `PASS_WITH_LIMITATIONS`

Empty successful turns are no longer an acceptable product state. Provider failures (including live OpenAI **429 quota exhausted / no credits**) now return typed `provider_error` + `failureReason` + user-safe copy, while preserving pre-LLM evidence (speech, Investigator, Source Story V2, etc.). Post-sanitize empty prose is also typed (`sanitizer_removed_all_text` / `missing_user_facing_response`).

**Limitation:** The configured OpenAI account has **no credits remaining**, so healthy-provider non-empty finals could not be re-verified live. Answer quality, Case 020 zoom honesty, and editorial prose remain **NOT_VERIFIED** pending quota. The delivery **contract** is fixed and proven under real provider failure.

---

## Baseline empty-final reference

| Case | Baseline final | Baseline raw-model | Notes |
| ---- | -------------- | ------------------ | ----- |
| 017 | empty (0 bytes) | empty | Target/editorial; ~11s agent; Investigator tools ran |
| 027 | empty (0 bytes) | empty | Edit-gap prompt; ~6.7s |
| 030 | empty (0 bytes) | empty | Tutorial polish; ~7.8s |

Baseline harness did not capture `InvokeResult.reason`. Failures scored `FINAL_RESPONSE_ERROR` / empty user-facing. Recovery 1 separately showed 429 → empty + mislabeled “Empty response from model…”.

---

## Final-response architecture audit

```text
LeftPanel.send
  → runChat (chat-service.ts)
  → invokeOpenScreenAgent (deep-agent/service.ts)
       evidence prep (visual/speech/investigator/stories…)  [pre-LLM]
       createOpenScreenChatModel → ChatOpenAI/Anthropic (maxRetries: 2)
       agent.streamEvents
         on_chat_model_stream → text / thinking
         on_tool_* (silent to UI, tracked for empty classification)
       if !rawText → typed empty_completion / tool_loop failure (+ preserve pre-LLM)
       else parse stories → stripInternalEvidenceJsonBlocks → grounded sanitize
       if !facingText → typed sanitizer/missing_user_facing failure
       else status=completed, text=facing
       catch → classifyProviderThrownError (429/401/timeout/…)
  → runChat: !text.trim() → success:false + userMessage (never success empty)
  → LeftPanel toast.error(error)
```

Empty-state candidates addressed: provider throw mislabeled as empty; JSON-only strip after raw check; tool-loop mute; thinking-only mute.

---

## Root cause(s)

1. **Provider errors collapsed** into `"Empty response from model (… error=…)"` — same family as mute streams.  
2. **No typed delivery status** on `InvokeResult` / `AiEditionChatResult`.  
3. **Post-sanitize hole:** non-empty raw JSON could become `text:""` without a rich failure reason.  
4. **LangChain default `maxRetries: 6`** could amplify 429 latency (bounded to 2).  
5. Live today: **hard quota / no credits** (`RateLimitQuotaExhaustedError` 429) — not a mute-model bug.

Baseline 017/027/030 empties are consistent with provider/stream failure or tool-loop without prose; without stored `reason` they cannot be re-attributed more finely. Under Recovery 3 the same prompts now fail **honestly** with typed quota errors when credits are gone.

---

## Files changed

| File | Role |
| ---- | ---- |
| `electron/ai-edition/deep-agent/deliveryStatus.ts` | Taxonomy, classifiers, user-safe messages, retry policy |
| `electron/ai-edition/deep-agent/deliveryStatus.test.ts` | Unit coverage for required failure classes |
| `electron/ai-edition/deep-agent/providerHealth.ts` | Benchmark/dev provider health probe |
| `electron/ai-edition/deep-agent/service.ts` | Wire status/failureReason; post-sanitize check; preserve pre-LLM artifacts |
| `electron/ai-edition/deep-agent/chat-model.ts` | `maxRetries: 2` on OpenAI/Anthropic |
| `electron/ai-edition/chat-service.ts` | Map typed failures → user-safe `AiEditionChatResult` |
| `src/native/contracts.ts` | `status` / `failureReason` / `providerHttpStatus` on chat result |
| `electron/ai-edition/chat-service.toolloop.test.ts` | Expect user-safe empty failure |
| `electron/ai-edition/speechEvidence/stt-recovery-live.runtime.test.ts` | Accept new diagnostic patterns |
| `electron/ai-edition/deep-agent/finals-recovery-live.runtime.test.ts` | Live Recovery 3 harness |

**Not modified:** STT, mediaContextNeeds, Investigator policy, Ledger/Claims/Stories/Gap/Plan/Proposal, apply/verify, editorial prompts.

---

## Provider error taxonomy

| `failureReason` | Typical trigger | `status` | Retryable |
| --------------- | --------------- | -------- | --------- |
| `provider_rate_limited` | 429 burst / TPM | `provider_error` | yes (bounded) |
| `provider_quota_exhausted` | no credits / billing / insufficient_quota | `provider_error` | **no** |
| `provider_auth_failed` | 401/403 | `provider_error` | no |
| `provider_timeout` | 408/504 / timeout | `provider_error` | yes |
| `provider_network_error` | fetch/DNS/502/503 | `provider_error` | yes |
| `provider_empty_completion` | stream with chunks but no prose | `provider_error` | no |
| `agent_tool_loop_no_final` | tools ran, no final text | `analysis_error` | no |
| `sanitizer_removed_all_text` | JSON/internals stripped to empty | `analysis_error` | no |
| `missing_user_facing_response` | empty after assembly | `analysis_error` | no |
| `local_cli_error` | local agent actionable message | `provider_error` | no |

---

## Provider health

`probeConfiguredProviderHealth` (benchmark/dev only):

```json
{
  "configured": true,
  "credentialsPresent": true,
  "simpleRequestOk": false,
  "quotaBlocked": true,
  "failureReason": "provider_quota_exhausted",
  "httpStatus": 429,
  "summary": "probe failed: provider_quota_exhausted"
}
```

Exact live class: **account quota / no credits remaining** (not a soft TPM burst). Retry correctly disabled.

---

## Streaming/final assembly

- Thinking deltas counted separately from prose.  
- Tool events tracked even when silent to the UI sink.  
- Empty raw → `classifyEmptyModelCompletion`.  
- Non-empty raw → strip → if empty facing → `classifyMissingUserFacingResponse`.  
- Success path sets `status: "completed"` only with non-empty facing text.

---

## Tool-loop finalization

Tool-only termination without prose → `agent_tool_loop_no_final` (`analysis_error`). No synthetic editorial “Done.” fallback.

---

## Sanitizer behavior

Internal SOURCE_STORY / TARGET_STORY / evidence JSON still stripped. If that leaves nothing user-facing → typed failure, not silent success.

---

## Evidence preservation on failure

On provider/empty failure, pre-LLM artifacts are retained on `InvokeResult` (benchmark/debug):

- `speechEvidence` (Recovery 1 pattern generalized)  
- `investigationEvidence`, `visualSpecialist`  
- `temporalEventLedger` / `claimPromotion` when built early  
- `sourceStoryV2`, `targetStoryV1`, `editGapV1`, `editPlanV1`, `planningClosureV1` when prepared  

Live case-017 delivery: `speechPreserved`, `investigationPreserved`, `sourceStoryV2Preserved` all **true** under 429.

---

## User-safe error contract

| Kind | User-facing copy |
| ---- | ---------------- |
| Provider unavailable / rate / quota / timeout / network / empty completion | “I couldn't complete the AI analysis because the model service is temporarily unavailable. Your video and project were not changed.” |
| Auth | “…rejected the credentials…” |
| Analysis / tool-loop / sanitizer | “OpenScreen couldn't complete this analysis. Your project was not changed.” |

Does **not** say “I couldn't understand the video” when evidence prep succeeded. Diagnostics stay in logs / `reason`, not toast.

`completed` ⇒ non-empty `finalText`. Empty ⇒ never `success: true`.

---

## Case 017 result

| | Baseline | Recovery |
| - | -------- | -------- |
| Final | empty | empty (honest) |
| Status | (implicit fail / empty file) | `provider_error` |
| Reason | unknown | `provider_quota_exhausted` (429) |
| User message | none | temporarily unavailable… |
| Evidence | — | speech `available`, Investigator present |
| Unexplained empty? | yes (product) | **no** |

---

## Case 027 result

Same contract as 017: typed `provider_quota_exhausted`, evidence retained, `emptyUnexplained=false`.

---

## Case 030 result

Same contract as 017/027.

---

## Case 020 observation

Provider unhealthy → final prose **NOT_VERIFIED**. Zoom suggestion class: **`not_verifiable`**. Routing still `editingContext`; speech `available`; Investigator present. Editorial hallucination deferred to Recovery 4+.

---

## Control cases

All hit the same live quota wall; each returned typed provider_error (never unexplained empty / never `completed` with blank text):

| Control | Routing | Notes |
| ------- | ------- | ----- |
| case-022 visual | `visualInspection` | speech not forced |
| case-023 speech | `mediaUnderstanding` | speech `no_audio` preserved |
| case-021 unsupported | `mediaUnderstanding` | refusal prose NOT_VERIFIED |
| control-deterministic | `deterministicEdit` | still invokes model today; fails typed |
| control-cross-modal | `mediaUnderstanding` | typed failure |

---

## Sequential stability

9 sequential real-media turns: **9/9** `provider_quota_exhausted`, **0** unexplained empties, **0** `status=completed` with empty text. Stable failure mode under hard quota.

---

## Provider retries

Policy: max **2** LangChain attempts; hard quota **not** retryable (`nextRetryDelayMs` → null). Soft rate-limit may delay up to 8s. Live quota path failed without inventing success.

---

## Model-call count

Health probe: 1 simple invoke (failed 429).  
Per case: evidence prep + agent model attempt(s) bounded by `maxRetries: 2`. No infinite retry.

---

## Latency

| Case | totalMs (Recovery 3 live) |
| ---- | ------------------------- |
| 017 | ~6031 |
| 027 | ~4309 |
| 030 | ~4369 |
| controls | ~0.3–5.0 s |

Faster than baseline ~39s avg because provider fails early on quota (evidence prep still runs). Not an optimization milestone.

---

## Tests

| Suite | Result |
| ----- | ------ |
| `deliveryStatus.test.ts` | PASS (11) |
| `chat-service.toolloop.test.ts` | PASS |
| `finals-recovery-live.runtime.test.ts` | PASS (9 cases + health) |

---

## Before-vs-after comparison

| Case | Baseline final | Baseline cause | Recovery status | Recovery final/error | Empty unexplained? |
| ---- | -------------- | -------------- | --------------- | -------------------- | ------------------ |
| 017 | empty | FINAL_RESPONSE_ERROR | provider_error / quota_exhausted | user-safe unavailable | **no** |
| 027 | empty | FINAL_RESPONSE_ERROR | provider_error / quota_exhausted | user-safe unavailable | **no** |
| 030 | empty | FINAL_RESPONSE_ERROR | provider_error / quota_exhausted | user-safe unavailable | **no** |
| 020 | 907 chars (baseline) | — | provider_error / quota | typed failure | **no** |
| 022 | 326 chars | — | provider_error / quota | typed failure | **no** |
| 023 | 328 chars | — | provider_error / quota | typed failure | **no** |
| 021 | 294 chars | — | provider_error / quota | typed failure | **no** |
| det / cross | n/a | — | provider_error / quota | typed failure | **no** |

---

## Regressions

- STT: speech still `available` / `no_audio` on failure path.  
- Routing: categories match Recovery 2 expectations on controls.  
- Prior baseline/recovery artifact trees untouched.

---

## Remaining limitations

- Healthy-provider non-empty finals **NOT_VERIFIED** (no credits).  
- Case 020 zoom honesty **not_verifiable**.  
- Deterministic-edit path still constructs a chat model (pre-existing); cheap routing flags are correct but model call may still occur.  
- Soft 429 vs hard quota distinguished by message heuristics (`billing` / `quota` / `credits`).

---

## What was deliberately NOT fixed

- Target Story / Edit Gap / Plan / Proposal quality  
- Zoom / editorial hallucination  
- Investigator sufficiency  
- Empty-final “answer quality” under healthy quota  
- Multi-edit / autonomy  
- New providers  

---

## Recommended next recovery cluster

**Recovery 4 — cognition / editorial honesty after evidence** (Case 020 zoom grounding, Investigator sufficiency, Target/Gap usefulness) **once provider credits are restored**, so finals can be measured again.

---

## Verdict

### `PASS_WITH_LIMITATIONS`

Response/error contract is fixed and proven on real media under live OpenAI quota exhaustion. Healthy-provider answer delivery remains blocked by billing/credits — not by unexplained empty success.

**STOP.**
