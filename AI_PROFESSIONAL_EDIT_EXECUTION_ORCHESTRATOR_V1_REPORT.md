# AI Professional Edit Execution Orchestrator V1 — Report

**Identity:** `CURRENT_OPENSCREEN_PROFESSIONAL_EDIT_EXECUTION_ORCHESTRATOR_V1`  
**Date:** 2026-09-15  
**Artifacts:** `tmp/perception-benchmark/professional-edit-orchestrator-v1/`

## Verdict

OpenScreen can now turn a professional-edit request (“make this professional; preserve what matters; you decide”) into a **grounded, bounded, multi-step sequence of single verified Apply Preview transactions**, with durable plan authorization, honest unsupported-capability language, duration safety, and final-sequence join QC — without inventing geometry or multi-mutation transactions.

On `recording-1789424212470.mp4` (~13.95s), the orchestrator planned **two safe dead-air trims + captions**, committed **both trims** with native compositor verification, rolled back captions when family verify failed honesty, assessed **5–7s as not safely achievable** without important speech loss (~1.18s safe removable → ~12.8s), and final-sequence QC **PASS_WITH_WARNINGS**.

## Failed product flow (audit)

See `tmp/perception-benchmark/professional-edit-orchestrator-v1/failed-flow-audit.json`.

| # | Failure | Root gate |
|---|---------|-----------|
| 1 | “Make professional” → dead-air-only card | `selectProductRecommendation` + `single_proposal_only` |
| 2 | No multi-op 5–7s plan | Intent regex + `MAX_MUTATIONS_PER_PREVIEW=1` |
| 3 | “No safe recording-specific edit” | `enforceFinalPlanConsistency` honesty rewrite |
| 4 | “Yes proceed” not durable | UI `createApplyConsent` only; chat text never mint |
| 5 | Repeated confirmation | Stateless `CONSENT_PROMPT_BLOCK` |
| 6 | Fake transitions | Model polish; plan gate omitted transitions |
| 7 | “Re-enable project edits” | **Correctness bug:** `proposal_only` conflated with Settings OFF via `agentEditsAllowed=false` → `CONSENT_PROMPT_BLOCK` |

## What shipped

### Module: `electron/ai-edition/professionalEditOrchestrator/`

| Piece | Role |
|-------|------|
| `intent.ts` | `ProfessionalEditIntentV1` — duration ranges (`5-7 seconds`), preserve, autonomy, unsupported transitions |
| `authorization.ts` | Durable plan auth from `you decide` / `yes proceed` bound to plan fingerprint |
| `packedTranscript.ts` | `PackedEditorialTranscriptV1` planning projection (not SSOT) |
| `story.ts` | `ProfessionalEditStoryV1` — must-survive / expendable / essential ranges |
| `duration.ts` | `DurationObjectiveAssessmentV1` — never force unsafe target |
| `investigation.ts` | Focal from stable cursor only; never invent center zoom |
| `plan.ts` | `ProfessionalEditPlanV1` — READY ops only (trim / captions / grounded zoom) |
| `session.ts` | Sequential single verified applies; caption refresh after mutation; zoom stale after trim |
| `assessment.ts` | Honest user-facing summary of **committed** ops only |
| `sanitize.ts` | Strip false Settings-disabled claims; transition ads; repeated proceed asks |
| `run.ts` | Full pipeline + FinalSequenceCutQualityVerify |

### Chat / prompt wiring (`deep-agent/service.ts`)

- `PROPOSAL_ONLY_PROMPT_BLOCK` when Settings edits ON but authority is proposal_only — **never** claim Settings disabled.
- `buildSystemPrompt({ editsAllowed, mutationMode })` uses real Settings flag.
- Compact + bounded prompts updated similarly.
- Professional-edit turns: run orchestrator; prefer its user-facing text; durable auth Map by project; sanitize responses.
- `enforceFinalPlanConsistency` strips unverified **transition** promises; merges orchestrator families as `extraSupportedFamilies`.

## Real recording E2E

**Media:** `recording-1789424212470.mp4`  
**Project:** `proj_e63f1a50-…` (baseline: prior agent dead-air trims cleared for fair re-plan)  
**Artifact:** `real-recording-e2e.json`

| Field | Value |
|-------|-------|
| Original duration | 13.95s |
| Target | 5–7s |
| Duration assessment | `NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS` (safe removable ≈1.18s → ≈12.8s) |
| Plan | trim, trim, captions |
| Committed | 2× `addTrim` (native compositor verified) |
| Captions | attempted after refresh; rolled back on family verify |
| Final duration | 12.77s |
| Final sequence QC | `PASS_WITH_WARNINGS` |
| Paid AI | 0 |
| Auto unverified mutations | 0 |

## Failure acceptance (unit corpus)

Covered in `professionalEditOrchestratorV1.test.ts`: already-good / no ops; impossible duration; no invented zoom; unsupported transitions; durable auth; false Settings-disabled strip; blank compositor rollback; stale zoom after trim.

## Final matrix

```
ENGINEERING_VERDICT: PASS (bounded multi-step verified orchestration; duration honesty; chat gates fixed)
FAILED_PRODUCT_FLOW_ROOT_CAUSE: single-op product surface + Edit Plan honesty + proposal_only mislabeled as Settings OFF + no durable chat plan auth
PROFESSIONAL_EDIT_INTENT: YES
DURABLE_AUTHORIZATION: YES (plan fingerprint; you_decide / proceed)
PACKED_EDITORIAL_TRANSCRIPT: YES (projection only)
TARGET_EDIT_STORY: YES
TARGETED_TEMPORAL_INVESTIGATION: YES (cursor focal; no invent)
GROUNDED_PLAN_GENERATION: YES
MISSING_PARAMETER_RESOLUTION: YES (investigate then suppress if missing)
UNSUPPORTED_CAPABILITY_HONESTY: YES (transitions)
MULTI_STEP_ORCHESTRATION: YES (sequential single Apply Preview)
SINGLE_EDIT_VERIFICATION_REUSE: YES
CONTEXT_REFRESH_AFTER_EDIT: YES (caption rebuild; zoom stale)
STALE_STEP_REVALIDATION: YES
DURATION_OBJECTIVE_SAFETY: YES
PRESERVATION_SAFETY: YES
FINAL_SEQUENCE_VERIFY_INTEGRATION: YES
FINAL_SEQUENCE_FAILURE_HANDLING: YES (NEEDS_REVIEW / no false success)
REPEATED_CONFIRMATION_REGRESSION: YES
FALSE_PROJECT_EDITS_DISABLED_REGRESSION: YES
REAL_RECORDING_END_TO_END: YES (1789424212470)
ORIGINAL_DURATION: 13.95s
TARGET_DURATION: 5–7s
FINAL_DURATION: 12.77s (safe; target not forced)
OPERATIONS_PROPOSED: 3 (2 trim + captions)
OPERATIONS_COMMITTED: 2 (trims)
OPERATIONS_ROLLED_BACK: 1 (captions verify)
UNSUPPORTED_REQUESTS: [] (transitions not requested in this phrasing; honesty covered in unit)
TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0
PRODUCTION_DEFAULT: orchestrator on professional-edit / you_decide chat turns; still one mutation per Apply Preview transaction
NEXT_MILESTONE: optional loudness coordination path; grounded zoom remapping after trim; native caption verify reliability after prior trims — NOT transitions renderer
```

## Hard stop

Stopped after audit, implementation, deterministic corpus, real recording E2E, and this report. No transition renderer / multi-mutation transaction / paid AI dependency introduced.
