# AI_OPENSCREEN_CAPTIONS_PRODUCT_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789554424774.mp4` (~35.6s) + injected grounded transcript words for caption text  
**Host:** Apple Silicon — Metal hardware compositor  
**Artifacts:** `tmp/perception-benchmark/openscreen-captions-maturity-v1/`  
**Export:** `export/captions-maturity-proof.mp4`  
**ZOOM / TRIM / SPEED:** frozen / untouched  

**FINAL_CAPTIONS_PRODUCT_STATUS = MATURE**

---

## 1. Phase 1 — Audit (pre-fix)

| # | Finding |
|---|---|
| 1 | Captions = **derived view** of `document.transcripts` via `legacyEditor.captions` settings — **no stored cue text** |
| 2 | Text from ASR/STT words (optional translations); cues recomputed every render |
| 3 | Authorable: enabled, fontSize/family/weight/color, anchorV/H, insetY/X, background, min/max words. No named presets |
| 4 | Reaches compositor as frame-space synthetic annotations (`deriveCaptionCues` → `buildSceneDescription`) |
| 5 | Settings + transcript words survive save/reopen; derived cues do not persist (recomputed) |
| 6 | Export uses same scene path as preview |
| 7 | Pre-fix Chat: ENABLE tried direct then orch; CAPTIONS/CAPTION_STYLE(shrink-only) direct; no move/larger/text-correct |
| 8 | “add captions” — local when transcript exists |
| 9 | “remove captions” — **disable** (`enabled:false`), non-destructive |
| 10 | Follow-ups beyond “smaller” were thin; no document-grounded caption anaphora |
| 11 | Text correction existed via transcript word edits — **not** via Chat |
| 12–13 | Cue mapping is trim-aware (source→virtual); compositor matches source time of played frame (speed-safe) |
| 14 | Risk: captionLayout placements ≠ burn-in; dual legacy `generateCaptions` annotations |
| 15 | No transcript → honest refuse / orch STT path; no fabricated speech |

---

## 2. Root causes fixed

1. CAPTION_STYLE only shrank size — no larger / position / readability / density  
2. No Chat text-correction intent  
3. “put captions at the bottom” mis-routed to ENABLE  
4. No caption follow-up / document-grounded restart path (unlike Speed)  

---

## 3. Files changed (CAPTIONS only)

| File | Role |
|---|---|
| `electron/ai-edition/localEditorialChat/directCaptions.ts` | **new** — style ops, text correction, extractors |
| `electron/ai-edition/localEditorialChat/types.ts` | `CORRECT_CAPTION`, `captionStyleOp`, `captionTextReplace`, `captionAtSec` |
| `electron/ai-edition/localEditorialChat/parse.ts` | enable/style/correct routing |
| `electron/ai-edition/localEditorialChat/normalize.ts` | “can you caption…” as COMMAND |
| `electron/ai-edition/localEditorialChat/direct.ts` | wire style + text correction |
| `electron/ai-edition/localEditorialChat/resolveFollowUp.ts` | caption anaphora |
| `electron/ai-edition/localEditorialChat/index.ts` | document-grounded caption follow-ups |
| `electron/ai-edition/localEditorialChat/captionsProductMaturityV1.test.ts` | unit |
| `electron/ai-edition/localEditorialChat/captionsProductMaturityV1.live.runtime.test.ts` | live |
| `electron/ai-edition/localEditorialChat/CAPTIONS_FROZEN.md` | freeze marker |

---

## 4. Caption data / authority model

- **SSOT text:** transcript words  
- **Look / show:** `legacyEditor.captions`  
- **OFF:** non-destructive `enabled: false` (style + corrections kept)  
- **EXPLICIT Chat** → `direct_document` (0 cloud)  
- **AUTONOMOUS** (“make professional”) → orch policy unchanged  

**Relative style ladder (font @ 1080p):** `24, 32, 40, 48, 56, 64, 72, 96`  
**Position:** bottom-anchored `insetY` ±2.5%; top / bottom / horizontal center supported  

---

## 5. Real Chat A–L trace

| Turn | Command | Result |
|---|---|---|
| A | add captions | enabled |
| B | make the captions smaller | 48→40px |
| C | move them a little higher | insetY ↑ |
| D | replace 'open screen' with 'OpenScreen' | cue text corrected |
| E–F | undo / redo | product stack PASS |
| G–H | off / back on | disable preserves size; re-enable restores |
| I | save → quit → relaunch → reopen | Electron QA PASS |
| J | make the captions a little bigger | 40→48 after restart |
| K–L | native preview + export | PASS |

Electron receipts: `electron-restart-qa.json`  
Live metrics: `metrics.json`

---

## 6. Text correction trace

`replace 'open screen' with 'OpenScreen'` → words w1/w2 rewritten; cues show `OpenScreen` / `editor settings`. Timing preserved. Ambiguous multi-match refused without a time anchor.

---

## 7. Trim + Speed synchronization

Document with captions → remove first 3s → speed 5–10 @ 2×.  
Speech cues remain; Metal frame sampled after compose.  
Frozen Trim/Speed paths used as-is (not modified).

---

## 8–10. Undo / redo / Electron restart

| Gate | Result |
|---|---|
| REAL_CAPTION_UNDO | **PASS** |
| REAL_CAPTION_REDO | **PASS** |
| CAPTION_RESTART_PERSISTENCE | **PASS** (quit exit 0 → relaunch → reopen → bigger) |

---

## 11–13. Native preview / export / match

| Gate | Result |
|---|---|
| NATIVE_CAPTION_PREVIEW | **PASS** (PPM frames: enabled, smaller, higher, corrected, off, restored, trim+speed) |
| NATIVE_CAPTION_EXPORT | **PASS** (~35.6s MP4, caption annotations in scene) |
| PREVIEW_EXPORT_CAPTION_MATCH | **PASS** |

---

## 14. Receipt honesty

| Metric | Value |
|---|---|
| FALSE_CAPTION_APPLIED_CLAIMS | **0** |
| ROLLED_BACK_CAPTION_CLAIMS | **0** |
| TOTAL_CLOUD_CALLS | **0** |

---

## 15. Product review (editor/user)

1. Appear when requested? **Yes**  
2. Readable? **Yes** (plate + bold available via “easier to read”)  
3. Professionally positioned? **Yes** (bottom default; movable)  
4. Size natural? **Yes**  
5. Position natural? **Yes**  
6. Text correctable safely? **Yes** (exact phrase / replace)  
7. Targets intended cue? **Yes** when phrase unique; else asks  
8. Synced after Trim? **Yes**  
9. Synced after Speed? **Yes**  
10. Disable/re-enable predictable? **Yes** (non-destructive)  
11. Follow-ups conversational? **Yes** (“them” / document-grounded)  
12. Undo/redo? **Yes**  
13. Restart? **Yes**  
14. Export ≈ preview? **Yes**  
15. Trust? **Yes** for local caption control  

**Issues:** MINOR — cue-density “longer on screen” approximates via fewer words (no separate dwell field); synthetic transcript used for text proof when recording had no STT sidecar; captionLayout placements still do not drive burn-in (out of scope).

**BLOCKER / MAJOR:** **NONE**

---

## 16. Acceptance matrix

| Capability | Status |
|---|---|
| Explicit enable | PASS |
| Explicit disable | PASS |
| Local-first | PASS (0 cloud) |
| Size | PASS |
| Position | PASS |
| Text correction | PASS |
| Follow-ups | PASS |
| Timing vs Trim/Speed | PASS |
| Undo/redo | PASS |
| Electron restart | PASS |
| Native preview | PASS |
| Native export | PASS |
| Honest receipts | PASS |

---

## 17. Remaining genuine limitations

- No per-cue dwell editor beyond max-words density  
- No Chat “split this caption” (would need new cue model)  
- captionLayout collision placements are analysis-only  
- Requires transcript words; does not invent speech  

---

## Status

```
FINAL_CAPTIONS_PRODUCT_STATUS = MATURE
```

**FREEZE CAPTIONS.**

Do not begin TITLE, CALLOUT, TRANSITION, or another editing family — wait for the next capability milestone.
