# AUTONOMOUS_EDITOR_MANUAL_PRODUCT_FAILURE_CLOSURE_V2

**Verdict: PASS_WITH_LIMITATIONS**

Recording: `recording-1789555833018.mp4` (~33.4s). Real Chat entry, OpenAI disabled. Artifact: `tmp/perception-benchmark/manual-product-failure-closure-v2/`.

---

## 1. Exact root causes

### Turn C — `add a caption` (hard failure)
- Parsed as `UNKNOWN` → `escalate_cloud` → generic “don’t see a safe recording-specific edit”.
- CAPTIONS intent only matched **disable/off**, never **add/enable/show**.
- Even when captions appeared in orch plans, enable often failed or was optional; caption-only turns still scheduled trim/zoom.

### Turn B — zoom follow-up
- Cursor sidecar **present** (820 samples, **8 clicks**). Focal layer said `ZOOM_ELIGIBLE`.
- Bug: spatially near but **temporally distant** clicks merged into ~19s zoom spans; mid-point often failed programme survival / usefulness checks → product said “no grounded focus” despite real clicks.
- Opportunity `useful` gate also required speech/phase labels even for MEDIUM grounded click/dwell.

### Turn A — visual + join QC
- Same merge bug suppressed usable short zooms (now fixed → zoom commits).
- Join FAIL was real: trim `0.3→2.29s` cut **inside active speech**. System shipped “join checks flagged an issue” without removing the offending trim (now revised by mutationRefs).

---

## 2. Exact files changed

- `electron/ai-edition/localEditorialChat/{types,parse,direct,index}.ts` — `ENABLE_CAPTIONS`, direct enable, STT-aware fallback
- `electron/ai-edition/professionalEditOrchestrator/{intent,plan,run}.ts` — caption-only families; join-QC trim revision
- `electron/ai-edition/editorialFocalEvidence/{policy,deriveTarget,geometry,orchestratorBridge}.ts` — temporal merge gate, max zoom hold, survive probes
- `electron/ai-edition/professionalEditorialPlanner/opportunities.ts` — grounded MEDIUM/HIGH click useful
- `electron/ai-edition/localEditorialChat/manualProductFailureClosureV2.live.runtime.test.ts` — A→B→C gate

---

## 3. A→B→C before / after

| Turn | Before (manual / pre-fix) | After (live E2E) |
|------|---------------------------|------------------|
| **A** | 2 trims + loudness; no zoom; join FAIL copy | Zoom committed; loudness; **join QC PASS** (speech-cutting trims revised out); receipt claims ~30.1s |
| **B** | No edit; “no grounded focus” | **zoomCount 1→2**; join PASS |
| **C** | Generic no-safe-edit; no captions | **`I enabled captions from the transcript.`** `captionsEnabled=true`; cloudCalls=0 |

---

## 4. Per-family funnel (Turn A autonomous)

| Family | Requested | Evidence | Outcome | Why |
|--------|-----------|----------|---------|-----|
| TRIM | yes | dead-air | planned then **revised out** | Join cut inside speech → removed by QC revision |
| ZOOM | yes | 8 clicks, ZOOM_ELIGIBLE | **APPLY** | Merge/clamp + useful-gate fix |
| REFRAME/ZOOM_OUT | yes (prompt) | enter/hold/exit via zoom span ~1.8s | modeled in zoom primitive | Explicit exit not separate op |
| SPEED | yes | no ≥1.8s low-speech remain-visible span | KEEP | Correct restraint |
| TITLE | yes | weak/conversational risk | KEEP | No safe title |
| CALLOUT | yes | needs grounded click label | KEEP | Not READY this take |
| TRANSITION | yes | single programme after trim revision | KEEP | No useful dissolve join |
| CAPTIONS | auto | transcript available | planned optional | Explicit enable on Turn C |
| LOUDNESS | auto | audio | APPLY | Balanced |

---

## 5. Focal beat trace (sidecar audit)

- `.cursor.json`: **yes**
- Samples: **820**; clicks: **8** at ~6.6s, 14.6s, 28.4s, 33.2s (pairs)
- Coordinates: normalized 0–1 in capture space (no DPR remapping bug proven)
- Pre-fix: merge across ~19s → bad geometry
- Post-fix: primary target ~**14.06–15.89s (1.84s)**, MEDIUM, CLICK+DWELL+CLUSTER → `ZOOM_ELIGIBLE`

---

## 6. Join QC

- Failure: `speechBoundary:inside_active_speech` on trim creating join at programme 0.3s (source 0.3 → 2.29).
- Fix: bounded revision drops trim IDs from failing `mutationRefs`, re-verifies.
- After fix: **FINAL_JOIN_QC = PASS** on A and B.

---

## 7. Document / timeline mutations

- A: fingerprint changed; `zoomRanges=1`; bad trims cleared (`trimCount=0`); join PASS
- B: fingerprint changed; `zoomRanges=2`
- C: fingerprint changed; captions enabled; zooms preserved; no generic fallback

---

## 8. Cloud calls

**TOTAL_CLOUD_CALLS = 0**

---

## 9. Remaining real product gaps

1. Autonomous Turn A still may leave captions off until user says “add a caption” (optional captions on professionalize).
2. Title/callout/transition often KEEP on short tutorial takes — honest, but visual “full skill pack” is not automatic.
3. SPEED remains rare on narration-dense clips by policy.
4. Dedicated ZOOM_OUT op is still enter/hold/exit of the zoom primitive, not a separate reframe skill.
5. Injected compositor in this E2E — native preview proof still needed on desktop for pixel confirmation.

---

## 10. Acceptance gates

| Gate | Result |
|------|--------|
| REAL_RECORDING_1789555833018_REPLAY | PASS |
| TURN_C_CAPTION_DIRECT_COMMAND | PASS |
| CAPTION_DIRECT_COMMAND_LOCAL / APPLY | PASS |
| NO_GENERIC_CAPTION_FALLBACK | PASS |
| LOCAL_FIRST_ALL_TURNS / TOTAL_CLOUD_CALLS=0 | PASS |
| TURN_B_ZOOM_INTENT / APPLIED | PASS |
| CURSOR_SIDECAR_AUDITED / FOCAL_FUNNEL | PASS |
| TRIM_JOIN_QC | PASS |
| CURRENT_DOCUMENT_EACH_TURN | PASS |

**Product question:** Better than the manual screenshots?  
**Yes** — zoom applies when clicks exist; “add a caption” enables captions locally; join FAIL no longer ships without revision.

---

## HARD STOP

No new Director/planner/TCS. Fixes are conversational routing, focal merge/geometry, caption direct command, and join-QC trim revision inside the existing path.
