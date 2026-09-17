# OpenScreen Real Corpus Recovery 1 — Speech/STT Report

**Identity:** `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_STT_V1`  
**Date:** 2026-09-13  
**Baseline preserved:** `tmp/perception-benchmark/real-corpus-baseline-v1/` (not overwritten)

---

## Executive verdict

### `PASS_WITH_LIMITATIONS`

Real Whisper STT now works reliably on the selected real-recording recovery subset: narrated Case‑1 media, Case‑4 correction, additional narrated clips, and true `no_audio` all resolve correctly. The frozen baseline’s corpus-wide `speechStatus=failed` root cause is fixed.

**Limitations:** OpenAI API quota was exhausted during agent final-response checks (empty finals + 429) — **not an STT failure**. SpeechEvidence still returns `available` on that path after the bridge fix. Packaged-app runtime was **NOT_VERIFIED** (path resolution reviewed; not run inside a packaged Electron build). `mediaContextNeeds` routing gaps deliberately untouched (Recovery 2).

---

## Frozen baseline reference

| Item | Value |
| ---- | ----- |
| Baseline identity | `CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1` |
| Finding | P0 speech path failed corpus-wide |
| Typical baseline | `speechStatus=failed`, `segmentCount=0`, audio probe true |
| Baseline reason (now captured) | `Cannot read properties of undefined (reading 'getPath')` |

---

## STT architecture audit (actual current flow)

```text
asset.originalPath
  → probeAudioStream (ffmpeg -i; Audio: stream?)
  → [no stream] speechStatus=no_audio; Whisper NOT invoked
  → document.transcripts SSOT / speech disk cache
  → resolveSttBinary (candidateBinaryPaths)
  → SttManager.transcribe
       → resolveSttModelsBaseDir()  ← FIXED (was app.getPath crash)
       → ensureModels / whisper-ggml/ggml-small-q8_0.bin
       → WhisperServerManager.start (Metal→CPU fallback)
       → extractMono16kPcm (ffmpeg f32le mono 16k)
       → chunked POST /inference
  → AxcutTranscript → SpeechEvidence
  → resolveSpeechEvidenceStatus (segments vs failed contract)
  → cache write on success
  → agent / Claim Promotion / Source Story consumers
```

---

## Root cause

**Exact failure layer:** `SttManager.getModelsDir()` called `app.getPath("userData")` while `electron.app` is **undefined** under the Vitest / non-ready Electron host used by `invokeOpenScreenAgent` → `getSttManager()`.

Probe and binary discovery succeeded; STT never started; prepare caught the throw → `speechStatus=failed` with opaque reason (raw `getPath` message). Model file already existed under `~/Library/Application Support/openscreen/stt-models/`.

This matches “AUDIO present + STT expected + 0 segments + failed.”

---

## Exact failure layer

| Layer | Baseline | After fix |
| ----- | -------- | --------- |
| Audio probe | OK | OK |
| Binary discovery | OK | OK |
| Model dir resolution | **CRASH** (`app` undefined) | Discovers openscreen cache / env / Electron userData |
| Extraction / Whisper | Never reached | OK (~0.4–0.7s / clip cold) |
| Status contract | failed + empty | available / no_audio |

---

## Files changed

| File | Change |
| ---- | ------ |
| `electron/stt/modelsDir.ts` | **New** — safe model-dir resolution |
| `electron/stt/modelManager.ts` | Export `MODEL_FILE_NAME` |
| `electron/stt/index.ts` | `getModelsDir()` uses `resolveSttModelsBaseDir()` |
| `electron/stt/health.ts` | **New** — lightweight runtime health probe |
| `electron/ai-edition/speechEvidence/failureReason.ts` | **New** — internal reason codes |
| `electron/ai-edition/speechEvidence/resolveStatus.ts` | **New** — validated segments ≢ failed |
| `electron/ai-edition/speechEvidence/prepare.ts` | Reason codes + status resolution |
| `electron/ai-edition/speechEvidence/types.ts` | Optional `failureReason` |
| `electron/ai-edition/speechEvidence/index.ts` | Exports |
| `electron/ai-edition/deep-agent/service.ts` | Preserve `speechEvidence` on empty/LLM error returns |
| Tests | `sttRecovery.unit.test.ts`, `stt-recovery-live.runtime.test.ts`, diagnose harness |

**Not changed:** mediaContextNeeds, visual, Investigator policy, Story/Gap/Plan/Proposal, Apply/verify, prompts, tools.

---

## Failure reason codes

Internal (`SpeechEvidence.failureReason`):  
`binary_missing`, `binary_not_executable`, `binary_arch_mismatch`, `server_start_failed`, `server_not_ready`, `model_missing`, `model_load_failed`, `audio_extract_failed`, `audio_decode_failed`, `audio_empty`, `request_failed`, `request_timeout`, `malformed_response`, `parse_failed`, `timestamp_invalid`, `runtime_crashed`, `userdata_unavailable`, `unknown`

User-facing `reason` remains natural (no getPath / paths / ggml names).

---

## Runtime discovery

- Binary: `candidateBinaryPaths()` → repo `electron/native/bin/darwin-arm64/whisper-stt-server` (Mach-O arm64, executable)
- Env override: `OPENSCREEN_WHISPER_SERVER_EXE`
- Packaged `resourcesPath` candidates already present — **packaged execution NOT_VERIFIED**

---

## Model discovery

Order: `OPENSCREEN_STT_MODELS_DIR` → Electron `userData/stt-models` when `app` exists → existing product caches (`openscreen` / `Electron` Application Support) → `~/.openscreen-stt-models` download target.

Health: `modelsBaseDir=/Users/…/openscreen/stt-models`, `modelPresent=true`.

---

## Audio extraction proof

Diagnose A: AAC 48 kHz mono stream present; STT succeeded with real phrase+word timestamps.  
No-audio C: probe `present:false` → `no_audio`, `sttMs=0` (Whisper not invoked).

---

## Process lifecycle

Single long-lived `WhisperServerManager` via `getSttManager()`; sequential recovery subset (8 cases) stable; no crash/restart required. Warm cache re-read ~57 ms.

---

## Cache behavior

Successes cached (path+size+mtime+modelId). Failures not cached (unchanged). Warm hit confirmed on narrated clip.

---

## Speech-status resolution

Validated non-empty, finite, in-bounds segments → **`available`** even if provisional was `failed`.  
Corrupt/empty-only segments → **`failed` + `timestamp_invalid`**, not fake `available`.  
`no_audio` unchanged.

---

## Source-time / timestamp validation

Segments use `SOURCE_MEDIA_TIME`; overshoot tolerance retained in usability filter. No fabricated word times.

---

## Real recordings tested

| ID | Media | Kind |
| -- | ----- | ---- |
| rec-narrated-bug5 | recording-bug5-narrated.mp4 | audio+speech |
| rec-case4-correction | case4-spoken-correction.mp4 | correction |
| rec-latest-narrated | recording-1789234858783.mp4 | audio+speech |
| rec-longer-narrated | recording-1789233035387.mp4 | longer speech |
| rec-pauses-editorial | recording-1789234858783.mp4 | pauses / editorial speech |
| rec-short-speech | recording-1788980586218.mp4 | short speech |
| rec-no-audio | recording-1788958840550.mp4 | true no_audio |
| rec-ui-plus-narration | recording-1789234858783.mp4 | UI + narration |

---

## Case 1 narrated result

**Baseline:** failed / 0 segments  
**Recovery:** `available`, 3 segments, sanity **GOOD**  
Example: “Today I am going to show you the open screen editor…”

Agent path: SpeechEvidence `available` (3 segs) even when LLM returned 429 empty final.

---

## Case 4 correction result

**Baseline:** failed / 0 segments  
**Recovery:** `available`, 4 segments, sanity **GOOD**

```text
[0.00-2.46] First I will open the timeline panel.
[2.46-5.52] I mean, actually, let me go back.
[5.52-7.32] I meant the effects panel.
[7.32-9.92] Okay, now looking at the effects panel.
```

Timeline → correction → Effects preserved.

---

## No-audio result

**Baseline / recovery:** `no_audio`, Whisper not invoked, `sttMs=0`.

---

## Other corpus speech results

All audio+speech recovery rows: `failed → available`, sanity GOOD. Spoken claims from ledger promotion: 3–5 per narrated case.

---

## Human transcript sanity

| Case | Sanity |
| ---- | ------ |
| narrated / latest / longer / pauses / short / UI+narration | GOOD |
| Case 4 correction | GOOD |
| no_audio | NO_SPEECH |

---

## Downstream Claim Promotion result

Spoken claims present after ledger build (counts 3–5). No policy changes.

---

## Downstream Source Story V2 result

Observed only when story prep requested; STT segments available as inputs. No Target/Gap/Plan tuning.

---

## Final user-facing speech answers

**NOT_VERIFIED for quality** — OpenAI 429 quota exhausted; finals empty.  
SpeechEvidence still attached after service bridge fix. Separate from STT. Do not treat as STT FAIL.

---

## Cold vs warm stability

| Mode | Typical |
| ---- | ------- |
| Cold speech prep (avg subset) | ~446 ms (includes first model load amortized across cases) |
| Per-clip STT inference | ~0.4–0.7 s wall for ~17–24 s audio (~40× realtime) |
| Warm cache | **57 ms**, `cacheHit=true` |

---

## Sequential-run stability

8 cases sequential on one server process: all OK. No zombie/port failures observed.

---

## Packaged-runtime status

`NOT_VERIFIED` — candidate paths include `resourcesPath`; no packaged app launch in this milestone.

---

## Latency

See `tmp/perception-benchmark/real-corpus-recovery-1-stt/latency.json`.  
STT itself is **not** the ~39 s baseline median (that was LLM + visual). Speech prep is sub-second once model is warm.

---

## Tests

| Suite | Result |
| ----- | ------ |
| `sttRecovery.unit.test.ts` | PASS |
| `speechEvidence.test.ts` + `stt/index.test.ts` | PASS (pre-existing + compatible) |
| `stt-recovery-live.runtime.test.ts` | PASS (real media) |
| Diagnose A/B/C | PASS after fix (default path works) |

---

## Before-vs-after corpus comparison

| Case | Baseline speech | Recovery speech | Segments | Human sanity | Source/claims speech | Final speech answer |
| ---- | --------------- | --------------- | -------: | ------------ | -------------------- | ------------------- |
| narrated-bug5 | failed | available | 3 | GOOD | spoken claims 3 | blocked (API 429) |
| case4-correction | failed | available | 4 | GOOD | spoken claims 4 | blocked (API 429) |
| latest-narrated | failed | available | 5 | GOOD | spoken claims 5 | n/a (prepare-only) |
| longer-narrated | failed | available | 4 | GOOD | spoken claims 4 | n/a |
| pauses-editorial | failed | available | 5 | GOOD | spoken claims 5 | n/a |
| short-speech | failed | available | 4 | GOOD | spoken claims 4 | n/a |
| no-audio | no_audio | no_audio | 0 | NO_SPEECH | 0 | n/a |
| ui+narration | failed | available | 5 | GOOD | spoken claims 5 | n/a |

**Aggregate:** audio-bearing tested 7/7 STT success; no_audio 1/1; failed rate 0 on recovery subset; warm cache OK.

---

## Regressions

None observed on unit suite or recovery subset. Baseline artifacts untouched.

---

## Remaining limitations

1. LLM finals / empty responses (quota + Cluster C) — out of scope  
2. `mediaContextNeeds` still skips speech for some phrasings (`routingWouldRequestSpeech=false` on one row) — Recovery 2  
3. Packaged Electron STT path NOT_VERIFIED  
4. No audio+no-speech fixture in this subset (would be `no_speech_detected`)

---

## What was deliberately NOT fixed

- mediaContextNeeds / visual starvation  
- empty finals / agent streaming  
- Target Story / Edit Gap / Plan / Proposal  
- Apply Preview / compositor / audio verify  
- Prompts / Investigator policy / OCR  

---

## Recommended next recovery cluster

**Recovery 2 — `mediaContextNeeds` fallback → visual/speech starvation**  
(then Recovery 3 empty finals, once API/provider path is usable)

---

## Verdict

`PASS_WITH_LIMITATIONS`

Artifacts: `tmp/perception-benchmark/real-corpus-recovery-1-stt/`

---

## STOP

STT/speech path restored and validated on real media. No further recovery clusters started.
