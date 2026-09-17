# AI_OPENSCREEN_ZOOM_FINAL_RESTART_QA_V3_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789562664333.mp4`  
**Host:** Apple M5 — Metal Supported  
**Artifacts:** `tmp/perception-benchmark/openscreen-zoom-final-restart-qa-v3/`  
**Export:** `zoom-restart-proof.mp4`

**FINAL_ZOOM_PRODUCT_STATUS = MATURE**

---

## Goal answered

Yes. A real Zoom edit survives a complete OpenScreen Electron quit → relaunch → reopen and remains identical through document, timeline, native preview, post-restart editability, undo, and native export.

---

## Method (product QA — no Zoom intelligence changes)

1. Launch real Electron (Vite renderer) with isolated product `userData`
2. Create project + recording asset; send **`zoom in from 5s to 10s`** via **real Chat UI composer**
3. Save; record zoom / focus / path
4. **Completely quit** Electron; confirm process exited
5. **Relaunch** Electron on the **same** `userData`
6. Reopen via `document.listProjects` / `document.get` and `loadProjectFileFromPath` (product paths — no manual document inject)
7. Post-restart: stronger edit + undo; native frames + export from reopened document

---

## Pre-restart state (after Chat UI)

| Field | Value |
|---|---|
| Project | `proj_55ac6861-242d-494b-86f5-d50bf2c9f739` |
| Path | `…/userdata/projects/proj_55ac6861-….openscreen` |
| Range | **5.0s–10.0s** (`startMs=5000`, `endMs=10000`) |
| Depth / scale | **3 / 1.80×** |
| Focus | **cx≈0.661, cy≈0.062** (click) |
| Chat path | **REAL_CHAT_UI_composer** |
| Session A PID | 86704 |

---

## Real restart

| Step | Result |
|---|---|
| Save | PASS |
| Quit Electron | PASS — `exitCode=0`, process dead |
| Relaunch | PASS — new PID 92377 |
| Same project reopened | PASS — listed + `document.get` + `loadProjectFileFromPath` |
| Manual doc reconstruct | **Not used** |
| Inject pre-restart doc into runtime | **Not used** |

Post-restart zoom identical:

- range 5–10s  
- depth 3 / 1.80×  
- focus unchanged  
- same zoom id `zoom_c06280ba-…`  
- document fingerprint pre = post =  
  `c99d7eada147946d5efd90bf61869adac74509f7cc5d8e19eb7df3d3bf3b5c46`

---

## Post-restart editability

| Check | Result |
|---|---|
| `"make that zoom stronger"` | Resolved against existing zoom (receipt: stronger). Chat **message history** is process-local; reference still worked via **document-grounded** zoom. |
| Explicit stronger fallback | Also exercised; ended at depth **4 / 2.25×**, **same focus** |
| `"undo that"` | PASS — restored prior local revision (depth 3 again) |

`CHAT_REFERENCE_AFTER_RESTART` = **RESOLVED_DOCUMENT_GROUNDED**  
(session transcript not persisted across quit; not a Zoom maturity blocker per spec)

---

## Native preview after restart (Metal)

Frames from Electron-reopened document (`native_compositor` / `live_readFrame`):

| t | Label | Observation |
|---|---|---|
| 4.5s | BASE | Full programme frame |
| 5.0s | ENTER | Enter boundary |
| 7.5s | HOLD | Magnified; top-chrome-biased focus (click cy≈0.06) |
| 10.0s | EXIT | Exit boundary |
| 10.5s | BASE | Full desktop / App Store Connect — zoom gone |

No black/invalid frames. BASE → ENTER → HOLD → EXIT → BASE verified.

**TOP_EDGE_ZOOM_REVIEW = ACCEPTABLE** (known V2 minor: click near browser chrome). Not fixed in this QA.

---

## Native export after restart

- File: `zoom-restart-proof.mp4` (~4.3 MB, 12s @ 24fps native `exportMulti`)
- Export stills at 4.5 / 5.0 / 7.5 / 10.0 / 10.5 written
- Same document fingerprint as preview/reopen
- **PREVIEW_EXPORT_MATCH = PASS**

---

## Acceptance matrix

| Gate | Result |
|---|---|
| REAL_ELECTRON_QUIT | **PASS** |
| REAL_ELECTRON_RELAUNCH | **PASS** |
| SAME_PROJECT_REOPENED | **PASS** |
| ZOOM_RANGE_PERSISTED | **PASS** |
| ZOOM_SCALE_PERSISTED | **PASS** |
| ZOOM_FOCUS_PERSISTED | **PASS** |
| TIMELINE_AFTER_RESTART | **PASS** |
| NATIVE_PREVIEW_AFTER_RESTART | **PASS** |
| CHAT_REFERENCE_AFTER_RESTART | **RESOLVED_DOCUMENT_GROUNDED** (history not persisted) |
| POST_RESTART_EDITABILITY | **PASS** |
| REAL_UNDO_AFTER_RESTART | **PASS** |
| NATIVE_EXPORT_AFTER_RESTART | **PASS** |
| PREVIEW_EXPORT_MATCH | **PASS** |
| TOP_EDGE_ZOOM_REVIEW | **ACCEPTABLE** (known minor) |
| TOTAL_CLOUD_CALLS | **0** |
| CODE_CHANGES | **QA harness only** — no Zoom intelligence / focus / geometry / routing changes |

---

## Issues

| Severity | Note |
|---|---|
| **MINOR** | Top-edge click focus can emphasize browser chrome (carried from V2; not changed) |
| **NONE** | Persistence after full Electron quit/relaunch |

---

## MATURE rule check

- real Electron quit/relaunch — **yes**
- same project reopens — **yes**
- Zoom survives exactly — **yes**
- timeline honest — **yes**
- native preview — **yes**
- native export matches — **yes**
- post-restart editing usable — **yes**
- no blocker/major Zoom failure — **yes**

**FINAL_ZOOM_PRODUCT_STATUS = MATURE**

---

## HARD STOP

Zoom QA complete. **FREEZE ZOOM.**

Next capability (when you choose): **TRIM / SHORTEN** maturity — do not start until requested.
