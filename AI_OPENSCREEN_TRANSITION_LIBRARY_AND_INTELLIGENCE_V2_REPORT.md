# AI_OPENSCREEN_TRANSITION_LIBRARY_AND_INTELLIGENCE_V2_REPORT

**Date:** 2026-09-16  
**Milestone:** `OPENSCREEN_TRANSITION_LIBRARY_AND_INTELLIGENCE_V2`  
**Phase completed this session:** **PHASE 1 — RESEARCH + EXISTING CODE AUDIT ONLY**  
**Implementation:** **NOT STARTED** (explicit DO NOT CODE FIRST)  
**Frozen families (untouched):** ZOOM · TRIM/SHORTEN · SPEED · CAPTIONS · TITLE · CALLOUT

---

## Verdict (Phase 1)

**Chosen direction (recommended):**

1. **One OpenScreen Transition Registry** (offline, bundled definitions + editorial metadata).  
2. **Native dual-texture transition pass** in the existing Metal / D3D11 / wgpu compositor (preview == export).  
3. **Import curated GL Transition Specification shaders as definitions**, validate, then port/compile into OpenScreen-native shaders — **not** a live WebGL picker and **not** FFmpeg `xfade` as the product renderer.  
4. Manual UI, Chat, and autonomous editor all resolve to the **same registry IDs + parameters → same document mutation → same native path**.

**Do not** continue implementing decorative transitions one-by-one as ad-hoc Rust blends.  
**Do not** use FFmpeg `xfade` as the primary effect engine (preview/export split).  
**Do not** depend on HTTP to gl-transitions.com at playback/export time.

**FINAL_TRANSITION_LIBRARY_PRODUCT_STATUS = PHASE_1_AUDIT_COMPLETE — IMPLEMENTATION_PENDING**

MATURE is **not** claimed. No freeze file created.

---

## 1. Existing transition architecture audit

### Product model today

A transition is a **clip-join attribute** on a **non-first** timeline clip:

```ts
clip.incomingTransition?: { kind: "cut" | "dissolve"; durationSec?: number }
```

| Layer | Mechanism |
|---|---|
| Document | `AxcutDocument.timeline.clips[i].incomingTransition` |
| Tool | `setClipIncomingTransition` (`electron/ai-edition/agent-tools.ts`) |
| Scene | `incomingFadeHalfSec` via `buildSceneDescription` (`src/native/sceneDescription.ts`) |
| Native math | `incoming_dissolve_with_half` / `footage_fade_opacity` (`crates/compositor/src/regions.rs`) |
| GPU | Hold last outgoing `AVFrame`; draw current + hold with `color.a = cut_fade` |

### Types actually rendered

| Kind | Real? | Notes |
|---|---|---|
| CUT | yes | `incomingFadeHalfSec = 0` |
| DISSOLVE | yes | Hold-frame opacity mix, default half-window **0.35s** (`CUT_FADE_HALF_SEC`) |
| Wipe / slide / cube / blur / dip / fade-to-black | **no** | Chat refuses unsupported names |

**Critical technical fact:** today’s dissolve is a **frozen last-frame hold mix**, **not** a true dual-stream A/B blend. GL Transitions and FFmpeg xfade both require **two live textures**. That is the main architecture gap for a library.

### Preview vs export today

**Unified:** same scene JSON → same `compose_frame` on macOS Metal / Windows D3D11 / Linux wgpu → libav encode.  
**Not** FFmpeg filter graphs for visual transitions.  
**Caveat:** dissolve hold is skipped on 3D-tilt paths.

### Audio

Independent ~5 ms equal-power PCM boundary crossfade in native audio — **not** authored with visual dissolve duration.

### UI

**No** Transition Library / picker / browser in the React editor today. Transitions are Chat/agent/document only (V1 direct Chat path).

### Chat / autonomous (V1 status)

| Path | Status |
|---|---|
| Direct Chat CUT\|DISSOLVE | Implemented (`directTransition.ts`) — FUNCTIONAL_WITH_GAPS (Metal QA / Electron relaunch still open from V1) |
| Autonomous | APPLY dissolve only when multi-clip + target story wants DISSOLVE; else KEEP CUT |
| Catalog | **None** — only cut/dissolve enum |

### Shader infrastructure already present

| Asset | Role |
|---|---|
| `crates/compositor/src/shaders.metal` | Generic layer draw; dissolve uses mode‑0 + `layer.color.a` |
| `shaders.hlsl` / `vk_shaders/layer.wgsl` | Same pattern |
| Dedicated transition shader slot | **Absent** |
| WebGL / Pixi / gl-transition runtime | **Absent** from product path |
| FFmpeg `xfade` | **Absent** from product path (tests/evidence only) |

---

## 2. Third-party sources researched

### A. gl-transitions / GL Transition Specification

| Item | Finding |
|---|---|
| Source | https://github.com/gl-transitions/gl-transitions · https://gl-transitions.com |
| npm | `gl-transitions@1.71.0` |
| Count discovered | **125** transitions |
| Spec | GLSL `transition(vec2 uv)` using `getFromColor` / `getToColor` + `progress` 0→1 + optional params with `// = default` |
| Runtime intent | WebGL / OpenGL consumers; **not** Metal-native |
| Fit for OpenScreen | Excellent as **offline definition catalog**; requires **native dual-texture pass** + shader port/compile to MSL/HLSL/WGSL |
| Prior art | `MTTransitions` (iOS Metal ports, MIT) proves Metal ports are feasible but are iOS-oriented, not drop-in for our Rust compositor |

### B. FFmpeg `xfade`

| Item | Finding |
|---|---|
| Count | ~40–50+ named transitions (`fade`, `wipe*`, `slide*`, `dissolve`, `pixelize`, `zoomin`, `fadeblack`, …) |
| Preview | Possible only by running filter graphs / secondary path |
| Export today | OpenScreen export is **native compositor**, not `xfade` |
| Performance | Filter often CPU-bound; multi-clip chains memory-heavy at high res |
| Fit | **Rejected as primary renderer** — would create Web/filter preview ≠ Metal export unless the whole editor moved to FFmpeg (unacceptable) |
| Optional future | Offline thumbnail baking / validation reference only — never sole product path |

### C. Existing OpenScreen infrastructure

| Item | Finding |
|---|---|
| Hold-frame dissolve | Ship as registry entries `openscreen.cut` / `openscreen.dissolve` (native, already proven) |
| Generic layer shaders | Can be extended with a **transition mode** that samples From+To + progress |
| Preference learning hooks | Not present; local signals can hang off registry events later |

---

## 3. Licenses

### gl-transitions catalog (npm 1.71.0 snapshot)

| License | Count |
|---|---|
| MIT | **123** |
| BSD 3-Clause | **1** |
| BSD 2-Clause | **1** |
| **TOTAL_DISCOVERED** | **125** |

**LICENSE_ACCEPTED (provisional for audit):** **125 / 125** are permissive (MIT/BSD) — suitable for bundling **after** per-file attribution and NOTICE generation.  
**Do not scrape** arbitrary web copies; pin a tagged npm/git revision and vendor the JSON + GLSL offline.

### FFmpeg xfade

FFmpeg LGPL/GPL build implications if we ship filter-driven export as a required path. Prefer **not** to make product rendering depend on GPL filter graphs. Bundled third-party FFmpeg already exists for other reasons; using `xfade` as the transition engine still fails preview==export.

### Notices

When implementation vendors shaders: generate `THIRD_PARTY_TRANSITIONS_NOTICES` (name, author, license, source revision). **Not created yet** (no import this phase).

---

## 4. Chosen integration architecture and why

```
[ Bundled transition definitions ]
        (GLSL/MSL/HLSL/WGSL + metadata)
                │
                ▼
   OpenScreen Transition Registry  ←── Manual picker
                │                     ←── Chat resolver
                │                     ←── Autonomous selector
                ▼
   Document: clip.incomingTransition {
     transitionId, durationSec, params, …
   }
                │
                ▼
   buildSceneDescription → scene transition descriptor
                │
                ▼
   Native compositor DUAL-TEXTURE pass
   (Metal / D3D / wgpu)  progress 0→1
                │
                ├── Live preview
                └── exportMulti (same path)
```

### Why this wins

| Criterion | gl-transitions defs + native pass | FFmpeg xfade primary | Hand-roll each effect |
|---|---|---|---|
| Large catalog | yes (125 discoverable) | ~50 | slow |
| Preview == export | yes (if native) | hard | yes |
| Offline | yes (bundle) | yes | yes |
| Metal/desktop fit | yes after port | weak | yes |
| License | mostly MIT/BSD | FFmpeg complexity | N/A |
| Chat + auto + UI one registry | yes | yes | yes |

### Why FFmpeg xfade is not the product engine

- OpenScreen’s sole pixel authority is the **native compositor**.  
- `xfade` would either (a) diverge preview from export, or (b) force a second composition stack.  
- Both violate the milestone’s non-negotiable PREVIEW == EXPORT rule.

### Why GLSL cannot “just run” on Metal

- Three backends: **MSL / HLSL / WGSL**, compile-time `include_str!` today.  
- Dissolve has **no** dual-input sampler API.  
- Need: From texture + To texture + progress + params uniforms, and hold/decoding of **both** sides during the window (true crossfade), not only last-frame hold.

### Recommended implementation phases (next coding milestones — not done now)

1. **Registry + document schema** (`transitionId` + params; keep cut/dissolve as first entries)  
2. **Native dual-texture transition pass** (all three GPUs) + migrate dissolve onto it  
3. **Ingest pipeline**: pin gl-transitions revision → license check → compile/port → quarantine failures  
4. **Manual Transition Library UI** (categories, search, preview thumbnails that call native or verified native-equivalent bake)  
5. **Chat resolver** → registry (local-first)  
6. **Autonomous selector** → editorial metadata (APPLY/KEEP, then family, then id)  
7. **Local preference counters** (manual select / accept / remove / replace)  
8. **QA**: Metal frames, Electron relaunch, export equality  

---

## 5. Registry design (canonical — design only)

Conceptual entry (not coded):

| Field | Purpose |
|---|---|
| `id` | Stable e.g. `gl.CrossZoom`, `openscreen.dissolve` |
| `displayName` | UI / Chat |
| `provider` | `openscreen` \| `gl-transitions` |
| `sourceLicense` / `author` / `attribution` | Legal |
| `category` | Subtle / Movement / Energetic / Stylized / Utility / … |
| `implementationRef` | Native shader module id / bytecode hash |
| `supportedParameters` / `defaultParameters` | Typed |
| `defaultDurationSec` / `minDurationSec` / `maxDurationSec` | Safety |
| `intensity` / `energyLevel` | Editorial |
| `gpuCompatibility` | metal / d3d11 / wgpu flags |
| `previewAvailable` / `exportAvailable` | Gates |
| `userAvailable` | Passed validation |
| `autonomousEligible` | Stricter curated subset |
| `tags` | search |
| `editorial` | content types, boundary types, repeat distraction, tutorial/social/cinematic suitability |
| `sourceRevision` | Pin |

**Document stores IDs + params only** — not shader source.

**One execution path:** `setClipIncomingTransition` (extended) or successor tool writing the same document field consumed by scene → native.

---

## 6–9. Counts / categories (Phase 1)

| Metric | Value |
|---|---|
| TOTAL_DISCOVERED (gl-transitions) | **125** |
| LICENSE_ACCEPTED (permissive) | **125** (provisional) |
| COMPILED into OpenScreen native | **0** (not started) |
| NATIVE_PREVIEW_PASS | **0** library / **2** legacy (cut, dissolve architecture) |
| NATIVE_EXPORT_PASS | same |
| USER_AVAILABLE | **2** conceptual (`cut`, `dissolve`) until library ships |
| AUTONOMOUS_ELIGIBLE | **2** conceptual (cut default; dissolve when story wants) |

### Suggested UI / editorial categories

All · Subtle · Movement · Zoom · Wipe · Reveal · Geometric · Stylized · Fade · Utility

Map gl-transitions names into these via **static editorial metadata** (local query — no LLM per decision).

---

## 10–13. Manual picker / preview / Chat / autonomous

| Item | Phase 1 status |
|---|---|
| Manual picker UI | **NOT IMPLEMENTED** |
| Preview implementation | Legacy dissolve only; library preview **NOT IMPLEMENTED** |
| Chat registry resolution | V1 cut/dissolve only; library names **NOT IMPLEMENTED** |
| Autonomous library selection | Family/story dissolve gate only; catalog pick **NOT IMPLEMENTED** |

### Autonomous reasoning design (to implement next)

```
boundary needs transition?  → KEEP CUT often
        ↓ APPLY
family (SUBTLE / MOVEMENT / …) from story + visual change + pacing
        ↓
candidates = registry.filter(autonomousEligible && family && intensity)
        ↓
pick 1 (deterministic rank: intensity fit, duration, nearby-transition diversity)
        ↓
duration/params from metadata defaults + media span clamp
```

No random catalog demo. No cloud. Preference counters optional local evidence later.

---

## 14–15. Autonomous APPLY / KEEP evidence

| Evidence | Status |
|---|---|
| V1 APPLY/KEEP on cut|dissolve | Exists from TRANSITIONS V1 live metrics (`AUTONOMOUS_APPLY_LIVE` / `KEEP`) |
| Library-based APPLY/KEEP | **NOT YET** — blocked on registry + dual-texture native |

Do not claim library maturity from V1 dissolve alone.

---

## 16. Performance benchmarks

**Not run** (no library shaders loaded).  

Baseline expectation from audit:

- Current dissolve ≈ one extra texture bind + draw while `cut_fade > 0.02`  
- True dual-texture transitions ≈ decode/hold **both** sides for duration + full-screen fragment — must lazy-load shaders, cache pipelines, **not** preload 125 at startup  

Target measurements for implementation phase: compile/load, first preview latency, FPS, frame time, memory, export time on Apple Silicon for Subtle / Movement / Stylized representatives.

---

## 17–21. Persistence / undo / preview / export

| Gate | Status |
|---|---|
| Persistence of cut/dissolve | Document field today; Electron relaunch still a V1 gap |
| Undo/redo cut/dissolve | V1 PASS via project store |
| Library id persistence | Design: store `transitionId` — **not coded** |
| Native preview/export equality for library | Requires dual-texture pass — **not coded** |
| WebGL-only picker | **Forbidden** by architecture choice |

---

## 22. TOTAL_CLOUD_CALLS

Phase 1 research: **0** (no Chat implementation work this phase).  
Requirement for later: supported direct Chat registry ops remain **local-first, TOTAL_CLOUD_CALLS = 0**.

---

## 23. Frozen-family regression

**No code changes** this phase → no frozen-family regression introduced.  
ZOOM / TRIM / SPEED / CAPTIONS / TITLE / CALLOUT remain frozen.

---

## 24. Genuine limitations (honest)

1. Current dissolve ≠ true A/B crossfade — library-quality transitions need a **new native pass**.  
2. GLSL cannot run as-is on Metal; every USER_AVAILABLE entry needs validation on **all** shipping GPU backends (or explicit platform gates).  
3. 125 discovered ≠ 125 user-available; expect quarantine after black-frame / progress / perf / aspect failures.  
4. Thumbnail UI may use a lightweight bake, but **applied** effect must match native export.  
5. Preference learning is local counters only in V2 scope — no recommendation service.  
6. V1 Metal native QA environment was sometimes `SKIP_NO_NATIVE` — library work must re-prove Metal on real hardware.  
7. Do not equate catalog size with editorial quality.

---

## 25. Next recommended transition-library expansion

**Immediate next coding milestone (still TRANSITIONS only):**

1. Schema + registry module with `openscreen.cut` / `openscreen.dissolve` + editorial metadata stubs.  
2. Native **dual-texture transition slot** (Metal first, then D3D/wgpu parity).  
3. Re-implement dissolve on that slot (parity proof).  
4. Ingest **curated Subtle/Utility subset** (~10–20) from pinned gl-transitions with NOTICE file.  
5. Manual picker MVP + Chat name/family resolve + autonomous family→id.  
6. Full QA checklist (manual, Chat, auto APPLY/KEEP, undo, Electron relaunch, export frames).  
7. Only then expand to Movement / Stylized after validation rates look healthy.

**Do not** start another editing family.

---

## Phase 1 gate checklist

| Question | Answer |
|---|---|
| Existing architecture audited? | **YES** |
| gl-transitions feasibility? | **YES as offline defs + native port** |
| FFmpeg xfade as primary? | **NO** |
| License snapshot? | **YES — 125 permissive** |
| Implementation started? | **NO** (per DO NOT CODE FIRST) |
| MATURE claimed? | **NO** |
| Freeze file? | **NO** |

---

## HARD STOP

Phase 1 audit complete.  
**No Transition Library implementation coded in this turn.**  
**No other editing family started.**

Awaiting go-ahead to begin Phase 2 (registry + dual-texture native pass) under the architecture above.
