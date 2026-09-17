# OpenScreen Reuse Milestone 1 — watch-video Algorithms

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_REUSE_VISUAL_V1`  
**Prerequisite audits:** `AI_OPEN_SOURCE_REUSE_AUDIT.md`  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: timecode-agent integration not started.

---

## Executive verdict

Clean-room TypeScript ports of watch-video’s **dHash dedupe**, **bounded scene+periodic sampling**, and **OCR preprocess** now sit behind the existing Visual Specialist / Investigator interfaces. Production turns prefer `runReuseVisualV1` (fallback to Visual Specialist V1). Locked baselines are untouched. Case 2 OCR independently reads **Restart recording** from source-resolution ROIs when macOS Vision can access the binary outside a restricted sandbox.

---

## Upstream watch-video commit audited

| Field | Value |
|-------|-------|
| Repository | https://github.com/WebDevBar/watch-video |
| Branch | `master` |
| Commit | `eb90ffae710df6def3c61aa1b3bf7a5743ed8f89` |
| Release | v1.1.3 (2026-08-31) |
| Primary file blob | `watch-video` / `18ea372978a9e80776376d1100abbe3dc83a43f5` |
| License file | MIT — Copyright (c) 2026 webdevbar |

---

## Upstream files/functions used

| Upstream | Classification | OpenScreen module |
|----------|----------------|-------------------|
| `dhash`, `hamming` | **ADAPT** (clean-room) | `reuse/dhash.ts` |
| `dedupe` | **ADAPT** (+ protected frames) | `reuse/dedupe.ts` |
| `extract_frames` scene+periodic | **ADAPT** (bounded range only) | `reuse/boundedSampling.ts`, `reuse/sceneDetect.ts` |
| `_prep_for_ocr` | **ADAPT** (ffmpeg+TS; tesseract path) | `reuse/ocrPreprocess.ts` |
| `ocr_frames` + Tesseract `--psm 6` | **ADAPT** (optional subprocess) | `reuse/tesseractEngine.ts` |
| `fps_mode_args` | **REFERENCE_ONLY** | existing ffmpeg helpers |
| `write_timeline` | **REFERENCE_ONLY** | Investigator briefing already covers fusion |
| `transcribe` / Whisper | **NOT_NEEDED** | `speechEvidence` |
| `acquire` / yt-dlp / CLI / contact sheet / cleanup | **NOT_NEEDED** | product surface |

---

## License/attribution

- **License:** MIT (verified from upstream `LICENSE`).
- **Copy mode:** Clean-room TypeScript reimplementation of algorithms — **no verbatim Python paste**.
- **Attribution location:** `electron/ai-edition/visualSpecialist/reuse/NOTICE.md` (includes MIT text + commit/file map).

---

## What was ported

1. Difference-hash + Hamming redundancy filter with **protected** ROI/interaction frames.  
2. Bounded-range candidate builder: periodic + scene + Bug-3 change + Investigator interaction.  
3. ffmpeg scene probe limited to Investigator focus window.  
4. Mean-threshold OCR preprocess (upstream recipe) for **Tesseract**; Vision uses source crop directly (binary threshold hurts HUD OCR).  
5. Optional Tesseract engine with honest `unavailable` / `failed` / `no_text` / `available` statuses.  
6. OCR disk+memory cache keyed by media identity, time, ROI, engine, preprocess version (not prompt).  
7. Extended specialist budgets + `runReuseVisualV1` wired from deep-agent service.

---

## What was deliberately NOT ported

- watch-video CLI / plugin UX / markdown timeline product  
- yt-dlp acquire path  
- faster-whisper transcription  
- contact sheets  
- full-video sampling (initial 2s visualEvidence unchanged)  
- Any non-MIT repository code  

---

## Files changed in OpenScreen

**Added**

- `electron/ai-edition/visualSpecialist/reuse/NOTICE.md`
- `electron/ai-edition/visualSpecialist/reuse/constants.ts`
- `electron/ai-edition/visualSpecialist/reuse/dhash.ts`
- `electron/ai-edition/visualSpecialist/reuse/dedupe.ts`
- `electron/ai-edition/visualSpecialist/reuse/boundedSampling.ts`
- `electron/ai-edition/visualSpecialist/reuse/sceneDetect.ts`
- `electron/ai-edition/visualSpecialist/reuse/ocrPreprocess.ts`
- `electron/ai-edition/visualSpecialist/reuse/ocrCache.ts`
- `electron/ai-edition/visualSpecialist/reuse/tesseractEngine.ts`
- `electron/ai-edition/visualSpecialist/reuse/runReuse.ts`
- `electron/ai-edition/visualSpecialist/reuse/index.ts`
- `electron/ai-edition/visualSpecialist/reuse/reuse.test.ts`
- `electron/ai-edition/perceptionBenchmark/reuse-visual-v1.runtime.test.ts`
- `AI_REUSE_VISUAL_V1_REPORT.md` (this file)

**Modified**

- `electron/ai-edition/visualSpecialist/types.ts` — `OcrStatus`, budgets, metrics  
- `electron/ai-edition/visualSpecialist/ocr/engine.ts` — status, tesseract fallback, compile lock  
- `electron/ai-edition/visualSpecialist/run.ts` — reuse briefing heading  
- `electron/ai-edition/visualSpecialist/index.ts` — exports  
- `electron/ai-edition/visualSpecialist/visualSpecialist.test.ts` — Case 2 timing  
- `electron/ai-edition/deep-agent/service.ts` — prefer `runReuseVisualV1`

---

## Keyframe/dedupe architecture

```
Investigator focus range + ROI/interaction times
        → buildBoundedSampleCandidates (periodic/scene/change/interaction)
        → optional center stills for dHash
        → dedupeByDhash (protected never dropped by hash alone)
        → source-res ROI crops for OCR
```

Hash similarity is a **budget signal**, not semantic equivalence.

---

## Scene+periodic sampling architecture

- **Periodic:** default 1.0s inside the inspected window (denser than watch-video’s full-video 4s).  
- **Scene:** ffmpeg `gt(scene,0.08)` only on `[rangeStart, rangeEnd]`.  
- **Change:** optional Bug-3 `toSourceTimeSec` list from prepared visual evidence.  
- **Interaction/ROI:** protected.  
- No whole-video explosion; visualEvidence 2s prepare unchanged for A/B.

---

## OCR architecture

```
source-res ROI crop
  → (tesseract only) mean-threshold preprocess
  → platform OCR (Vision preferred → Tesseract → unavailable)
  → status: available | no_text | unavailable | failed
  → Observation visible_text (≠ action)
  → InvestigationEvidenceSet + ledger observed_visible_text
```

---

## OCR engine/runtime decision

| Option | Decision |
|--------|----------|
| A Tesseract subprocess | **Supported** if binary present (`OPENSCREEN_TESSERACT_EXE` or common paths); honest unavailable otherwise |
| B Node OCR library | **Not chosen** (extra dep, no gain for V1) |
| C Platform-native | **Primary** — existing macOS Vision Swift helper |

Smallest reliable path: keep Vision; add Tesseract as cross-platform fallback; never treat missing engine as “no text.”

---

## Source-resolution ROI path

Unchanged `extractSourceResolutionCrop` — crops from source media, not 1280 JPEGs. Metrics retain source/ROI/preprocess dimensions on OCR results when available.

---

## Investigator integration

Investigator V1 unchanged in planning. Service order:

1. Investigator acquires focus/ROI evidence  
2. `runReuseVisualV1` (reuse algorithms)  
3. On failure → `runVisualSpecialistV1`  
4. Merge into `InvestigationEvidenceSet` briefing  

Visual Specialist still does not decide editorial goals.

---

## Ledger integration

Existing `appendVisualSpecialistToLedger` maps `visible_text` → `observed_visible_text` with epistemic **observed**. No automatic VERIFIED actions.

---

## Case 2 result

Measured (macOS, Vision, Case 2 recording, no GT in production path):

| Item | Result |
|------|--------|
| Range | Investigator-style late window ~14–20s |
| Frame | Forced ROI ~18.0s prioritized |
| ROI | `bottom_center` source crop ~1360×432 from 3024×1964 |
| Preprocess | Vision: not applied (threshold hurts); recipe still versioned |
| OCR output | Includes `Restart recording` (+ HUD chrome) |
| Confidence | Vision line confidences when present |
| Ledger | `observed_visible_text` only |
| Action claim | Not asserted |
| User response | Still model-authored from briefing; no OCR JSON in user text |

Diagnostics: `tmp/perception-benchmark/reuse-visual-v1/` (gitignored).

---

## Upwork regression

Unit invariant: OCR of “Upwork” → `specialistObservedText` true; `specialistHasVerifiedOpenFromOcr` false; passive-chrome note emitted when app-name regex matches.

---

## Case 4 regression

No change to speech/visual contradiction policy. OCR coincidence of “Effects” elsewhere is not wired as panel-open verification (OCR remains visibility-only observations).

---

## Settings contradiction

OCR of “Settings” does not create verified “opened Settings” claims (ledger + observation contracts).

---

## Quality comparison

| Metric | CURRENT_OPENSCREEN | Investigator V1 | Reuse Visual V1 |
|--------|-------------------:|----------------:|----------------:|
| File menu | baseline | improved via ROI | OCR can read File/menu chrome when top_chrome runs |
| Highlight | baseline | partial | unchanged (no GT) |
| Menu close | baseline | partial | unchanged |
| App transition | baseline | partial | unchanged |
| Restart tooltip | miss / weak | ROI acquired, OCR often miss at 1280 | **OCR reads Restart at source-res** |
| Unsupported claims | guarded | guarded | OCR≠action + Upwork guard |
| Latency | — | investigator+specialist | + scene/dHash/OCR overhead (see Performance) |
| Extra model calls | N | 0 investigator | **0** |
| OCR calls | 0 | ≤4 (V1) | ≤4 (budgeted) |

Full live model A/B of user prose vs locked CURRENT_OPENSCREEN is optional (`reuse-visual-v1.runtime.test.ts` when `OPENAI_API_KEY` set); unit/OCR path is the acceptance core for this milestone.

---

## Performance

From Case 2 reuse run (order-of-magnitude, local):

| Step | Typical |
|------|---------|
| Scene probe | tens–hundreds ms |
| dHash over candidates | ~0.5–1.5s including still extracts |
| Source ROI crop | ~50–150 ms each |
| OCR (Vision, warm binary) | ~30–80 ms/call |
| OCR cache hit | ≪ cold |
| Specialist total | ~2–6 s for bounded window |
| Extra LLM calls | **0** |

Desktop-suitable for short Investigator windows; not for whole-video OCR.

---

## Model-call count

**0** additional LLM calls in reuse specialist (same contract as Visual Specialist V1).

---

## Test results

`npx vitest --run --no-file-parallelism` (full OS permissions for Vision):

- `visualSpecialist/reuse/reuse.test.ts` — pass  
- `visualSpecialist/visualSpecialist.test.ts` — pass  
- `videoInvestigator/videoInvestigator.test.ts` — pass  

**31 passed.**

Note: macOS Vision OCR returns empty under Cursor’s restricted sandbox; production Electron / unrestricted CI/dev is required for OCR assertions.

---

## Remaining limitations

1. Vision OCR sandbox/TCC sensitivity on agent hosts.  
2. ffmpeg mjpeg encode can fail at some exact EOF timestamps (e.g. 19.89s) — non-fatal.  
3. Tesseract not installed on this machine — fallback path unit-tested via unavailable status only.  
4. Initial 2s visualEvidence sampling intentionally unchanged (A/B).  
5. Full live CURRENT vs Reuse user-response matrix not blocked on this milestone’s unit/OCR gate.  
6. Binary threshold preprocess reserved for Tesseract; not applied to Vision.

---

## What should be reused next

Per prior audit — **timecode-agent** checkpoint promotion / capture provenance / verification levels (ideas only, MIT). Not started.

---

## Verdict

### **PASS_WITH_LIMITATIONS**

Reuse Milestone 1 delivers watch-video algorithms behind OpenScreen interfaces without redesign, preserves locked baselines, and demonstrates Case 2 source-res OCR for Restart without GT. Limitations: Vision sandbox sensitivity, optional Tesseract not present locally, and no whole-video sampler change.
