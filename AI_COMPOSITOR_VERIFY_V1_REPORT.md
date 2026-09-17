# OpenScreen Offscreen Native Compositor Verification V1 Report

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1`  
**Prerequisites:** Render Verification V1 + Apply Preview V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Single-trim compositor visual gate only. No multi-edit, autonomy, UI consent, or tool-family expansion.

---

## Executive verdict

PASS_WITH_LIMITATIONS. Authoritative post-edit visual verification now requires frames from the **OpenScreen native compositor** (`createView` → `setScene` → `setActiveClip` → `presentTime` → `readFrame`, with bounded `exportMulti` fallback on the same `walk_composited_timeline`). ffmpeg **source** stills no longer upgrade status. Live darwin-arm64 capture produced a valid RGBA frame (`status: ok`, `frameProvider: native_compositor`, `capturePath: live_readFrame`, hardware backend, ~187ms). Fail-closed rollback preserved. Audio continuity remains **NOT_VERIFIED**. Required LLM calls = **0**.

---

## Native compositor code audit

| Topic | Finding |
|-------|---------|
| Scene | `buildSceneDescription` / `resolveVisibleClips` — pure, in-memory doc OK |
| Offscreen | `createView` — **no HWND/NSView**; rect is preview resolution only (`addon.d.ts`) |
| Frame API | `presentTime` (active-clip **SOURCE** seconds) + `readFrame` → RGBA8 `{gen,width,height,data}` |
| Export | `exportMulti` shares scene + `walk_composited_timeline`; ClipInput needs `hasAudio` |
| Service | `electron/native-bridge/services/compositorViewService.ts` |
| Platforms | macOS Metal (proven here); Windows D3D11; Linux wgpu — not re-proven this milestone |

### Exact answers

1. **In-memory scene without save?** Yes.  
2. **Without React UI?** Yes — offscreen RT + CPU readback.  
3. **OS surface required?** No.  
4. **Other offscreen API?** Live path is already offscreen; `exportMulti` is the file-based twin.  
5. **Export share scene logic?** Yes.  
6. **Frame without full-video encode?** Live `readFrame`; or bounded `exportMulti` window (~1s proven ~0.09s).  
7. **Time domain?** `presentTime` = SOURCE on active clip; programme join mapped via `resolvePlaybackSegments`.  
8. **Trim join mapping?** Compressed programme → segment → source (`locateProgrammeInstant`).  
9. **Buffer?** RGBA8, `width*height*4`.  
10. **Cleanup?** `destroyView` joins render thread.

---

## Offscreen feasibility

**Feasible — not BLOCKED.** Live `readFrame` succeeded on this macOS host with hardware backend after passing `appRoot` so the `.node` resolves outside Electron `app.getAppPath()`.

---

## Architecture implemented

```text
post-edit AxcutDocument
  → programme join (±0.75s)
  → locateProgrammeInstant (COMPRESSED → SOURCE)
  → NativeCompositorFrameSampler
       prefer: live readFrame
       else:   bounded exportMulti → RGBA from composited MP4
  → RGBA luma/variance/transparency validation
  → verified_compositor_*  |  compositor_verification_failed  |  compositor_unavailable
  → accept / rollback
```

ffmpeg source stills: diagnostics only (`ffmpegSourceUsedAsAuthoritative: false`).

---

## Files changed

| Path | Role |
|------|------|
| `electron/ai-edition/compositorVerify/*` | New module (types, pixels, programmeMap, sampler, verify, tests, NOTICE) |
| `electron/ai-edition/applyPreview/run.ts` | Authoritative gate = compositor verify |
| `electron/ai-edition/applyPreview/types.ts` | Receipt + sampler inputs |
| `electron/ai-edition/applyPreview/applyPreviewV1.test.ts` | Compositor sampler wiring |
| `electron/ai-edition/renderVerify/renderVerifyV1.test.ts` | Updated apply-path expectations |
| `tmp/perception-benchmark/compositor-verify-v1/` | Artifacts (render-verify-v1 untouched) |

---

## Programme-time mapping

`locateProgrammeInstant` / `clipInputsForProgrammeWindow` use `resolvePlaybackSegments` / `resolveVisibleClips`.  
Live artifact: programme ~2.0s after trim `[2,3)` → `sourceStartSec: 3` (`clip_1_seg2`). Removed source not sampled.

---

## Offscreen frame sampler

`NativeCompositorFrameSampler` + `CompositedFrameSampler` interface.  
Providers: `native_compositor` | `ffmpeg_source` | `injected_test`.  
Unit tests use injected doubles only with explicit `allowInjectedAsAuthoritative`.

---

## Pixel validation

`analyzeRgba8`: mean luma, variance, near-black / near-transparent fractions, bucket uniqueness.  
Uniform black / fully transparent → invalid. Dark-but-varied → valid (`darkButValid`).

---

## Source provenance

Each frame records `sourceProvenance` `{assetId, clipId, sourceStartSec, sourceEndSec}` from programme mapping (not guessed from pixels).

---

## Must-survive compositor verification

Programme mapping still includes protected source ranges; compositor samples representative programme points when mappable. Modality honesty: speech meaning is not claimed visually verified.

---

## Compositor unavailable policy

Keep fail-closed: `compositor_unavailable` → rollback.  
ffmpeg source stills do **not** upgrade to verified.

---

## Platform support

| Platform | Status this milestone |
|----------|------------------------|
| **macOS (darwin-arm64)** | Proven live `readFrame` + hardware |
| Windows | Architecture present; **NOT_VERIFIED** here |
| Linux | Architecture present; **NOT_VERIFIED** here |

---

## Headless/test strategy

- Unit tests: injected RGBA compositor sampler (explicit flag)  
- Live runtime test: real `.node` + h264_videotoolbox fixture + `appRoot: process.cwd()`  
- No fake PASS via source ffmpeg screenshots

---

## Safe real-media trim result

Artifact `live-frame-result.json`:

- `frameProvider: native_compositor`
- `capturePath: live_readFrame`
- `status: ok`, `backend: hardware`
- `320×180`, 230400 bytes, valid pixel stats
- `readFrameMs ≈ 182`, `perFrameMs ≈ 187`
- Source provenance post-trim correct (`sourceStartSec: 3`)

Unit safe-trim (injected authoritative double) also green under `verified_compositor_*`.

---

## Failure + rollback result

Blank / unavailable injected paths → `compositor_verification_failed` / `compositor_unavailable` → rollback → fingerprint restored. Artifact: `compositor-failure-rollback.json`.

---

## Case regressions

Case 2 / Case 4 / Upwork / Settings / narrated: **mutations = 0**, compositor stage not entered.

---

## Audio honesty

`audioContinuity: NOT_VERIFIED` on every receipt. Visual compositor frames do not imply audio smoothness.

---

## Model-call count

`additionalModelCalls = 0`. No vision LLM.

---

## Native latency measurements

From live artifact (single frame): setup ~3ms, present ~0ms, readFrame ~182ms, total ~187ms.  
Bounded exportMulti previously measured ~0.09s wall for ~1s window (probe session).

---

## ffmpeg vs native comparison

| Path | Role |
|------|------|
| Native live / exportMulti | **Authoritative** |
| ffmpeg decode of composited export | Helper to obtain RGBA from compositor output |
| ffmpeg source stills | Diagnostics only — cannot verify |

---

## Tests

`npx vitest --run electron/ai-edition/{compositorVerify,applyPreview,renderVerify}/*.test.ts`  
→ **36 unit passed** + **1 live passed** (real native frame).

---

## Benchmark impact

New identity: `CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1`  
Artifacts: `tmp/perception-benchmark/compositor-verify-v1/`  
Prior `render-verify-v1` / Apply Preview identities preserved.

---

## Remaining limitations

- Windows/Linux compositor verify **NOT_VERIFIED** in this run  
- Live path sensitive to addon resolve (`appRoot`) and media codec (h264 preferred)  
- Wallpaper asset warnings in headless scene (non-fatal)  
- No waveform/audio continuity analysis  
- Injected doubles only for unit wiring — production must use native

---

## Recommended next milestone

After review:

- UI consent surface for single apply preview  
- Optional: cache composited frames by fingerprint+programme time  
**Do not** start multi-edit / autonomy / auto-repair / zoom-crop execution.

---

## Verdict

**PASS_WITH_LIMITATIONS**

Concrete evidence: post-edit programme-time sample via native compositor `readFrame` returned valid RGBA with correct source provenance after a trim; unavailable/invalid paths fail closed and roll back.

**STOP.**
