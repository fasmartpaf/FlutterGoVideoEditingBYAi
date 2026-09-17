# AI_OPENSCREEN_TRANSITION_NATIVE_PARITY_V3_1_REPORT

**Milestone:** `OPENSCREEN_TRANSITION_NATIVE_PARITY_CLOSURE_V3_1`  
**Host:** Apple Silicon (Apple M5) — Metal Supported  
**Date:** 2026-09-16  

```
TRANSITION_NATIVE_PARITY_STATUS = PASS_WITH_LIMITATIONS
```

Metal live preview ↔ export A/B parity is **PASS**. Limitations are honest non-Metal backends + seek-based preview timing (not a frozen-FROM path).

---

## 1. V3 gap audit

| V3 gap | V3.1 result |
|--------|-------------|
| Metal/native proof `SKIP_NO_NATIVE` | **PASS** — real `MTLDevice` via compositor addon (`probeBackend: hardware`) |
| Live preview freeze-hold at clip advance | **FIXED** — secondary `AbFromDecoder` seeks progressing FROM |
| Export true live FROM | **Still PASS** (unchanged export walk) |
| preview == export for true A/B | **PASS** — MAE ≤ ~4.1 @ 1920×1080 (tol 28) |
| D3D11 / wgpu | Still **BACKEND_LIMITED** / stub (honest) |
| Performance unmeasured | **Measured** — `TRANSITION_PERFORMANCE = WARNING` (see §9) |

---

## 2. Live preview parity implementation

Authority unchanged: **document → scene → native transition path**.

In `crates/compositor/src/live.rs`:

- Added `AbFromDecoder` on `Player` (path + `source_end` + `Decoder`).
- `ensure_ab_from` / `clear_ab_from` / `bind_ab_transition` mirror export’s `ab_transition_progress` + `ab_from_source_time` + `set_transition_from_frame` + `set_transition_mode`.
- Called before every compose from `present_frame`, `step`, and `recompose`.
- Armed on clip advance and on `setActiveClip` when index > 0 (scrub into transition without playback advance).
- When live FROM binds successfully → `clear_dissolve_hold()` so Metal does **not** mix freeze + live.
- Hold capture retained and labeled **LEGACY_HOLD_FALLBACK** for D3D11/wgpu stubs that ignore `transition_from`.

No separate preview approximation remains on Metal.

---

## 3. Exact files changed

| File | Change |
|------|--------|
| `crates/compositor/src/live.rs` | True A/B FROM decoder + bind on present/step/recompose/advance/scrub |
| `crates/compositor/tests/output_geometry_golden.rs` | Call-site signature update |
| `crates/poc-d3d/src/app.rs` | Call-site signature update |
| `electron/ai-edition/transitionLibrary/registry.ts` | `validateAndClampTransitionApply`, quarantine/backend stats |
| `electron/ai-edition/transitionLibrary/index.ts` | Re-exports |
| `electron/ai-edition/agent-tools.ts` | Registry clamp/reject on `setClipIncomingTransition` |
| `electron/ai-edition/transitionLibrary/transitionNativeParityV3_1.live.runtime.test.ts` | **New** Metal parity/perf harness |
| `electron/native/bin/darwin-arm64/compositor_view.node` | Rebuilt Metal addon |

Frozen families **not** modified: ZOOM / TRIM / SPEED / CAPTIONS / TITLE / CALLOUT.

---

## 4. Moving-A/B fixture

Real OpenScreen recording:

`~/Library/Application Support/openscreen/recordings/recording-1789554424774.mp4` (~35.63s)

Multi-clip join at **t=12s**, half-window **0.4s**, both sides of a live screen recording (cursor/window motion). Not static cards.

Evidence dir:

`tmp/perception-benchmark/openscreen-transition-native-parity-v3_1/`

---

## 5–7. Native evidence (dissolve / wipe / slide)

Progress samples: `0.00, 0.10, 0.25, 0.50, 0.75, 0.90, 1.00`  
Each: **live_readFrame** preview PPM + export PPM.

| Transition | Preview | Export | Motion early↔mid MAE | Pixel max MAE |
|------------|---------|--------|----------------------|---------------|
| `openscreen.dissolve` | PASS | PASS | 2.54 | **4.13** |
| `gl.wipeLeft` | PASS | PASS | 2.70 | **4.13** |
| `gl.slideLeft` | PASS | PASS | 2.70 | **3.38** |

- `OUTGOING_MOTION_DURING_TRANSITION = PASS`
- `INCOMING_MOTION_DURING_TRANSITION = PASS`
- No mostly-black frames (`NO_BLACK_INVALID_FRAMES = PASS`)

---

## 8. Preview/export pixel comparison

**Metric:** mean absolute RGB error (MAE) over all pixels.  
**Tolerance:** 28 (encoder + VT color path; detects wrong frame / freeze / wrong geometry / black / type mismatch).  
**Observed max MAE:** ~4.1 (all three) → `PIXEL_PREVIEW_EXPORT_MATCH = PASS`.

---

## 9. Performance numbers (1920×1080, Apple M5)

Measured via seek+`readFrame` sampler (pessimistic vs continuous playback decode).

| Id | Cold batch (7 samples) | Warm avg | Warm p95 | FPS est. | Export (~1.4s window) |
|----|------------------------|----------|----------|----------|------------------------|
| dissolve | 786 ms | 139 ms | 290 ms | ~7.2 | 715 ms / 699 KB |
| wipeLeft | 643 ms | 143 ms | 268 ms | ~7.0 | 594 ms |
| slideLeft | 676 ms | 130 ms | 266 ms | ~7.7 | 719 ms |

```
TRANSITION_PERFORMANCE = WARNING
PERFORMANCE_MEASURED = WARNING
```

Justification: warm p95 > 250 ms and FPS estimate < 12 **under seek-heavy sampleFrame**. Export realtime factor is healthy (~2×). Lazy pipelines: no preload of all transition modes; mode set per compose from scene.

4K not required for this closure; 1080p is the measured gate.

---

## 10. Memory numbers

- Extra cost: **one** secondary screen `Decoder` (`AbFromDecoder`) for the previous clip while clip_index > 0 and fade active.
- Cleared on clip 0 / cut.
- Not a full dual timeline preload; matches export’s single FROM decoder pattern.
- JS cannot RSS-attribute the native decoder precisely; qualitative bound recorded in `perf.json`.

---

## 11. Param validation

`validateAndClampTransitionApply`:

- min / default / max duration clamp to registry
- NaN duration → fail
- unknown / malformed params → rejected (not forwarded)
- Wired into `setClipIncomingTransition`

`PARAM_VALIDATION = PASS`

---

## 12. Save / reopen

Document stores `transitionId` + `durationSec` + optional `params` only.  
Round-trip `JSON.stringify` → `documentSchema.parse` preserves id/duration/boundary.  
No shader source in document.  
`SAVE_REOPEN = PASS`

---

## 13. Updated registry availability counts

| Counter | Value |
|---------|------:|
| TOTAL_DISCOVERED | 125 |
| LICENSE_ACCEPTED | 125 |
| PORTED_METAL | 13 |
| METAL_NATIVE_PASS | 11 |
| USER_AVAILABLE_METAL | 11 |
| QUARANTINED_RENDER | 2 |
| QUARANTINED_PERFORMANCE | 0 |
| BACKEND_LIMITED | 10 |

(cut is universal; A/B library entries remain Metal-first.)

---

## 14. Backend matrix

| Backend | Status |
|---------|--------|
| **Metal** | Implemented + **QA PASS** (preview A/B + export A/B + pixel parity) |
| **D3D11** | Stub / hold fallback — **BACKEND_LIMITED** / unavailable for true A/B |
| **wgpu** | Stub / hold fallback — **BACKEND_LIMITED** / unavailable for true A/B |

Do **not** expose A/B transitions as universally available off Metal.

---

## 15. Quarantine matrix

| State | Entries |
|-------|---------|
| USER_AVAILABLE (Metal) | cut, dissolve, gl.fade, gl.dissolve, 4 wipes, 2 slides, fadeblack (11) |
| QUARANTINED_RENDER | `gl.circleOpen`, `gl.crossZoom` (approx dissolve until dedicated SDF) |
| QUARANTINED_PERFORMANCE | (none) |
| BACKEND_LIMITED | Non-cut A/B set on D3D11/wgpu |

---

## 16. Frozen-family regressions

Narrow unit suite (callout / title / captions / speed / trim / zoom maturity tests): **36/36 PASS**.  
No frozen-family files touched.  
`FROZEN_FAMILY_REGRESSION = PASS`

---

## 17. TOTAL_CLOUD_CALLS

```
TOTAL_CLOUD_CALLS = 0
```

---

## 18. Remaining genuine gaps

1. **D3D11 / wgpu** true dual-texture A/B not implemented (hold fallback only).
2. **circleOpen / crossZoom** still approximate → QUARANTINED_RENDER.
3. **Preview warm FPS** under seek+readback is WARNING; continuous playback path not separately instrumented at 60 fps wall-clock.
4. **4K** not measured in this pass.
5. Production **Transition Picker** / autonomous catalog expansion **intentionally not built** (HARD STOP).

---

## 19. Recommendation for product-surface V4

Safe next milestone:

1. Production Transition Picker bound **only** to `listUserAvailableTransitions("metal")` with backend gate.
2. Keep autonomous catalog selection **off** until picker + Metal QA are product-visible.
3. Optional: D3D11 A/B port as a separate backend milestone — do not claim cross-platform maturity yet.
4. Optional: replace circle/crossZoom approximations with real SDF ports before un-quarantine.

---

## Acceptance gates (final)

| Gate | Result |
|------|--------|
| REAL_METAL_DEVICE | PASS |
| LIVE_PREVIEW_TRUE_AB | PASS |
| EXPORT_TRUE_AB | PASS |
| OUTGOING_MOTION_DURING_TRANSITION | PASS |
| INCOMING_MOTION_DURING_TRANSITION | PASS |
| DISSOLVE_PREVIEW_EXPORT_PARITY | PASS |
| WIPE_PREVIEW_EXPORT_PARITY | PASS |
| SLIDE_PREVIEW_EXPORT_PARITY | PASS |
| PIXEL_PREVIEW_EXPORT_MATCH | PASS |
| PERFORMANCE_MEASURED | WARNING |
| NO_BLACK_INVALID_FRAMES | PASS |
| PARAM_VALIDATION | PASS |
| SAVE_REOPEN | PASS |
| BACKEND_LIMITATIONS_HONEST | PASS |
| FROZEN_FAMILY_REGRESSION | PASS |
| TOTAL_CLOUD_CALLS | 0 |

```
TRANSITION_NATIVE_PARITY_STATUS = PASS_WITH_LIMITATIONS
```

**HARD STOP.** No production picker. No autonomous catalog expansion. No other editing family.
