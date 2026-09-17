# OpenScreen — Local Caption Layout + Safe Areas V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1`  
**Code:** `electron/ai-edition/captionLayout/`  
**Artifacts:** `tmp/perception-benchmark/local-caption-layout-v1/`  
**Paid AI:** **0**

HARD STOP after this report: no transitions, denoise, stabilization, AI rewrite, translation, TTS, multi-edit, or cognition changes.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** OpenScreen already had a WORKING transcript→cue→frame-space compositor path. This milestone adds a canonical **local layout analysis + collision/safe-area/policy layer** (`CaptionCueV1` / `CaptionLayoutResult`) with reading-speed grouping, placement continuity, trim/speed programme mapping, fail-closed `NO_SAFE_LAYOUT`, reviewable proposal, consented enable-only apply (not Apply Preview), and scene-metadata verification. Karaoke remains out of scope. Product caption rendering defaults are **unchanged**.

---

## 2. Current caption architecture

```text
Whisper/STT → AxcutTranscript (SSOT words)
  → deriveCaptionCues (virtual ms) → captionCuesToTextRegions (space:frame)
  → buildSceneDescription → native compositor text backends
```

Legacy `generateCaptions` still writes stored `auto-caption` annotations (**DUPLICATED**).  
Apply Preview allowlist does **not** include captions (**MISSING** by design this milestone).

Audit: `caption-current-audit.json`

| Part | Status |
|------|--------|
| STT / transcript storage | WORKING |
| generateCaptions CLI/agent | DUPLICATED |
| Derived CaptionCue + settings | WORKING |
| Scene / compositor text | WORKING |
| Font / line / safe column | WORKING |
| Karaoke | MISSING |
| applyPreview captions | MISSING |
| CaptionLayout V1 | WORKING (new) |

---

## 3. Cue grouping

`CaptionGroupingPolicy` (`policy.ts` / `group.ts`):

- pause break **0.24s** (aligned with existing word-run gap)
- min/max words **2–7**
- max cue duration **6s**
- punctuation break on `.!?;:`
- reading-speed split when CPS too high

Technical tokens (`npm run build`, `localhost 3000`) kept verbatim — no paraphrase.

---

## 4. Reading-speed policy

Metrics per cue: `charactersPerSecond`, `wordsPerSecond`.  
Prefer **split** over shrinking font below `minFontSizePxAt1080` (28).  
Speech timing never altered.

---

## 5. Line breaking

Deterministic token wrap with estimated glyph width (`avgGlyphWidthEm ≈ 0.55`).  
Orphan-word avoidance when possible. Overflow flagged at minimum font.  
Real CoreText metrics not required for V1; compatible estimate is honest.

---

## 6. Safe areas

Normalized geometry via product `captionSafeColumn` / default insets:

- 16:9 → ~68% column, small bottom inset  
- 9:16 / 1:1 → wider column, larger vertical inset (platform chrome)

`CaptionSafeArea` uses 0..1 fractions — not hard-coded export pixels.

---

## 7. Protected-content handling

Optional `CaptionProtectedRegion[]` (webcam / annotation / OCR / focal / UI).  
When **all** placements collide blocking → status **`NO_SAFE_LAYOUT`** and cues omitted.  
Conservative: no paid vision; callers supply regions from local evidence.

---

## 8. Collision detection

`CaptionCollision { cueId, objectId, overlapRatio, severity, reason }`  
Severities: low / medium / high / **blocking**.

---

## 9. Placement continuity

Candidates: `BOTTOM_CENTER` | `TOP_CENTER` | `BOTTOM_LEFT` | `BOTTOM_RIGHT`.  
Hysteresis: keep previous placement unless blocking collision forces change.  
`placementChanges[]` records reasons.

---

## 10. Font policy

Preferred 48 @1080, min 28, max 64. Split before going below min.

---

## 11. Technical speech

Grouping/line-break preserve transcript tokens; no prettier rewrite.

---

## 12. Source / programme timing

Words are SOURCE_MEDIA_TIME.  
`mapSourceSpanThroughDocument` → virtual spans → speed-compressed programme spans.  
`sourceInstantSurvivesPlayback` drops fully trimmed speech before grouping.

---

## 13. Trim interaction

Surviving-word filter + empty programme map → omit. No captions for removed speech.

---

## 14. Speed interaction

`compressedDurationSec` / `virtualSpanToProgrammeSpan` for 0.5× / 1.5× / 2×.  
Text unchanged; programme duration scales as `sourceDur / speed`.

---

## 15. Zoom / crop interaction

Product captions remain **`space: "frame"`** overlays — intentionally not cropped by source zoom/crop. Layout module verifies scene frame-space annotations. Preview/export parity inherits existing scene path.

---

## 16. Aspect ratios

Corpus runs **16:9, 9:16, 1:1** with distinct safe columns/insets.

---

## 17. Compositor verification

`verifyCaptionLayoutRender`:

1. Scene build with captions enabled → count `caption-*` text annotations  
2. Bounding boxes inside frame  
3. Optional native sampler frames (authoritative only when native)

Does **not** OCR our own text. Metadata-first is honest when sampler omitted.

---

## 18. Proposal / apply integration

- Review copy: deterministic (“Add captions for N seconds of narration.”)  
- Proposal: `proposal_only` / `applyDomain: CAPTION_SETTINGS_ENABLED`  
- Apply: `runConsentedCaptionLayoutEnable` → `patchCaptionSettings({ enabled: true })` only  
- **Not** forced through Apply Preview allowlist (structurally different; remaining bridge noted)  
- No consent → no mutation; stale fingerprint → blocked; verify fail → rollback settings

---

## 19. Manual caption preservation

Layout never rewrites annotation text. Manual/legacy presence adds warning `manual_captions_present_not_overwritten`. Enable-only apply does not delete user text annotations.

---

## 20. Real corpus

Artifacts under `local-caption-layout-v1/`:

- synthetic technical speech @ 16:9 / 9:16 / 1:1  
- no-audio → `NO_SPEECH`  
- speed-2x fixture  
- media path prefers bug5 narrated when present  

---

## 21. Human visual review

`manual-review.json` — checklist judgments (GOOD / BAD_PLACEMENT_AVOIDED). Not an AI call. Full pixel beauty not claimed from unit tests alone.

---

## 22. Performance

Layout does not decode full video. Typical synthetic totals ≪ 50ms grouping+layout; scene verify dominates when run.

---

## 23. Cache

Key: transcript fp + programme fp + aspect + policy version + protected-region fp.  
Invalidates on transcript/timing/trim/speed/aspect/protected geometry — not unrelated metadata.

---

## 24. Tests

`captionLayoutV1.test.ts` + `captionLayoutV1.corpus.runtime.test.ts` — **12 passed**.

Covers grouping, line break, overflow, collisions, NO_SAFE_LAYOUT, aspects, speed, trim, proposal/consent, cache, paid AI = 0.

---

## 25. Paid AI proof

```json
{
  "OPENAI_CALLS": 0,
  "ANTHROPIC_CALLS": 0,
  "GEMINI_CALLS": 0,
  "OTHER_PAID_AI_CALLS": 0,
  "TOTAL_PAID_AI_CALLS": 0
}
```

---

## 26. Limitations

- Glyph width is estimated (not CoreText/DirectWrite measure).  
- Protected regions require caller-supplied local evidence (no auto OCR in this module).  
- Apply Preview caption family not wired — enable path is settings consent only.  
- Karaoke / word highlight still MISSING.  
- Native frame verify optional; metadata verify is the default gate.  
- PRODUCTION_DEFAULT unchanged — does not auto-enable captions on every video.

---

## 27. Next local capability recommendation

**caption_apply_preview_bridge_v1** — wire verified caption-enable (or layout-pack) through the same consent→apply→verify→rollback transaction family as trim/zoom/crop/speed, without LLM rewrite.

---

## FINAL DECISIONS

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
CAPTION_GROUPING: PASS
READING_SPEED_POLICY: PASS
LINE_BREAKING: PASS
SAFE_AREA_LAYOUT: PASS
PROTECTED_CONTENT_AVOIDANCE: PASS
COLLISION_HANDLING: PASS
PLACEMENT_CONTINUITY: PASS
SOURCE_PROGRAMME_TIMING: PASS
TRIM_INTERACTION: PASS
SPEED_INTERACTION: PASS
ZOOM_CROP_INTERACTION: PASS
ASPECT_RATIO_SUPPORT: PASS
NATIVE_RENDER_VERIFY: PARTIAL
MANUAL_CAPTION_PRESERVATION: PASS
TOTAL_PAID_AI_CALLS: 0
CAPTION_LAYOUT_V1: READY_FOR_PRODUCT_INTEGRATION
PRODUCTION_DEFAULT: UNCHANGED
NEXT_LOCAL_CAPABILITY: caption_apply_preview_bridge_v1
```

STOP.
