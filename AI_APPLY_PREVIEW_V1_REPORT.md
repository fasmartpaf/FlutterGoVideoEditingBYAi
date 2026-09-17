# OpenScreen Consent + Apply Preview V1 Report

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_APPLY_PREVIEW_V1`  
**Prerequisites:** Constrained Edit Proposal V1 (+ full cognition chain above it)  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: One consented eligible proposal max. No multi-edit. No autonomous editing. No automatic repair.

---

## Executive verdict

PASS_WITH_LIMITATIONS. Consent + Apply Preview V1 proves OpenScreen can take one evidence-backed `proposal_ready` proposal, require explicit consent bound to a document fingerprint, mutate the real AxcutDocument through `executeAgentTool` (transactional full-document snapshot), independently verify structure + must-survive preservation, and roll back when verification fails. Case 2 / Upwork / Case 4 provisional / Settings / narrated paths produce **mutations = 0**. Safe dead-air trim fixture and forced verification-failure fixture exercise the real tool path. Orchestration LLM calls = **0**.

---

## Existing mutation architecture audit

### AxcutDocument mutation path
- Primary gate: `executeAgentTool(document, name, args, options?)` in `electron/ai-edition/agent-tools.ts`.
- Mutating tools (including `addTrim`) return a **new** document; they do not mutate in place.
- Agent holder: `DocumentHolder = { current: AxcutDocument }` in `deep-agent/service.ts`; success replaces `holder.current`.

### Persistence
- Agent return alone is not durable. Renderer path (`applyAgentDocumentIfCurrent` → `saveDocument`) writes disk.
- Apply Preview V1 returns the resulting document to the caller; it does **not** write AxcutDocument to disk itself.

### Undo / history
- Renderer: full-document undo snapshots (`src/lib/ai-edition/store/undo.ts`).
- Chat checkpoints use `structuredClone`.
- Apply Preview does **not** invent a second history system; it uses a pre-apply `structuredClone` snapshot for exact rollback within the apply transaction.

### Tool execution behavior
- Tool `ok: true` means the function completed and returned a document (when mutating).
- It does **not** mean editorial quality or independent post-state verification.
- `editsAllowed === false` → mutating tools return `consent_required` without mutation.

### Source ↔ timeline mapping
- Evidence / proposals use **SOURCE_MEDIA_TIME**.
- `addTrim` arguments are **source seconds** on the asset/clip (`startSec`/`endSec`).
- Zooms / some modifiers use virtual ms via `resolvePlaybackSegments` / locate helpers.
- Apply Preview V1 records requested landing as `SOURCE_MEDIA_TIME` and applies trim in source seconds without converting transcript times as timeline times.

### Audit answers (Phase 0)

| # | Question | Finding |
|---|----------|---------|
| 1 | Which tools mutate AxcutDocument? | `MUTATING_TOOL_NAMES` via `executeAgentTool` (`addTrim`, `addZoom`, `setClipCrop`, …) |
| 2 | Where does mutation become persistent? | Renderer save after accepting agent document — not inside Apply Preview |
| 3 | Undo/history/transaction? | Renderer undo + clone checkpoints; Apply Preview uses full-doc snapshot |
| 4 | In-place vs new state? | **New document** returned |
| 5 | Clip/asset validation? | Inside tool (`Unknown asset` / `Unknown clip`) + Apply Preview preflight |
| 6 | Source→timeline map? | Evidence = source; trim = source sec; virtual mapping elsewhere |
| 7 | Tool success meaning? | Function completed — **not** verified quality |
| 8 | Pre-mutation snapshot? | `structuredClone(doc)` + SHA-256 relevant fingerprint |
| 9 | Exact rollback? | Restore snapshot; re-fingerprint must match |
| 10 | Render/preview validation? | V1 structural + preservation only; quality left `structurally_valid_but_quality_unverified` |

**Transaction decision: A — full AxcutDocument snapshot** (safest match to existing undo/chat patterns; exact restore; no parallel document model).

---

## Architecture implemented

```text
Constrained Edit Proposal V1
        ↓
Proposal Eligibility
        ↓
Preflight (fingerprint, asset/clip, capability, stale)
        ↓
Consent Gate (proposal_ready ≠ consented_for_preview)
        ↓
PreApplySnapshot (structuredClone)
        ↓
Transactional Single Apply (MAX_MUTATIONS_PER_PREVIEW = 1)
        ↓
Post-Edit Verification (structural + must-survive + damage notes)
        ↓
ACCEPT (verified)  or  ROLLBACK (rolled_back / rollback_failed)
        ↓
STOP
```

Service wiring: `prepareApplyPreviewDiagnostics` only — **never auto-applies**. Mutation requires `runConsentedApplyPreview` with explicit `selectedProposalId` + matching `preflight` + `consent`.

---

## Files changed

| Path | Role |
|------|------|
| `electron/ai-edition/applyPreview/types.ts` | Lifecycle, preflight, consent, receipt types |
| `electron/ai-edition/applyPreview/fingerprint.ts` | Deterministic relevant-document SHA-256 |
| `electron/ai-edition/applyPreview/preflight.ts` | Eligibility + preflight builder |
| `electron/ai-edition/applyPreview/consent.ts` | Consent mint/validate |
| `electron/ai-edition/applyPreview/apply.ts` | Snapshot + `executeAgentTool` apply |
| `electron/ai-edition/applyPreview/verify.ts` | Structural + must-survive verification |
| `electron/ai-edition/applyPreview/run.ts` | Orchestrator (0 LLM) |
| `electron/ai-edition/applyPreview/index.ts` | Public exports |
| `electron/ai-edition/applyPreview/NOTICE.md` | Scope / non-goals |
| `electron/ai-edition/applyPreview/applyPreviewV1.test.ts` | Behavioral + real mutation/rollback tests |
| `electron/ai-edition/deep-agent/service.ts` | Diagnostics-only `applyPreviewV1` on InvokeResult |
| `tmp/perception-benchmark/apply-preview-v1/` | New benchmark artifacts (prior identities preserved) |

---

## Proposal eligibility contract

ALL required for proceed:

- `status === proposal_ready`
- `proposedCall.notExecuted === true`
- landing present, `SOURCE_MEDIA_TIME`, `end > start`
- supported tool (`addTrim` in V1)
- asset resolvable; clip resolvable when needed
- not stale vs `proposalDocumentFingerprint`
- no blocking preservation/continuity/damage risks
- mutation budget ≥ 1

Explicit rejects (never upgraded): `provisional`, `no_safe_proposal`, `needs_more_evidence`, `unsupported`, stale, missing landing/asset, unsupported capability.

---

## Preflight architecture

`ApplyPreflight`: proposalId, eligible, documentFingerprint, assetId/clipId, capability, toolName, landing, mustSurviveIds, damageRiskLevels, stale, blockingReasons, preflightMs.

---

## Stale-proposal protection

Fingerprint hashes: project primary asset, assets (id/path/duration), clips (source + timeline bounds), trimRanges, speedRanges, zoomRanges.

Mismatch → `stale_proposal` → fail closed. No silent arg regeneration.

---

## Consent architecture

- `proposal_ready` ≠ `consented_for_preview`
- Consent binds: proposalId + preflightId + documentFingerprint + scope `single_proposal_preview`
- Document change after consent → must re-preflight (fingerprint mismatch)
- Tests use `mintTestConsent` / `createApplyConsent`; production must not treat proposal creation as consent

---

## Transaction/snapshot decision

**A — full AxcutDocument snapshot** via `structuredClone` immediately before mutation.  
Rationale: matches existing undo/chat clone patterns; exact restore; reversible without inventing a patch algebra for every tool.

---

## Apply mechanism

- Translates approved proposal into existing tool contract (`addTrim` only in V1)
- Landing source times forced into args; no editorial reinterpretation
- Records toolName + sanitized args (strips path/secret-like keys)
- `MAX_MUTATIONS_PER_PREVIEW = 1`; no second proposal auto-run

---

## Application receipt

`EditApplicationReceipt` includes proposal/preflight/consent ids, tool, before/after fingerprints, mutation flags, landings, verificationStatus, rollbackStatus, latency breakdown, `additionalOrchestrationModelCalls: 0`.

Receipt = evidence mutation was attempted/verified — **not** that the video is “better.”

---

## Post-edit structural verification

Independent of tool return:

- Fingerprint change / requested trim presence
- No accidental clip deletion
- Valid clip/trim bounds
- Document serializable
- Unrelated clip fields unchanged

---

## Must-survive verification

Uses proposal `mustSurvive` + transcript speech segments + optional `survive:start-end` ranges in reasons.  
Full coverage of protected speech by new trim → verification fail → rollback.

---

## Damage-risk verification

Bounded deterministic notes (overlap, multi-trim, unrelated clip).  
No universal perceptual quality score. Terminal quality honesty:

`verificationStatus = structurally_valid_but_quality_unverified` on accept.

---

## Rollback architecture

On verification failure: restore snapshot → re-fingerprint → `rolled_back` if match, else `rollback_failed`.  
Never reports success when apply succeeded but verification failed.

---

## Lifecycle/state machine

Observed happy path:

`proposal_received → preflight_passed → awaiting_consent → consented → applying → applied → verifying → verified`

Failure paths: `preflight_blocked`, `blocked_no_consent`, `apply_failed`, `verification_failed → rolling_back → rolled_back|rollback_failed`.

---

## Case 2 result

**BLOCKED** — fixture `no_safe_proposal` (HUD / restart).  
`mutations = 0`. Artifact: `tmp/perception-benchmark/apply-preview-v1/case2-blocked.json`.  
PASS (refusal is success).

---

## Upwork result

**BLOCKED** — `mutations = 0`. Artifact: `upwork-blocked.json`.  
PASS.

---

## Case 4 result

**BLOCKED** as `provisional` — does not force unsafe trim. `mutations = 0`.  
Artifact: `case4-blocked.json`.  
PASS (honest non-execution).

---

## Settings result

**BLOCKED** — `needs_more_evidence` + unsupported zoom. `mutations = 0`.  
PASS.

---

## Narrated stable result

**BLOCKED** — `no_safe_proposal`. `mutations = 0`.  
PASS (no manufactured edit).

---

## Safe real-mutation fixture result

Dead-air silence 5–8s, `proposal_ready` trim, consent, real `addTrim` via `executeAgentTool`:

- `terminalStatus = verified`
- `mutationsApplied = 1`
- before/after fingerprints differ
- corrected Effects speech 8–12 survives
- clip_2 untouched
- Artifact: `safe-mutation-receipt.json`

PASS (concrete evidence).

---

## Forced verification-failure + rollback result

1. Mutation occurs (`applied` in lifecycle)
2. `forceVerificationFailure` / preservation-violating trim fails verify
3. Rollback restores original fingerprint
4. `terminalStatus = rolled_back`, `mutationsApplied = 0` on receipt, trimRanges empty

Artifacts: `rollback-receipt.json` + forced-failure test.  
PASS.

---

## Source/timeline timing proof

Landing recorded as `SOURCE_MEDIA_TIME`; trim applied with matching `startSec`/`endSec` source bounds (5–8). No transcript→timeline direct misuse in apply layer.

---

## Mutation isolation proof

After safe apply, `clip_2` deep-equals pre-apply clone; only one new trim range.

---

## Model-call count

`additionalOrchestrationModelCalls = 0` on receipts and diagnostics.  
No planner LLM added for apply decisions.

---

## Tool-call/mutation count

| Scenario | toolCalls | mutationsApplied |
|----------|-----------|------------------|
| Blocked cases | 0 | 0 |
| Safe verified | 1 | 1 |
| Rollback after fail | 1 (attempted) | 0 (receipt after restore) |

---

## Latency breakdown

Receipt fields: `preflightMs`, `snapshotMs`, `applyMs`, `structuralVerificationMs`, `preservationVerificationMs`, `rollbackMs`, `totalMs`. Measured per run in tests (fixture-scale; not optimized).

---

## Persistence decision

| Persist? | What |
|----------|------|
| Ephemeral / caller | Apply receipt, consent metadata, preflight |
| Existing path | Document after UI accepts verified result (`saveDocument`) |
| Unchanged | Ledger, claims, stories, gap, plan, closure, proposal policies |

Do **not** dump cognition chain into AxcutDocument.

---

## Test counts/results

`npx vitest --run electron/ai-edition/applyPreview/applyPreviewV1.test.ts` → **21 passed**.

Coverage includes eligibility blocks, stale, consent binding, safe real mutation, preservation rollback, forced verification rollback, case refusals, lifecycle, single-mutation limit, 0 LLM, locked identity.

---

## Benchmark impact

New dir only: `tmp/perception-benchmark/apply-preview-v1/`.  
Prior identities preserved (not overwritten):

```text
CURRENT_OPENSCREEN
CURRENT_OPENSCREEN_INVESTIGATOR_V1
CURRENT_OPENSCREEN_REUSE_VISUAL_V1
CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1
CURRENT_OPENSCREEN_INVESTIGATOR_V1_1
CURRENT_OPENSCREEN_SOURCE_STORY_V2
CURRENT_OPENSCREEN_TARGET_STORY_V1
CURRENT_OPENSCREEN_EDIT_GAP_V1
CURRENT_OPENSCREEN_EDIT_PLAN_V1
CURRENT_OPENSCREEN_PLANNING_CLOSURE_V1
CURRENT_OPENSCREEN_EDIT_PROPOSAL_V1
```

New: `CURRENT_OPENSCREEN_APPLY_PREVIEW_V1`.

---

## Remaining limitations

- V1 apply capability = **`addTrim` only** (zoom/crop/speed blocked as unsupported).
- Perceptual / render preview quality = **NOT_VERIFIED** (honest `structurally_valid_but_quality_unverified`).
- `rollback_failed` path is typed and coded; corrupt-restore injection not fully fixture-driven beyond fingerprint mismatch branch.
- Product UI consent surface not built — module API + service diagnostics only; agent turn never auto-mutates via this path.
- Case 4 live `proposal_ready` still not forced; provisional refusal remains correct.

---

## Recommended next milestone

Review evidence first. Candidates **after** review (do not start now):

- UI consent + single apply preview in editor
- Expand supported tools under same eligibility/verify/rollback contract
- Optional bounded render-frame check for trim landings

**Do not** begin multi-edit execution, autonomous editing, or automatic repair.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Concrete proof: one consented dead-air trim mutates real AxcutDocument via `executeAgentTool`, verifies structure + must-survive, and rolls back on verification failure; unsafe/case proposals remain at zero mutations without threshold gaming.

**STOP.**
