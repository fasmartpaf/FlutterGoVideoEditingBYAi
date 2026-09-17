# AI_OPENSCREEN_ZOOM_FINAL_PRODUCT_CLOSURE_V2_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789562664333.mp4`  
**Host:** Apple M5 — Metal Supported  
**Artifacts:** `tmp/perception-benchmark/openscreen-zoom-final-product-closure-v2/`

**FINAL_ZOOM_PRODUCT_STATUS = FUNCTIONAL_WITH_GAPS**

---

## What this closure closed

Prior V1 already fixed direct timed zoom execution. V2 closed remaining ZOOM gaps only:

| Gap | Result |
|---|---|
| 1 Direct focus intelligence | **PASS** — click/dwell before center |
| 2 Native visual proof | **PASS** — Metal `live_readFrame` frames |
| 3 Zoom-out semantics | **PASS** return-to-1×; wider-than-base **honest limit** |
| 4 Real undo/redo | **PASS** — product `undo()` / `redo()` stacks |
| 5 Persistence | **PASS_FILE_REOPEN** — `.openscreen` write/reparse (not full Electron UI relaunch) |
| 6 Native export | **PASS** — `zoom-final-product-proof.mp4` |
| 7 Direct vs autonomous | **PASS** |

---

## GAP 1 — Direct focus (WHERE only)

New module: `electron/ai-edition/localEditorialChat/directZoomFocus.ts`

Priority: **user → click → dwell → focal cluster → center**

Real 5s–10s trace on this recording:

```json
{
  "selectedFocus": { "cx": 0.661, "cy": 0.062 },
  "focusSource": "click",
  "confidence": 0.92,
  "fallbackUsed": false,
  "candidates": ["click@7.455s", "dwell@9.44s", "center"]
}
```

Receipt: `I added a zoom from 5.0s to 10.0s at 1.80× (focus: click (0.66, 0.06)).`

| Case | Result |
|---|---|
| A strong click in range | **PASS** — selected click |
| B dwell without click | **PASS** (unit) |
| C no useful evidence | **PASS** — center |
| D explicit `userFocus` override | **PASS** |

Focal evidence never rejects the command.

---

## GAP 2 — Native visual proof (Metal)

Native compositor succeeded with `all` permissions (prior V1 sandbox lacked Metal device).

Frames (`frames/*.jpg`, provider `native_compositor` / `live_readFrame`):

| Label | t | Observation |
|---|---|---|
| base_before | 4.5s | Full browser page (BASE) |
| enter | 5.0s | Enter begins |
| enter_plus | 6.0s | Magnified text — ENTER in progress |
| hold | 7.5s | Magnified HOLD |
| hold_stronger | 7.5s | Same target, stronger scale — focus retained |
| hold_late | 9.5s | Still zoomed (chrome/tab region — click was near top) |
| exit | 10.0s | Exit |
| base_after | 10.5s | Full frame again (BASE) |

No black/invalid frames. Enter→hold→exit lifecycle visible.

**Product note (MINOR):** click at `cy≈0.06` is browser chrome/tabs, so HOLD frames the top strip more than body text. Correct per cursor evidence; may look “awkward” as an editorial choice.

---

## GAP 3 — Zoom-out semantics

| Command | Behavior |
|---|---|
| `zoom out after 10 seconds` | Return-to-normal / ensure exit at 10s → **works** |
| `return to normal after 10 seconds` | Same 1× return → **works** |
| `make it wider from 10 to 15 seconds` | Honest refusal: *“Wider-than-base zoom-out is not supported…”* |

No fabricated wider-than-1×.

---

## GAP 4 — Real undo / redo

Exercised product modules `src/lib/ai-edition/store/undo.ts` + `undoStack.ts` (same path as Ctrl+Z / Redo):

1. add 5–10s zoom → depth 3  
2. stronger → depth 4, **same focus**  
3. Undo → depth 3  
4. Undo → zoom gone  
5. Redo → zoom depth 3  
6. Redo → stronger depth 4  

**REAL_UNDO = PASS**, **REAL_REDO = PASS** (not session-restore-only).

---

## GAP 5 — Persistence

Wrote `~/Library/Application Support/openscreen/projects/proj_zoom_final_product_closure_v2.openscreen` and re-parsed with `documentSchema`.

- preview fingerprint = reopened fingerprint  
- zoom survived  

**Not** a full Electron quit/relaunch UI session → gate marked `PASS_FILE_REOPEN` (blocks MATURE).

---

## GAP 6 — Native export

- File: `tmp/.../zoom-final-product-proof.mp4` (~2.5 MB)  
- Scene from same reopened document  
- Fingerprints: preview = saved/reopened = export document  

**NATIVE_EXPORT = PASS**, **PREVIEW_EXPORT_MATCH = PASS**

---

## GAP 7 — Regression

| Prompt | Result |
|---|---|
| `zoom in from 5s to 10s` | direct EXECUTE |
| `add zooms wherever useful` | orch PROPOSE |
| `Do you think this section needs a zoom?` | no mutate |
| `Don't zoom from 5s to 10s.` | CONSTRAINT / PRESERVE |

---

## Product review (editor/user)

| # | Question | Verdict |
|---|---|---|
| 1 | Focus on what viewer should see? | **PARTIAL** — click-top chrome; useful but not body content |
| 2 | Enter smooth? | Yes (native frames) |
| 3 | Hold stable? | Yes |
| 4 | Exit smooth? | Yes — full frame by 10.5s |
| 5 | Stronger keeps focal? | Yes |
| 6 | Return to normal natural? | Yes (1×) |
| 7 | Timeline honest? | Yes |
| 8 | Export matches? | Yes (doc fingerprint + export produced) |
| 9 | Undo/redo predictable? | Yes (product stack) |
| 10 | Survive restart? | File reopen yes; full app relaunch **not** proven |

### Issues

| Severity | Note |
|---|---|
| **MINOR** | Top-edge click focus can crop toward chrome |
| **MINOR** | Persistence proven via `.openscreen` file, not full Electron relaunch |
| **NONE** | Wider-than-1× correctly refused |

---

## Files changed (V2 only)

- `electron/ai-edition/localEditorialChat/directZoomFocus.ts` (+ test)
- `electron/ai-edition/localEditorialChat/direct.ts` — focus select + wider honesty
- `electron/ai-edition/localEditorialChat/parse.ts` — `zoomUserFocus` coords
- `electron/ai-edition/localEditorialChat/types.ts` — focus source slots
- `electron/ai-edition/localEditorialChat/index.ts` — pass cursor / focus trace
- `electron/ai-edition/deep-agent/service.ts` — load cursor into early direct path
- `electron/ai-edition/localEditorialChat/zoomFinalProductClosureV2.live.runtime.test.ts`

---

## Acceptance matrix

| Gate | Result |
|---|---|
| DIRECT_ZOOM_EXECUTION | **PASS** |
| DIRECT_FOCUS_CLICK | **PASS** |
| DIRECT_FOCUS_DWELL | **PASS** |
| CENTER_FALLBACK | **PASS** |
| EXPLICIT_TARGET_OVERRIDE | **PASS** |
| ZOOM_ENTER_VISUAL | **PASS** |
| ZOOM_HOLD_VISUAL | **PASS** |
| ZOOM_EXIT_VISUAL | **PASS** |
| ZOOM_STRONGER_VISUAL | **PASS** |
| RETURN_TO_NORMAL | **PASS** |
| WIDER_THAN_BASE_SEMANTICS | **PASS_HONEST_LIMIT** |
| REAL_UNDO | **PASS** |
| REAL_REDO | **PASS** |
| APP_RESTART_PERSISTENCE | **PASS_FILE_REOPEN** |
| NATIVE_PREVIEW | **PASS** |
| NATIVE_EXPORT | **PASS** |
| PREVIEW_EXPORT_MATCH | **PASS** |
| TIMELINE_HONESTY | **PASS** |
| LOCAL_FIRST | **PASS** |
| AUTONOMOUS_SAFETY_REGRESSION | **PASS** |
| TOTAL_CLOUD_CALLS | **0** |

**FINAL_ZOOM_PRODUCT_STATUS = FUNCTIONAL_WITH_GAPS**

Not MATURE solely because full Electron quit/reopen UI persistence was not exercised (file reopen only). Native Metal preview + export passed on this host.

---

## HARD STOP

Zoom-only closure complete. No trim / speed / captions / titles / callouts / transitions / Director / planner work.
