# OpenScreen AI Video Editor — Technical Audit

**Date:** 2026-09-09  
**Scope:** Diagnosis only (no code changes)  
**Authority:** Repository code + configs. `NOT IMPLEMENTED` / `UNKNOWN` used where evidence is absent.  
**Product framing:** Desktop Electron app (not a cloud multi-tenant SaaS). “Backend” = Electron main process + native helpers + Rust compositor.

---

### 1. Executive verdict

OpenScreen is a **real non-destructive timeline editor** with a **validated 34-tool AI agent** that mutates `AxcutDocument` and shares preview/export via a native compositor. It is **not** yet a true multimodal “understand the pixels” editor for cloud models.

Cloud AI receives **text JSON** (document snapshot / `mediaContext` / optional transcript & cursor tools). **Frame→LLM vision for Anthropic/OpenAI/Gemini is NOT IMPLEMENTED.** Local CLI agents may run ffmpeg stills only when watch permission grants media folders.

Intelligence today is strongest on: **silence trims (via transcript gaps + `addTrims`), cursor-guided zooms, captions (Whisper when binary present), aspect/background, graphics overlays.** Weakest on: **semantic UI (“clicked Publish”), OCR/scene detection, quality enhancement, post-edit visual verification.**

Whisper STT is **architected** but often **unavailable in local/dev** if `whisper-stt-server` was never built (`scripts/build-whisper-stt.sh`). Preview fails open as blank wallpaper when `compositor_view.node` is missing.

**Largest latency driver (code):** unbounded agent tool loops (`recursionLimit: 1000`) + optional local-CLI ffmpeg watching (minutes) + on-device Whisper + full export encode — **not** a Redis/job queue (there is none).

**Largest intelligence gap:** no persistent visual understanding; “professionalize” is prompt heuristics over metadata/tools, not a verified multimodal pipeline.

**Most dangerous before adding more AI:** claiming/vision-prompting that the model “sees” video when cloud path cannot — plus missing compositor/STT binaries that silently degrade UX.

---

### 2. Architecture diagram

```
[HUD / LaunchWindow]  --record-->  [Native helper SCK/WGC/PipeWire]
        |                              | writes MP4 + .cursor.json + session
        v                              v
[Editor NewEditorShell] <--import-- [userData/recordings + projects/*.openscreen]
        |
        |  Zustand projectStore (AxcutDocument v7)
        |
        +-- Preview: sceneDescription --> compositor_view.node (Metal/D3D11/Vulkan)
        +-- Export:  same scene --> exportMulti / GIF
        +-- STT:     whisper-stt-server (optional) --> transcripts[]
        |
        +-- Chat LeftPanel --> IPC aiEdition.chatRun
                --> chat-service.runChat (checkpoint + history)
                --> invokeOpenScreenAgent (LangChain createAgent)
                --> executeAgentTool (Zod) --> mutated AxcutDocument
                --> applyAgentDocumentIfCurrent --> saveDocument
```

**Not present:** HTTP API server, Redis, SQS/Bull queues, Postgres/Mongo, Remotion, S3 (desktop local files only).

---

### 3. Current capability matrix

| Capability | Status | Notes |
|---|---|---|
| Record screen/window | Implemented | Native helpers |
| Non-destructive timeline | Implemented | `AxcutDocument` |
| AI tool edits | Implemented | 34 tools |
| Cloud multimodal frames | NOT IMPLEMENTED | Text tools only |
| Local CLI “watch” stills | Partial | Claude `--add-dir` + ffmpeg when permitted |
| Whisper captions | Partial | Needs built binary |
| Cursor telemetry | Implemented | `.cursor.json` ~30 Hz |
| Semantic “Publish button” | NOT IMPLEMENTED | Cursor coords only |
| OCR / scene detect / embeddings | NOT IMPLEMENTED | |
| Post-edit visual verify | NOT IMPLEMENTED | Tool JSON honesty only |
| Job queue / cancel AI turn | NOT IMPLEMENTED | No AbortSignal on cloud path |
| Durable chat checkpoints | Partial | Messages may persist; checkpoints in-memory |

---

### 4. Video-understanding pipeline

**What exists**

1. **Capture metadata:** duration via HTML `<video>` probe (`src/lib/ai-edition/timeline/duration.ts`); size via `fs.stat`; width/height via video element; **fps often left `0`, codec `"unknown"`** at import (`useTimeline.ts`).
2. **Cursor sidecar:** `*.cursor.json` (`electron/media/cursorSidecar.ts`, contracts in `src/native/contracts.ts`).
3. **Transcript:** Whisper → word segments → `transcripts[]` (`electron/stt/`, `document/transcribe.ts`).
4. **UI silence gaps:** synthetic silence tokens ≥0.2s in transcript pane (`aggregated-transcript.ts`) — not a separate audio VAD product.
5. **`mediaContext`:** text outline of kept spans / speech / notes (`src/lib/ai-edition/document/mediaContext.ts`) — **not pixels**.
6. **Filmstrip:** seek frames into timeline UI cells (`clipFilmstrip.ts`) — **not** sent to LLM.

**What does not exist**

- Scene/change detection, OCR, face/object detection, embeddings/vector DB, indexed screenshots for AI, cloud frame upload pipeline.

---

### 5. AI editing pipeline

**Path:**  
`LeftPanel.send` → `runAgentTurn` (`agentDocumentApply.ts`) → `nativeBridgeClient.aiEdition.chatRun` → `electron/.../aiEditionService.ts` → `runChat` (`chat-service.ts`) → `invokeOpenScreenAgent` (`deep-agent/service.ts`) → tools in `agent-tools.ts` → document returned → `applyAgentDocumentIfCurrent` → `saveDocument`.

**Providers** (`provider-registry.ts`): anthropic, openai, google, mistral, openrouter, minimax, minimax-token-plan, openai-compatible, **local-cli**. Keys in `llm-credentials.enc` (`safeStorage`).

**System prompt:** `BASE_SYSTEM_PROMPT` in `electron/ai-edition/deep-agent/service.ts` (promotes one-pass professionalize heuristics; forbids inventing transitions/TTS/EQ/links).

**Tools (34):** see §9 below.

**Verification:** tool result JSON + optional `getCurrentDocument`; **no** frame-diff / export QA loop.

---

### 6. Timeline/render pipeline

**SSOT:** `AxcutDocument` schema v7 — `src/lib/ai-edition/schema/index.ts`.

**Time bases:** clips/trims = **source** seconds; zooms/speed/annotations/camera/audio = **virtual** (edited) seconds — documented in system prompt and tools.

**Preview:** `NativeCompositorOverlay.tsx` + `buildSceneDescription` (`src/native/sceneDescription.ts`) + N-API `compositor_view.node`. Missing addon → **no-op blank canvas** (wallpaper/empty), logged as `native addon not present`.

**Export:** same scene → `exportMulti` (MP4 H.264/H.265); GIF path separate. GPU backends Metal/D3D11/Vulkan with CPU fallback.

**Edits are non-destructive:** instructions live in JSON; media files not rewritten per trim/zoom.

---

### 7. Latency findings

| Stage | Evidence | Timing |
|---|---|---|
| Chat IPC | In-process Electron | Typically ms — **UNKNOWN** exact (no structured span logs) |
| Agent loop | `recursionLimit: 1000` (`service.ts`) | Can be many tool rounds — **no AbortSignal** |
| Local CLI watch | 10 min hard / 6 min idle timeouts (`local-cli-chat-model.ts`) | Minutes possible |
| Whisper | Chunked on-device STT | Seconds–minutes; blocks if binary missing (error) |
| Preview | Pull RGBA from compositor | Near-real-time when addon present |
| Export | Full GPU encode | Seconds–minutes by length/resolution |

**No Redis/worker timing.** Top code-level latency risks: **local-CLI ffmpeg stills**, **Whisper**, **long tool loops**, **export**, not “upload to S3.”

---

### 8. Intelligence/quality findings

- **Cursor-driven zoom** can be high quality when sidecar exists (`getCursorTrack` + `cursorAnchor` on `addZoom`).
- **“Clicked Publish”** cannot be resolved to a labeled UI control — **NOT IMPLEMENTED** (coords/shape only; clicks often collapsed).
- **Professionalize** = prompt playbook (trims, zooms, captions, aspect, graphics) — quality depends on model + available data, not a measured rubric in production.
- **Quality enhance** (denoise/upscale/stabilize): **NOT IMPLEMENTED** as tools (prompt says say so).

---

### 9. Validation/verification gaps

**Present:** Zod arg schemas; `coversNoClip` refuse; clamp overhanging spans; revision conflict on apply; consent gate.

**Absent:** post-edit pixel verification; automatic GC of all dead effects after duration shrink beyond tool landing; cloud vision confirm zoom landed on intended control; cancel in-flight agent.

**Off-timeline effects:** new agent writes that cover no clip are **refused**; partial overhang **clamped**. Effects past end can still exist if created when timeline was longer, or via non-agent paths — **partial risk**; example `16.35–17.80` with end `16.35` is consistent with **duration shrink after placement** or UI path without same clamps — investigate per project JSON (**case-specific**).

---

### 10. Technical debt / duplicated architecture

- Docs still mention “21 tools” / auto-compaction (`ai-agent.md`) while code has **34 tools** and **manual** compaction.
- Phantom filesystem tools historically caused false “no cursor” answers (`PHANTOM_TOOL_NAMES` comment in `agent-tools.ts`).
- `legacyEditor` passthrough bag for appearance vs first-class schema fields.
- Dual CLI surfaces: rich in-app tools vs narrower headless Way-1 JSON ops.
- Removed server/Python worker (decision ledger) — good, but leftover mental models in older docs.

---

## Detailed answers (sections 1–50)

### 1. Current architecture

See diagram §2. Stages:

| Stage | Frontend | Main/native | Storage | External |
|---|---|---|---|---|
| Record | `LaunchWindow`, `useScreenRecorder` | helpers under `electron/native/` | `userData/recordings/` | OS capture APIs |
| Project | `recordingImport.ts`, `projectStore` | `document-service.ts` | `userData/projects/*.openscreen` | — |
| Analyze | transcriptionStore | `electron/stt/` | transcripts in document | Whisper model download |
| AI prompt | `LeftPanel.tsx` | `chat-service`, `deep-agent` | chat-sessions (messages); checkpoints RAM | LLM APIs or local CLI |
| Timeline | V4 timeline, panes | — | same document | — |
| Preview | `NativeCompositorOverlay` | `compositorViewService` | — | — |
| Export | `ExportDialog` | `exportMulti` | user-chosen path | — |

**Queues/DB/websockets:** NOT IMPLEMENTED (desktop IPC only).

---

### 2. Video ingestion

- **Formats:** primarily native-captured **MP4**; imports via file picker (UI) — exact allowlist **UNKNOWN** without reading every picker filter; schema is generic video asset + path.
- **Max size/duration:** NOT IMPLEMENTED as hard product limits in DocumentService (cursor sidecar has 1h sample cap comments in handlers).
- **Storage:** `~/Library/Application Support/openscreen/recordings/` (macOS) via `RECORDINGS_DIR`.
- **Proxy videos:** NOT IMPLEMENTED (explicitly rejected in `decisions.md`).
- **Thumbnails:** filmstrip seek in UI; not persisted proxy files.
- **Metadata:** HTML media element duration/dimensions; **not** ffprobe on default import (`document-service` comment). CLI may use ffprobe (`agentWrapper.ts`).
- **FFmpeg:** used for peaks, STT extract, local-CLI stills, packaging — not mandatory for basic import probe.
- **Transcode on ingest:** NO (helper already encodes).
- **UI blocking:** record is async; import is light; STT queued in background store.

---

### 3. Information per video/project

| Field | Status | Where |
|---|---|---|
| Source duration | Implemented | `assets[].durationSec` |
| Edited duration | Derived | clips − trims (computed) |
| Clip boundaries | Implemented | `timeline.clips` |
| Source in/out | Implemented | clip `sourceStartSec`/`sourceEndSec` |
| FPS | Partial | often `0` at import |
| Dimensions | Partial | filled by renderer probe |
| Aspect ratio | Implemented | settings / `setAspectRatio` |
| Audio metadata | Partial | peaks cache; limited codec fields |
| Cursor coordinates | Implemented | `.cursor.json` |
| Clicks | Partial | `interactionType`; flattened in places |
| Keyboard / scroll / hover / drag | NOT IMPLEMENTED | |
| Active app/window | NOT IMPLEMENTED in sidecar | capture source chosen at record time only |
| DOM/browser a11y | NOT IMPLEMENTED | |
| Webcam track | Implemented | `cameraTrack` / sidecar files |
| Mic / system audio | Partial | in capture request / muxed into MP4 |
| Scene boundaries | NOT IMPLEMENTED | |
| Transcript + word times | Implemented when STT works | `transcripts[]` |
| Visual descriptions / OCR / faces / objects / motion embeddings | NOT IMPLEMENTED | |
| Silence | Partial | UI gaps + agent trims; not STT silence segments |
| Keyframes/screenshots for AI | NOT IMPLEMENTED | filmstrip UI only |
| Zooms/crops/annotations/captions/audio overlays | Implemented | document fields |
| Masks/blurs | Partial | annotation type `blur` |

---

### 4. Cursor/mouse intelligence

- **Captured during recording:** YES — editable-overlay / system cursor modes.
- **Rate:** `CURSOR_SAMPLE_INTERVAL_MS = 33` (~30 Hz) — `electron/ipc/handlers.ts`.
- **Coords:** normalized **0–1** frame fractions (`cx`,`cy`); Windows DIP→physical via `helperCoordinates.ts`.
- **Clicks:** optional `interactionType`; renderer read path may drop click kinds; docs note double/right/middle flattened to move upstream.
- **Scroll/hover/drag/keyboard:** NOT IMPLEMENTED as first-class events.
- **After crop/zoom:** focus/cursor remain 0–1 of **frame**; crop is separate `cropRegion`; agent reports `cursorAnchor` vs focus.
- **Persistence:** sidecar next to MP4; not inside `.openscreen` JSON.
- **Sync:** `timeMs` on recording clock → `virtualSec` via clip/trim mapping (`cursor-track.ts`). Drift possible if clocks diverge — mitigated by same-session capture; **UNKNOWN** measured drift stats.

---

### 5. Actual visual understanding

**Cloud agent path: does NOT inspect frames.**

- No OpenScreen pipeline extracts JPEG/PNG and attaches them to Anthropic/OpenAI/Gemini chat requests.
- System prompt instructs: use `mediaContext`; **do not extract ffmpeg stills** unless user asks; never claim blindness if `visibleMedia` non-empty — this **simulates** seeing via metadata.
- **Local-cli:** may shell ffmpeg + Read on media dirs when watch granted — opportunistic, not a fixed FPS sampler with indexed frames.

Scene-based sampling / dedupe / OCR / UI detection: **NOT IMPLEMENTED**.

---

### 6. Multimodal AI providers

| Provider | Models | Modality in OpenScreen chat | Purpose |
|---|---|---|---|
| Anthropic / OpenAI / Google / Mistral / OpenRouter / MiniMax / openai-compatible | User-selected from registry discovery | **Text** (+ tools) | Chat edits |
| local-cli (Claude Code, Codex, Cursor Agent, Gemini CLI) | CLI binary | Text; optional self-extracted stills | Chat edits |
| Ollama / LM Studio HTTP | Listed models | Text OpenAI-compatible | Chat |
| Whisper.cpp `ggml-small-q8_0` | Local binary | Audio → text | Captions |
| Caption translate | Same LLM as config | Text JSON batches | Translation |

Timeouts: local-cli hard 10m / idle 6m. Cloud: **UNKNOWN** explicit timeout (recursionLimit only). Retries: not a unified product retry layer — **UNKNOWN** per SDK defaults.

---

### 7. AI prompt architecture

| Prompt | Path | Output |
|---|---|---|
| `BASE_SYSTEM_PROMPT` + open project JSON | `deep-agent/service.ts` | Tools + free text |
| `CONSENT_PROMPT_BLOCK` | same | When edits disabled |
| Local CLI wrapper prompt | `local-cli-chat-model.ts` | JSON `message` / `tool_calls` |
| Caption translate system | `caption-translate.ts` | JSON map segment→text |

Validation: Zod on tool args; caption JSON parse; invalid tool → error payload to model (can retry in-loop). Free text always allowed for final answer.

**Specialized agents:** one primary chat agent + separate translate one-shot. Workbench scenarios (`wizard-enhance`) are **evals**, not separate production agents.

---

### 8. How commands are understood

**Shared path:** LeftPanel → `chatRun` → `runChat` → tools.

| Command | Expected tools | Failure modes |
|---|---|---|
| “Make professional” | `getCurrentDocument`, `addTrims`, `addZoom(s)`, `generateCaptions`, `setAspectRatio`, `addGraphic`, … | No STT → weak silence/caption; no cursor → weaker zooms; no vision → no UI semantics |
| “Delete 10.2–13.5” | `addTrim` / `setClipRange` (source vs virtual confusion risk) | Wrong time base; wrong clipId if multi-clip |
| “Zoom when I click Publish” | `getCursorTrack` + `addZoom` near click | **Cannot identify “Publish”** without OCR/vision; may zoom on click coords only |

---

### 9. AI tool/function system

**Complete vocabulary:** `OPENSCREEN_TOOL_NAMES` in `agent-tools.ts` (34):  
getCurrentDocument, getTranscript, getTranscriptWords, getCursorTrack, setWordText, addTrim(s), setTrim, setClipRange, addClip, setClipCrop, moveClip, replaceTimeline, addZoom(s), setZoom, addSpeed, setSpeed, addAnnotation, addGraphic, setAnnotation, addCameraFullscreen, setCameraFullscreen, addAudio, setAudio, removeTrim, removeModifier, removeClip, setAspectRatio, setBackground, listSources, recordScreen, generateCaptions, exportProject.

| Action family | Schema | Executor | Undo | Preview | Render |
|---|---|---|---|---|---|
| Trims/clips/zooms/speed/ann/graphics/audio/aspect/bg | Zod in agent-tools | `executeAgentTool` | Whole-turn checkpoint rewind + editor undo stack | Compositor | Same |
| Denoise/stabilize/upscale/transitions/TTS | — | NOT IMPLEMENTED | — | — | — |
| Import disk / delete asset | Prompt says none | NOT IMPLEMENTED | — | — | — |

---

### 10. Timeline model

- Contiguous clips (no gaps/overlap by invariant — `decisions.md`).
- Tracks: primary video clips + audioTracks + modifier collections (not NLE track rows for all effects).
- Trims inside clips; modifiers clip-anchored ms.
- Undo: `undoStack.ts` MAX 50; AI rewind via `rewindToMessage`.
- Versioning: `schemaVersion` 7 migrations; no multi-branch project versions.

---

### 11. Non-destructive editing

**YES.** Source MP4 unchanged; `.openscreen` holds instructions; preview/export evaluate scene from document.

---

### 12. Preview architecture

Native compositor pull frames (not Remotion/CSS-only). AI edits update document → scene rebuild → near-instant when addon present. **No full re-encode for preview.** Missing addon → blank. Filmstrip seeks are separate UI.

---

### 13. Export/render architecture

`exportMulti` via Rust compositor (demux→decode→composite→encode→mux). GIF alternate path. Progress via IPC. Hardware encode where available; Linux often software. Bottlenecks: encode length, resolution, effects complexity, missing HW encoder.

---

### 14. Speech-to-text

- **Intended:** local whisper.cpp server `whisper-stt-server`, model `ggml-small-q8_0.bin`.
- **Why unavailable:** binary not in `electron/native/bin/<platform>/` until `scripts/build-whisper-stt.sh` — **dev/packaging gap**, not “Whisper deleted.”
- Failure throws; caption generation fails; **does not** block timeline editing.
- Word-level timestamps: YES (DTW). Diarization: NOT IMPLEMENTED. Language detection: UNKNOWN beyond whisper defaults.

---

### 15. Audio understanding

Peaks/waveforms + gain: YES. Silence as UI gaps: partial. Filler lexicon: NOT IMPLEMENTED. Breaths/music/clipping/loudness LUFS: NOT IMPLEMENTED as product features.

---

### 16. Scene/change detection

**NOT IMPLEMENTED.**

---

### 17. UI understanding

**Cannot** map click → “Publish button.” Uses cursor telemetry (± optional local stills). No a11y tree / DOM / OCR pipeline.

---

### 18. Persistent video intelligence

Persisted: document, transcripts, cursor sidecar, `mediaContext` regenerated on open.  
**Not** persisted: frame embeddings, OCR index, multimodal summaries.  
Second prompt: reuses document + chat history (≤20 msgs); may re-call tools; does **not** re-Whisper unless captions regenerates.

---

### 19. Embeddings/search

**NOT IMPLEMENTED.**

---

### 20. Context per prompt

- System prompt + full `documentSnapshotForModel` JSON (`mediaContext`, assets, clips, trims, zooms, …).
- Last ≤20 chat messages.
- Transcript/cursor **on demand** via tools (can be huge if `getTranscript` uncapped).
- No screenshot batch for cloud.
- Risk: large transcripts + many tool results inflate latency/cost.

---

### 21. Re-analysis per prompt

Typically **does not** re-transcribe or re-probe video every chat turn. **Does** rebuild agent, resend snapshot, may re-read cursor file N times per zoom pass. Local-cli may re-ffmpeg if model chooses. Export only on `exportProject`.

---

### 22. Latency breakdown

No unified OpenTelemetry spans. Best evidence: local-cli timeouts, Whisper chunk logs, export progress. Invented ms tables would be dishonest → **UNKNOWN** for precise splits.

---

### 23. Parallel vs sequential

Sequential today: STT chunks (by design), agent tool loop steps, local-cli single spawn. Could parallelize (not doing now): multi-asset probes, peak extraction vs STT, independent trim computation vs caption gen.

---

### 24. Caching

- Audio peaks disk cache (`userData/audio-peaks`).
- Local agent scan cache in memory.
- STT model download once.
- Chat message persistence.
- **No** frame/embedding/LLM response cache.

---

### 25. Job/queue architecture

**NOT IMPLEMENTED** as Redis/workers. STT has in-process queue; transcriptionStore queues UI jobs. Agent cancel: **NOT IMPLEMENTED**. Export progress: yes; cancel: limited/unknown per UI.

---

### 26. Database/project persistence

**No SQL DB.** Filesystem JSON: projects, recordings, llm-config, credentials, chat-sessions, peaks, stt-models. Zustand in-memory + undo stacks. Electron `userData`.

---

### 27. AI edit safety

Zod + landing/clamp + consent + revision apply. Gaps: long uncapped transcripts; recursionLimit 1000; model can still place many blurs if they **land on clips**; duration shrink may leave stale modifiers until cleaned — **partial**.

---

### 28. Dead/off-timeline effects

New agent spans covering no clip → `coversNoClip` refuse. Clamped if partial. Dead effects after duration change: **possible**; auto GC of all modifiers: **NOT fully proven** as comprehensive GC — treat as **validation gap**.

---

### 29. Coordinate systems

Source pixels → normalized 0–1 focus/cursor; cropRegion 0–1; preview vs export share scene description; DPR handled in capture helpers. Functions: `focusUtils.ts`, `zoomMath`, `sceneDescription`, `helperCoordinates.ts`.

---

### 30. Smart zoom

Agent chooses times via tools + cursor track; depth ordinal 1–6; focus 0–1; `addZooms` batch; cursorAnchor feedback; collision/clamp via landing. **Not** visual-semantic button detection. Quality: good for cursor-follow demos; weak for “important UI without cursor.”

---

### 31. Animation system

`textAnimation` presets on annotations; `addGraphic` presets (title, lower third, CTA, arrow, blur, image). AI picks times via virtual seconds; position fields on annotations. No general motion-path engine as first-class tool beyond these.

---

### 32. Reframing

`setAspectRatio` + `setClipCrop` + zooms. Dynamic face/object tracking crop: **NOT IMPLEMENTED**. Cursor/zoom can approximate “follow action.”

---

### 33. Quality enhancement

Denoise/sharpen/upscale/stabilize/studio sound: **NOT IMPLEMENTED** as tools. Prompt forbids inventing them.

---

### 34. Auto-edit / professional

Prompt “One-pass finish” playbook in `BASE_SYSTEM_PROMPT`. Workbench `wizard-enhance` scenarios evaluate behavior. Not a separate deterministic rules engine with QA.

---

### 35. Execution vs suggestion

| Capability | Class |
|---|---|
| Trim/silence/zoom/speed/ann/graphic/crop/aspect/bg/audio overlay/captions text | AI can execute |
| generateCaptions/export/record (CLI tools) | Execute if CLI engine + binaries |
| Denoise/upscale/transitions/TTS/brand kit | Not implemented (must say so) |
| Semantic UI zoom | Suggest/approximate via cursor only |
| Import from disk via AI | Cannot (tool missing) |

---

### 36–37. Verification / self-correction

No visual verification loop. Model may call `getCurrentDocument` after edits (prompted). Failed Zod → tool error → model can retry within recursion limit. No dedicated verify-render agent.

---

### 38. Undo / history

Pre-turn document checkpoint + rewind UI; editor undo stack for applied docs. Prompt/plan not stored as first-class audit objects beyond chat messages. Checkpoints **not durable** across restart.

---

### 39–40. Errors / fallbacks

Silent/degraded: missing compositor (blank preview); missing Whisper (captions fail); cursor unavailable; local-cli timeout messages. Provider failure: chat errors to UI — **no automatic cross-provider failover** proven. STT fail does not erase timeline.

---

### 41–42. Duplication / loops

Single agent per turn (not OpenAI→Claude→Gemini chain). Local-cli is alternate transport. Loop: LangChain agent up to recursionLimit 1000 — **risk of long loops**.

---

### 43. Network/storage overhead

Cloud: prompt+JSON tools to provider (no video upload by OpenScreen). Local: optional ffmpeg temp stills. Peaks cache on disk. No S3 in architecture.

---

### 44. Dev vs production

Dev: Electron.app branding/TCC issues; must build native bin (helper, compositor, whisper). Production packaged app ships binaries. Same document/agent architecture.

---

### 45. Tests

Strong: `agent-tools.test.ts`, deep-agent service tests, schema tests, cursor-track, workbench scenarios (often **not CI-enforced**). E2E Playwright limited for real capture/AI quality. Pass/fail of full suite: **UNKNOWN** in this audit run (targeted tests previously green).

---

### 46. TODO/FIXME (AI/media relevant)

Search shows architectural comments (phantom tools, consent gaps, addon absence). Exhaustive TODO dump: **partial** — many are historical comments rather than open tickets.

---

### 47. Leftover architectures

Pre-merge VideoEditor; browser exporter removed; React Query for agent never adopted; proxy files rejected; OAuth providers removed 1.8.0.

---

### 48. Security/cost

Keys in OS safeStorage; env overrides; BYOK (user pays providers); local Whisper ungated; no app-side token budget UI beyond context % badge; agent recursion high.

---

### 49. Architectural truths

| # | Answer |
|---|---|
| A | Primarily **LLM on timeline/cursor/transcript metadata**; true multimodal cloud editor **no** |
| B | **No** (cloud); local-cli only optionally |
| C | **No** semantic UI binding |
| D | **No** full re-Whisper/re-probe each prompt; **yes** resend snapshot + tool calls |
| E | **Partial** (`mediaContext` + transcript + cursor files) — not visual semantic index |
| F | **Yes** structured Zod tools |
| G | **No** rendered visual verification |
| H | Long agent/local-cli/Whisper/export — **not** queue backlog |
| I | Lack of genuine visual/UI understanding |
| J | Honesty gap (prompt claims seeing) + native binary gaps (compositor/STT) before more AI features |

---

### 50. Top 10 issues + first fix

| Rank | Issue | Sev | User | Latency | Quality | Diff | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Cloud path has no real vision; prompt implies seeing | High | High | Med | High | High | `service.ts` prompt; no image in `chat-model.ts` |
| 2 | Missing compositor → blank preview | High | High | — | High | Med | `compositorViewService` no-op |
| 3 | Missing Whisper binary → no captions/silence AI | High | High | — | High | Med | `whisperServer.ts` throw |
| 4 | recursionLimit 1000 / no abort | High | Med | High | Med | Med | `service.ts` |
| 5 | Cannot resolve click→UI control | High | High | — | High | High | no OCR/a11y |
| 6 | Uncapped transcript to model | Med | Med | High | Med | Low | `getTranscript` docs |
| 7 | Checkpoints not durable | Med | Med | — | Med | Med | chat-service Maps |
| 8 | Local-cli trust/watch friction | Med | Med | High | Med | Low | local-agents / timeouts |
| 9 | Stale modifiers after duration shrink | Med | Med | — | Med | Med | clamp on write only |
| 10 | Doc/tool-count drift | Low | Low | — | Low | Low | ai-agent.md |

### Recommended FIRST fix (before more AI features)

**Ensure native preview compositor is present and hard-fail visibly if missing** (and/or ship whisper binary in the same “native payload complete” gate).

**Why first:** Without compositor, users conclude “AI/recording is blank” even when MP4 is fine — blocks all evaluation of AI edits. Measurable, isolated, high user impact, low risk to agent logic. Vision/UI understanding is larger and should come after the editor can show truth.

**Files:** `electron/native-bridge/services/compositorViewService.ts`, `scripts/build-macos-compositor-addon.mjs`, packaging `extraResources`, `NativeCompositorOverlay.tsx` (user-visible error), CI payload checks in build docs.

**Objective test:** With addon present, open known recording → preview shows non-wallpaper content (frame probe / screenshot). With addon removed, UI shows explicit error (not silent wallpaper). Logs must not say `running as no-op` in the happy path.

---

### Exact files for that first fix

- `electron/native-bridge/services/compositorViewService.ts`
- `src/components/ai-edition/NativeCompositorOverlay.tsx`
- `src/native/hooks/useNativeCompositorView.ts`
- `scripts/build-macos-compositor-addon.mjs` (+ win/linux twins)
- `electron-builder.json5` / packaging hooks
- `technical-documentation/engineering/build-and-packaging.md`

### How to test the fix

1. Delete/rename `compositor_view.node` → expect **blocking error UI**, not blank wallpaper.  
2. Restore built addon → open `recording-*.mp4` project → preview matches ffprobe-extracted mid-frame content.  
3. Unit: existing `useNativeCompositorView.test.ts` expectations updated for fail-loud behavior.  
4. Manual: record 10s → editor shows desktop, not only Background image.

---

*End of audit. No production code was modified for this document.*
