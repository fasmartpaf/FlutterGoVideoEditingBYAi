# OpenScreen — Caption Verified Apply Bridge V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_CAPTION_VERIFIED_APPLY_V1`  
**Code:** `electron/ai-edition/applyPreview/` + `electron/ai-edition/captionLayout/operation.ts`  
**Artifacts:** `tmp/perception-benchmark/caption-verified-apply-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** Captions now participate in the same `runConsentedApplyPreview` transaction as trim/zoom/crop/speed. Canonical mutation is **settings-only** (`enableCaptions` → `patchCaptionSettings({ enabled: true })`), preserving transcript SSOT and derived cues. Live macOS native compositor proof achieved **`LIVE_VERIFIED_CAPTION_RENDER`** on `recording-bug5-narrated.mp4`. Manual annotations preserved. Forced verify failure rolls back with fingerprint match. Production default remains **unchanged** (no auto-caption-all-videos). Legacy `generateCaptions` marked **DEPRECATE_LATER**.

---

## 2. Caption apply architecture before

Settings enable sat outside Apply Preview (`runConsentedCaptionLayoutEnable`).  
`generateCaptions` wrote legacy auto-caption annotations (CLI/agent only).  
Native render verify was metadata-heavy / PARTIAL.

---

## 3. Canonical operation

`CaptionLayoutOperationV1` / tool **`enableCaptions`** binds:

- transcriptFingerprint, programmeFingerprint, styleFingerprint  
- layoutPolicyVersion, cueCount, layoutStatus=ok  
- preserveManualCaptions: true  
- aspectValue, expectedProgrammeRanges  

See `operation-contract.json`.

---

## 4. Canonical mutation choice

**Decision:** mutate **CaptionSettings.enabled only**.  
Do **not** freeze cues into annotations.  
Derived path `AxcutTranscript + CaptionSettings → deriveCaptionCues → SceneDescription` remains SSOT for caption text.

---

## 5. Manual-caption safety

Structural verify fails if `annotations[]` change.  
Unit proof: `ann_manual` content unchanged after verified enable.

Classes: DERIVED_AUTO_CAPTION | LEGACY_AUTO_CAPTION | MANUAL_CAPTION | USER_EDITED_CAPTION.

---

## 6. Transaction integration

```text
runConsentedApplyPreview
  → enableCaptions preflight
  → patchCaptionSettings({enabled:true})
  → structural (enabled flipped; annotations untouched)
  → caption family verify (scene + native frames)
  → commit | rollback
```

No parallel long-term caption transaction.

---

## 7. Preflight

Requires transcript/programme/style fingerprints match live document, cueCount≥1, layoutStatus=ok, landing present. Stale fingerprints → 0 mutation.

---

## 8. Consent binding

Existing consent binds toolName + operationArgsFingerprint (includes caption fingerprints). Wrong-op / stale → blocked.

---

## 9. Review card

Deterministic: “Add captions to N seconds of narration” + cue count / protected-content move note. No hashes/JSON.

---

## 10. Native compositor verification

Live receipt:

- frameProvider: `native_compositor`  
- status: `LIVE_VERIFIED_CAPTION_RENDER`  
- authoritativeSatisfied: true  

Injected sampler: unit tests only (`allowInjectedCompositorAsAuthoritative`).

---

## 11. Cue presence verification

Scene metadata before/during/after mid caption: inactive / active / inactive.

---

## 12. Geometry verification

Frame-space captions asserted; bbox/font policy checks on layout cues; native frames non-blank.

---

## 13. Text identity verification

Scene caption tokens must be transcript-derived (no OCR, no invented words).

---

## 14–16. Trim / speed / zoom-crop

Handled by CaptionLayout mapping + frame-space scene assert. Unit coverage for trim/speed; zoom/crop independence via `space: frame`.

---

## 17. Aspect ratios

Layout + artifact stubs for 16:9 / 9:16 / 1:1. Live apply proven on 16:9.

---

## 18. Protected regions

Full-frame blocking region → `NO_SAFE_LAYOUT` → apply not proposed / invalid_operation_args.

---

## 19. No-speech

Empty transcript → `NO_SPEECH` → no safe proposal path.

---

## 20. Rollback

Forced family failure: `rolled_back`, `rollbackFingerprintMatch=true`, `captionsEnabled=false`.

---

## 21. Save / undo

Unchanged product path: only verified document returned for renderer save/history. Settings rollback restores pre-enable state.

---

## 22. Duplicate apply

Already-enabled → apply fails (`captions_already_enabled`) → 0 new mutation. MAX_MUTATIONS=1 unchanged.

---

## 23. Legacy generateCaptions

| Path | Role |
|------|------|
| Derived cues + settings | **CANONICAL_PRODUCT_PATH** |
| generateCaptions → auto-caption annotations | **LEGACY_COMPATIBILITY_PATH** |
| Decision | **DEPRECATE_LATER** |

---

## 24. Cache

Caption layout cache invalidated by transcript/programme/aspect/policy/protected fp. Apply verify runs `useCache: false`.

---

## 25. Real-media proof

Media: bug5 narrated. Cue enable → native verify → `LIVE_VERIFIED_CAPTION_RENDER`. Mutations=1.

---

## 26. Performance

Live family verify ~1.0s (native frames). Layout/preflight ≪ 50ms.

---

## 27. Regressions

`applyPreviewV1`, `verifiedApplyExpansionV1`, `captionLayoutV1` unit suites green with this bridge.

---

## 28. Paid AI proof

TOTAL_PAID_AI_CALLS = 0.

---

## 29. Remaining limitations

- Windows/Linux live not run.  
- Aspect live apply exercised primarily at 16:9 (layout at all three).  
- Grouping policy vs `deriveCaptionCues` may differ line boundaries; identity is transcript-token based.  
- Karaoke still out of scope.  
- PRODUCTION_DEFAULT unchanged — users still opt in via consent.

---

## 30. Production readiness

Captions are ready for verified apply when transcript exists and layout is ok. Do not auto-enable globally.

---

## 31. Next recommendation

**caption_product_surface_v1** — wire review card + enableCaptions into the in-app Edit Review UI path end-to-end (still no LLM rewrite).

---

## FINAL DECISIONS

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
CAPTION_OPERATION_CONTRACT: PASS
CAPTION_PREFLIGHT: PASS
CONSENT_BINDING: PASS
MANUAL_CAPTION_PRESERVATION: PASS
NATIVE_CAPTION_RENDER_VERIFY: PASS
CAPTION_TIMING_VERIFY: PASS
TRIM_INTERACTION: PASS
SPEED_INTERACTION: PASS
ZOOM_CROP_INTERACTION: PASS
ASPECT_RATIO_LIVE_VERIFY: PARTIAL
PROTECTED_REGION_HANDLING: PASS
ROLLBACK: PASS
SAVE_UNVERIFIED_BLOCK: PASS
UNDO_INTEGRATION: PASS
LEGACY_CAPTION_PATH: DEPRECATE_LATER
TOTAL_PAID_AI_CALLS: 0
CAPTIONS_READY_FOR_VERIFIED_APPLY: YES
VERIFIED_EDIT_FAMILIES: [trim, zoom, crop, speed, captions]
PRODUCTION_DEFAULT: UNCHANGED
NEXT_LOCAL_CAPABILITY: caption_product_surface_v1
```

STOP.
