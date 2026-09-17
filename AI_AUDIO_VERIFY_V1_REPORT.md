# OpenScreen Audio Continuity Verification V1 Report

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_AUDIO_VERIFY_V1`  
**Prerequisites:** Apply Preview V1 + Render Verification V1 + Compositor Verification V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Single-trim audio continuity gate only. No UI consent, multi-edit, autonomy, auto-repair, crossfades, or zoom/crop/speed expansion.

---

## Executive verdict

PASS_WITH_LIMITATIONS. After one consented `addTrim`, OpenScreen now inspects **post-edit programme audio** around the compressed join via bounded `exportMulti` → ffmpeg `f32le` mono @ 48 kHz → deterministic PCM metrics, reusing the existing speech-boundary classifier. Safe dead-air keeps the mutation as `verified_single_trim_basic`. Click/pop discontinuity and speech cuts fail closed with rollback. `no_audio` → `not_applicable_no_audio` (does not block). Extraction failure → `audio_unavailable` → rollback. Live darwin-arm64 proof: `bounded_exportMulti_pcm`, 76 800 samples, ~174 ms, `verified_audio_basic`. Required LLM calls = **0**.

---

## Existing audio architecture audit

| Topic | Finding |
|-------|---------|
| Heard audio after edit | **`exportMulti`**: decode → stretch → concat (≈240-sample native crossfade) → `mix_external_tracks` → `finish_audio` → AAC |
| Live compositor view | **Video only** — no PCM/`readAudio` API |
| Preview vs export | **Not identical** — HTML preview audio ≠ export mixer |
| Peaks / STT PCM | Source-file helpers (`audioPeaks`, STT 16 kHz) — **not** post-edit programme truth |
| Bounded window | Yes — `clipInputsForProgrammeWindow` + short `exportMulti` |
| In-memory doc | Yes — `buildSceneDescription(document)` without persistence |
| Sample format for analysis | **f32le mono @ 48 kHz** from composited MP4 |
| Silence today | Transcript silence segments + near-zero PCM energy |

### Exact answers

1. **What path produces heard audio?** Native `exportMulti` audio pipeline (not live preview).  
2. **Bounded post-edit window?** Yes — programme join ±0.75 s.  
3. **Requires?** `exportMulti` + bundled ffmpeg decode (no second mixer).  
4. **In-memory doc without persist?** Yes.  
5. **Preview ≡ export?** **No.**  
6. **Reliable sample format?** f32le mono 48 kHz.  
7. **Existing peaks code?** `electron/media/audioPeaks.ts` (source peaks @ 16 kHz) — reused only for `resolveFfmpeg`.  
8. **Missing for “true” continuity?** Perceptual mix QA, multi-track overlay isolation, full-file loudness standards, human A/B.

---

## Authoritative post-edit audio path

```text
post-edit AxcutDocument
  → clipInputsForProgrammeWindow(join ± 0.75s)
  → CompositorViewService.exportMulti (hasAudio: true)
  → ffmpeg -vn -ac 1 -ar 48000 -f f32le
  → analyzeJoinPcm + assessSpeechBoundary
  → verified_audio_* | audio_verification_failed | audio_unavailable | not_applicable_no_audio
  → accept | rollback
```

Source-side PCM alone is **not** used to claim export parity.

---

## Audio Verification architecture

```text
proposal → preflight → consent → apply
  → structural + must-survive
  → native compositor visual
  → AUDIO CONTINUITY VERIFY
  → accept | rollback
```

Module: `electron/ai-edition/audioVerify/`  
Identity: `CURRENT_OPENSCREEN_AUDIO_VERIFY_V1`  
Wired in `applyPreview/run.ts` after compositor pass.

---

## Files changed

| Path | Role |
|------|------|
| `electron/ai-edition/audioVerify/*` | New module (types, extract, analyze, verify, tests, NOTICE) |
| `electron/ai-edition/applyPreview/run.ts` | Audio gate + rollback status preservation |
| `electron/ai-edition/applyPreview/types.ts` | Receipt `audioVerification` + terminal statuses |
| `electron/ai-edition/applyPreview/applyPreviewV1.test.ts` | Injected PCM on happy path |
| `electron/ai-edition/compositorVerify/compositorVerifyV1.test.ts` | Audio continuity expectation updated |
| `electron/ai-edition/renderVerify/renderVerifyV1.test.ts` | Same |
| `tmp/perception-benchmark/audio-verify-v1/` | Artifacts (compositor-verify-v1 untouched) |
| `AI_AUDIO_VERIFY_V1_REPORT.md` | This report |

---

## Audio evidence contract

`AudioContinuityEvidence` includes: `proposalId`, programme join, source before/after provenance, `programmeAudioWindow` (start/end/sampleRate/channels/sampleCount), `speechBoundaryRisk`, `waveformMetrics` (RMS/peak/jump/clipping/near-silence/rmsRatio), `capturePath`, `warnings`, `blockingReasons`, `status`, `latencyMs`, `bytesRendered`, `pcmSamplesAnalyzed`, `additionalModelCalls: 0`.

Statuses:

- `verified_audio_basic` / `verified_audio_with_warnings`
- `audio_verification_failed` → rollback
- `audio_unavailable` → fail-closed rollback
- `not_applicable_no_audio` → **does not** block
- `not_run` (typed; unused on happy attach)

Raw PCM is **not** serialized on the receipt.

---

## Bounded audio window

| Constant | Value | Justification |
|----------|-------|---------------|
| Pad before/after join | **0.75 s** | Matches compositor visual pad; enough for RMS context without whole-file export |
| Micro window | **50 ms** | Instantaneous jump / pop risk |
| Context window | **250 ms** | Short-term RMS / near-silence |
| Analysis rate | **48 kHz mono** | Export mixer native rate; deterministic |

Total analysed span ≤ **1.5 s** programme time.

---

## Speech-boundary integration

Reuses `assessSpeechBoundary` from Render Verify (`safe_silence_boundary` | `near_speech_boundary` | `inside_active_speech` | `inside_protected_speech` | `unknown`).

- Inside active/protected speech → **hard fail** (waveform smoothness cannot override).  
- Near-speech → warning.  
- Transcript silence ≠ automatic audio perfection — PCM still required.

Compositor may still fail speech cuts first (defense in depth); audio layer independently fails the same class.

---

## PCM/waveform metrics

Measured (units: linear float samples ≈ −1..1):

- `rmsBefore` / `rmsAfter` (250 ms context)
- `peakBefore` / `peakAfter`
- `boundarySampleJump` (|last pre − first post|)
- `clippingFraction` (|x| ≥ 0.98)
- `nearSilenceFractionBefore/After` (|x| < 0.01)
- `rmsRatio`

No fake “quality = 0.87” score.

---

## Discontinuity policy

| Signal | Policy |
|--------|--------|
| `boundarySampleJump` ≥ **0.85** | **Block** (click/pop) |
| `boundarySampleJump` ≥ **0.45** | Warning |
| `clippingFraction` ≥ **0.02** | **Block** |
| RMS ratio ≥ **12** (both sides active) | Warning only (natural scene change OK) |
| Speech inside word / protected | **Block** |
| Large RMS alone | **Not** automatic fail |

Combined: semantic speech safety + waveform validity + extreme discontinuity.

---

## Safe dead-air result

Injected safe-silence PCM + real `addTrim` 5–8 s:

- `verified_audio_basic`
- `speechBoundaryRisk: safe_silence_boundary`
- Protected Effects 8–12 survives
- Terminal: **`verified_single_trim_basic`**

Artifact: `tmp/perception-benchmark/audio-verify-v1/safe-dead-air-audio.json`, `verified-single-trim-basic.json`

---

## Bad speech-cut rollback result

Direct audio verify on trim inside speech → `audio_verification_failed` + `inside_active_speech`.  
Protected cut → `inside_protected_speech`.  
Apply path may fail at compositor speech gate first; audio layer still independently blocking.

---

## Click/pop fixture result

Synthetic join (−0.9 → +0.9 style polarity flip):

- Compositor visual **pass**
- Audio **fail** (`boundary_jump`)
- Rollback + fingerprint restored

Artifact: `click-pop-rollback.json`

---

## Loudness warning result

Synthetic RMS jump across join:

- `verified_audio_with_warnings`
- Mutation **kept**
- Terminal: `verified_single_trim_with_warnings`

Artifact: `loudness-warning.json`

---

## No-audio result

`forceNoAudio` / probed `no_audio`:

- Status: **`not_applicable_no_audio`** (not `audio_unavailable`)
- Mutation kept when other gates pass

Artifact: `no-audio.json`

---

## Audio-unavailable rollback result

Forced / failed extraction:

- `audio_unavailable` → rollback → fingerprint match

Artifact: `audio-unavailable-rollback.json`

---

## Receipt changes

`EditApplicationReceipt` adds:

- `audioVerification` (provider, status, evidence, capturePath, speech risk, latency, samples, modelCalls=0)
- `compositorVerification.audioContinuity` now reflects audio status (no longer permanently `NOT_VERIFIED` after the stage runs)
- `verificationStatus`: `verified_single_trim_basic` | `verified_single_trim_with_warnings` | `audio_verification_failed` | `audio_unavailable`
- `latencyMs.audioVerificationMs`

---

## Final acceptance policy

Retain single trim iff:

```text
structural
AND must-survive
AND native compositor visual
AND (audio pass OR not_applicable_no_audio)
```

`audio_unavailable` ≠ `no_audio`. Fail closed.

Terminal quality: **`verified_single_trim_basic`** means structural + protected + compositor pixels + basic programme-audio continuity — **not** “professionally perfect edit.”

---

## Model-call count

`additionalModelCalls = 0` (audio + apply orchestration). Deterministic PCM only.

---

## Real latency measurements

**Live darwin-arm64** (`live-audio-result.json`):

| Metric | ms |
|--------|-----|
| audioRenderSetupMs | 29 |
| boundedExportMs (includes export+decode) | 143 |
| decodeToPcmMs (separate bucket; folded into export for live provider) | 0 |
| analysisMs | 2 |
| totalAudioVerificationMs | **174** |
| wallMs | 175 |
| pcmSamplesAnalyzed | 76 800 @ 48 kHz |

Unit injected fixtures: analysis ≪ 5 ms (not production claims).

---

## Temp/cache behavior

- Isolated work dir under OS temp or `audioArtifactDir`
- Composited MP4 deleted unless `retainAudioArtifacts`
- Benchmark retains under `tmp/perception-benchmark/audio-verify-v1/`
- No cross-document cache in V1

---

## Platform support

| Platform | Status |
|----------|--------|
| **darwin-arm64** | Unit + **live** `exportMulti`→PCM proven this run |
| Windows | Architecture present; **NOT_VERIFIED** here |
| Linux | Architecture present; **NOT_VERIFIED** here |

ffmpeg decode is cross-platform in principle; bounded compositor export not re-proven off-macOS.

---

## Tests

`electron/ai-edition/audioVerify/audioVerifyV1.test.ts` + live runtime + updated apply/compositor/render suites.

Covered: post-mutation only; blocked proposals skip audio; real/synthetic PCM; SR/channels; safe dead-air; speech/protected fail; discontinuity analyzer; severe jump fail; RMS warning; clipping; no_audio ≠ unavailable; unavailable rollback; fingerprint restore; compositor pass + audio fail rollback; Effects survive; bounded window; receipt evidence; 0 LLM; prior compositor tests green; case refusals zero mutation.

---

## Benchmark impact

Identity: **`CURRENT_OPENSCREEN_AUDIO_VERIFY_V1`**  
Artifacts: `tmp/perception-benchmark/audio-verify-v1/`  
Does **not** overwrite `compositor-verify-v1/`.  
All prior `CURRENT_OPENSCREEN_*` identities preserved (`identity.json`).

---

## Remaining limitations

- Preview HTML audio still ≠ export; we verify **export** path only.  
- Native ~240-sample export crossfade can mask some pops — analyzer still sees residual jump; not a full perceptual model.  
- Multi-track / mic+system overlays: V1 inspects **final mixed** export mono; does not attribute tracks.  
- Live decode timing is folded into `boundedExportMs`.  
- Windows/Linux live **NOT_VERIFIED**.  
- No automatic fades/crossfades generated.  
- No claim of professional mix quality.

---

## Recommended next milestone

**UI Consent Surface V1** (explicit human consent UX for Apply Preview) **or** **Bounded Crossfade Proposal V1** (propose — not auto-apply — short fades when discontinuity warnings fire), still without autonomy/multi-edit.

---

## Verdict

**PASS_WITH_LIMITATIONS**

OpenScreen no longer stops at “the picture looks valid.” After a single consented trim it also checks that the **actual programme audio** around the cut is structurally and (conservatively) perceptually safe enough to keep — or it rolls back.
