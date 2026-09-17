# OpenScreen Render Verification V1 Report

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_RENDER_VERIFY_V1`  
**Prerequisites:** Consent + Apply Preview V1 (`CURRENT_OPENSCREEN_APPLY_PREVIEW_V1`)  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Single-trim render check only. No multi-edit. No autonomy. No tool-family expansion. No UI consent workflow.

---

## Executive verdict

PASS_WITH_LIMITATIONS. After one consented `addTrim`, OpenScreen now runs an explicit **Render Verification** stage on top of structural + must-survive checks: compressed-programme mapping (`resolvePlaybackSegments`), speech-boundary risk, and bounded frame samples (injected/ffmpeg). Failures and `render_unavailable` **fail-closed → rollback**. Case 2 / Case 4 / Upwork / Settings / narrated remain **mutations = 0** with render stage never entered. Required LLM calls = **0**.

---

## Render/compositor architecture audit

### Map

```text
AxcutDocument (in-memory OK)
  → resolvePlaybackSegments(clips, trimRanges)   // COMPRESSED programme
  → buildSceneDescription / resolveVisibleClips  // export+preview SSOT
  → NativeCompositorOverlay (UI store-bound)
  → exportMulti / presentTime+readFrame          // same Rust walk
PARALLEL: ffmpeg source stills (visualEvidence) — not composed parity
```

### Answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Frames from in-memory doc? | Yes via scene/export APIs; Apply Preview already returns mutated doc without disk write |
| 2 | Bounded time range? | No first-class export window; V1 bounds via sample times + pad constants (0.75s) |
| 3 | Before/after trim boundary? | Yes — compressed join + source neighbors |
| 4 | Temp without polluting project? | Yes — snapshot/rollback; temp workdir cleaned unless retain |
| 5 | Export-parity path? | `buildSceneDescription` + compositor `exportMulti` / `readFrame` |
| 6 | Compositor unavailable? | Addon no-op / null frames — **must not** upgrade structural→render |
| 7 | Latency? | Mapping+speech ms; N stills tens–hundreds ms each; no full-video export |

**V1 choice:** mapping + speech (always) + **bounded stills sampler** (injected in tests; ffmpeg when media exists). Native compositor presence is probed and reported; V1 does not silently pretend structural == render.

---

## Render Verification architecture

```text
proposal → preflight → consent → apply
  → structural verify → preservation verify
  → RENDER VERIFY (trim only)
  → accept | rollback
```

Module: `electron/ai-edition/renderVerify/`.  
Wired inside `runConsentedApplyPreview` after structural pass (`applyPreview/run.ts`).

---

## Files changed

| Path | Role |
|------|------|
| `electron/ai-edition/renderVerify/types.ts` | Evidence + quality states |
| `electron/ai-edition/renderVerify/mapping.ts` | Programme join / removed / must-survive |
| `electron/ai-edition/renderVerify/speechBoundary.ts` | Speech cut risk |
| `electron/ai-edition/renderVerify/frames.ts` | Sampler helpers / blank heuristic / ffmpeg |
| `electron/ai-edition/renderVerify/verify.ts` | Orchestrator |
| `electron/ai-edition/renderVerify/index.ts` | Exports |
| `electron/ai-edition/renderVerify/NOTICE.md` | Scope |
| `electron/ai-edition/renderVerify/renderVerifyV1.test.ts` | Tests + artifacts |
| `electron/ai-edition/applyPreview/types.ts` | Receipt + lifecycle + sampler input |
| `electron/ai-edition/applyPreview/run.ts` | Async apply + render stage + fail-closed |
| `electron/ai-edition/applyPreview/applyPreviewV1.test.ts` | Updated for async + sampler |
| `tmp/perception-benchmark/render-verify-v1/` | New artifacts (Apply Preview dir preserved) |

---

## Render evidence contract

`RenderVerificationEvidence` includes: proposal/fingerprints, trim boundary (source + compressed join + ±0.75s windows), before/after/pre-edit frame samples, `removedIntervalAbsentFromProgramme`, `mustSurvivePresentInProgramme`, `speechBoundaryRisk`, `compositorStatus`, `qualityState`, warnings/blockingReasons, latency breakdown, `additionalModelCalls: 0`.

---

## Verification window policy

- `RENDER_VERIFY_PAD_BEFORE_SEC = 0.75`
- `RENDER_VERIFY_PAD_AFTER_SEC = 0.75`
- Max 3 frames per side of compressed join  
- No full-timeline render/export

---

## Trim landing verification

Uses `resolvePlaybackSegments` (same basis as export programme):

- Interior probes of trimmed source must be **absent**
- Join inferred from kept segments around trim edges
- Evidence: safe-trim fixture `removedIntervalAbsentFromProgramme === true`

---

## Speech/audio boundary verification

Classifies cut points:

`safe_silence_boundary` | `near_speech_boundary` | `inside_active_speech` | `inside_protected_speech` | `unknown`

Silence segments checked before “near speech.”  
Inside active/protected speech → **blocking → rollback**.  
No claim of audio waveform smoothness (NOT_VERIFIED).

---

## Visual continuity verification

Conservative:

- Sample decode/valid/non-blank (byte heuristic)
- Blank/invalid around join → fail
- No universal pixel-diff “looks good” score
- Large discontinuity after intentional trim is not automatic fail

---

## Must-survive verification

Protected `survive:start-end` ranges must remain representable in the compressed programme after edit. Combined with Apply Preview preservation checks.

---

## Render-unavailable policy

**Decision: A — fail-closed (rollback).**

Rationale: consented preview must not accept a mutation when post-edit media cannot be inspected. Structural success alone is reported as insufficient; `verificationStatus = render_unavailable` then rollback restores fingerprint.

Tests inject samplers because fixture paths lack real media; production without sampler attempts ffmpeg and still fail-closes if samples cannot be obtained.

---

## Receipt changes

`EditApplicationReceipt` extended with:

- lifecycle `render_verifying`
- `verificationStatus`: `verified_render_basic` | `verified_render_with_warnings` | `render_verification_failed` | `render_unavailable`
- `renderVerification` attachment (provider, qualityState, evidence, framesRendered, speech risk, ms, modelCalls=0)
- `latencyMs.renderVerificationMs`

Prior receipt fields retained.

---

## Safe trim result

Dead-air 5–8s consented apply:

- `mutatedAndVerified = true`
- `verified_render_basic` (or with_warnings)
- removed silence absent from programme
- Effects speech 8–12 survives
- `safe_silence_boundary`
- clip_2 unchanged  
Artifact: `tmp/perception-benchmark/render-verify-v1/safe-trim-render.json`

---

## Bad-boundary rollback result

Trim interior to protected/corrected speech:

- apply occurs
- render/speech/must-survive fails
- `rolled_back`, fingerprint restored  
Artifact: `bad-boundary-rollback.json`

---

## Render-failure rollback result

- Blank sampler → `render_verification_failed` → rollback  
- Unavailable sampler → `render_unavailable` → rollback  
Artifact: `render-failure-rollback.json`

---

## Case 2 result

`no_safe_proposal` → blocked preflight → **render never runs**, mutations = 0. PASS.

---

## Case 4 result

`provisional` → blocked → render never runs, mutations = 0. PASS (not forced).

---

## Upwork / Settings / Narrated regressions

All zero mutation; render attachment absent. PASS.

---

## Model-call count

`additionalModelCalls = 0`, `optionalSemanticModelCalls = 0`. No vision LLM required for V1.

---

## Latency breakdown

Measured per evidence: `renderSetupMs`, `frameRenderMs`, `audioBoundaryCheckMs`, `visualVerificationMs`, `mappingMs`, `renderVerificationMs` (+ apply path totals). Fixture-scale (injected frames); real ffmpeg/compositor cost not profiled on GPU in this run — **NOT_VERIFIED** for production compositor seek latency.

---

## Cache/temp behavior

- Workdir under `os.tmpdir()/openscreen-render-verify-*`
- Deleted after run unless `retainArtifacts`
- Benchmark retain writes under `tmp/perception-benchmark/render-verify-v1/`
- No cross-document frame leak by design (per-run dir)

---

## Tests

`npx vitest --run electron/ai-edition/applyPreview/applyPreviewV1.test.ts electron/ai-edition/renderVerify/renderVerifyV1.test.ts`  
→ **29 passed** (21 Apply Preview + 8 Render Verify).

Covers: render only after apply; blocked never renders; safe evidence; removal mapping; must-survive; speech cut fail; blank/unavailable fail-closed; rollback fingerprint; unrelated clip isolation; bounded window; receipt; 0 LLM; case refusals.

---

## Benchmark impact

New identity only:

`CURRENT_OPENSCREEN_RENDER_VERIFY_V1`

Artifacts: `tmp/perception-benchmark/render-verify-v1/`  
Prior Apply Preview and earlier identities **not overwritten**.

---

## Remaining limitations

- Stills path is **ffmpeg/injected**, not yet offscreen native `presentTime+readFrame` (compositor probed/reported only).
- Blank detection is a byte heuristic, not a true luma decode — **NOT_VERIFIED** as perceptual lab quality.
- Audio continuity / waveform smoothness — **NOT_VERIFIED**.
- Zoom/crop/speed render verify — out of scope.
- Production UI consent + live preview grab — not started.

---

## Recommended next milestone

After review:

- Optional offscreen native compositor frame grab for export-parity samples
- UI consent surface for single apply preview  
**Do not** start multi-edit, autonomy, or auto-repair.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Concrete proof: one consented dead-air trim is kept only after programme mapping + speech + bounded frame verification; unsafe speech cuts and missing render samples roll back to the original fingerprint.

**STOP.**
