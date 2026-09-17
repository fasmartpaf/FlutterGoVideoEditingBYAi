# AI_OPENSCREEN_ZOOM_CONTROL_MATURITY_V1_REPORT

**Date:** 2026-09-16  
**Recording:** `recording-1789562664333.mp4`  
**Failure phrase:** `from a second 5s to 10s add a zoom in ok?`  
**Status:** `FUNCTIONAL_WITH_GAPS`

---

## 1. Exact original root cause

Runtime proof (pre-fix parse):

| Input | Normalized | Intent | Range | Execution |
|---|---|---|---|---|
| `from a second 5s to 10s add a zoom in ok?` | `from a sec 5 sec to 10 sec add a zoom in ok` | `ADJUST_ZOOM` | `null` | `professional_orchestrator` |

Funnel that produced the wrong product behavior:

1. **raw message** → normalize (`seconds?`→`sec`, `5s`→`5 sec`)
2. **speech act** → `COMMAND` (trailing `ok?` is not a real question)
3. **parsed intent** → `ADJUST_ZOOM` because `zoom in` matched the adjust regex **before** add-zoom
4. **temporal range** → **never extracted** (`range` always `null`)
5. **zoom direction** → lost
6. **authorization** → implicit Director propose (“where useful”)
7. **local router** → `needsProfessionalOrchestrator=true`
8. **orchestrator message** rewritten to: *“Improve visual focus with grounded zoom… where useful…”* — **drops 5s–10s**
9. **autonomous Director** → no strong focal evidence → **ZOOM KEEP**
10. **user-facing copy** → *“I left the framing unchanged because I didn't find a zoom or crop…”*

**Exact conversion point:** `parse.ts` classified explicit timed `zoom in` as `ADJUST_ZOOM` / `ADD_ZOOM` with `executionKind=professional_orchestrator` and `range=null`, so the professional orchestrator usefulness gate overrode an already-authorized user command.

---

## 2. Files changed

| File | Change |
|---|---|
| `electron/ai-edition/localEditorialChat/normalize.ts` | `extractTimeRangeSlot`; duration slot no longer steals `from→to` zoom ranges; preserve `1.5x` decimals; `don't zoom` constraint |
| `electron/ai-edition/localEditorialChat/types.ts` | `zoomDirection`, `zoomDepth`, `zoomScale`, `zoomFocusSource`, `zoomAuthorization` |
| `electron/ai-edition/localEditorialChat/parse.ts` | Compositional ZOOM_IN / OUT / RESET / MODIFY / AUTONOMOUS routing; explicit range → `direct_document` + `EXECUTE` |
| `electron/ai-edition/localEditorialChat/direct.ts` | Direct `addZoom` / `setZoom` / zoom-out-to-1× / intensity / collision replace |
| `electron/ai-edition/localEditorialChat/resolveFollowUp.ts` | Anaphoric zoom follow-ups; never re-escalate already-direct zooms |
| `electron/ai-edition/localEditorialChat/index.ts` | Export `extractTimeRangeSlot` |
| `electron/ai-edition/localEditorialChat/zoomControlMaturityV1.test.ts` | Unit + paraphrase matrix |
| `electron/ai-edition/localEditorialChat/zoomControlMaturityV1.live.runtime.test.ts` | Real recording Chat E2E |

Artifacts: `tmp/perception-benchmark/openscreen-zoom-control-maturity-v1/`

---

## 3. Direct vs autonomous zoom architecture

```
                    ┌─────────────────────────┐
  Chat text ───────▶│ Local compositional     │
                    │ parse (0 cloud)         │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   DIRECT ZOOM            AUTONOMOUS ZOOM        NON-EDIT
   explicit range         "where useful"         question /
   or "that zoom"         "improve focus"        "don't zoom"
   intensity/out/reset    no time range
          │                     │
          ▼                     ▼
   direct_document        professional_orchestrator
   zoomAuthorization=     zoomAuthorization=
     EXECUTE                PROPOSE
          │                     │
          ▼                     ▼
   addZoom / setZoom      Director + focal gate
   center/cursor fallback KEEP/APPLY by evidence
   NO usefulness KEEP
```

- **DIRECT** does not ask the Director whether zoom is justified.
- **AUTONOMOUS** keeps existing focal/editorial safety unchanged.

---

## 4. Intent / paraphrase matrix

Concepts (not phrase lists): `ZOOM_IN`, `ZOOM_OUT`, `ZOOM_RESET`, `REMOVE_ZOOM`, `MODIFY_ZOOM`, `AUTONOMOUS_ZOOM`.

| Class | Examples | Result |
|---|---|---|
| Explicit range in | failure phrase, `from 5s to 10s`, `between five and ten…` | `ADD_ZOOM` + range + `EXECUTE` + direct |
| Zoom out / reset | `zoom out from 10s to 15s`, `return to full screen at 15s` | `ADJUST_ZOOM` + `out`/`reset` + direct |
| Intensity | `make that zoom stronger`, `1.8x` | `ADJUST_ZOOM` on last zoom |
| Remove | `undo that zoom` | `REMOVE_ZOOM` direct |
| Autonomous | `Add zooms wherever useful` | `ADD_ZOOM` + `PROPOSE` + orch |
| Guards | `Why did you zoom…?`, `Don't zoom this section` | no ADD execute |

Measured (unit matrix):

- **ZOOM_INTENT_RECALL** ≥ 0.85  
- **FALSE_ZOOM_INTENT_RATE** = 0 on non-edit guards  
- **DIRECT_ZOOM_EXECUTION_RATE** ≥ 0.80 for timed in/out paraphrases  

---

## 5. Exact real Chat E2E conversation

On `recording-1789562664333` (OpenAI disabled):

| Turn | User | Intent / exec | Receipt (abbrev) |
|---|---|---|---|
| A | `from a second 5s to 10s add a zoom in ok?` | `ADD_ZOOM` / direct | `I added a zoom from 5.0s to 10.0s at 1.80× (focus: center).` |
| B | `make that zoom stronger` | `ADJUST_ZOOM` / direct | `I made that zoom stronger (2.20×).` |
| C | `zoom out after 10 seconds` | `ADJUST_ZOOM` out / direct | `I zoomed out / returned to normal after 10.0s (base 1× framing).` |
| D | `Undo that.` | session restore | Restored pre–zoom-out (idempotent; zoom still 5–10 @ 2.20×) |
| E | `Undo that.` | session restore | Restored pre–stronger → depth 3 |

No generic KEEP / “couldn’t find a grounded zoom” on turn A.

---

## 6. Document mutations per turn

| Turn | Before zooms | After zooms | Fingerprint changed |
|---|---|---|---|
| A | `[]` | `[{5–10s, depth 3, focus center}]` | yes |
| B | depth 3 | depth 4 (2.20×) | yes |
| C | depth 4 end 10 | same span (already exits at 10s) | no (idempotent return-to-1×) |
| D | depth 4 | depth 4 | no (restore to identical) |
| E | depth 4 | depth 3 | yes |

---

## 7. Timeline evidence

Turn A after state:

- `zoomRanges[0].startMs = 5000`, `endMs = 10000`
- `depth = 3` → rendered **1.80×**
- `focus = {cx:0.5, cy:0.5}`, `source = manual`
- Anchored to `clip_1`

Chat claim ↔ document zoom ↔ timeline zoom id present. **TIMELINE_HONESTY = PASS.**

---

## 8. Native before/enter/hold/exit frames

**NATIVE_PREVIEW_PROOF = SKIP_NO_METAL**

Environment error: `aucun MTLDevice disponible (Metal indisponible ou VM sans GPU)`.

Compositor addon probe ran; live `sampleFrame` / Metal device unavailable in this agent environment. Document/timeline proof is complete; pixel proof requires a Metal-capable host.

---

## 9. Preview / export comparison

**EXPORT_ZOOM_PROOF = SKIP_NO_METAL** (same Metal limitation).

When native is available, the live test writes:

- frames at 4.5 / 5.0 / 7.5 / 10.0 / 10.5  
- `zoom-explicit-5s-10s-export.mp4`  
- fingerprint equality: preview doc = export doc  

---

## 10. Undo / redo / persistence

| Check | Result |
|---|---|
| Undo after intensity | Restores prior depth (turn E → depth 3) |
| Session revisions | Cap 12; zoom family recorded |
| JSON persistence | `zoomRanges` survive serialize/parse |
| Redo | Via session restore stack (undo of undo not a separate redo API — restore pops) |

**UNDO_REDO = PASS**, **PERSISTENCE = PASS** (document-level). Full app save/restart UI reopen not exercised in this headless run.

---

## 11. TOTAL_CLOUD_CALLS

**0** — all supported direct zoom turns local-first.

---

## 12. Autonomous zoom regression

| Prompt | Result |
|---|---|
| `Add zooms wherever useful.` | `ADD_ZOOM` + `professional_orchestrator` + `zoomAuthorization=propose` |
| Multi-family `zooming or unzooming some important parts` | Still `MULTI_FAMILY_VISUAL` orch (not forced direct) |

**AUTONOMOUS_ZOOM_SAFETY_REGRESSION = PASS**

---

## 13. Remaining genuine ZOOM limitations

1. **No wider-than-1× primitive.** Zoom-out / reset means *end coverage / return to base 1×*, not a true pull-back beyond identity scale. Reported honestly in receipts.
2. **Focus fallback is center** for time-only DIRECT zooms. Cursor/focal wiring for direct path is not yet preferred over center when telemetry exists (slot records `center`).
3. **Native/export visual proof skipped here** (no Metal GPU in this environment).
4. **Idempotent zoom-out** after a zoom that already ends at the requested time does not change the document (receipt still explains return-to-1×).
5. **Relative “make it 1.5x” without session zoom** routes as `ADJUST_ZOOM` and needs an existing zoom to apply.
6. **App-level redo button / project file reopen** not covered beyond document + session revision stack.

---

## Acceptance matrix

| Gate | Result |
|---|---|
| DIRECT_ZOOM_IN | **PASS** |
| DIRECT_ZOOM_OUT | **PASS** |
| EXPLICIT_TIME_RANGE | **PASS** |
| FOCUS_FALLBACK | **PASS** |
| ZOOM_INTENSITY | **PASS** |
| FOLLOWUP_REFERENCE | **PASS** |
| MODIFY_EXISTING_ZOOM | **PASS** |
| REMOVE_ZOOM | **PASS** |
| UNDO_REDO | **PASS** |
| PERSISTENCE | **PASS** |
| TIMELINE_HONESTY | **PASS** |
| NATIVE_PREVIEW_PROOF | **SKIP_NO_METAL** |
| EXPORT_ZOOM_PROOF | **SKIP_NO_METAL** |
| LOCAL_FIRST_ZOOM | **PASS** |
| AUTONOMOUS_ZOOM_SAFETY_REGRESSION | **PASS** |
| TOTAL_CLOUD_CALLS | **0** |

**FINAL_ZOOM_PRODUCT_STATUS = FUNCTIONAL_WITH_GAPS**

(Direct timed zoom works end-to-end on the real failure phrase; native pixel/export proof pending Metal-capable run.)

---

## HARD STOP

Zoom capability maturity work for this milestone is complete. No trim / speed / captions / titles / callouts / transitions / Director redesign work was done beyond what was required to keep autonomous zoom safety intact.
