# AI Local Editorial Focal Evidence V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1`  
**Artifacts:** `tmp/perception-benchmark/local-editorial-focal-evidence-v1/`  
**Date:** 2026-09-15

## ENGINEERING_VERDICT

**PASS.** OpenScreen now has a local-first focal-evidence layer that turns temporal
cursor behavior (plus optional visual/OCR corroboration) into grounded targets,
then restrains zoom/crop unless the target is `GROUNDED` and editorial policy
allows emphasis. Wired into Professional Edit Orchestrator. Zero paid AI.

Precision over edit count: recording-1789454384941 correctly keeps **zero zooms**
(no cursor sidecar). A different local recording with real click telemetry proves
`ZOOM_ELIGIBLE` → planned zoom.

## What shipped

Module: `electron/ai-edition/editorialFocalEvidence/`

| Piece | Role |
|-------|------|
| `EditorialFocalEvidenceV1` | Evidence kinds (dwell/click/cluster/approach/visual/OCR/protected/…) |
| `GroundedEditorialFocalTargetV1` | Status: GROUNDED / WEAK / AMBIGUOUS / CONFLICTING / NO_TARGET |
| Cursor metrics | Velocity, dwell, cluster, convergence — not “cursor = zoom” |
| Targeted investigation | Bounded window Q&A; `additionalDecodePasses: 0` |
| Zoom/crop decisions | Eligible only when grounded + persistence + preservation |
| Temporal bridge | `EDITORIAL_FOCAL_EVIDENCE` / `EDITORIAL_FOCAL_TARGET` records |
| Orchestrator bridge | Only ZOOM_ELIGIBLE → `GroundedFocalTargetV1` for verified apply |

Professional orchestrator (`run.ts`):

1. Loads cursor sidecar when samples not injected  
2. Runs `analyzeEditorialFocalEvidence`  
3. Plans zoom only from eligible grounded focals  
4. Continues dead-air / loudness / captions when focal absent  
5. User copy uses editor language (“tightening the view…”) — no jargon  

## Case matrix (SYNTHETIC unit)

| Case | Result |
|------|--------|
| A crossing | no GROUNDED / no zoom |
| B parked | WEAK / no zoom |
| C click+dwell | GROUNDED / ZOOM_ELIGIBLE |
| D cluster | GROUNDED |
| E competing | CONFLICTING / no zoom |
| F fullscreen scene | no focal |
| G OCR alone | no zoom |
| H click+OCR | GROUNDED HIGH |
| I webcam protect | PRESERVATION_CONFLICT |
| J existing zoom | EXISTING_ZOOM_SUFFICIENT |
| K trim remap | STALE_BUT_REMAPPABLE / STALE_AND_INVALID |
| L no evidence | skip zoom; not a hard fail |
| M already-good | no speculative zoom |

## Real product E2E (`recording-1789454384941`)

- Captions already enabled — preserved; other families continued  
- Cursor sidecar: **absent** → `NO_GROUNDED_FOCAL_TARGET` → no zoom (PASS)  
- Loudness still committed when safe  
- User-facing text free of internal jargon  
- `TOTAL_PAID_AI_CALLS: 0` · `AUTO_UNVERIFIED_MUTATIONS: 0`

## Positive zoom proof

- **REAL_POSITIVE_ZOOM_PROOF: AVAILABLE** on `recording-1788894882204.mp4`  
  (128 cursor samples, click+dwell → ZOOM_ELIGIBLE, depth 3 / 1.8×, planned zoom)

## Acceptance gates

```
ENGINEERING_VERDICT: PASS

EXISTING_EVIDENCE_REUSE: PASS
CURSOR_TEMPORAL_ANALYSIS: PASS
VISUAL_CORROBORATION: PASS (context only; never alone)
OCR_OPTIONAL_REUSE: PASS (optional; never alone)
TARGETED_TEMPORAL_INVESTIGATION: PASS
FOCAL_TARGET_CONTRACT: PASS
AMBIGUITY_HANDLING: PASS
PROTECTED_CONTENT_HANDLING: PASS
TEMPORAL_CONTEXT_INTEGRATION: PASS
SOURCE_PROGRAMME_REMAP: PASS
ZOOM_EDITORIAL_RESTRAINT: PASS
ZOOM_GEOMETRY_DERIVATION: PASS
CROP_RESTRAINT: PASS (NO_CROP without aspect reason)
PROFESSIONAL_ORCHESTRATOR_INTEGRATION: PASS
POST_TRIM_REVALIDATION: PASS
REAL_PRODUCT_E2E: PASS (zero speculative zoom)
REAL_POSITIVE_ZOOM_PROOF: AVAILABLE
SYNTHETIC_POSITIVE_ZOOM_PROOF: N/A (real proof available)
ALREADY_GOOD_RESTRAINT: PASS
REGRESSION_STATUS: PASS (focal + orchestrator unit suites green)

GROUNDED_TARGET_PRECISION: PASS
UNSUPPORTED_ZOOM_SURFACED: 0
SPECULATIVE_ZOOM_COMMITS: 0

ADDITIONAL_MEDIA_DECODE_PASSES: 0
TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0
```

## Hard stop

Stopped after audit → implementation → unit/corpus → real E2E → positive zoom
proof → regression → this report.

**Not started:** transitions, denoise, AI vision, paid OCR, object-detection
downloads, multi-edit transactions, new compositor/timeline.

Next step (per user): record a new video and test OpenScreen manually.
Do not auto-choose the next milestone.
