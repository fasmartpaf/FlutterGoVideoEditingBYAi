# OpenScreen — Local Edit Verification Expansion V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_EDIT_VERIFY_EXPANSION_V1`  
**Date:** 2026-09-15  
**Code:** `electron/ai-edition/editVerify/`  
**Artifacts:** `tmp/perception-benchmark/local-edit-verify-expansion-v1/`  
**Paid AI:** **0**

Extends verification for **zoom / crop / speed** under consent → apply → verify → rollback.  
Does **not** change applyPreview production default (`addTrim`-only). No LLM.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** Generic `EditVerificationResult` contract + family verifiers work with fail-closed rollback. Geometry + SceneDescription effect-presence + compositor frame validity are proven (injected authoritative sampler offline). Native live compositor sampling is available via the same sampler interface but was not required for geometry pass on this run.

---

## 2. Current verification gap

| Family | Before | After |
|--------|--------|-------|
| Trim | VISUAL + AUDIO + TIMING (applyPreview) | unchanged |
| Zoom | NOT_VERIFIED on consent path | editVerify module: STRUCTURAL + GEOMETRY + SCENE + COMPOSITOR |
| Crop | NOT_VERIFIED | same pattern |
| Speed | NOT_VERIFIED | TIMING + SCENE + optional AUDIO duration |

See `current-audit.json` / `edit-verification-current-audit.json`.

---

## 3. Generic contract

`EditVerificationRequest` / `EditVerificationResult` with levels:

`STRUCTURAL_VALID` → `PROGRAMME_MAPPING_VALID` → `RENDER_VALID` → `EFFECT_PRESENT` → `PRESERVATION_VALID` → `AUDIO_VALID` → `VERIFIED`

Allowed claims only: `zoom_rendered_as_specified`, `crop_geometry_valid`, `speed_timing_valid` (+ structural/mapping/audio).  
Forbidden: subjective quality language.

---

## 4–6. Zoom

- Audit: `zoomRanges` → `effectiveZoomScale` (1–5) → `SceneDescription.zoomRegions`
- Geometry: focus unit square + scale bounds + visible source window; focal target containment (`ZoomGeometryVerification`)
- Render: scene zoom active at mid-time with matching scale; compositor samples before/mid/after must be valid (native or injected-authoritative)
- Fail closed: invalid focus/scale, blank frame, unavailable compositor, clipped protected target

---

## 7–8. Crop

- `classifyCrop`: `VALID_CROP` | `EMPTY_CROP` | `OUT_OF_BOUNDS` | `EXTREME_CROP`
- Scene `cropByClip` must match; protected region exclusion → rollback
- No aesthetic judgment

---

## 9–11. Speed

- Authority: `legacyEditor.speedRegions` (multiplier)
- Math: `programmeDuration = sourceDuration / M` (0.5× / 1× / 1.25× / 1.5× / 2× covered)
- Scene speed region present; optional PCM/duration probe; forced audio failure → rollback
- No perceptual “naturalness” claims

---

## 12. VisualAnalysisV1 integration

Adapter-ready (`visual-analysis-integration.json`): must-survive regions / mapped activity. Does not re-decode when analysis is supplied by caller. Not wired into AI cognition.

---

## 13. Must-survive generalization

| Family | Rule |
|--------|------|
| Zoom | protected normalized region center inside visible zoom window |
| Crop | protected center inside crop |
| Speed | source midmaps under multiplier (outside region noted, not failed) |

Timeline presence ≠ output visibility.

---

## 14. Native compositor evidence

`VISUAL_VERIFIED` requires `frameProvider === native_compositor` **or** explicit `allowInjectedAsAuthoritative` for tests. FFmpeg source stills never upgrade status.

---

## 15. Rollback

Snapshot → mutate → verify fail → restore fingerprint. Proven for blank zoom, protected crop, audio-failed speed.

---

## 16. Real-media / fixtures

Corpus uses bug5 narrated path when present; document mutations + scene inspect + injected compositor. Consent required; one mutation per run.

---

## 17–18. Performance / cache

Per-family latency in `performance.json` (preflight/apply/verify slices).  
Frame cache: fingerprint + programmeTime + resolution + `EDIT_VERIFY_FRAME_CACHE_VERSION`. Cleared across mutations.

---

## 19. Cross-platform

Proven: current host with injected compositor. Windows/Linux native: **NOT_RUN**.

---

## 20. Tests

`editVerifyExpansionV1.test.ts` + corpus runtime. applyPreview regression still green. Fingerprint now includes crop/zoom details/speed multipliers.

---

## 21. Paid AI proof

`TOTAL_PAID_AI_CALLS = 0`

---

## 22. Limitations

- applyPreview still addTrim-only (intentional `PRODUCTION_DEFAULT: UNCHANGED`)
- Offline corpus uses injected compositor as authoritative; live native macOS sampling not claimed as proven this run
- Speed audio without PCM probe does not grant `AUDIO_VALID` level
- Extreme crops classified but not auto-blocked (VALID path requires `VALID_CROP`)
- Subjective quality out of scope

---

## 23. Next recommendation

**`caption_layout_safe_areas_v1`**

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS

GENERIC_EDIT_VERIFY_CONTRACT: PASS
ZOOM_STRUCTURAL_VERIFY: PASS
ZOOM_GEOMETRY_VERIFY: PASS
ZOOM_COMPOSITOR_VERIFY: PASS_WITH_LIMITATIONS
CROP_STRUCTURAL_VERIFY: PASS
CROP_GEOMETRY_VERIFY: PASS
CROP_COMPOSITOR_VERIFY: PASS_WITH_LIMITATIONS
SPEED_TIMING_VERIFY: PASS
SPEED_AUDIO_VERIFY: PASS_WITH_LIMITATIONS
MUST_SURVIVE_GENERALIZATION: PASS
ROLLBACK: PASS

TOTAL_PAID_AI_CALLS: 0

ZOOM_READY_FOR_VERIFIED_APPLY: YES
CROP_READY_FOR_VERIFIED_APPLY: YES
SPEED_READY_FOR_VERIFIED_APPLY: YES

PRODUCTION_DEFAULT: UNCHANGED
NEXT_LOCAL_CAPABILITY: caption_layout_safe_areas_v1
```

**HARD STOP.** No captions, transitions, denoise, stabilization, cognition, multi-edit, or production-default changes.
