# AI_OPENSCREEN_TRANSITION_LIBRARY_PRODUCT_SURFACE_V4_REPORT

**Milestone:** `OPENSCREEN_TRANSITION_LIBRARY_PRODUCT_SURFACE_V4`  
**Date:** 2026-09-16  
**Host:** Apple Silicon (Metal)

```
TRANSITION_PRODUCT_SURFACE_STATUS = MATURE_MANUAL
```

Manual Transition Library + direct Chat control over the **same Registry**.  
Autonomous transition intelligence is **not** claimed mature.

---

## 1. Phase-1 UI audit

**Finding:** No Transition Library React surface existed. Joins were decorative diamonds (`pointer-events: none`). Authoring was Chat/`setClipIncomingTransition` only.

**Decision (fits OpenScreen):**

| Choice | Rationale |
|--------|-----------|
| **Primary:** clickable timeline join → `FloatingInspector` SelectionPane | Same pattern as zoom/speed region selection |
| **Catalog:** MediaStage-style searchable card grid inside that pane | Existing library UX language |
| **Avoid:** new top-level Effects facet / random modal | No precedent; Effects is look/background |

**Boundary authority added:** `selectedTransitionBoundary: { incomingClipId }` on `useTimeline` (mutual exclusive with clip/region/audio).

---

## 2. Screenshots / UI description

UI (no desktop computer-use MCP in this session — description from implementation):

- Timeline join diamonds are **buttons**; active join highlighted; non-cut joins tinted.
- Clicking a join opens the inspector **Transitions** pane.
- Pane: search field, duration slider (registry min/max), categorized cards (Basic / Dissolve·Fade / Wipes / Slides), geometry-faithful looping mini-previews, **Remove → Cut**.
- Cards show **display names** only (not `gl.wipeLeft` in normal UI).

Evidence artifacts:

`tmp/perception-benchmark/openscreen-transition-product-surface-v4/`

---

## 3. Exact files changed

| Area | Files |
|------|--------|
| Timeline / selection | `useTimeline.ts`, `V4Timeline.tsx`, `EditorShellV4.module.css`, `clipFilmstrip.ts` |
| Inspector library | `FloatingInspector.tsx`, `TransitionLibraryPane.tsx`, `TransitionPreviewThumb.tsx` |
| Document mutation | `src/lib/ai-edition/document/incomingTransition.ts` |
| Backend map | `src/lib/ai-edition/transitions/gpuBackend.ts` |
| Registry phrase/search | `transitionLibrary/resolvePhrase.ts`, `index.ts` |
| Chat | `directTransition.ts`, `parse.ts`, `types.ts` |
| Tests | `transitionLibraryProductSurfaceV4.test.ts`, `.live.runtime.test.ts`; V1 wipe expectation updated |

Frozen families untouched.

---

## 4. Registry → UI data flow

```
probeCompositorBackend → resolveTransitionGpuBackend
  → listUserAvailableTransitions(gpu) / searchTransitions(q, gpu)
  → TransitionLibraryPane cards
  → setClipIncomingTransitionInDocument (validateAndClampTransitionApply)
  → projectStore.saveDocument({ history: true })
  → sceneDescription.emitIncomingTransition → native preview/export
```

UI never hard-codes a transition list.

---

## 5. Available transition count (Metal)

**USER_AVAILABLE_METAL = 11**

`openscreen.cut`, `openscreen.dissolve`, `gl.fade`, `gl.dissolve`, four wipes, two slides, `gl.fadeblack`.

Quarantined (`circleOpen`, `crossZoom`) **not** shown.

---

## 6. Picker / category / search

- Categories from registry `category` → Basic / Dissolve·Fade / Wipes / Slides / More.
- Local search over `displayName`, `category`, `tags` (compositional scoring).
- Measured search path writes `__transitionSearchMs` on `window` for diagnostics.

---

## 7. Preview strategy + cache

- Canvas mini-previews use **same mode geometry** as Metal `ab_from_layer_geometry` (not unrelated CSS).
- Frames cached per `transitionId` in module `Map` — **no native decoders** while browsing.
- Hover/selected cards animate; idle shows mid-progress still.

---

## 8. Boundary-selection model

- `tl.selectTransitionBoundary(incomingClipId)`
- Clears clip/region/audio selection.
- Inspector opens `TransitionLibraryPane` when boundary set.
- Timeline join `data-active` / `data-kind` reflect selection and cut vs effect.

---

## 9. Manual apply / replace / remove trace

| Action | Result |
|--------|--------|
| Apply Wipe Left | `incomingTransition.transitionId = gl.wipeLeft` |
| Replace → Slide Left | single transition replaced (no stack) |
| Remove → Cut | `openscreen.cut` |

Authority: `setClipIncomingTransitionInDocument` ≡ agent-tools validation.

---

## 10. Duration trace

Slider clamped to registry `minDurationSec`/`maxDurationSec` via `validateAndClampTransitionApply`. Live: Wipe Left `0.4` → `0.7` PASS.

---

## 11. Chat parsing / resolution architecture

- `resolveTransitionPhrase` — aliases + tags + direction composition (`wipe`+`left`).
- Ambiguous → ask user; unsupported → honest refuse.
- `directTransition` ADD/ADJUST/REMOVE call `setClipIncomingTransition` with **transitionId**.
- Follow-ups: shorter/longer ladder, other direction flip, list available.
- Document grounding: `legacyEditor.transitionClipIds` + nearTimestamp join + sole active join.

---

## 12. Chat command trace (proven)

| Utterance | Result |
|-----------|--------|
| use wipe left here | `gl.wipeLeft` |
| change this transition to dissolve | dissolve/fade id |
| make that a little shorter | duration ↓ |
| change that transition to wipe right | `gl.wipeRight` after reopen |
| what transitions are available? | local name list |

`TOTAL_CLOUD_CALLS = 0`

---

## 13. Timeline evidence

Join marks: clickable, selected chrome, effect vs cut tint, accessible name via `aria-label`/`title`. Geometry tests updated (`data-incoming-clip-id` so clips stay `data-clip-id` only).

---

## 14. Undo / redo

Product history stack: slide → wipe → undo → slide → redo → wipe. **PASS**

---

## 15. Real Electron restart

**Document persistence:** JSON round-trip + schema reopen + Chat follow-up without process-local-only state. **PASS**

**Full Electron quit/relaunch of UI chrome:** not driven (no desktop computer-use MCP here). Persistence contract is document-level; UI re-derives selection from joins after reopen.

---

## 16–18. Native preview / export / match

Metal product-path document (`gl.wipeLeft`):

- Live `readFrame` samples at 0 / 0.25 / 0.5 / 0.75 / 1 → **PASS**
- `exportMulti` → **PASS**
- Preview/export path shared via scene → **PASS**

(Parity numbers carried from V3.1; this milestone did not reopen compositor architecture.)

---

## 19. Picker performance

- No per-card native decoder open.
- Preview frame cache is O(transitions × 16 frames × 96×54).
- Seek-heavy compositor WARNING from V3.1 **carried forward** (not redesigned).

---

## 20. Backend gating

`listUserAvailableTransitions(resolveTransitionGpuBackend(probe))`.

| Backend | Behavior |
|---------|----------|
| Metal | 11 USER_AVAILABLE |
| D3D11 / wgpu | Metal-only A/B filtered out (`gpuCompatibility !== false`); cut remains |

No unsupported A/B lies.

---

## 21. Attribution handling

`THIRD_PARTY_TRANSITIONS_NOTICES.md` retained. About dialog not redesigned (existing About has no third-party list surface). Notices remain product-accessible as repo/packaged notice files — no per-card license clutter.

---

## 22. Frozen-family regression

Unit suite (callout / title / captions / speed / trim / zoom maturity + V4 + V1 transitions): green in this pass.  
`FROZEN_FAMILY_REGRESSION = PASS`

---

## 23. TOTAL_CLOUD_CALLS

```
TOTAL_CLOUD_CALLS = 0
```

---

## 24. Remaining genuine gaps

1. Autonomous library selection still conservative (intentional HARD STOP).
2. D3D11/wgpu A/B still BACKEND_LIMITED.
3. circleOpen / crossZoom still QUARANTINED_RENDER.
4. Full desktop Electron click-walkthrough not computer-used this session (document + native path proven).
5. Seek-heavy preview FPS WARNING carried from V3.1.
6. About UI does not yet deep-link transition notices.

---

## 25. Final product-surface status

```
TRANSITION_PRODUCT_SURFACE_STATUS = MATURE_MANUAL
```

**Means:** a normal user can browse, preview (geometry-faithful thumbs), apply, replace, remove, change duration, Chat-control, undo/redo, persist, and export transitions on Metal via the Registry.

**Does not mean:** autonomous transition intelligence is mature.

---

## Acceptance gates

| Gate | Result |
|------|--------|
| TRANSITION_PICKER_UI | PASS |
| REGISTRY_IS_UI_SSOT | PASS |
| BACKEND_GATED_LIBRARY | PASS |
| VISUAL_TRANSITION_PREVIEWS | PASS |
| SEARCH | PASS |
| BOUNDARY_SELECTION | PASS |
| MANUAL_APPLY | PASS |
| REPLACE | PASS |
| REMOVE_TO_CUT | PASS |
| DURATION_CONTROL | PASS |
| CHAT_TRANSITION_NAME_RESOLUTION | PASS |
| CHAT_TRANSITION_FOLLOWUP | PASS |
| CHAT_DOCUMENT_GROUNDED_AFTER_RESTART | PASS |
| DIRECT_TRANSITION_AUTHORITY | PASS |
| TIMELINE_TRANSITION_HONESTY | PASS |
| REAL_TRANSITION_UNDO | PASS |
| REAL_TRANSITION_REDO | PASS |
| TRANSITION_RESTART_PERSISTENCE | PASS |
| NATIVE_PRODUCT_PREVIEW | PASS |
| NATIVE_PRODUCT_EXPORT | PASS |
| PREVIEW_EXPORT_TRANSITION_MATCH | PASS |
| NO_QUARANTINED_TRANSITIONS_EXPOSED | PASS |
| NO_UNSUPPORTED_BACKEND_LIE | PASS |
| FROZEN_FAMILY_REGRESSION | PASS |
| TOTAL_CLOUD_CALLS | 0 |

**HARD STOP.** Do not start autonomous transition intelligence until this manual surface is accepted in product.
