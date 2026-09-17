# AI_EDITORIAL_DIRECTOR_QUALITY_AND_COMPLETE_VISUAL_PROOF_V1_REPORT

**Verdict: PASS_WITH_LIMITATIONS**

## Summary

Chat → local professional orchestrator now builds readable source/target stories, emits `EditorialTransformationDecisionV1` rows (problem → goal → transform), rejects conversational title paste, ships authorable CUT|DISSOLVE, runs `FinalEditorialQualityReviewV1` with one bounded title revision, and completed a real Chat-style E2E on `recording-1789233035387` with useful-edit precision **1.0** and **0 BAD** transforms.

Limitations: this recording correctly withheld title/zoom/callout/transition (no safe title meaning, no focal, single-clip); full Pixi compositor export of the edited programme is not available in the Node harness (ffmpeg remux of source + document/timeline proof + source frames around the sped span).

## A. Runtime audit

Artifacts:
- `tmp/perception-benchmark/editorial-director-quality-v1/current-runtime-trace.json`
- `tmp/perception-benchmark/editorial-director-quality-v1/current-director-audit.json`

Path confirmed in production code (not reports): Chat UI → IPC → chat-service local-first → `runProfessionalEditOrchestrator` → perception/Temporal → source/target story → Deterministic Director → skill registry → opportunities → compiler → verified sequential Apply Preview → live document ship → FinalSequence QC → FinalEditorialQualityReview → user receipt.

## B. Tool-availability ≠ editorial decision

- `EditorialTransformationDecisionV1` + `decideApplyOrKeep` + `isToolAvailabilityOnlyReason`
- Wired via `buildTransformationDecisions` into orchestrator `autonomous.transformationDecisions`
- APPLY requires grounded opportunity + clear editorial problem + target-story improvement

## C–D. Source / target story

Readable artifacts from E2E:
- `source-story.md`
- `target-story.md`
- `story-diff.md`

Whole-video beats from transcript, silence, visual stability, focal coverage, dead-air — UNKNOWN preserved where evidence missing.

## E. Title quality

- `titleQuality.ts`: reject conversational filler; derive 2–8 word titles; skip short clips / existing titles / no safe meaning
- Unit tests: conversational, tutorial, no meaning, already present, short clip
- E2E: no “This is a cursor I am working with” title committed

## F–I. Zoom / speed / trim / callout

Unchanged geometry authority; zoom/callout remain focal-gated. E2E committed **speed 1.25×** on stable low-info span; trim/zoom/callout correctly not forced.

## J. Transition primitive

Closed smallest gap:
- `clip.incomingTransition` `{ kind: cut|dissolve, durationSec? }`
- `setClipIncomingTransition` agent tool + VERIFIED_APPLY + fingerprint/verify
- Compositor `incomingFadeHalfSec` / dissolve opacity path
- Skill registry: TRANSITIONS = `FULL_AUTONOMOUS_PATH`
- Autonomous dissolve only when multi-clip + `wantDissolve`; single-clip tutorials KEEP CUT

## K. Skill honesty

COLOR / DENOISE / SLOW_MOTION / PAN / etc. remain MISSING or EXECUTION_ONLY in registry; unsupportedDesiredSkills reported honestly. Loudness is polish, not sole professional proof.

## L. Multi-edit coherence

Director + collision helpers + opportunity ranking; 12-op budget ≠ target. E2E plan: speed + captions (+ loudness settings). No title+zoom+callout clutter.

## M–N. Final review + revision

`FinalEditorialQualityReviewV1` on E2E: `PROFESSIONALLY_IMPROVED` (speed + non-caption editorial family). `revisionUsed=0` (no bad title to remove). Already-good fixture: `TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT`, **0 title commits**.

## O–Q. Real Chat E2E + manual review

Prompt (Chat product orchestrator entry, verified_apply):

> Make this video professional and ready to publish. Keep the important explanation… You decide.

Also tested short: “Make this video professional. You decide.”

| Edit | Label |
|------|-------|
| speed 1.25× @ 10.15–13.85s | GOOD |
| captions | ACCEPTABLE |
| loudness +12 dB | ACCEPTABLE |

- **USEFUL_EDIT_PRECISION = 1.0**
- **BAD_TRANSFORMATIONS = 0**

## R. Chat receipt

User-facing text describes committed speed / audio / captions only — no fingerprints / Apply Preview / Temporal jargon. Title not claimed.

## S. Regressions retained

Caption verified apply, loudness, dead-air policy, focal restraint, speed verify, title/addGraphic verify path, Chat shipping, undo/persistence/rollback contracts, FinalSequence QC, already-good restraint (tested).

## T. Acceptance matrix

| Gate | Value |
|------|-------|
| CHAT_TO_AUTONOMOUS_EDITOR | PASS |
| ACTIVE_PROJECT_GROUNDING | PASS |
| WHOLE_VIDEO_UNDERSTANDING | PASS |
| SOURCE_STORY_QUALITY | PASS |
| TARGET_STORY_QUALITY | PASS |
| STORY_DIFF | PASS |
| EDITORIAL_DIRECTOR_QUALITY | PASS |
| TOOL_AVAILABILITY_BIAS_REMOVED | PASS |
| TITLE_EDITORIAL_QUALITY | PASS |
| TRIM_EDITORIAL_QUALITY | PASS (correctly withheld) |
| ZOOM_EDITORIAL_QUALITY | PASS (correctly withheld) |
| SPEED_EDITORIAL_QUALITY | PASS |
| CALLOUT_EDITORIAL_QUALITY | PASS (correctly withheld) |
| TRANSITION_PRIMITIVE | PASS |
| TRANSITION_AUTONOMOUS | LIMITED (single-clip; primitive ready) |
| MULTI_EDIT_COHERENCE | PASS |
| COLLISION_RESOLUTION | PASS |
| SEQUENTIAL_VERIFIED_EXECUTION | PASS |
| LIVE_EDITOR_SHIPPING | PASS |
| FINAL_VIDEO_RENDER | LIMITED (ffmpeg remux; Pixi export not in harness) |
| FINAL_EDITORIAL_QUALITY_REVIEW | PASS |
| BOUNDED_REVISION | PASS (wired; unused this run) |
| ALREADY_GOOD_RESTRAINT | PASS |
| REAL_CHAT_E2E | PASS |
| VISIBLE_EDITORIAL_TRANSFORMS | LIMITED (speed/captions/loudness; no title/zoom/callout/transition) |
| USEFUL_EDIT_PRECISION | 1.0 |
| BAD_TRANSFORMATIONS | 0 |
| FINAL_ASSESSMENT | PASS_WITH_LIMITATIONS |
| TRIM_COMMITTED | 0 |
| ZOOM_COMMITTED | 0 |
| SPEED_COMMITTED | 1 |
| TITLE_COMMITTED | 0 |
| CALLOUT_COMMITTED | 0 |
| TRANSITION_COMMITTED | 0 |
| CAPTIONS_COMMITTED | 1 |
| LOUDNESS_COMMITTED | 1 |
| TOTAL_PAID_AI_CALLS | 0 |
| AUTO_UNVERIFIED_MUTATIONS | 0 |
| MAX_MUTATIONS_PER_PREVIEW | 1 |
| AUTONOMOUS_EDITOR_PRODUCT_STATUS | FUNCTIONAL_WITH_KNOWN_GAPS |

## U. Verdict rule check

1–7, 9–13 met. Item 8: explicit export blocker/limitation documented — remux artifact present, not full compositor programme bake.

**PASS_WITH_LIMITATIONS** (not FAIL): product path works; director quality/title/transition/review shipped; visual family breadth limited by evidence on this recording + export harness gap.

## V. HARD STOP

No color engine, denoise model, object detector, paid AI, transition library, or architecture rewrite started.

## Artifacts

`tmp/perception-benchmark/editorial-director-quality-v1/`

- current-runtime-trace.json, current-director-audit.json
- input-document.json, source-story.md, target-story.md, story-diff.md
- director-decisions.json, skill-consideration.json, plan.json
- execution-receipts.json, final-document.json, final-editorial-review.json
- chat-shipping.json, export-note.json, manual-quality-review.json
- already-good-restraint.json, short-prompt-plan.json
- final-professional-edit.mp4
- frames/before-speed.jpg, frames/speed-region-mid.jpg
