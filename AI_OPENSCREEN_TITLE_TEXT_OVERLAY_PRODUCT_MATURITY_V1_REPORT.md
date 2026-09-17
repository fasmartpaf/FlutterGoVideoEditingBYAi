# AI_OPENSCREEN_TITLE_TEXT_OVERLAY_PRODUCT_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789554424774.mp4` (~35.6s)  
**Host:** Apple Silicon — native compositor addon (Metal/CPU fallback)  
**Artifacts:** `tmp/perception-benchmark/openscreen-title-maturity-v1/`  
**Export:** `export/title-maturity-proof.mp4` (~11.8 MB)  
**ZOOM / TRIM / SPEED / CAPTIONS:** frozen / untouched  

**FINAL_TITLE_PRODUCT_STATUS = MATURE**

**TITLE / TEXT OVERLAY is FROZEN.** Stop. Wait for the next capability.

---

## 1. FINAL_TITLE_PRODUCT_STATUS

`MATURE` — explicit exact text, programme timing (incl. after frozen Trim/Speed),
size/position/timing follow-ups, multi-title targeting, title-vs-caption separation,
document-grounded restart edit, real undo/redo, Electron quit→relaunch persistence,
native preview frames, native export, receipt honesty, autonomous garbage-title
regression, and `TOTAL_CLOUD_CALLS = 0` for supported direct commands all pass.

---

## 2. Phase-1 audit (pre-fix)

| # | Finding |
|---|---|
| 1 | Titles are **`addGraphic(kind:"title")` → `document.annotations[]` text regions** (not a separate overlay table). |
| 2 | Primitive = annotation `type:"text"`; graphic kind is not persisted on the annotation. |
| 3 | Existing fields used: `content`/`textContent`, `startMs`/`endMs`, `position.{x,y}`, `size.{width,height}`, `style.{fontSize,fontFamily,fontWeight,fontStyle,textAlign,color,backgroundColor,textAnimation}`, `zIndex`. No new fields invented. |
| 4 | Compositor: annotations → `buildSceneDescription` text nodes (programme/source mapping via existing scene path). |
| 5 | Save/reopen: annotation + `legacyEditor.titleOverlayIds` survive document JSON. |
| 6 | Export: same scene path as preview (`CompositorViewService.exportMulti`). |
| 7 | Pre-fix Chat: bare “add a title” → orchestrator; explicit quoted/timed titles often escalated cloud; REMOVE could hit wrong annotation; size/move/retime not local. |
| 8 | Routing today (after fix): explicit text/range/adjust/remove → `direct_document`; bare “add a title” / “you decide” → `professional_orchestrator`; unrelated → cloud/UNKNOWN. |
| 9 | Pre-fix: follow-ups needed Chat session; no strong document-grounded title anaphora. |
| 10 | Timing must use **current programme** time (`programmeToRawSec`) after Trim/Speed — was missing for titles. |
| 11 | Placement is percent frame coordinates (same as other annotations). |
| 12 | Multiple text annotations allowed; need registry to avoid caption collision. |
| 13 | Distinction: titles tracked in `legacyEditor.titleOverlayIds`; captions = `legacyEditor.captions` + `annotationSource:"auto-caption"` / derived cues. Callouts untouched. |
| 14 | Autonomous wording = professional orchestrator / agent path (quality gated). |
| 15 | Historical garbage titles (“Our Cursor Cursor…”, “Limited Labeled Speech”, “I Think You Can See”) came from weak-evidence autonomous generation — gate kept; explicit user text never goes through that gate. |

---

## 3. Root causes fixed

1. Explicit title / timed show / size / position / retime / named remove were not reliably `direct_document`.
2. `executeAgentTool` for title add needed `JSON.stringify(args)` + `editsAllowed:true` (same class of bug as Speed).
3. Named targeting regex captured `"make the Export Settings"` instead of `"Export Settings"` → silently edited last overlay.
4. Ordinal first/last/ending used annotation **array order** (mutated by `setAnnotation`/`replacePillSpan`) instead of **timeline start**.
5. No `titleOverlayIds` registry → remove/adjust could confuse captions/other text.
6. Programme-time mapping for title spans after Trim/Speed was absent.
7. No document-grounded title follow-up promotion after session loss.

---

## 4. Exact files changed (TITLE only)

| File | Role |
|---|---|
| `electron/ai-edition/localEditorialChat/directTitle.ts` | **new** — add/adjust/remove, extractors, targeting, programme map, size ladder |
| `electron/ai-edition/localEditorialChat/types.ts` | `ADJUST_TITLE`, `titleText` / `titlePlacement` / `titleStyleOp` |
| `electron/ai-edition/localEditorialChat/parse.ts` | explicit TITLE / ADJUST_TITLE / REMOVE_TITLE routing |
| `electron/ai-edition/localEditorialChat/direct.ts` | wire title handlers |
| `electron/ai-edition/localEditorialChat/resolveFollowUp.ts` | title anaphora |
| `electron/ai-edition/localEditorialChat/index.ts` | `promoteTitleFollowUpFromDocument` |
| `electron/ai-edition/localEditorialChat/titleProductMaturityV1.test.ts` | unit |
| `electron/ai-edition/localEditorialChat/titleProductMaturityV1.live.runtime.test.ts` | live lifecycle + native + export |
| `electron/ai-edition/localEditorialChat/TITLE_FROZEN.md` | freeze marker |

Harness (not product code):  
`tmp/perception-benchmark/openscreen-title-maturity-v1/run-live-via-vitest.cjs`  
`tmp/perception-benchmark/openscreen-title-maturity-v1/run-electron-restart-qa.cjs`

---

## 5. Title document / authority model

- **SSOT:** `annotations[]` text regions created by `addGraphic` / `setAnnotation`
- **Registry:** `legacyEditor.titleOverlayIds: string[]` (most-recently-edited id moved to end)
- **User times:** **current programme seconds** → `programmeToRawSec` → stored `startMs`/`endMs`
- **Default duration when omitted:** `DEFAULT_TITLE_DURATION_SEC = 3` (beginning: `0…3`; end: `dur-3…dur`)
- **Size ladder (px):** `28, 36, 44, 52, 60, 72, 96`
- **Position step:** `Y_STEP = 4` (percent); center/top presets supported
- **EXPLICIT Chat text:** authoritative — never rewritten / never Director-gated
- **AUTONOMOUS:** still quality-gated via orchestrator; weak evidence may withhold titles

---

## 6. Real Chat A–Q trace

| Turn | Command | Result |
|---|---|---|
| A | add the title 'OpenScreen Tutorial' at the beginning | exact text; 0–3s programme |
| B | make it bigger | 44→52px same overlay |
| C | move it a little higher | y decreased |
| D | keep it on screen one second longer | endMs +1000 |
| E | change that to 'OpenScreen Editing Tutorial' | same id, new text |
| F | show 'Export Settings' from 5 to 8 seconds | second overlay exact range |
| G | make the Export Settings title bigger | named target only |
| H | add … 'Thanks for Watching' at end | third overlay |
| I | remove the ending title | removes Thanks (timeline-last), not captions |
| J–K | undo / redo (product store) | PASS |
| L–N | save → quit Electron → relaunch → reopen | PASS |
| O | make the OpenScreen Editing Tutorial title smaller | document-grounded after restart |
| P | native preview frames before/enter/hold/exit/after | PASS |
| Q | native export MP4 | PASS |

Electron restart assistant receipts:  
“I added…”, “I made the title larger…”, “I changed the title…”, post-restart “I made the title smaller…”.

---

## 7. Exact-text proof

User: `add the title 'OpenScreen Tutorial'`  
Committed annotation text: **OpenScreen Tutorial** (unchanged).  
No Director rewrite.

---

## 8. Programme-time proof after frozen Trim/Speed

Sequence: remove first 3s → speed 5–10s @ 2× → `show 'Export Settings' from 5 to 8 seconds`.

Stored raw span (`programme-time.json`):

```json
{ "startMs": 8000, "endMs": 13500, "text": "Export Settings" }
```

`startMs > 5000` → not blind raw 5–8s. Trim/Speed code untouched.

---

## 9. Multiple-title targeting proof

Priority implemented: exact phrase before “title” → time/range → ordinal first/second/ending (by `startMs`) → single → most-recent registry id → else last-by-timeline.  
Named miss → honest error (no silent random edit).

Unit: “make the Export Settings title bigger” grows Export only.  
“remove the ending title” removes Thanks after prior Export adjust.

---

## 10. Title-vs-caption regression

With captions enabled (`fontSize: 48`):

- add / enlarge / remove title → caption `enabled` + `fontSize` unchanged  
- title is a separate annotation id in `titleOverlayIds`  
- remove ending title does not disable captions  

`TITLE_VS_CAPTION = PASS`

---

## 11. Autonomous title-quality regression

Prompt: “Make this video professional and ready to publish. You decide.”  
`TOTAL_CLOUD_CALLS` contribution 0 in harness (empty API key / local orch path).  
Applied autonomous titles: **none** (no garbage strings).  
Regression strings not regenerated.  
Explicit titles remain ungated.

`AUTONOMOUS_TITLE_QUALITY = PASS`

---

## 12. Undo / redo

Product `pushHistory` / `undo` / `redo` (not test-only restore):

- undo text change → prior wording  
- undo size → prior fontSize  
- redo restores both  

`REAL_TITLE_UNDO = PASS` · `REAL_TITLE_REDO = PASS`

---

## 13. Electron restart

`run-electron-restart-qa.cjs`:

| Gate | Result |
|---|---|
| REAL_ELECTRON_QUIT | PASS |
| REAL_ELECTRON_RELAUNCH | PASS (new pid) |
| TITLE_STATE_PERSISTED | PASS (id/text/timing/fontSize/y) |
| POST_RESTART_EDITABILITY | PASS (named smaller without Chat history) |
| TITLE_RESTART_PERSISTENCE | PASS |

---

## 14. Native preview evidence

Frames: `frames/title-{before,enter,hold,exit,after}.ppm` (+ `.png`).  
Pixel delta hold vs after confirms title pixels present during hold and gone after end (`maxd` at title glyph).  
`NATIVE_TITLE_PREVIEW = PASS`

Note: sample `t=0.05` still overlaps default 0–3s title window — harness label “before” is weak; exit/after prove disappearance.

---

## 15. Native export evidence

`export/title-maturity-proof.mp4` — 854 frames, ~35.6s, ~11.8 MB.  
Scene included title text annotation.  
`NATIVE_TITLE_EXPORT = PASS`

---

## 16. Preview / export match

Same document fingerprint used for sampler + export; annotation text/timing present in both paths.  
`PREVIEW_EXPORT_TITLE_MATCH = PASS`  
`TITLE_DOC_ROUNDTRIP = PASS`

---

## 17. Receipt honesty metrics

| Metric | Value |
|---|---|
| FALSE_TITLE_APPLIED_CLAIMS | **0** |
| ROLLED_BACK_TITLE_CLAIMS | **0** |
| FINAL_TITLE_RECEIPT_HONESTY | PASS |

---

## 18. Product review (editor/user)

| # | Question | Answer |
|---|---|---|
| 1 | Exact user text? | Yes |
| 2 | Requested time? | Yes (programme) |
| 3 | Beginning/end natural? | Yes (3s default) |
| 4 | Looks like a title? | Yes (large graphic text; default upper placement) |
| 5 | Size natural? | Yes (bounded ladder) |
| 6 | Position natural? | Yes |
| 7 | Text correct without recreate? | Yes |
| 8 | Timing follow-ups? | Yes |
| 9 | Follow-ups same title? | Yes |
| 10 | Multi-title safe? | Yes (named + ordinal by timeline) |
| 11 | Captions unaffected? | Yes |
| 12 | Undo/redo predictable? | Yes |
| 13 | Restart preserves? | Yes |
| 14 | Preview matches Chat? | Yes |
| 15 | Export matches preview? | Yes (same document/scene) |
| 16 | Trust as title tool? | Yes for explicit Chat title editing |

---

## 19. Issue severity

| Issue | Severity |
|---|---|
| Named-target / ordinal array-order bugs (fixed) | — resolved |
| Pre-fix cloud escalate for explicit titles (fixed) | — resolved |
| Harness “before” sample overlaps title window | MINOR |
| Default title placement upper (not cinematic center) | MINOR |
| Autonomous path still may withhold titles on weak evidence (by design) | NONE |
| Remaining BLOCKER/MAJOR title issues | **NONE** |

---

## 20. Acceptance matrix

| Capability | Status |
|---|---|
| A Explicit title | PASS |
| B Timed text | PASS |
| C Default beginning/end (3s) | PASS |
| D Text modification | PASS |
| E Size | PASS |
| F Position | PASS |
| G Timing follow-ups | PASS |
| H Remove / undo restore | PASS |
| I Multiple titles | PASS |
| J Conversational follow-ups | PASS |
| K Document-grounded after restart | PASS |
| L Real undo/redo | PASS |
| M Electron quit/relaunch | PASS |
| N Native preview | PASS |
| O Native export | PASS |
| P Receipt honesty | PASS |
| Autonomous quality regression | PASS |
| Title vs caption | PASS |
| Local-first supported commands | PASS |

---

## 21. TOTAL_CLOUD_CALLS

**0** for all supported explicit title commands in the live maturity harness.

---

## 22. Remaining genuine limitations

1. Bare “add a title” (no text) still routes to professional orchestrator — intentional (needs wording authority).
2. Autonomous title generation remains evidence-gated and may apply **zero** titles on mushy speech — intentional.
3. Default title style/position come from existing `addGraphic` graphic presets (not a new title design system).
4. Callouts / transitions **not** started (HARD STOP).

---

## Freeze

`electron/ai-edition/localEditorialChat/TITLE_FROZEN.md`

**TITLE / TEXT OVERLAY = MATURE / FROZEN.**

Do not begin CALLOUT, TRANSITION, or another editing family in this milestone.
