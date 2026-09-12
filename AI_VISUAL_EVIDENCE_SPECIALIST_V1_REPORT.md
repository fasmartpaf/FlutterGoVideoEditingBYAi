# Visual Evidence Specialist V1 — CTO Report

**Date:** 2026-09-13  
**Prerequisites:** Temporal Event Ledger V1 · Master Video Investigator V1 (`PASS_WITH_LIMITATIONS`)  
**Verdict:** **PASS_WITH_LIMITATIONS**

This milestone does **not** start Target Story or autonomous editing. It strengthens **perception** of acquired visual evidence.

---

## A. Pre-change audit

Baseline before edits: **124 passed** (`tmp/perception-benchmark/visual-specialist-v1-baseline.txt`).

Findings:

| Topic | Finding |
|---|---|
| Investigator `additionalFrames` | Paths + notes; attached as ≤6 multimodal stills before agent |
| ROI `inspect_region` | Cropped from **≤1280 JPEG cache**, not source media |
| Source video Case 2 | **3024×1964** |
| OCR in repo | **None** (no tesseract/paddle; no Vision in capture helpers) |
| Semantic grounding | Model-opportunistic `visibleText[]`; not OCR |
| Change heat | Scalar `blockMax` only — no hotspot export (added additive helper) |

Measured gap (before specialist):

| Evidence | macOS Vision OCR |
|---|---|
| Source-res bottom crop 1360×432 @ 18.0s | **Reads `Restart recording` (conf=1)** |
| 1280-derived ROI 576×182 @ 18.0s | **Empty lines** |

---

## B. Existing capabilities reused

- Investigator acquisition + budgets  
- ffmpeg extract/crop (`resolveFfmpeg`)  
- Gray thumbnail compare (`decodeGrayThumbnail`, `scoreGrayThumbnails`)  
- Ledger / InvestigationEvidenceSet merge points  
- `mediaContextNeeds` / Source Story / edit tools — untouched  

---

## C. Exact files changed

### Added

- `electron/ai-edition/visualSpecialist/` (types, sourceCrop, ocr/engine, changeHeat, run, ledgerBridge, index, tests)
- `electron/ai-edition/visualSpecialist/native/macosVisionOcr.swift`
- `electron/ai-edition/perceptionBenchmark/visual-specialist-v1.runtime.test.ts`
- `AI_MASTER_VIDEO_INVESTIGATOR_V1` sibling report: `AI_VISUAL_EVIDENCE_SPECIALIST_V1_REPORT.md`
- Diagnostics: `tmp/perception-benchmark/visual-specialist-v1/`

### Modified

- `electron/ai-edition/deep-agent/service.ts` — run specialist after Investigator, before briefing attach; merge into investigation + ledger
- `electron/ai-edition/temporalEventLedger/types.ts` — additive event types
- `electron/ai-edition/temporalEventLedger/store.ts` — `visualInRange` includes new types

Native binary may be compiled to `electron/native/bin/darwin-arm64/openscreen-vision-ocr` (gitignored bin dir); **Swift source is the portable artifact**, with compile-on-demand fallback.

---

## D. Visual Specialist architecture

```
Investigator Evidence Set (frames/ROIs/ranges)
        ↓
Visual Specialist V1
  · source-resolution crops from VIDEO (not 1280 upscale)
  · dense late-window bottom samples + early top chrome
  · optional change-hotspot crop
  · platform OCR adapter (macOS Vision)
        ↓
VisualObservation[] (observed text / UI state / diffs)
        ↓
merge → InvestigationEvidenceSet briefing + stills
append → Temporal Event Ledger (observed_* types)
        ↓
existing agent / verification (0 specialist LLM calls)
```

---

## E. OCR technology decision

**Choice:** thin `OcrEngine` interface + **macOS Vision** helper (`VNRecognizeTextRequest`).

**Why:**

1. No OCR existed in-repo; avoid npm OCR stacks.  
2. Vision is already on macOS developer machines; small Swift helper, cognition stays engine-agnostic.  
3. Windows/Linux: `UnavailableOcrEngine` stub — same interface later.  
4. Provider-vision fallback **not** used as primary (would add model calls); native OCR measured sufficient for Case 2 tooltip.

---

## F. High-resolution ROI architecture

`extractSourceResolutionCrop`:

- `-ss` + ffmpeg `crop=w:h:x:y` on **source video**  
- Presets: `bottom_center`, `top_chrome`, `center`, `change_hotspot`  
- Case 2: **1360×432 from 3024×1964** (not upscaled 576×182)

Global sampling remains ≤1280. Only specialist path pays for source-res crops.

---

## G. Before/after comparison

Supported when ≥2 sample times ≥~1s apart: source-res bottom pair + pixel score + optional hotspot OCR.  
Temporary UI claims use **uncertain onset** wording (`temporallyUncertain`).

---

## H. Ledger integration

Additive types (no rewrite):

- `observed_visible_text`  
- `observed_ui_state`  
- `observed_visual_diff`  

Claims stay **`observed`** — never auto-`verified` actions from OCR.

---

## I. Investigator integration

In `invokeOpenScreenAgent`, after Investigator (skipped for `deterministicEdit`):

1. `runVisualSpecialistV1`  
2. `mergeSpecialistIntoInvestigation`  
3. `appendInvestigatorToUserMessage` (includes source-res stills + OCR notes)  
4. Final ledger append via `appendVisualSpecialistToLedger`

---

## J. Case 2 full evidence trace

Artifact: `tmp/perception-benchmark/visual-specialist-v1/case02-full-trace.json`  
Provider id: **`CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1`**

| Step | Result |
|---|---|
| Initial coarse | frames 16/18; change **minimal** |
| Investigation | late range ~14–20s; ROI tools planned/run |
| Selected regions | bottom_center @ 18.097, 18.992, 19.387, 19.588; top_chrome @ 13.921 |
| Source-res crop | **1360×432 from 3024×1964**, `fromSourceMedia: true` |
| OCR | **`Restart recording` (confidence 1)** among HUD lines |
| Observation | `visible_text` / observed — “Visible text ≠ user action” |
| Verification | No “user restarted recording” action claim |
| Recognized? | **YES** (production OCR, not GT) |
| Provenance | source time, crop rect, image path, engine=`macos_vision` |
| GT isolation | Fair prompt has no Restart string; specialist JSON built from pixels |
| Latency | specialist **~1.6s** (crop ~0.67s + OCR ~0.77s); **0 extra model calls** |
| vs Investigator V1 | Investigator alone: ROI acquired, Restart **not** named; Specialist: Restart **observed** |

User-facing prose remains the existing agent’s job; briefing tells it OCR-visible tooltip text without dumping JSON.

---

## K. File-menu regression

Top-chrome source-res OCR @ ~13.9s reads **File** / Android Studio menu chrome.  
Observation remains visibility, not “user opened File” unless interaction evidence exists.

---

## L. Upwork regression

OCR of app names triggers explicit **passive_chrome_guard** note.  
`specialistHasVerifiedOpenFromOcr` invariant enforced in tests.

---

## M. Case 4 regression

Specialist does not invent panel-open visuals from speech. Source Story / investigator speech contradiction path unchanged (suite green).

---

## N. Settings contradiction

Keyword coincidence ≠ open action — OCR visibility notes do not verify Settings opened. (Same epistemic rules as Upwork.)

---

## O. Performance (Case 2 specialist)

| Metric | Value |
|---|---|
| Source crops | 5 |
| OCR calls | 4 |
| Source crop ms | ~670 |
| OCR ms | ~770 |
| Total specialist | **~1.6–1.9 s** |
| Extra model calls | **0** |
| Image bytes | ~310 KB |

Compared to Investigator V1 alone (~0.4s acquire, miss tooltip name): +~1.5s for successful OCR perception.

---

## P. Model-call count

| Stage | Calls |
|---|---|
| Visual Specialist | **0** |
| Investigator | **0** |
| Existing agent turn | 1 (unchanged) |

---

## Q. Test counts

| Suite | Result |
|---|---|
| Pre-change related | 124 passed |
| Final related (specialist + ledger + investigator + sourceStory + speech + grounded + Case2 runtime) | **86 passed / 0 failed** |

---

## R. Benchmark comparison

| Identity | Status |
|---|---|
| `CURRENT_OPENSCREEN` | Locked — not overwritten |
| `CURRENT_OPENSCREEN_INVESTIGATOR_V1` | Preserved |
| `CURRENT_OPENSCREEN_VISUAL_SPECIALIST_V1` | New diagnostics; Case 2 Restart **detected via OCR** |

Scorer remains GT-only; production never reads GT.

---

## S. Remaining perception ceiling (measured)

**Primary cause of the prior Case 2 miss: evidence resolution**, not “VLM stubbornness” alone.

1. **Resolution (dominant):** 1280→ROI OCR returned empty; source-res OCR read `Restart recording`.  
2. **Temporal sampling (secondary):** tooltip readable ~18.0–19.0s; single sample at 17.9 or 19.4 missed it — dense late-window sampling required.  
3. **General VLM (tertiary):** even with ROI stills, prior agent turns missed/empty; OCR removes dependence on VLM noticing small glyphs.  
4. **OCR quality:** occasional misreads (`Restart recerdingrding` at 18.8s) — confidence/provenance still required.

---

## T. Remaining limitations

1. OCR binary is macOS-first; Windows/Linux need adapters.  
2. Geometric + dense-time heuristics ≠ learned attention.  
3. OCR can misread; must stay `observed`, never silent truth.  
4. User-facing narration still depends on the existing agent consuming the briefing.  
5. File-menu early OCR competes with OCR budget (HUD prioritized).  
6. Native bin compile requires `swiftc` on first use if binary absent.

---

## U. Verdict

**PASS_WITH_LIMITATIONS**

OpenScreen can now: acquire visual evidence (Investigator), crop **source-resolution** ROIs, run **bounded native OCR**, emit provenance-backed `VisualObservation`s into the InvestigationEvidenceSet and Temporal Event Ledger, and recognize Case 2’s `Restart recording` text from pixels without GT — without rewriting architecture, without extra LLM calls in the specialist, and without promoting visible text into user actions.

**STOP.** Do not start Target Story, edit planning, or autonomous editing until this report is reviewed.
