# AI_OPENSCREEN_CALLOUT_PRODUCT_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789554424774.mp4` (~35.6s) + cursor sidecar when present  
**Host:** Apple Silicon — native compositor  
**Artifacts:** `tmp/perception-benchmark/openscreen-callout-maturity-v1/`  
**Export:** `export/callout-maturity-proof.mp4`  
**Frozen families untouched:** ZOOM · TRIM · SPEED · CAPTIONS · TITLE  

**FINAL_CALLOUT_PRODUCT_STATUS = MATURE**

**CALLOUT is FROZEN.** Stop. Do not begin TRANSITIONS.

---

## 1. FINAL_CALLOUT_PRODUCT_STATUS

`MATURE` — direct explicit callouts, click/dwell WHERE grounding, explicit labels without hallucination, programme-time mapping after Trim/Speed, follow-up modify/remove, multi-callout targeting, autonomous restraint, coexistence with captions/titles, real undo/redo, Electron quit→relaunch persistence + post-restart edit, native preview + export, receipt honesty, `TOTAL_CLOUD_CALLS = 0` for supported direct commands.

---

## 2. Phase-1 audit findings

| # | Finding |
|---|---|
| 1 | “Callout” = `annotations[]` **`type:"figure"`** (arrow), usually via `addGraphic(kind:"figure")` |
| 2 | Primitives: figure/arrow yes; text/title/badge/cta yes; **no** spotlight/box highlight kind |
| 3 | Stored on `AxcutDocument.annotations` (+ optional `figureData`) |
| 4 | Path: annotations → `buildSceneDescription` → compositor `draw_annotations` |
| 5 | Native renders arrows (mode 9); **figure text was previously not painted** |
| 6 | Export uses same scene JSON as preview |
| 7 | Chat: `CALLOUT`/`REMOVE_CALLOUT` declared but **never parsed**; no `directCallout` |
| 8 | Autonomous: `generateCalloutOpportunities` + orch `addGraphic figure` (evidence-gated) |
| 9–10 | WHERE from editorial focal / cursor click+dwell (planner); Chat had no path |
| 11–12 | Label from nearby speech when useful; else NOT_READY (no invent) |
| 13 | Planner one callout per pass; no Chat multi-target |
| 14 | Titles had `programmeToRawSec`; callouts did not |
| 15–16 | `setAnnotation` / `removeModifier` existed; no Chat adjust/remove |
| 17–19 | Undo/persist/preview-export work for annotations when applied like titles |
| 20 | Failures: dead intents, no direct executor, invisible labels, no programme Chat map, no registry |

---

## 3. Exact root causes fixed

1. Dead `CALLOUT` / `REMOVE_CALLOUT` (and new `ADJUST_CALLOUT`) never routed to `direct_document`
2. No `directCallout` module / no wiring in `direct.ts`
3. No programme-time mapping for Chat callout spans
4. No `calloutOverlayIds` registry → unsafe targeting vs titles/captions
5. Figure `content` label invisible in preview/export (scene only emitted arrow)
6. Empty-string label matching treated every figure as a text hit (`""` ⊆ needle)
7. No document-grounded callout follow-ups after session loss

---

## 4. Exact files changed (CALLOUT only)

| File | Role |
|---|---|
| `electron/ai-edition/localEditorialChat/directCallout.ts` | **new** — add/adjust/remove, WHERE via `selectDirectZoomFocus` (read-only), programme map |
| `electron/ai-edition/localEditorialChat/types.ts` | `ADJUST_CALLOUT`, `calloutText`, `calloutStyleOp`, `last_callout` |
| `electron/ai-edition/localEditorialChat/parse.ts` | CALLOUT / ADJUST / REMOVE routing + autonomous “wherever” → orch |
| `electron/ai-edition/localEditorialChat/direct.ts` | wire handlers |
| `electron/ai-edition/localEditorialChat/resolveFollowUp.ts` | callout anaphora |
| `electron/ai-edition/localEditorialChat/index.ts` | `promoteCalloutFollowUpFromDocument` |
| `src/native/sceneDescription.ts` | figure + companion label text for preview/export |
| `electron/ai-edition/localEditorialChat/calloutProductMaturityV1.test.ts` | unit |
| `electron/ai-edition/localEditorialChat/calloutProductMaturityV1.live.runtime.test.ts` | live |
| `electron/ai-edition/localEditorialChat/CALLOUT_FROZEN.md` | freeze marker |

Harness: `tmp/perception-benchmark/openscreen-callout-maturity-v1/run-*.cjs`

**Not modified:** Zoom focal policy, Trim, Speed, Captions, Title modules (frozen).

---

## 5. Direct command trace

| Command | Result |
|---|---|
| Add a label saying 'Export' from 8 to 11 seconds | EXECUTE · figure · exact text · programme 8–11 |
| change the text to 'Export Video' | same overlay |
| make that callout smaller / move higher / keep longer | same overlay |
| Add a callout from 14 to 17 seconds | second overlay |
| make the first callout smaller | ordinal by timeline |
| remove that callout | removes target only |
| Add callouts wherever they help | `professional_orchestrator` |

---

## 6. Target / focal grounding trace

Direct WHERE reuses **`selectDirectZoomFocus`** (READ-only; Zoom frozen):

user → click in range → dwell → focal cluster → safe offset fallback  

Live injected clicks → `CLICK_GROUNDING = PASS` (x > 50).  
Electron Chat used real sidecar → receipt: “over the click in that range”.

---

## 7. Semantic / text grounding trace

- Explicit user text: authoritative, never rewritten  
- Autonomous: existing `generateCalloutOpportunities` speech usefulness filters unchanged  
- Weak/no speech → `NOT_READY` / `GROUNDED_NOT_USEFUL`  
- Scene now paints stored figure labels as companion text plates (no invented names)

---

## 8. Timing / programme mapping proof

After `remove the first 3 seconds` + `make 5 to 10 seconds 2x`:

`Add a callout from 8 to 11 seconds` → stored `startMs > 5000` (`programme-time.json`).

Default duration when omitted: **`DEFAULT_CALLOUT_DURATION_SEC = 3`**.

---

## 9. Follow-up modification trace

Size / position / timing / text / remove all mutate the **same** `calloutOverlayIds` entry (most-recent bumped on adjust). Document-grounded named follow-up works after session clear.

---

## 10. Multiple-callout targeting proof

Unit + live: two callouts; “Export callout” / “first callout” resolve independently. Empty labels never match named phrases.

---

## 11. Autonomous APPLY / KEEP proof

| Case | Result |
|---|---|
| No focal (`generateCalloutOpportunities({focal:null})`) | all `NOT_READY` → **KEEP** |
| Existing planner tests (click/dwell + useful label) | READY path unchanged |
| “Make this video professional… You decide.” | orch path exercised; no false direct claim |

Direct ≠ autonomous: explicit timed callout always executes when range valid.

---

## 12. Coexistence (Zoom / Captions / Title)

With captions enabled + a title present, callout size adjust did **not** change caption settings or title count.  
`COEXISTENCE = PASS`  
Zoom policy untouched (callout only reads focus helper).

---

## 13. Real undo / redo proof

Product `pushHistory` / `undo` / `redo`:

add → smaller → undo ×2 → empty → redo ×2 → restored size  

`REAL_CALLOUT_UNDO = PASS` · `REAL_CALLOUT_REDO = PASS`

---

## 14. Electron quit / relaunch proof

| Gate | Result |
|---|---|
| REAL_ELECTRON_QUIT | PASS |
| REAL_ELECTRON_RELAUNCH | PASS |
| CALLOUT_STATE_PERSISTED | PASS (id/text/timing/size/xy) |
| POST_RESTART_EDITABILITY | PASS (“make the Export Video callout bigger”) |
| CALLOUT_RESTART_PERSISTENCE | PASS |

Receipts: add → change text → smaller → post-restart larger.

---

## 15. Native preview evidence

Frames: `frames/callout-{before,enter,hold,exit,after}.ppm` at programme 7.5 / 8.2 / 9.5 / 10.9 / 12.0s.  
`NATIVE_CALLOUT_PREVIEW = PASS`

---

## 16. Native export evidence

`export/callout-maturity-proof.mp4` produced via `CompositorViewService.exportMulti` + same `buildSceneDescription`.  
`NATIVE_CALLOUT_EXPORT = PASS`

---

## 17. Preview / export / document fingerprint

Same document fingerprint round-trip; scene includes figure (+ label companion when text set).  
`PREVIEW_EXPORT_CALLOUT_MATCH = PASS` · `CALLOUT_DOC_ROUNDTRIP = PASS`

---

## 18. Receipt honesty metrics

| Metric | Value |
|---|---|
| FALSE_CALLOUT_APPLIED_CLAIMS | **0** |
| ROLLED_BACK_CALLOUT_CLAIMS | **0** |
| FINAL_CALLOUT_RECEIPT_HONESTY | PASS |

---

## 19. Cloud-call count

**TOTAL_CLOUD_CALLS = 0** for supported direct callout commands in the live harness.

---

## 20. Regression — frozen families

| Family | Check |
|---|---|
| TITLE | `titleProductMaturityV1.test.ts` green after callout work |
| Planner callout gates | `visualEditingSkillsV1.test.ts` green (no loosened autonomous quality) |
| ZOOM / TRIM / SPEED / CAPTIONS | not edited |

---

## 21. Remaining genuine limitations

1. No dedicated spotlight / highlight-box primitive (arrow + optional label only).  
2. Bare “add callouts wherever they help” stays orchestrator (intentional).  
3. Autonomous APPLY still requires click/dwell + useful speech label (by design).  
4. Companion label placement is beside the arrow (percent offset); may sit near busy UI on some recordings — MINOR.  
5. Transitions / other families not started.

---

## 22. Issue severity

| Issue | Severity |
|---|---|
| Dead Chat callout path / invisible labels / no programme map (fixed) | — resolved |
| Empty-string name matching (fixed) | — resolved |
| Label plate may land near bottom on some real clicks | MINOR |
| No spotlight box | MINOR (out of existing primitives) |
| BLOCKER / MAJOR remaining | **NONE** |

---

## Authority model (summary)

- **Document:** `annotations[]` figures + `legacyEditor.calloutOverlayIds`  
- **WHERE:** `selectDirectZoomFocus` evidence (Zoom frozen; read-only reuse)  
- **WHAT:** explicit user text or autonomous speech-gated label only  
- **When:** current programme seconds → `programmeToRawSec`  
- **Size ladder (box %):** `8, 10, 12, 14, 16, 20, 24`  
- **Default duration:** 3s  

---

## Freeze

`electron/ai-edition/localEditorialChat/CALLOUT_FROZEN.md`

**CALLOUT = MATURE / FROZEN.**

HARD STOP — wait for the next capability. Do not begin TRANSITIONS.
