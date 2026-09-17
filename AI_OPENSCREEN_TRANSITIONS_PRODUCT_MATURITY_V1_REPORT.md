# AI_OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Milestone:** `OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1`  
**Frozen families (untouched):** ZOOM · TRIM/SHORTEN · SPEED · CAPTIONS · TITLE · CALLOUT

---

## 1. FINAL_TRANSITIONS_PRODUCT_STATUS

**FINAL_TRANSITIONS_PRODUCT_STATUS = FUNCTIONAL_WITH_GAPS**

Direct CUT|DISSOLVE control, programme-time join targeting, multi-join targeting, follow-ups, autonomous KEEP + APPLY (on constructed multi-clip from real media), undo/redo, document persistence round-trip, and receipt honesty all pass with `TOTAL_CLOUD_CALLS = 0`.

Not awarded **MATURE** because this session could not complete:

- native Metal preview frame proof (`SKIP_NO_NATIVE` — `aucun MTLDevice disponible`)
- native export proof (same Metal blocker)
- real Electron quit → relaunch → reopen UI persistence

Do **not** create `TRANSITIONS_FROZEN.md` until those gates pass.

---

## 2. Phase-1 audit (pre-fix findings)

### What OpenScreen considers a transition

A **clip join** attribute: `clip.incomingTransition` on a **non-first** timeline clip.

```ts
incomingTransition?: { kind: "cut" | "dissolve"; durationSec?: number }
```

- **CUT** = hard cut (`kind: "cut"` → scene `incomingFadeHalfSec: 0`)
- **DISSOLVE** = visual crossfade half-window (`durationSec`, default **0.35s**)
- **Unset** → native legacy default dissolve **0.35s** (`CUT_FADE_HALF_SEC`)

Not annotations, not modifiers, not overlays.

### Primitives that actually exist

| Type | Document | Compositor | Exposed in Chat |
|---|---|---|---|
| CUT | yes | yes (`incomingFadeHalfSec: 0`) | yes |
| DISSOLVE / crossfade / “fade” (mapped) | yes | yes | yes |
| Wipe / slide / blur / scale / 3D cube / dip / fade-to-black | **no** | **no** | honest refusal |

### Storage in AxcutDocument

- On `timeline.clips[i].incomingTransition` for `i > 0`
- Optional registry: `legacyEditor.transitionClipIds` (follow-up targeting, same pattern as title/callout registries)

### `buildSceneDescription`

Emits `incomingFadeHalfSec` only when `incomingTransition` is set (`sceneDescription.ts` ~717–724). Preview and export share this scene JSON.

### Native compositor

`incoming_dissolve_with_half` / Metal hold-frame mix. Audio: clip-boundary equal-power crossfade exists in the native audio path; visual dissolve does **not** invent a separate audio-mix milestone.

### Chat intents (before this milestone)

`TRANSITION` / `REMOVE_TRANSITION` tokens existed; **no direct apply path**; autonomous path had `wantDissolveTransition` but orch never set it → permanent KEEP/NOT_READY.

### Product failures that blocked maturity

1. No direct Chat add/adjust/remove  
2. “Around N seconds” stolen as `TARGET_DURATION`  
3. Autonomous dissolve never wired from target story  
4. Sanitize stripped honest transition receipts  
5. Single-clip tutorials correctly have **no join** (not a bug)

---

## 3. Exact transition primitives supported

**Authorable:** `CUT` | `DISSOLVE` only.  
**Default dissolve half-window:** `0.35s` ladder `[0.15, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4]`.

---

## 4. Root causes found

| Gap | Cause | Fix |
|---|---|---|
| No direct Chat | Missing `directTransition` + wire in `direct.ts` | Added |
| Around N → duration | `around`→`approx` + duration before transition | normalize + parse order |
| Autonomous always KEEP | `wantDissolveTransition` never passed | targetStory `DISSOLVE` + orch rebuild |
| False “unavailable” copy | `stripUnsupportedTransitionClaims` + transformationSummary | Allow honest apply; drop unavailable claim |
| Multi-join “here” | Ambiguous without time/ordinal | Require time / first|second / between clips |

---

## 5. Exact files changed

| File | Role |
|---|---|
| `electron/ai-edition/localEditorialChat/directTransition.ts` | **new** — add/adjust/remove, join targeting |
| `electron/ai-edition/localEditorialChat/direct.ts` | Wire TRANSITION / ADJUST / REMOVE |
| `electron/ai-edition/localEditorialChat/types.ts` | Intent + style slots |
| `electron/ai-edition/localEditorialChat/parse.ts` | Intent routing before TARGET_DURATION |
| `electron/ai-edition/localEditorialChat/normalize.ts` | Programme near-time for transitions |
| `electron/ai-edition/localEditorialChat/index.ts` | Document-grounded follow-up promote |
| `electron/ai-edition/localEditorialChat/resolveFollowUp.ts` | Anaphora + protect direct |
| `electron/ai-edition/autonomousProfessionalEditor/targetStory.ts` | Section-change → DISSOLVE |
| `electron/ai-edition/autonomousProfessionalEditor/deterministicDirector.ts` | ADD_TRANSITION from treatment |
| `electron/ai-edition/professionalEditOrchestrator/run.ts` | Rebuild transition ops with wantDissolve |
| `electron/ai-edition/professionalEditOrchestrator/sanitize.ts` | Keep honest dissolve receipts |
| `electron/ai-edition/professionalEditOrchestrator/transformationSummary.ts` | Stop “transitions unavailable” |
| `electron/ai-edition/professionalEditOrchestrator/assessment.ts` | Receipt family `transitions` |
| `electron/ai-edition/localEditorialChat/transitionsProductMaturityV1.test.ts` | Unit |
| `electron/ai-edition/localEditorialChat/transitionsProductMaturityV1.live.runtime.test.ts` | Live |

Frozen ZOOM/TRIM/SPEED/CAPTIONS/TITLE/CALLOUT modules: **not modified** (except read-only coexistence checks).

---

## 6. Document authority model

- Authority: `clip.incomingTransition` on join clips  
- Tool: `setClipIncomingTransition`  
- Scene: `incomingFadeHalfSec`  
- Follow-up registry: `legacyEditor.transitionClipIds`  
- CUT = explicit hard cut (not “delete field”, so unset native default dissolve cannot resurrect)

---

## 7. Direct Chat trace

Evidence: `tmp/perception-benchmark/openscreen-transitions-maturity-v1/metrics.json`

| Step | Result |
|---|---|
| Add dissolve ~12s | PASS |
| Shorter / longer | PASS |
| Type → cut / dissolve | PASS |
| Remove | PASS |
| Wipe refused | PASS |
| Single-clip no join | PASS |
| `TOTAL_CLOUD_CALLS` | **0** |

---

## 8. Boundary targeting trace

- Explicit between clip N and N+1  
- Ordinal first / second  
- Nearest programme join to timestamp (ambiguous if two within ~0.75s)  
- Document-grounded last via `transitionClipIds`

---

## 9. Programme-time mapping proof

`AFTER_TRIM_SPEED = PASS` — after “remove first 3 seconds” + speed 5–10s @2x, “dissolve around 9 seconds” resolves on current programme joins (not raw source 9s blind).

---

## 10–12. Type / duration / multi-join

`SUPPORTED_TYPE_DISSOLVE`, `DURATION_SHORTER`, `DURATION_LONGER`, `TYPE_MODIFICATION`, `TWO_TRANSITIONS`, `ORDINAL_MULTI_TARGET` = **PASS**.

---

## 13. Follow-up / reference

Session anaphora + document-grounded promote (`last_transition`).  
`POST_RELOAD_EDITABILITY = PASS` after JSON round-trip without Chat session.

---

## 14. Autonomous APPLY proof

Live multi-clip project from real recording `recording-1789554424774.mp4` (split into three programme clips).

`autonomous-apply.json`: dissolve on second clip (`durationSec: 0.35`), receipt includes “softening a clip join with a brief dissolve”, `cloud: 0`.

`AUTONOMOUS_APPLY_LIVE = PASS`

---

## 15. Autonomous KEEP proof

- Opportunity: single-clip → `NOT_READY`  
- Live orch on single-clip: no dissolve claim / no false apply  
`AUTONOMOUS_KEEP` + `AUTONOMOUS_KEEP_LIVE = PASS`

---

## 16. Story / semantic reasoning

`targetStory`: DISSOLVE only on chapter-like beat changes (e.g. OPENING→ACTION, EXPLANATION→ACTION). Continuous same-kind beats stay CUT. Director emits `ADD_TRANSITION` only when treatment wants DISSOLVE; planner READY only if multi-clip + `wantDissolve`.

---

## 17. Bad-join camouflage check

Transitions never invent joins. Trim join QC remains authoritative; dissolve is optional polish on existing joins only. No path “fix bad trim with dissolve.”

---

## 18. Frozen-family coexistence

`FROZEN_FAMILY_COEXISTENCE = PASS` — captions settings + title count unchanged by transition edits. Regression unit suites for callout/title/orch still green.

---

## 19. Audio behavior

Visual dissolve mixes previous hold frame over incoming video. Native audio already equal-power crossfades at **clip boundaries** (not a new audio product). No A/V redesign in this milestone. Honest status: **visual dissolve authored; clip-boundary audio crossfade is existing native behavior, not Chat-authored**.

---

## 20. Real undo / redo

`REAL_TRANSITION_UNDO = PASS` · `REAL_TRANSITION_REDO = PASS` via project store history.

---

## 21–22. Electron quit / relaunch / post-restart

| Gate | Result |
|---|---|
| Document JSON round-trip | PASS |
| Post-reload edit | PASS |
| REAL_ELECTRON_QUIT / RELAUNCH | **NOT RUN** (gap) |

---

## 23–25. Native preview / export / match

| Gate | Result |
|---|---|
| Addon present | yes (`hasAddon: true`, backend probe `cpu`) |
| Metal sample/export | **SKIP_NO_NATIVE** (`aucun MTLDevice disponible`) |
| Preview/export match | SKIP |

Artifacts dir: `tmp/perception-benchmark/openscreen-transitions-maturity-v1/`

---

## 26–27. Receipt honesty / cloud

| Metric | Value |
|---|---|
| FALSE_TRANSITION_APPLIED_CLAIMS | **0** |
| ROLLED_BACK_TRANSITION_CLAIMS | **0** |
| TOTAL_CLOUD_CALLS (supported direct) | **0** |

---

## 28. Frozen-family regression results

Unit: callout / title / orch / autonomous editor suites — **PASS**. No intentional edits to frozen family modules.

---

## 29. Remaining genuine limitations

1. Only CUT + DISSOLVE (no wipe/slide/3D/etc.) — by design  
2. Needs a real multi-clip join (single continuous clip → honest refusal)  
3. Unset field still defaults to native dissolve 0.35 — Chat “remove” writes explicit CUT  
4. Metal native QA + full Electron relaunch still required for MATURE  
5. Audio crossfade not independently Chat-authored

---

## 30. BLOCKER / MAJOR / MINOR

| Severity | Issue |
|---|---|
| **MAJOR** (maturity gate) | Native Metal preview/export unavailable this session |
| **MAJOR** (maturity gate) | Real Electron quit→relaunch not executed |
| MINOR | Join QC warning on autonomous multi-clip cut (flagged in receipt; not transition camouflage) |
| — | No BLOCKER in direct Chat path |

---

## Maturity gate checklist

| Gate | Status |
|---|---|
| Phase-1 audit | PASS |
| Direct add / join / programme time / type / duration / remove | PASS |
| Multi + follow-up + invalid/unsupported honesty | PASS |
| Autonomous APPLY + KEEP | PASS (live) |
| Bad-join camouflage | PASS (by architecture) |
| Frozen coexistence | PASS |
| Undo/redo | PASS |
| Electron quit/relaunch | **GAP** |
| Native preview/export | **GAP** |
| Receipts / cloud=0 | PASS |

→ **FUNCTIONAL_WITH_GAPS** (not MATURE; not frozen)

---

## Next (only when resuming TRANSITIONS)

1. Re-run live test on a host with Metal → fill `frames/transition-*.ppm` + export MP4  
2. Real Electron Chat → save → quit → relaunch → reopen → edit  
3. If all remaining gates PASS → set MATURE + write `TRANSITIONS_FROZEN.md`

**STOP.** No next capability started.
