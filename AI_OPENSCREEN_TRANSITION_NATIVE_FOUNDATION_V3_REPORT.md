# AI_OPENSCREEN_TRANSITION_NATIVE_FOUNDATION_V3_REPORT

**Date:** 2026-09-16  
**Milestone:** `OPENSCREEN_TRANSITION_NATIVE_FOUNDATION_AND_FIRST_LIBRARY_V3`  
**Phase-1 source of truth:** `AI_OPENSCREEN_TRANSITION_LIBRARY_AND_INTELLIGENCE_V2_REPORT.md`  
**Frozen (untouched):** ZOOM · TRIM · SPEED · CAPTIONS · TITLE · CALLOUT  

---

## Final status

**NATIVE_FOUNDATION_PASS_WITH_LIMITATIONS**

Foundation code is in place: canonical registry, document `transitionId` BC, Metal dual-texture A/B dissolve path in export walk, first curated GL ports (wipes/slides/fade), notices, unit + live harness.

Limitations preventing unqualified PASS:

1. **This agent host has no Metal GPU** (`aucun MTLDevice`) → live preview/export pixel gates = `SKIP_NO_NATIVE` (must re-run on real Apple Silicon).  
2. **D3D11 / wgpu** A/B = stubs only → registry entries gated `BACKEND_LIMITED` / Metal-first.  
3. **Live preview path** still captures freeze-hold at clip advance; **export walk** uses live FROM seek (`set_transition_from_frame`). Preview==export for A/B motion needs live wiring + Metal QA.  
4. `gl.circleOpen` / `gl.crossZoom` = **QUARANTINED_RENDER** (no true SDF/zoom shader yet).

**NOT MATURE.** No production Transition Picker. No autonomous family→catalog expansion.

---

## 1. Exact old architecture

```
clip.incomingTransition { kind: cut|dissolve, durationSec? }
  → incomingFadeHalfSec
  → footage_fade_opacity (cut_fade)
  → capture_dissolve_hold(last AVFrame of outgoing)
  → draw TO opaque + draw HOLD with alpha=cut_fade
```

Outgoing was **frozen**.

---

## 2. Exact new architecture

```
Transition Registry (offline)
  → document: transitionId + durationSec + params (+ legacy kind)
  → scene: incomingFadeHalfSec + incomingTransitionMode + incomingTransitionId
  → export walk: secondary FROM Decoder seek to ab_from_source_time(progress)
  → Metal: set_transition_from_frame(live FROM) + ab_from_layer_geometry(mode)
  → draw TO + draw live FROM (dissolve alpha / wipe-slide geometry)
```

Progress 0→1: `ab_transition_progress`  
FROM time: `prev_end - half + progress*half` (outgoing **continues**)

---

## 3. Files changed

| Area | Paths |
|---|---|
| Registry | `electron/ai-edition/transitionLibrary/*` |
| Notices | `THIRD_PARTY_TRANSITIONS_NOTICES.md` |
| Catalog pin | `electron/ai-edition/transitionLibrary/catalog/gl-transitions-1.71.0.json` |
| Schema | `src/lib/ai-edition/schema/index.ts` |
| Scene emit | `src/native/sceneDescription.ts`, `src/native/contracts.ts` |
| Tool | `electron/ai-edition/agent-tools.ts` (`setClipIncomingTransition`) |
| Rust scene/math | `crates/compositor/src/scene.rs`, `regions.rs` |
| Export A/B | `crates/compositor/src/timeline_walk.rs` |
| Metal | `crates/compositor/src/compositor_macos.rs` |
| Stubs | `compositor_windows.rs`, `compositor_linux.rs` |
| Tests | `transitionNativeFoundationV3.test.ts`, `.live.runtime.test.ts` |

---

## 4. Registry schema

See `TransitionRegistryEntry` in `registry.ts`: id, displayName, provider, author, license, attribution, category, implementationRef, parameters, durations, intensity, gpuCompatibility, preview/export flags, userAvailable, autonomousEligible, tags, editorial, sourceRevision, availability.

Documents store **ids + params only**.

---

## 5. Backward compatibility

| Case | Behavior |
|---|---|
| `{ kind: "cut" }` | Opens; resolves `openscreen.cut` |
| `{ kind: "dissolve", durationSec }` | Opens; resolves `openscreen.dissolve` |
| `{ transitionId: "gl.wipeLeft", … }` | Preferred V3 form; kind also written for BC |

Unit: `BACKWARD_COMPAT_CUT_DISSOLVE = PASS`

---

## 6. A/B temporal sampling

During incoming window of length `half` on clip B at source time `t`:

- `progress = smooth01((t - B.start) / half)`  
- `from_t = A.end - half + progress * half`  
- Decode **separate** FROM decoder at `from_t` (even if same file as TO)  
- Compose TO current + FROM live  

---

## 7. Dissolve before / after

| | Before | After (export path) |
|---|---|---|
| FROM | Cloned last frame | Seeking progressing tail of previous clip |
| Mix | Hold alpha | Live FROM alpha / geometry |

Metal pixel before/after grids: **SKIP_NO_NATIVE** this host — code path landed.

---

## 8. Imported third-party transitions

Pinned: **gl-transitions@1.71.0** (125 discovered).

| ID | Availability |
|---|---|
| gl.fade | USER_AVAILABLE (Metal), BACKEND_LIMITED |
| gl.dissolve | USER_AVAILABLE (Metal), BACKEND_LIMITED |
| gl.wipeLeft/Right/Up/Down | USER_AVAILABLE (Metal), BACKEND_LIMITED |
| gl.slideLeft/Right | USER_AVAILABLE (Metal), BACKEND_LIMITED |
| gl.fadeblack | USER_AVAILABLE (Metal), BACKEND_LIMITED |
| gl.circleOpen | **QUARANTINED_RENDER** |
| gl.crossZoom | **QUARANTINED_RENDER** |

Builtins: `openscreen.cut`, `openscreen.dissolve` (A/B impl).

**FIRST_GL_TRANSITIONS_IMPORTED (user-available GL):** 9 (≥8 required).

---

## 9. License table

All imported entries: **MIT** (authors gre / rectangletangle).  
Full catalog snapshot: 123 MIT + 1 BSD-3 + 1 BSD-2.  
Artifact: `THIRD_PARTY_TRANSITIONS_NOTICES.md`

---

## 10. Quarantined + reasons

| ID | Class | Reason |
|---|---|---|
| gl.circleOpen | QUARANTINED_RENDER | Needs dedicated circle SDF dual-sample shader |
| gl.crossZoom | QUARANTINED_RENDER | Needs UV zoom warp, not dissolve approx |
| All GL ports on D3D/wgpu | BACKEND_LIMITED | Stubs only |

---

## 11–12. Native frame / moving A/B evidence

Harness samples progress `[0,0.1,0.25,0.5,0.75,0.9,1]` around join.  
**This run:** `NATIVE_METAL_* = SKIP_NO_NATIVE`  
Artifacts dir: `tmp/perception-benchmark/openscreen-transition-native-foundation-v3/`

Re-run on Metal host:

```bash
npx vitest --run electron/ai-edition/transitionLibrary/transitionNativeFoundationV3.live.runtime.test.ts
```

---

## 13. Performance

Not measured (no GPU). Design: lazy FROM decoder open; no preload of 125 shaders.  
`PERFORMANCE_MEASURED = SKIP` this host.

---

## 14–16. Document mutations / undo / save

| Gate | Result |
|---|---|
| add / replace / cut via registry tool | PASS (unit + live) |
| UNDO_REDO | PASS |
| SAVE_REOPEN (JSON round-trip) | PASS |
| Real Electron quit/relaunch | **Not this milestone** (deferred to V4 product layer) |

---

## 17. Preview / export pixel comparison

**SKIP_NO_NATIVE** here. Architecture intends same `walk_composited_timeline` / scene JSON. Live hold fallback remains a known gap until live dual-decode matches export.

---

## 18. Backend compatibility matrix

| Backend | cut | A/B dissolve | wipe/slide | Notes |
|---|---|---|---|---|
| Metal | yes | implemented | geometry overlays | Needs device QA |
| D3D11 | hold/legacy | stub | stub | BACKEND_LIMITED |
| wgpu | hold/legacy | stub | stub | BACKEND_LIMITED |

---

## 19. TOTAL_CLOUD_CALLS

**0**

---

## 20. Frozen-family regression

Callout + transitions V1 unit suites green. No frozen-family modules edited.

---

## 21. Remaining gaps

1. Metal device QA (preview frames, export MP4, motion energy proof)  
2. Wire **live** preview dual-decode (parity with export)  
3. Port A/B to D3D11 + wgpu  
4. True circle / CrossZoom shaders  
5. Production Transition Library UI (V4)  
6. Chat semantic catalog resolve (V4)  
7. Autonomous family→id intelligence (V4)  
8. Real Electron quit/relaunch for transitionId persistence (V4)

---

## 22. Recommendation for V4

**OPENSCREEN_TRANSITION_LIBRARY_PRODUCT_SURFACE_V4**

1. Re-run V3 live harness on Apple Silicon → flip SKIP gates to PASS.  
2. Live dual-decode parity.  
3. Polished Transition Library picker (categories/search) over **same registry**.  
4. Local Chat name/family resolve → registry.  
5. Autonomous: APPLY/KEEP then family then validated id.  
6. Expand USER_AVAILABLE only after validation harness PASS.  
7. Electron relaunch QA.

Do **not** claim TRANSITIONS MATURE until V4 product layer closes.

---

## Acceptance gate summary

| Gate | Status |
|---|---|
| TRANSITION_REGISTRY | PASS |
| DOCUMENT_REGISTRY_REFERENCE | PASS |
| BACKWARD_COMPAT_CUT_DISSOLVE | PASS |
| TRUE_DUAL_TEXTURE_AB | SKIP_NO_NATIVE (code PASS) |
| OUTGOING/INCOMING_MOTION | SKIP_NO_NATIVE |
| DISSOLVE_MIGRATED_TO_AB | PASS (export path) |
| FIRST_GL ≥ 8 | PASS (9 user-available) |
| LICENSE + NOTICE | PASS |
| NATIVE_METAL_PREVIEW/EXPORT | SKIP_NO_NATIVE |
| PIXEL_PREVIEW_EXPORT_MATCH | SKIP_NO_NATIVE |
| UNDO_REDO / SAVE_REOPEN | PASS |
| PERFORMANCE_MEASURED | SKIP |
| FROZEN_FAMILY_REGRESSION | PASS |
| TOTAL_CLOUD_CALLS | 0 |

→ **NATIVE_FOUNDATION_PASS_WITH_LIMITATIONS**

---

## HARD STOP

No production picker. No autonomous catalog expansion. No other editing family.
