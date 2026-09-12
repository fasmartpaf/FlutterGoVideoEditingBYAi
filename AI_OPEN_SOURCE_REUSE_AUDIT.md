# OpenScreen Open-Source Reuse Audit

**Date:** 2026-09-13  
**Scope:** Capability reuse behind OpenScreen interfaces — no production copy, no architecture replacement  
**Method:** GitHub API metadata + recursive tree listing + direct source/LICENSE inspection via raw GitHub (not README-only)  
**Constraint:** Preserve Electron, AxcutDocument/timeline, mediaContextNeeds, visualEvidence, speechEvidence, sourceTiming, Temporal Event Ledger, Video Evidence Store, Investigator V1, Source Story, benchmark harness, locked CURRENT_OPENSCREEN baselines, editing tools

---

## Executive verdict

**Stop building Visual Evidence Specialist V1 as a greenfield perception stack.**  
OpenScreen already owns the right product boundaries (ledger, investigator budgets, SOURCE_MEDIA_TIME, native OCR adapter). The highest-ROI path is to **steal algorithms, not repos**: MIT-licensed **watch-video** keyframe/OCR/timeline patterns and MIT-licensed **timecode-agent** checkpoint/provenance/verification *ideas*, reimplemented behind existing TypeScript interfaces.

Heavy research agents (VideoAgent, LongVideoAgent, VideoMind, LongVT, InternVideo3, TimeLens2, EGAgent, UI-Hawk) are mostly **ARCHITECTURE_REFERENCE_ONLY** for desktop: GPU/training stacks, missing or non-commercial licenses, or no shippable inference path. Do **not** replace Investigator/Ledger with any of them.

**GO / NO-GO on Visual Evidence Specialist V1 from scratch: NO-GO.**  
Freeze further from-scratch specialist expansion. Next milestone = **algorithm port + ledger provenance merge**, not a new parallel cognition architecture.

---

## Repositories audited

| # | Repo | Stars | Lang | Default branch | Last push | Blobs inspected |
|---|------|------:|------|----------------|-----------|-----------------|
| 1 | [mupozg823/timecode-agent](https://github.com/mupozg823/timecode-agent) | 53 | Python | main | 2026-08-06 | 145 (deep: ledger/OCR/keyframes/verify/export) |
| 2 | [WebDevBar/watch-video](https://github.com/WebDevBar/watch-video) | 6 | Python | master | 2026-08-31 | 38 (full single-file CLI) |
| 3 | [yuanyunchen/VideoAgent](https://github.com/yuanyunchen/VideoAgent) | 1 | Python | main | 2025-12-17 | 36 |
| 4 | [IMNearth/UIHawk](https://github.com/IMNearth/UIHawk) | 5 | — | main | 2025-10-31 | 9 (paper assets only) |
| 5 | [MCG-NJU/TimeLens2](https://github.com/MCG-NJU/TimeLens2) | 133 | Python | main | 2026-07-27 | 2117 (tree + LICENSE/README) |
| 6 | [OpenGVLab/InternVideo](https://github.com/OpenGVLab/InternVideo) (InternVideo3) | 2385 | Python | main | 2026-07-02 | 3597 (tree + InternVideo3 SFT README) |
| 7 | [longvideoagent/LongVideoAgent](https://github.com/longvideoagent/LongVideoAgent) | 129 | Python | main | 2026-07-29 | 427 |
| 8 | [yeliudev/VideoMind](https://github.com/yeliudev/VideoMind) | 357 | Python | main | 2026-02-08 | 84 |
| 9 | [agentic-practice/agentic_longvideo](https://github.com/agentic-practice/agentic_longvideo) (**LongVT**) | 0 | Python | main | 2025-12-05 | 904 |
| 10 | [facebookresearch/egagent](https://github.com/facebookresearch/egagent) | 61 | Python | main | 2026-09-01 | 49 |

---

## License/commercial-use matrix

| Repo | Declared license | Commercial reuse | Classification |
|------|------------------|------------------|---------------|
| timecode-agent | **MIT** | OK (preserve notice) | **ADAPT_WITH_WRAPPER** (ideas + selective algorithms; do not vend whole workspace) |
| watch-video | **MIT** | OK | **ADAPT_WITH_WRAPPER** / selective **DIRECTLY_REUSABLE** algorithms (reimpl in TS preferred) |
| VideoMind | **BSD-3-Clause** | OK | **ARCHITECTURE_REFERENCE_ONLY** for desktop; optional future cloud specialist |
| LongVT (agentic_longvideo) | **Apache-2.0** | OK | **ARCHITECTURE_REFERENCE_ONLY** (tool-call RL training stack) |
| InternVideo / InternVideo3 | **Apache-2.0** | OK | **NOT_SUITABLE** for Electron production (multi-GPU foundation/SFT) |
| TimeLens2 | Custom Tencent: **academic only**, **not EU**, no commercial/production | **Blocked** | **ARCHITECTURE_REFERENCE_ONLY** |
| UI-Hawk | **CC BY-NC-SA 4.0** | **Blocked** | **ARCHITECTURE_REFERENCE_ONLY** |
| EGAgent | **CC BY-NC 4.0** | **Blocked** | **ARCHITECTURE_REFERENCE_ONLY** |
| VideoAgent | **No SPDX**; README: “research purposes” | **Unclear / treat as blocked for copy** | **ARCHITECTURE_REFERENCE_ONLY** |
| LongVideoAgent | **No LICENSE file** in tree API | **Unclear — do not copy** | **ARCHITECTURE_REFERENCE_ONLY** until clarified |

**Rule applied:** missing / NC / academic-only / unclear → no source copy; concepts only via clean-room reimplementation inside OpenScreen contracts.

---

## timecode-agent findings

| Field | Finding |
|-------|---------|
| License | MIT |
| Runtime | Python 3.12, CLI `va`/`tca` |
| Primary deps | faster-whisper, mlx-whisper (Apple), ocrmac, OpenTimelineIO, sherpa-onnx, numpy |
| Models | Local Whisper; optional pyannote diarize extra |
| GPU | Optional; designed local/CPU/Apple Silicon first |
| Local/cloud | **Local-first** media; coding agent may call cloud LLMs separately |
| Platform | macOS-first OCR (Vision via ocrmac); Linux/Windows experimental |
| Maturity | Alpha v0.4.0, CI, strong schema discipline |
| Activity | Active 2026 |
| Module boundaries | Clear: ingest → signals → checkpoints.jsonl → sequences → export |
| Reusable | Checkpoint status machine; lazy verify; capture provenance; keyframe budget selector; OCR scan merge; EDL/OTIO/FCPXML receipt |
| Coupled | Full workspace FS layout, Korean-centric defaults, CLI-centric agent skill packaging |
| Integration difficulty | Medium for *ideas*; High if embedding Python package wholesale |
| Commercial risk | Low (MIT) |

### Capability deep dive vs OpenScreen Temporal Event Ledger V1

| Concern | timecode-agent | OpenScreen TEL V1 | Decision |
|---------|----------------|-------------------|----------|
| Evidence unit | Claim **checkpoint** with span + hypothesis + status | **TemporalEvent** + claims with epistemic state | **KEEP OUR VERSION** as event construction from sensors |
| Construction | Agent writes checkpoints; ingest is transcript-first | Deterministic `buildLedgerFromPreparedEvidence` (0 LLM) | **KEEP OUR VERSION** |
| Status machine | `hypothesized` → `verified` / `corrected` | `observed` / `spoken` / `inferred` / `verified` / `contradicted` / `unknown` | **MERGE SPECIFIC IDEAS** — add explicit *promotion* path for investigator-acquired support; keep epistemic taxonomy |
| Append-only | checkpoints.jsonl + revision binding | Turn-local store; rebuild post-semantic | **MERGE SPECIFIC IDEAS** — durable revision/hash for investigation artifacts |
| Lazy visual verify | Capture only when claim needs pixels; `verification.py` checks resolvable visual refs + transcript segments | Investigator tools + Visual Specialist OCR | **MERGE SPECIFIC IDEAS** — formal “promotable only if evidence resolves” |
| Capture provenance | `reason` on captures; image records with span checks | Frame paths / ROI crops with weaker reason ledger | **COPY/ADAPT SPECIFIC MODULE** — capture-reason + span-bound image provenance (clean-room TS) |
| Edit handoff | EDL/OTIO/FCPXML + deterministic **receipt** (sha256, checkpoint revisions) | AxcutDocument / editing tools (owned) | **MERGE SPECIFIC IDEAS** later for export provenance — not V1 blocker |
| OCR | macOS Vision via ocrmac; interval OCR transcript merge | macOS Vision Swift helper already in `visualSpecialist/ocr` | **KEEP OUR VERSION**; optionally adopt interval merge algorithm |
| Keyframes | Budget-aware, query-blind, scene/burst/lowconf signals (AKS coverage term) | visualEvidence sampler + change scores | **MERGE SPECIFIC IDEAS** — budgeted coverage picks when ROI budget tight |

**Exact decisions:**

1. **KEEP OUR VERSION** — Temporal Event Ledger schema, SOURCE_MEDIA_TIME, deterministic build, Video Evidence Store.  
2. **DO NOT REPLACE WITH THEIR LOGIC** — Python workspace, wiki, BM25 corpus, EDL-as-primary editing path.  
3. **MERGE SPECIFIC IDEAS** — hypothesized→verified promotion gates; verification levels (`transcript_only` / `visual_only` / `cross_modal`); capture `reason` provenance; export receipt concept for later.  
4. **COPY/ADAPT SPECIFIC MODULE** — only as clean-room TypeScript: keyframe budget selector heuristics; OCR interval merge; image-record span validation. **Do not paste their Python.**

**Classification:** ADAPT_WITH_WRAPPER (ideas) · not DIRECTLY_REUSABLE as a dependency.

---

## watch-video findings

| Field | Finding |
|-------|---------|
| License | MIT |
| Runtime | Single-file Python CLI via `uv run --script` |
| Deps | faster-whisper, yt-dlp, Pillow, numpy, pytesseract; system ffmpeg + tesseract |
| Models | Whisper tiny→large-v3 (local CPU int8 default) |
| GPU | Not required |
| Local/cloud | **Strict local-first** |
| Platform | Linux/macOS/Windows |
| Maturity | Small but tested (bash suite); v1.1.3 |
| Activity | Active 2026 |
| Boundaries | One pipeline file: acquire → frames → dedupe → transcribe → OCR → timeline |
| Reusable | **Highest code-density reuse candidate** for Visual Specialist acceleration |
| Coupled | yt-dlp / Loom plugin UX; markdown agent artifacts — not OpenScreen timeline |
| Integration difficulty | **Low–medium** if reimplemented in TS/Node using existing ffmpeg; Medium if optional Python subprocess |
| Commercial risk | Low (MIT) |

### Exact functions that accelerate Visual Evidence Specialist V1

From `watch-video` (single CLI file):

| Function | What it does | OpenScreen mapping |
|----------|--------------|--------------------|
| `fps_mode_args()` | ffmpeg `-fps_mode` vs `-vsync` probe | Harden frame extract helpers |
| `extract_frames()` | first + scene (`gt(scene,T)`) + periodic `mod(t,N)` | Adaptive sampling for specialist / visualEvidence |
| `dhash()` + `hamming()` + `dedupe()` | perceptual hash dedupe + max-frames thinning | Missing vs time-window-only `dedupeVisualCandidates` |
| `_prep_for_ocr()` + `ocr_frames(..., tuned=True)` | upscale + threshold + PSM 6 | Cross-platform OCR path when Vision unavailable; sharpen HUD OCR |
| `write_timeline()` | interleave frame + transcript + OCR | Investigator briefing / fusion presentation |
| `transcribe()` | faster-whisper local | **Do not replace** speechEvidence/whisperServer — reference only |
| Cache/cleanup/manifest | ownership-safe artifact dirs | Optional diagnostics hygiene |

**Compare to OpenScreen:**

- speechEvidence already owns ASR — keep.  
- visualEvidence owns sampling/change — add **dhash dedupe + scene select**, not a parallel pipeline.  
- visualSpecialist owns source-res crop + Vision OCR — add **tuned preprocessing** + **Windows/Linux tesseract adapter** behind `OcrEngine`.  
- Investigator owns bounded tools — consume improved frames/OCR as evidence, not markdown dumps.

**Classification:** ADAPT_WITH_WRAPPER (primary immediate win). Prefer clean-room TS reimplementation over shipping `uv`+Python in the Electron app.

---

## UI-Hawk findings

| Field | Finding |
|-------|---------|
| License | **CC BY-NC-SA 4.0** — commercial copy forbidden |
| Code shipped | README + PDF + assets **only** — **no inference code, no weights in repo** |
| Inference | Not available from this repository |
| Weights | Not published in-repo; FunUI benchmark on HF |
| GPU | Assumed research MLLM (TextHawk-based) |
| Input | Screen *stream* / GUI navigation (Android-centric FunUI) |
| Practical for OpenScreen screen recordings? | **No as production dependency** |

**Decision:** **architecture reference** (history-aware screen encoder, FunUI task taxonomy: grounding / referring / QA / summarization).  
**Not** production candidate. **Not** even a strong benchmark-only *code* candidate (no runnable model package here).

---

## VideoAgent findings

| Field | Finding |
|-------|---------|
| License | None / “research purposes” → **no copy** |
| Runtime | Python + LangGraph ReAct |
| Deps | transformers, CUDA torch, many expert models |
| Models | InternVideo2.5-8B, CLIP/VideoTree, YOLO, DAM, API MLLMs |
| GPU | **Required** for meaningful local tools (~16GB for InternVideo2.5) |
| Architecture | ReAct controller + hierarchical memory + tool server/GPU manager |
| Maturity | Tutorial-scale (1★); EgoSchema eval focus |

**Classification:** ARCHITECTURE_REFERENCE_ONLY.

**Worth adopting as pattern (not code):** tool interface layer (agent sees schemas only); max tool calls; force-answer; hierarchical memory slots. Aligns with Investigator V1 direction already.

---

## TimeLens2 findings

| Field | Finding |
|-------|---------|
| License | **Academic-only / non-commercial / not for EU** |
| Role | Generative temporal grounding MLLM (query → intervals) |
| Stack | Large SFT+GRPO training/eval monorepo |
| Desktop fit | Poor |

**Classification:** ARCHITECTURE_REFERENCE_ONLY — interval-set output + coarse-to-fine grounding *as research benchmark target*, never ship weights under this license.

---

## InternVideo3 findings

| Field | Finding |
|-------|---------|
| License | Apache-2.0 (repo) |
| InternVideo3 content | SFT on XTuner/FSDP, 8–64 GPU recipes, InternVideoNext + Qwen3-VL-scale LM |
| Desktop fit | **Foundation-model training/eval only** |

**Classification:** NOT_SUITABLE for OpenScreen production. Optional future: cloud provider that *hosts* a model *inspired by* InternVideo family — not bundling this tree.

---

## LongVideoAgent findings

| Field | Finding |
|-------|---------|
| License | **Missing** → no copy |
| Architecture | MasterAgent ↔ GroundingAgent ↔ VisionAgent; max K turns; GRPO |
| Tools | `<request_grounding>`, `<visual_query>`, answer |
| Stack | vLLM / verl / flash-attn training |

**Classification:** ARCHITECTURE_REFERENCE_ONLY.

**Pattern for Investigator V2:** explicit grounding vs vision specialist roles (OpenScreen already split Investigator vs Visual Specialist) + hard step budget — keep; skip RL training.

---

## VideoMind findings

| Field | Finding |
|-------|---------|
| License | BSD-3-Clause |
| Architecture | Chain-of-LoRA: **Planner → Grounder → Verifier → Answerer** |
| Models | 2B/7B video MLLMs; HF demo exists |
| Desktop fit | Too heavy to embed; viable as **optional remote specialist** later |

**Classification:** ARCHITECTURE_REFERENCE_ONLY for now; future ADAPT_WITH_WRAPPER as cloud tool behind Investigator if quality warrants.

**Missing vs OpenScreen Investigator:** learned temporal grounder/verifier LoRAs; multi-role chain. OpenScreen uses deterministic tools + 0 investigator LLM calls today — keep that cost model until measured need.

---

## LongVT findings

| Field | Finding |
|-------|---------|
| Repo name | agentic_longvideo; product name **LongVT** |
| License | Apache-2.0 |
| Architecture | Native tool-calling “think with long video”; custom `video_tools` / `visual_toolbox`; RL rewards |
| Desktop fit | Training/eval oriented; MCP server examples interesting |

**Classification:** ARCHITECTURE_REFERENCE_ONLY.

**Pattern:** native tool schemas for zoom/time crop; stop when answer confidence sufficient — refine Investigator tool contracts, don’t import verl.

---

## EGAgent findings

| Field | Finding |
|-------|---------|
| License | **CC BY-NC 4.0** — blocked |
| Architecture | Planner + visual search + transcript search + **entity graph** |
| Deps | SigLIP2 giant, LangGraph, heavy prep pipelines |
| Desktop fit | Offline graph construction unsuitable for consumer editor |

**Classification:** ARCHITECTURE_REFERENCE_ONLY (entity-graph memory concept for very long video — future research only).

---

## Reusable code/files/functions

### Tier A — implement in OpenScreen TS now (MIT patterns)

| Source | Files / symbols | Action |
|--------|-----------------|--------|
| watch-video | `dhash`, `hamming`, `dedupe`, `extract_frames`, `_prep_for_ocr`, `ocr_frames`, `write_timeline` | Clean-room port into `visualEvidence` / `visualSpecialist` |
| timecode-agent | `checkpoint_schema.STATUSES` / `validate_transition`; `verification.py` promotability; `keyframes.collect_candidates` + budget select; `ocr.ocr_scan` merge; `export.build_receipt` concept; `capture` reason stamps | Clean-room port into ledger/investigator provenance |

### Tier B — optional subprocess later (not milestone 1)

| Source | Boundary | Notes |
|--------|----------|-------|
| watch-video CLI | Isolated helper | Only if TS port lags; pin version; never on critical UI path without timeout |
| timecode-agent `va` | Isolated helper | Overkill vs OpenScreen stack; reject as default |

### Tier C — do not import

| Source | Reason |
|--------|--------|
| UI-Hawk, EGAgent, TimeLens2 | NC / academic license |
| VideoAgent, LongVideoAgent | No clear commercial license + GPU agent stacks |
| InternVideo3 SFT, LongVT train, VideoMind train | Training monorepos |
| Entire timecode-agent workspace | Wrong product surface (coding-agent CLI, not editor) |

---

## Architecture patterns worth adopting

1. **Transcript/signals first, pixels lazy** (timecode-agent) — OpenScreen already mostly here; formalize promotion gates.  
2. **Placement vs selection split** — deterministic candidates; agent/tools choose.  
3. **Master / Grounding / Vision roles** (LongVideoAgent, VideoMind) — map to Investigator + range tools + Visual Specialist without new LLM planners yet.  
4. **Perceptual keyframe dedupe + scene+periodic hybrid** (watch-video) — fill visualEvidence gap.  
5. **Verification levels / resolvable evidence refs** (timecode-agent) — strengthen `videoInvestigator/verify.ts`.  
6. **Tool interface isolation** (VideoAgent) — keep specialist backends swappable behind schemas.  
7. **Hard step budgets + force stop** (all agents) — already in Investigator V1; keep.

---

## Reuse map

| CAPABILITY | CURRENT OPENSCREEN | BEST EXTERNAL SOURCE | REUSE TYPE | EXPECTED BENEFIT | INTEGRATION COST | RISK |
|------------|--------------------|----------------------|------------|------------------|------------------|------|
| OCR | Vision Swift + `OcrEngine`; Case2 Restart works at source-res | watch-video tuned prep + tesseract fallback; timecode ocrmac scan | ADAPT_WITH_WRAPPER | Cross-platform + sharper digits | Low–Med | Low |
| Keyframe dedupe | Time-window dedupe only | watch-video dhash | ADAPT_WITH_WRAPPER | Fewer redundant frames/tokens | Low | Low |
| Adaptive sampling | Intent + change sampler | watch-video scene+periodic; timecode budgeted keyframes | ADAPT_WITH_WRAPPER | Better rare HUD catch | Med | Low |
| Evidence ledger | Temporal Event Ledger V1 | timecode checkpoints/verify | MERGE IDEAS | Stronger claim promotion | Med | Med (schema creep) |
| Temporal grounding | Investigator range tools; no learned grounder | VideoMind / TimeLens2 (patterns only) | ARCHITECTURE_REFERENCE | Future cloud tool | High | License/GPU |
| Investigator planning | Deterministic plan + budgets | LongVideoAgent / VideoAgent roles | ARCHITECTURE_REFERENCE | Clearer tool policy | Low | Low |
| Claim verification | `verify.ts` + groundedDiagnosis | timecode verification levels; VideoMind verifier role | MERGE IDEAS | Fewer false “verified” | Med | Low |
| Transcript fusion | speech + visual attach; briefing | watch-video `write_timeline` | ADAPT_WITH_WRAPPER | Better human/agent briefings | Low | Low |
| UI/screen understanding | ROI OCR + crops; no UI model | UI-Hawk tasks (NC) | ARCHITECTURE_REFERENCE | Task taxonomy only | — | License |
| Long-video memory | TEL + Evidence Store (turn-local) | timecode append-only + EGAgent graphs (NC) | MERGE IDEAS (timecode only) | Persistence across turns | Med–High | Med |

---

## Top 3 immediate integrations

1. **Port watch-video perceptual pipeline into visualEvidence / visualSpecialist (MIT, clean-room TS)**  
   - dhash dedupe, scene+periodic extract, OCR preprocess, optional tesseract engine behind `OcrEngine`.  
   - Highest measured overlap with Case2 ceiling (resolution + sampling + OCR).

2. **Merge timecode-agent verification/provenance into Ledger + Investigator (ideas only)**  
   - Promotable claims require resolvable visual and/or transcript support; capture `reason`; optional investigation receipt hash.  
   - **Keep** OpenScreen event taxonomy and deterministic builder.

3. **Adopt Multi-agent role policy as Investigator V1.1 design doc (no new models)**  
   - Explicit Grounding vs Vision specialist tool classes and stop conditions from LongVideoAgent/VideoMind — implemented as policy in existing deterministic planner, not LangGraph/RL.

*(Rejected as immediate: UI-Hawk weights, TimeLens2 service, InternVideo3, EGAgent graphs, vendoring full timecode-agent.)*

---

## What we should stop building ourselves

| Stop | Prefer |
|------|--------|
| DO NOT BUILD another OCR engine | Platform Vision + Tesseract adapters |
| DO NOT BUILD perceptual-hash/scene sampling from first principles beyond a thin port | watch-video algorithms |
| DO NOT BUILD a second evidence workspace / wiki / BM25 corpus | Extend TEL + Evidence Store |
| DO NOT BUILD a temporal-grounding foundation model in-app | Optional future cloud; license carefully |
| DO NOT BUILD multi-GPU tool servers / GRPO loops | Keep 0–few LLM investigator calls |
| DO NOT BUILD UI-Hawk-like MLLM | Taxonomy reference only |
| DO NOT CONTINUE greenfield Visual Specialist features that duplicate watch-video | Port then measure |

---

## What OpenScreen must continue owning

- Electron shell and packaging  
- AxcutDocument / timeline / Pixi render / undo  
- SOURCE_MEDIA_TIME / sourceTiming  
- mediaContextNeeds routing  
- Evidence normalization contracts (TEL types, epistemic states)  
- Provenance and verification contracts  
- Editor skills and edit execution  
- Provider routing and CURRENT_OPENSCREEN baselines  
- Benchmark harness and Case locks  
- Product UX / i18n / privacy (local media)

External code may only sit **under** these interfaces.

---

## Integration risks

| Risk | Mitigation |
|------|------------|
| License contamination (NC/academic) | Blocklist UI-Hawk, EGAgent, TimeLens2, unclear repos for copy |
| Python/uv runtime in Electron | Prefer TS ports; subprocess only with budgets/timeouts |
| Schema fork if ledger absorbs too much timecode | Additive fields; don’t rename epistemic enums lightly |
| Breaking CURRENT_OPENSCREEN baselines | Gate new sampling/OCR behind provider id + benchmark diffs |
| Over-trusting OCR as action | Keep “observed_visible_text ≠ action” |
| Shipping research GPUs | Never bundle InternVideo3/VideoMind weights in desktop |

---

## Recommended next milestone

**Milestone: Visual Evidence Acceleration via Reuse (no architecture rewrite)**

1. Freeze Visual Specialist feature expansion from scratch.  
2. Implement TS ports: `dhash` dedupe + scene/periodic candidates + OCR preprocess + `tesseract` `OcrEngine` fallback.  
3. Wire into existing specialist budgets; re-run Case2 + CURRENT_OPENSCREEN.  
4. Add ledger/investigator “promotable claim” checks inspired by timecode `verification.py`.  
5. Write short Investigator V1.1 policy note (Grounding vs Vision tools) — no new LLM planner.  
6. Explicitly defer: VideoMind/TimeLens2 services, EDL receipts, entity graphs.

**Exit criterion:** Case2 Restart remains recognized; redundant frame count drops; Windows/Linux OCR path non-empty; no new Python dependency required for default macOS path.

---

## Final architecture (after reuse — additive only)

```
OPENSCREEN CORE
  timeline / render / editing / undo / AxcutDocument
        ↑
VIDEO COGNITION (owned)
  Master Video Investigator V1 (+ V1.1 role policy)
  Temporal Event Ledger + Video Evidence Store
  mediaContextNeeds · sourceTiming · Source Story · benchmarks
        ↑
REUSED / ADAPTED MODULES (behind OpenScreen interfaces)
  visualEvidence sampler + dhash/scene (← watch-video algos)
  visualSpecialist OCR (Vision + tesseract + tuned prep)
  claim promotion / capture provenance (← timecode ideas)
  (future optional) remote grounder/verifier service
        ↑
RAW VIDEO / AUDIO / CURSOR
```

Do **not** insert LangGraph, verl, InternVideo training, or timecode workspaces into this stack.

---

## GO / NO-GO on Visual Evidence Specialist V1 from scratch

### **NO-GO**

Continue owning the **OpenScreen Visual Specialist interface and Case2-proven Vision OCR path**, but **stop greenfield expansion**. Next work is **reuse-driven acceleration** (watch-video algorithms + timecode provenance ideas) measured against locked baselines.

---

*Audit complete. No production code was copied or merged in this step.*
