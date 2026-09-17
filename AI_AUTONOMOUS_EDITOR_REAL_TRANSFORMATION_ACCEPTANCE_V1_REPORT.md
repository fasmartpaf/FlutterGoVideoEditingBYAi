# AUTONOMOUS_EDITOR_REAL_TRANSFORMATION_ACCEPTANCE_V1_REPORT

**Verdict: PASS_WITH_LIMITATIONS**

## Objective

Prove whether `recording-1788978271417` becomes professionally better through the **real Chat → verified apply → production compositor** path — not that many families can commit.

## What changed (product fixes, not architecture)

1. **Title quality**
   - Root cause of “Screen Recording with Limited Labeled Speech”: `story.communicates` / source summary used evidence-quality fallbacks that title derivation preferred.
   - Removed those fallbacks as title sources; reject metadata/evidence-quality and conversational fragments (`I think you can see`, repeated words, etc.).
   - Unit tests cover prior bad strings.

2. **Callout vs zoom**
   - Callout no longer auto-stacks with `ZOOM_ELIGIBLE`.
   - Requires nearby narration **and** a useful grounded label; otherwise KEEP (“zoom covers emphasis”).

3. **Chat path ↔ production compositor**
   - `invokeOpenScreenAgent` local-first professional block now attaches `NativeCompositorFrameSampler` when the native addon is available.
   - Returns `professionalEditOrchestratorV1` on the early Chat return for product evidence.

4. **Bounded revision**
   - Conversational/metadata titles removed in the revision cycle when review fails TITLE_QUALITY.

## E2E (required path)

Entry: **`invokeOpenScreenAgent`** (same local-first Chat gate as in-app).

Fixture: clean document for **`recording-1788978271417`**.

Prompt: professional / ready to publish / You decide (as specified).

### Final committed editorial state

| Family | Decision | Result |
|--------|----------|--------|
| zoom | APPLY | **committed** (enter→hold→exit, depth 3, scale 1.8, focus ~0.52/0.55) |
| title | KEEP | withheld — conversational / no safe topic |
| callout | KEEP | withheld — zoom sufficient / label not useful |
| trim | KEEP | speech-adjacent / protected context |
| speed | KEEP | protected speech/explanation |
| captions | APPLY | committed (polish) |
| loudness | settings | committed (polish) |
| transition | KEEP | single-clip |

Chat receipt (actual):

> I improved the video by balancing the audio, enabling captions, tightening the view around the part of the screen you were actively demonstrating.

### First-pass failure (documented, then fixed)

An earlier acceptance attempt on this fixture committed garbage title (“I Think You Can See”) + fragment callout (“on it and I”). That violated title/callout quality. Policies were tightened and the run was repeated. **Final artifacts reflect the corrected run.**

## Production rendering — gap closed

| Check | Result |
|-------|--------|
| Native compositor addon | present (`hardware`) |
| Frame capture path | **`live_readFrame`** (not source screenshots, not injected) |
| Zoom before/enter/hold/exit/after | captured under `proof/zoom/` |
| Full programme export | **`CompositorViewService.exportMulti` on EDITED document** → `final-professional-edit.mp4` (~8.3 MB) |

See `renderer-export-trace.json`.

## Manual quality (editorial only; captions/loudness excluded)

| Edit | Label |
|------|-------|
| zoom | GOOD — native frames show programme progression; verification `zoom_rendered_as_specified` |

- **USEFUL_EDIT_PRECISION = 1.0** (1/1 editorial)
- **BAD_TRANSFORMATIONS = 0**

## Focal ambiguity (policy not loosened)

Investigated 3 AMBIGUOUS_TARGET recordings from the breadth probe:

- Clicks **are present** (5–9).
- Targets exist but marked **LOW confidence / conflict** → `AMBIGUOUS_TARGET`.
- Assessment: not “zero evidence”; useful click clusters may be over-merged/conflicted. **No threshold loosen** in this milestone.

Primary fixture remains `ZOOM_ELIGIBLE` / `GROUNDED_EMPHASIS`.

## Why trim/speed from the breadth probe did not commit here

`transformation-decisions.json` shows trims/speeds considered then KEEP for protected speech / speech-adjacent pauses. Under clean Chat + this prompt + current dead-air policy, **restraint won**. That is not the same as “failed to run.” Breadth probe differences likely include project/transcript/dead-air state variance — not re-asserted as a quota.

## Acceptance matrix

| Gate | Value |
|------|-------|
| REAL_CHAT_ENTRY | PASS (`invokeOpenScreenAgent`) |
| CLEAN_DOCUMENT_START | PASS |
| WHOLE_VIDEO_UNDERSTANDING | PASS |
| SOURCE_STORY / TARGET_STORY / STORY_DIFF | PASS |
| DIRECTOR_DECISIONS | PASS |
| TRIM_PLANNED / COMMITTED / QUALITY | considered / 0 / KEEP justified |
| ZOOM_PLANNED / COMMITTED | PASS / PASS |
| ZOOM_RENDER_VISUALLY_VERIFIED | PASS (native live_readFrame) |
| ZOOM_QUALITY | GOOD |
| SPEED_PLANNED / COMMITTED / QUALITY | considered / 0 / KEEP justified |
| TITLE_PLANNED / COMMITTED / QUALITY | considered / 0 / correctly withheld |
| CALLOUT_PLANNED / COMMITTED / QUALITY | considered / 0 / correctly withheld |
| MULTI_EDIT_COHERENCE | PASS (no title+callout+zoom stack) |
| VISUAL_CLUTTER | PASS |
| FINAL_SEQUENCE_QC | PASS |
| PRODUCTION_COMPOSITOR_USED | PASS |
| PRODUCTION_EXPORT_USED | PASS |
| FINAL_VIDEO_ARTIFACT | `final-professional-edit.mp4` |
| FINAL_VIDEO_MANUALLY_REVIEWED | PASS (frames + export) |
| USEFUL_EDIT_PRECISION | 1.0 |
| BAD_TRANSFORMATIONS | 0 |
| FOCAL_AMBIGUITY_ROOT_CAUSE | LOW-confidence/conflict targets despite clicks; no loosen |
| FOCAL_POLICY_LOOSENED | NO |
| CHAT_DOCUMENT_SHIPPED | PASS (`verified_applied`) |
| TOTAL_PAID_AI_CALLS | 0 |
| AUTO_UNVERIFIED_MUTATIONS | 0 |
| MAX_MUTATIONS_PER_PREVIEW | 1 |
| FINAL_ASSESSMENT | **PASS_WITH_LIMITATIONS** |
| AUTONOMOUS_EDITOR_PRODUCT_STATUS | FUNCTIONAL_WITH_KNOWN_GAPS |

## Why not full PASS

1. This acceptance run’s **editorial stack is zoom-primary** (trims/speeds correctly KEEP), so it does not re-demonstrate the prior 5-family breadth stack under identical Chat+export conditions.
2. Opening narration still cannot yield a safe professional title — correct restraint, but topic labeling remains a product gap for sparse speech.
3. Focal AMBIGUOUS_TARGET on other recordings still looks like **merge/conflict**, not empty cursor — investigation recorded, not fixed (out of “no global loosen” scope).

## Artifacts

`tmp/perception-benchmark/autonomous-editor-real-transformation-acceptance-v1/`

Includes required stories, decisions, plan, receipts, reviews, Chat shipping, focal investigation, renderer/export trace, proof frames, and **`final-professional-edit.mp4`**.

## HARD STOP

No new planner/Director/context architecture. No paid AI. No focal threshold loosen. No fabricated transitions.
