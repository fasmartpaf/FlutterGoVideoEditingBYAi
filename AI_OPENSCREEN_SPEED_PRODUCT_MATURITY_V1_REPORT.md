# AI_OPENSCREEN_SPEED_PRODUCT_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789554424774.mp4` (~35.6s; visible UI motion)  
**Host:** Apple Silicon — Metal hardware compositor  
**Artifacts:** `tmp/perception-benchmark/openscreen-speed-maturity-v1/`  
**Export:** `export/speed-maturity-proof.mp4` (~32.58s; video+audio aligned)  
**ZOOM / TRIM_SHORTEN:** frozen / untouched  

**FINAL_SPEED_PRODUCT_STATUS = MATURE**

---

## Phase 1 — Audit (pre-fix)

| # | Question | Finding |
|---|---|---|
| 1 | Explicit speed commands | Ranges/multipliers often dropped; no DIRECT programme→raw `addSpeed` Chat path |
| 2 | Route to autonomous orch? | Semantic “faster” **and** many range phrases → `professional_orchestrator` |
| 3 | Explicit range preserved? | **No** until direct path |
| 4 | Multiplier preserved? | **No** (zoom scale parser could steal `2x`) |
| 5 | CURRENT PROGRAMME time? | Speed regions stored on raw ruler; Chat did not invert programme→raw |
| 6 | After trims? | Unmapped; risk of wrong source span |
| 7 | Modify existing speed? | Session anaphora partial; no document-grounded restart path |
| 8 | Reset to 1×? | Missing clean return-to-normal |
| 9 | Slowdown &lt;1×? | Schema + compositor `atempo` already support it |
| 10 | Receipt honesty? | Orch risk planned≠committed |
| 11 | Undo/redo? | Product stack available; needed wiring for speed commits |
| 12 | Native compositor? | Speed regions in scene; export duration sensitive to clip window |

---

## Fixes applied (SPEED only)

1. **`directSpeed.ts`** — programme duration with speed; programme→raw inverse; `applyDirectSpeedRange` / `applyDirectSpeedAdjust`; defaults 1.5× / 0.75×; ladder `[0.5…3]`
2. **`parse` / `normalize` / `types`** — explicit range SPEED → `direct_document`; multiplier extraction; bare “5 to 10” for speed; zoom `Nx` tightened so speed `2x` is not stolen
3. **`direct.ts` + `resolveFollowUp.ts`** — range SPEED + last_speed adjust; conversational anaphora
4. **`index.ts`** — **document-grounded** relative speed after session loss (“make that a little faster” on existing `legacyEditor.speedRegions`)
5. Live harness — export uses full source clips (product `ExportDialog` pattern); programme duration compared to export `videoDurationS`

**Not modified:** Zoom, Trim/Shorten, join-QC, Director, planner, TCS, captions, titles, callouts, transitions. Autonomous SPEED thresholds unchanged.

---

## Relative multiplier behavior (bounded)

| Cue | Behavior |
|---|---|
| Unspecified speed-up | **1.5×** (`DEFAULT_SPEED_UP`) |
| Unspecified slow-down | **0.75×** (`DEFAULT_SPEED_DOWN`) |
| Explicit `Nx` | Exact multiplier (cap 16×) |
| “a little faster” / “a little more” | Next step on ladder above current |
| “too fast” / “reduce” / slower | Next step below current |
| “return … to normal speed” | Remove speed region (1×) |

Ladder: `0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3` (then ×1.25 / ÷1.25 beyond ends).

---

## Metrics

| Metric | Result |
|---|---|
| DIRECT_SPEED_RANGE | **PASS** |
| DIRECT_SPEED_MULTIPLIER | **PASS** (exact 2.0×) |
| DIRECT_SPEED_FIRST | **PASS** (programme [0,4]) |
| DIRECT_SPEED_LAST | **PASS** (last 5s @ 1.5×) |
| SPEED_PROGRAMME_TIME_MAPPING | **PASS** |
| SPEED_AFTER_TRIM_MAPPING | **PASS** (−first 3s, then speed programme 5–10 → correct source) |
| RELATIVE_FASTER | **PASS** |
| RELATIVE_SLOWER | **PASS** |
| RETURN_TO_NORMAL | **PASS** |
| SLOW_DOWN_SUPPORT | **SUPPORTED** (0.75× native/export path) |
| SPEED_FOLLOWUP_REFERENCE | **PASS** |
| SPEED_EDIT_MODIFICATION | **PASS** (same region; edge ±0.5s / +1s) |
| TIMELINE_SPEED_HONESTY | **PASS** (5s @ 2× → programme −2.5s) |
| FINAL_SPEED_RECEIPT_HONESTY | **PASS** |
| NATIVE_SPEED_VISUAL | **PASS** (Metal frames before/enter/inside/exit/after) |
| SPEED_AUDIO_QUALITY | **ACCEPTABLE** (atempo; A/V durations ~32.54 / 32.58s) |
| REAL_SPEED_UNDO | **PASS** |
| REAL_SPEED_REDO | **PASS** |
| SPEED_RESTART_PERSISTENCE | **PASS** (real Electron quit → relaunch → reopen) |
| NATIVE_SPEED_EXPORT | **PASS** (programme ~32.63s; export ~32.58s) |
| PREVIEW_EXPORT_SPEED_MATCH | **PASS** |
| DIRECT_SPEED_AUTHORITY | **PASS** |
| AUTONOMOUS_SPEED_SAFETY | **PASS** (orch KEEP; 0 speed when no evidence) |
| AUTONOMOUS_REAL_SPEED_POSITIVE | **CORPUS_NOT_AVAILABLE** |
| TOTAL_CLOUD_CALLS | **0** |

---

## Electron restart proof

| Step | Result |
|---|---|
| Chat: “make 5 to 10 seconds 1.5x” | speed `[5,10]` @ 1.5×; programme ≈34.0s |
| Save + quit | exit 0, process dead |
| Relaunch + reopen same project | identical range + multiplier |
| “make that a little faster” | **2×** on same region (document-grounded; no chat history) |

Artifacts: `electron-restart-qa.json`, `pre-restart-document.json`, `post-restart-document.json`

---

## Product review (editor/user)

1. Explicit SPEED where requested? **Yes**  
2. Explicit multiplier match? **Yes**  
3. Current-programme time after speed? **Yes**  
4. Compose after frozen Trim? **Yes**  
5. Relative follow-ups same edit? **Yes**  
6. Motion visibly faster? **Yes** (native frame samples on motion span)  
7. Audio acceptable? **ACCEPTABLE** (synced; pitch-preserving atempo; not studio-perfect)  
8. Timeline duration sense? **Yes**  
9. Undo/redo predictable? **Yes**  
10. Restart preserve? **Yes**  
11. Export match preview? **Yes**  
12. Would a normal user trust SPEED? **Yes** for direct + relative control  

**Issues:** MINOR — compositor logs `atempo sample_fmts` negotiate warning (non-fatal); autonomous natural SPEED-positive fixture still absent.

**BLOCKER / MAJOR:** **NONE**

---

## Status

```
FINAL_SPEED_PRODUCT_STATUS = MATURE
```

**FREEZE SPEED.**

Do not begin captions, titles, callouts, transitions, or another editing family — wait for the next capability milestone.
