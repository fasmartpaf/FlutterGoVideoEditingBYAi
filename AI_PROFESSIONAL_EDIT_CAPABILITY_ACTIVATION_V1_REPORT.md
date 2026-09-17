# AI Professional Edit Capability Activation + Real Video Gap Audit V1

**Recording (primary):** `recording-1789463294153.mp4` (~16s)  
**Positive zoom:** `recording-1788894882204.mp4`  
**Artifacts:** `tmp/perception-benchmark/professional-edit-capability-activation-v1/`  
**Date:** 2026-09-15

## WHY_DID_OPENSCREEN_BEHAVE_LIKE_A_CAPTION_TOOL?

Concrete root causes (runtime-proven, not docs):

1. **Cursor telemetry never written in `system` capture mode**  
   Session: `cursorCaptureMode: "system"`. Mac/Windows stop path only wrote `.cursor.json` for `editable-overlay`.  
   → No samples → focal layer `NOT_AVAILABLE` → no zoom.  
   **This is a product wiring gap**, not “no focal evidence” as an abstract fact.

2. **Dead-air found pauses but none were READY**  
   3 silence intervals (~0.70s, ~0.80s, ~0.79s), all `TOO_SHORT` / `silence_below_candidate_threshold`.  
   → **POLICY_CONSERVATISM** relative to short screen-recording pauses (not a lost pipeline). Thresholds not loosened.

3. **Crop/speed: verified apply exists; editorial generation does not**  
   Professional planner never emits crop/speed candidates.  
   → `MISSING_GENERATION` (verification ≠ generation).

4. **Captions + loudness are the only families with complete generate→READY→apply paths when cursor is missing**  
   Transcript always present → caption layout deterministic. Loudness always analyzable.  
   → On this recording, after captions already on, **only loudness still commits** — which feels “caption-tool-like” in the UI history even though the orchestrator continued other families.

5. **Orchestrator mode is hybrid (C), not full editorial planning**  
   It aggregates dead-air / focal / caption-layout / loudness candidates and filters.  
   It did **not** previously run VisualAnalysis or consume Temporal Context Store.  
   It does **not** invent crop/speed from story alone.

Captions did **not** short-circuit the plan (trim→captions→zoom still considered). Dominance is **generation asymmetry**, not early exit.

## PROFESSIONAL_ORCHESTRATOR_MODE

**C) HYBRID** — evidence pipelines → candidate filter/aggregate → multi-step verified apply.

Proof: `run.ts` runs analyzers then `plan.ts` filters READY ops; no Temporal Context query; no bounded LLM edit planning.

## WHAT_WAS_FIXED?

| Fix | Why |
|-----|-----|
| **Always capture + write cursor telemetry** on Mac/Windows native record (system *and* editable-overlay) | Unblocks focal/zoom on future recordings made in system mode |
| **Run `analyzeVisual` inside professional orchestrator** and pass intervals into focal evidence | Professional intent now runs full local visual analysis |
| **Internal decision table** (`decisionTable.ts`) on every professional result | TRIM/ZOOM/CROP/SPEED/CAPTIONS/LOUDNESS APPLY\|KEEP\|MISSING_GENERATION with reasons |
| Prior dual Apply-card contradiction cleared on professional turns | Separately fixed; not the focus of this milestone |

## WHAT_CAN “MAKE THIS PROFESSIONAL” ACTUALLY DO NOW?

| Family | Generate | Verify/apply | This recording |
|--------|----------|--------------|----------------|
| Captions | Yes (when off) | Yes | KEEP — already on |
| Loudness | Yes | Yes (settings) | APPLY — peak-limited normalize |
| Trim | Yes (dead-air) | Yes | KEEP — 3 short pauses, policy |
| Zoom | Yes (focal) | Yes | KEEP — no sidecar on *this* file (pre-fix). **New recordings in system mode will get sidecars.** Positive recording: plan zoom **PASS** |
| Crop | **No** | Yes | MISSING_GENERATION |
| Speed | **No** | Yes | MISSING_GENERATION |

User-facing replay of the exact prompt after fixes (same file):

> I improved the video by balancing the audio. Your existing captions were already in place, so I kept them. I left the framing unchanged because I didn't find a zoom or crop that would clearly improve the recording.

## WHAT STILL CANNOT BE EDITORIALLY GENERATED EVEN THOUGH APPLY SUPPORT EXISTS?

- **Crop** — needs aspect/framing required path; not auto for generic professional.
- **Speed** — no professional candidate generator.
- **Temporal Context Store** — still not queried by orchestrator (visual analysis now runs directly).
- **This recording’s missing sidecar** — cannot be retroactively created; fix is for **future** captures.

## Decision table (this recording)

```
TRIM     KEEP   — 3 intervals, 0 safe (TOO_SHORT / policy)
ZOOM     KEEP   — cursor sidecar absent (system mode wiring gap on this file)
CROP     MISSING_GENERATION
SPEED    MISSING_GENERATION
CAPTIONS KEEP   — already enabled
LOUDNESS APPLY  — PEAK_LIMITED_SAFE_NORMALIZATION (+12 dB)
```

## Positive zoom product E2E

`recording-1788894882204.mp4`: cursor sidecar → click+dwell → `ZOOM_ELIGIBLE` → professional plan `addZoom` → **REAL_POSITIVE_ZOOM_PRODUCT_E2E: PASS**

## Acceptance gates

```
PROFESSIONAL_INTENT_RUNS_FULL_LOCAL_ANALYSIS: PASS (visual + dead-air + focal + loudness)
CAPABILITY_FUNNEL_TRACE: PASS
TEMPORAL_CONTEXT_ACTUALLY_CONSUMED: FAIL (still not queried; visual run direct)
DEAD_AIR_EDITORIAL_DECISION: PASS (KEEP proven)
FOCAL_EVIDENCE_PRODUCT_WIRING: PASS (capture fix) / this file still no sidecar
REAL_POSITIVE_ZOOM_PRODUCT_E2E: PASS
CAPTION_DOES_NOT_SHORT_CIRCUIT_PLAN: PASS
LOUDNESS_COORDINATION: PASS
CROP_EDITORIAL_GENERATION: MISSING
SPEED_EDITORIAL_GENERATION: MISSING
VERIFICATION_VS_GENERATION_GAP_DOCUMENTED: PASS
NO_SPECULATIVE_EDITS: PASS
PRESERVATION_SAFETY: PASS
RECEIPT_GROUNDED_USER_COPY: PASS
TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0
```

## Hard stop

Stopped after audit → minimal proven fixes → same-recording E2E → positive-zoom E2E → regressions → report.

**Do not** auto-choose the next milestone.  
**Next manual test:** record a **new** video with system cursor mode, confirm `.cursor.json` appears, then re-run the professional prompt.
