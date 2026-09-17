# OpenScreen — Single Mutation Authority Audit + Enforcement V1

**Identity:** `CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1`  
**Date:** 2026-09-13  
**Artifacts:** `tmp/perception-benchmark/single-mutation-authority-v1/`

---

## 1. Executive verdict

### `PASS_WITH_LIMITATIONS`

Proved and fixed the live trust contradiction:

- Semantic/editorial turns previously could call `addTrim` / other mutators **while** Edit Proposal showed `no_safe_proposal`.
- Chat could report `applied: added 2 trims` without Proposal → Consent → Apply Preview.

**After this milestone:** semantic/editorial turns are `proposal_only`. Mutating tools are refused **in `executeAgentTool` before mutation**. Chat does not auto-ship editorial fingerprint changes. Final prose is bound to transaction truth so false “applied” claims are rewritten.

Limitations: deterministic direct edits remain allowed by design; natural `proposal_ready` live consent path was not exercised this run (`NO_NATURAL_SAFE_PROPOSAL`); Apply Preview suites still cover consented commit.

---

## 2. Reproduced contradiction

Live product observation (user testing):

1. Prompt: shorten / professional / keep explanation  
2. Chat claimed trims applied (`applied: added 2 trims`)  
3. UI Consent card: **No safe edit found** (trim overlaps preserved meaning)

Code proof of root mechanism (pre-fix):

| Fact | Evidence |
| ---- | -------- |
| `editingContext` still received full mutating tool surface | `buildTools` always includes writes; no category filter |
| `editsAllowed` only Settings gate | `executeAgentTool` refused only when `editsAllowed === false` |
| Auto-apply when card has `canApply: false` | `chat-service` suppressed ship only when **some** card `canApply === true` |
| Tool UI “applied:” from any `toolEnd(ok)` | Independent of verification |

---

## 3. Root cause

**Dual mutation lanes:**

1. **Agent tool loop** — immediate AxcutDocument mutation when Project edits ON  
2. **Proposal → Consent → Apply Preview** — verified, consent-bound lane  

Semantic turns used (1) and displayed (2). Blocked proposals did **not** block (1). Prompt honesty was not a hard boundary.

---

## 4. Complete mutation-path audit

| Mutation path | Caller | Can mutate? | Requires proposal? | Requires consent? | Verification? | Persistence? | Allowed after V1? |
| ------------- | ------ | ----------- | ------------------ | ----------------- | ------------- | ------------ | ----------------- |
| Agent tools (`executeAgentTool`) on `editingContext` | deep-agent | Was yes → **No** | Yes (propose only) | Yes for commit | Via Apply Preview | Blocked at tool + ship gate | **Refuse direct** |
| Agent tools on `deterministicEdit` | deep-agent | Yes if Settings on | No | Settings only | No | Auto-apply if returned | **Yes (preserved)** |
| Agent tools on speech/visual/understanding | deep-agent | Was yes → **No** | N/A | N/A | N/A | No editorial ship | **read_only** |
| Speech prep transcript attach | prepareSpeech | Transcript only | No | No | No | May ship if editorial FP unchanged | Yes (non-editorial) |
| Edit Proposal build | prepare | No | N/A | N/A | N/A | Never | Yes |
| UI Consent Apply Preview | `applyPreview.run` | Yes (approved tool) | Yes | Yes | Compositor+audio | Only if verified | **Yes — sole semantic commit** |
| Chat rewind | rewindToMessage | Restore | No | User confirm | No | Yes | Yes (user restore) |
| Manual timeline / save | UI | Yes | No | No | No | Yes | Yes (human) |

---

## 5. Request classification

| Class | `mediaContextNeeds` | Mutation mode |
| ----- | ------------------- | ------------- |
| Semantic/editorial | `editingContext` | `proposal_only` |
| Explicit deterministic | `deterministicEdit` | `deterministic_edit` |
| Non-edit / inspect | speech/visual/understanding/fallback | `read_only` |
| Consented apply IPC | (n/a) | `consented_apply` |

---

## 6. Before architecture

```text
editingContext + allowAgentEdits
  → full mutating tools
  → addTrim may succeed
  → chat ships document unless canApply card exists
  → blocked no_safe card does NOT suppress ship
  → UI can show applied: + No safe edit found
```

---

## 7. After architecture

```text
editingContext
  → mutationMode=proposal_only
  → executeAgentTool refuses mutators (code mutation_authority_proposal_only)
  → fingerprint editorial unchanged
  → chat will not ship editorial FP changes
  → final prose bound: cannot claim applied without verified commit
  → proposals/cards still built for review
```

---

## 8. Mutation authority contract

Module: `electron/ai-edition/mutationAuthority/`

Invariant:

> For semantic/editorial AI requests, no AxcutDocument editorial mutation may become user-visible/persisted unless it originates from an eligible Constrained Edit Proposal, explicit consent, Apply Preview, and required verification.

---

## 9. Tool exposure policy

Tools remain **listed** (model can name intended edits). Execution is gated by `mutationMode` inside `executeAgentTool` — not prompt-only.

---

## 10. Tool execution policy

| Mode | Mutating tools |
| ---- | -------------- |
| `proposal_only` | Refuse before switch |
| `read_only` | Refuse before switch |
| `deterministic_edit` | Allowed if `editsAllowed` |
| `consented_apply` | Allowed if `editsAllowed` (Apply Preview only) |

---

## 11. Document propagation / persistence audit

`chat-service` return gate:

- `proposal_only` / `read_only`: **never** return document if editorial fingerprint changed  
- transcript-only (FP unchanged) may still ship  
- `deterministic_edit`: prior behavior (suppress only when consentable `canApply` card present)

Renderer cannot auto-apply an unverified semantic tool document because it is not returned.

---

## 12. Chat-response truth binding

`bindFinalResponseToTransactionTruth`:

- Strips / rewrites false “applied / shortened / added N trims” on proposal_only/read_only  
- Consentable proposal → “review below… Nothing has been changed yet.”  
- Blocked-only → “haven’t applied… preserves important explanation…”

---

## 13. UI review-card cleanup

`preservesFor` / `humanizePreserveText` in `buildReviewCard.ts`:

- Drops internal IDs, “Pixels Unresolved”, source-resolution dumps  
- Surfaces product language (“Your spoken words…”, “corrected explanation about Effects”, etc.)

---

## 14. Deterministic-edit decision

**Preserve existing direct-tool behavior** for `deterministicEdit` (e.g. `Trim 5.0-7.0 seconds.`) when Project edits are on.

Rationale: not the observed bypass; changing it was not required to close the semantic safety hole. Explicitly tested.

---

## 15. Semantic editorial decision

**Hard refuse** direct agent mutations. Cognition may plan/propose only. Commit solely via Consent → Apply Preview.

---

## 16. Case A–H results

| Case | Result |
| ---- | ------ |
| A semantic shorten | **PASS** — live: mode `proposal_only`, executed mutators `[]`, FP unchanged, no applied claim |
| B unsafe opening cut | **PASS** (unit + product path) — proposal `no_safe_proposal`; mutation 0 |
| C safe dead-air + consent | **PASS** via Apply Preview suites; live natural ready = not found this run |
| D Upwork | Covered by existing proposal/plan guards + proposal_only (no direct mut) |
| E Settings | Same |
| F Case 4 | Same (speech path read_only / no invented panel edit) |
| G non-edit question | **PASS** — `read_only`; mutators refused |
| H deterministic trim | **PASS** — `deterministic_edit`; `addTrim` still allowed |

---

## 17. Real-video runtime proof

Artifacts under `tmp/perception-benchmark/single-mutation-authority-v1/`:

### Run 1 (no consent)

Recording: `recording-bug5-narrated.mp4` (case-007)  
Prompt: *Make this video shorter and more professional, but keep the important explanation.*

```json
{
  "deliveryStatus": "completed",
  "mutationMode": "proposal_only",
  "mutatingToolsExecuted": [],
  "fingerprintUnchanged": true,
  "finalClaim": "nothing_applied",
  "claimsAppliedInProse": false,
  "proposalReadiness": "no_safe_proposal"
}
```

### Run 2

`NO_NATURAL_SAFE_PROPOSAL_REQUIRED_FOR_PASS` — did not manufacture a ready proposal. Consented apply remains proven in Apply Preview unit/integration tests.

### Tool-level refusal

`case-A-tool-refusal.json` — `addTrim` → `mutation_authority_proposal_only`, FP unchanged.

---

## 18. Mutation telemetry

Per turn on `InvokeResult.mutationAuthority`:

- requestClass, mutationMode  
- attempted / executed / rejected mutators  
- fingerprints before/after  
- proposal id/readiness  
- finalResponseClaim  
- providerUsage fields (frames/bytes when known; tokens `not_available` unless provider exposes them)

---

## 19. Token/cost telemetry availability

Instrument-only: frames attached + total image bytes recorded when visual prep exists. Text/image/output tokens and USD cost: **`not_available`** (provider usage metadata not wired). No invented estimates.

---

## 20. Tests and exact counts

| Suite | Result |
| ----- | ------ |
| `mutationAuthority.test.ts` | 10 passed |
| `mutation-authority.runtime.test.ts` | 3 passed |
| `uiConsentV1.test.ts` | passed (with suite) |
| `applyPreviewV1.test.ts` | passed |
| `editProposalV1.test.ts` | passed |
| `deep-agent/service.test.ts` | 72 passed |

---

## 21. Regressions

Semantic turns that previously auto-trimmed will **stop mutating** until the user approves a ready proposal. That is intentional. Models may still *attempt* writes and receive refusal payloads (or may not attempt — observed live: zero attempts).

---

## 22. Files changed

| Path | Change |
| ---- | ------ |
| `electron/ai-edition/mutationAuthority/*` | Authority resolver, truth binding, telemetry, tests, runtime proof |
| `electron/ai-edition/agent-tools.ts` | Refuse mutators for `proposal_only` / `read_only` |
| `electron/ai-edition/deep-agent/service.ts` | Wire mode, telemetry, truth binding |
| `electron/ai-edition/chat-service.ts` | Do not ship editorial mutations on semantic/read-only |
| `electron/ai-edition/applyPreview/apply.ts` | `mutationMode: consented_apply` |
| `electron/ai-edition/uiConsent/buildReviewCard.ts` | WILL KEEP humanization |
| `src/native/contracts.ts` | Optional `mutationAuthority` on chat result |

---

## 23. Remaining limitations

1. Deterministic lane still direct-mutates (by design).  
2. Natural live `proposal_ready` + consent not demonstrated this run.  
3. Provider token/cost usage still largely `not_available`.  
4. TPM/frame packing still a separate survival issue.  
5. Soft generic advice in finals may still appear; applied-claims are gated.

---

## 24. Recommended next milestone

**Bounded multimodal evidence packing for the final LLM call** (frame budget / downscale) — so longer recordings do not 429 TPM while authority stays intact.

Do **not** start multi-edit autonomy next.

---

## 25. Final verdict

### `PASS_WITH_LIMITATIONS`

Semantic AI editing now has **one trustworthy mutation path**: Proposal → Consent → Apply Preview. The parallel agent-tool bypass for editorial turns is closed at the executor and persistence layers.

**STOP.**
