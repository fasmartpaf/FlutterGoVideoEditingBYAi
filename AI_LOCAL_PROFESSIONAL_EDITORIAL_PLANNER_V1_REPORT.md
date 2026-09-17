# AI Local Professional Editorial Planner V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1`  
**Prerequisite:** `CURRENT_OPENSCREEN_PROFESSIONAL_EDIT_CAPABILITY_ACTIVATION_V1`  
**Artifacts:** `tmp/perception-benchmark/local-professional-editorial-planner-v1/`  
**Date:** 2026-09-15

## Verdict

Professional editing now runs a **local editorial planner** that **consumes Temporal Context** (STANDARD packet), derives bounded story/pacing phases, emits `ProfessionalEditorialOpportunityV1` per family, and converts only `GROUNDED_READY` ops into the existing `ProfessionalEditPlanV1` → sequential verified Apply Preview path.

This is **not** another apply/verify milestone. Verified execution was already green. The gap closed here is **editorial generation + Temporal Context as real input**.

## What changed

| Layer | Before | After |
|-------|--------|-------|
| Orchestrator mode | Hybrid candidate aggregation | Evidence → Temporal packet → opportunities → plan → verified apply |
| Temporal Context | Populated elsewhere; **not consumed** by professional run | `buildAndQueryTemporalContext` + STANDARD packet **before** opportunity generation (`metrics.temporalContextConsumed: true`) |
| SPEED | `MISSING_GENERATION` | Grounded generator over stable low-info spans (1.25× / 1.5× / 2× policy); speech/focal/explanation blocks |
| CROP | `MISSING_GENERATION` | Generator present; **HONESTLY_LIMITED** without measured framing geometry (no invented crop) |
| ZOOM | Geometry eligibility only | Geometry = EditorialFocalEvidence; **usefulness** = planner (story/speech/action) |
| TRIM | Dead-air filter only | Contextual KEEP vs READY using phases + visual activity (thresholds **not** lowered) |
| Captions / loudness | Complete paths | Still complete; **no early exit**; already-good → KEEP and continue |

Module: `electron/ai-edition/professionalEditorialPlanner/`  
Wired through `professionalEditOrchestrator/run.ts` + `plan.ts` + `session.ts` (addSpeed / setClipCrop proposal wiring).

## Acceptance gates

| Gate | Result |
|------|--------|
| TEMPORAL_CONTEXT_ACTUALLY_CONSUMED | **PASS** (query + STANDARD packet; proven on real TEST1/TEST2) |
| LOCAL_EDITORIAL_OPPORTUNITY_CONTRACT | **PASS** (corpus A–M) |
| STORY_AWARE_TEMPORAL_PLANNING | **PASS** (bounded phases; no LLM rewrite) |
| TRIM_CONTEXTUAL_DECISION | **PASS** |
| ZOOM_EDITORIAL_USEFULNESS | **PASS** (TEST2 committed grounded useful zoom; corpus G keeps random) |
| SPEED_EDITORIAL_GENERATION | **PASS** (corpus D) / real runs often KEEP via preservation |
| CROP_EDITORIAL_GENERATION | **HONESTLY_LIMITED** (no speculative geometry) |
| CAPTION_DOMINANCE_REGRESSION | **PASS** (TEST1 captions KEEP; all families evaluated) |
| LOUDNESS_DOMINANCE_REGRESSION | **PASS** (continues after captions KEEP) |
| ALREADY_GOOD_RESTRAINT | **PASS** (corpus A; TEST1 plan ops = 0 from planner) |
| PRESERVATION_SAFETY | **PASS** |
| NO_EDIT_QUOTA | **PASS** |
| NO_SPECULATIVE_GEOMETRY | **PASS** |
| EXISTING_VERIFIED_APPLY_REUSED | **PASS** |
| MAX_MUTATIONS_PER_PREVIEW | **1** |
| TOTAL_PAID_AI_CALLS | **0** |
| AUTO_UNVERIFIED_MUTATIONS | **0** |

## Corpus A–M

Deterministic unit suite: `professionalEditorialPlannerV1.test.ts` — **all passed**.

Highlights: A zero unnecessary READY; B short pause KEEP; C safe trim READY; D speed READY; E/L no speed on narrated/focal action; F zoom READY; G zoom NOT_USEFUL; H/I crop geometry-only / no fullscreen invent; J/K captions+loudness KEEP while other families still planned; M multi-family ranking without caption dominance.

## Real recordings

### TEST 1 — `recording-1789463294153.mp4` (no cursor sidecar)

| Metric | Value |
|--------|-------|
| TEMPORAL_CONTEXT_RECORDS | 26 |
| EDITORIAL_OPPORTUNITIES | 8 |
| GROUNDED_READY_OPPORTUNITIES | 0 |
| PLAN_OPERATIONS (timeline) | [] |
| Cursor | NOT_AVAILABLE (not fabricated) |
| TRIM | KEEP (short pauses / contextual) |
| ZOOM | KEEP / INSUFFICIENT_EVIDENCE |
| CROP | HONESTLY_LIMITED |
| SPEED | KEEP (preservation / speech) |
| CAPTIONS | KEEP (already on) |
| LOUDNESS | APPLY via settings (`PEAK_LIMITED_SAFE_NORMALIZATION` gain=12) |

Compared to Capability Activation: same recording still does not invent zoom/crop/speed without evidence; Temporal Context is now **consumed**; family decisions are planner-backed rather than `MISSING_GENERATION`.

### TEST 2 — `recording-1788894882204.mp4` (positive focal)

Proven path:

**Temporal Context → story/pacing → focal evidence → editorial usefulness → zoom opportunity → plan → verified apply**

| Metric | Value |
|--------|-------|
| Zoom opportunity | `GROUNDED_READY` / READY |
| PLAN_OPERATIONS | `zoom:addZoom` |
| COMMITTED | zoom step verified + committed |
| SPEED | KEEP (focal conflict — correct) |
| CROP | HONESTLY_LIMITED |

### TEST 3 — newer system-mode sidecar

Optional; **not required**. No post-fix system-mode sidecar found in the scanned set. Cursor capture fix remains in place for future recordings.

## Product question (runtime-proven)

If a user records a normal screen tutorial and says *“Make this video professional. You decide.”*:

**What evidence can OpenScreen understand?**  
Speech/transcript, silence/dead-air, visual stable/activity/change intervals, cursor sidecar when present (focal geometry), caption state, loudness analysis, existing timeline edits, packed story ranges, Temporal Context coverage (with `NOT_AVAILABLE ≠ negative`).

**What editorial decisions can it independently generate?**  
Contextual trim KEEP vs READY; zoom usefulness over grounded focals; speed on low-information stable spans when speech/focal-safe; crop only with explicit framing geometry otherwise honest insufficient; captions/loudness KEEP when already good; bounded story phase hints (not semantic certainty).

**What operations can it actually execute?**  
Verified Apply Preview: trim, zoom, crop, speed, captions; loudness via settings; final-sequence QC when mutations commit. Still **one mutation per preview**.

**What still needs explicit user direction?**  
Aesthetic crop/reframe without measured unused-canvas geometry; speed on spans lacking stable visual evidence; zoom without cursor/focal evidence; any transition/denoise/stabilization; creative style that isn’t grounded in local evidence; lowering dead-air policy for sub-threshold pauses.

## Artifacts

- `current-planning-audit.json`
- `available-evidence-matrix.json`
- `generation-gap.json`
- `corpus-A-already-good.json` / `corpus-M-combination.json`
- `acceptance-gates-unit.json`
- `test1-1789463294153.json`
- `test2-1788894882204.json`
- `test3-system-mode-sidecar.json`

## HARD STOP

Milestone complete. No next milestone selected.
