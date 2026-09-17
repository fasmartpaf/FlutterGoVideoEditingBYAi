# OpenScreen — Local Silence Analysis + Dead-Air Shorten V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_V1`  
**Date:** 2026-09-14  
**Artifacts:** `tmp/perception-benchmark/local-dead-air-v1/`  
**Code:** `electron/ai-edition/deadAir/`  
**Paid AI product calls:** **0**

Derived from `AI_LOCAL_EDITING_CAPABILITY_AUDIT_V1_REPORT.md`. AI cognition / Bounded / Retrieval / consent architecture: **UNCHANGED**.

---

## 1. Executive verdict

Local pipeline works: FFmpeg `silencedetect` → typed intervals → speech-aware candidates → keep-some-pause trim proposal → existing `addTrim` consent/apply/verify.

High precision on the offline corpus (**1.0** among `safeToPropose`; **0** critical false positives). Conservative gates block trailing outro, short breaths, already-trimmed source, and cursor activity in silence.

---

## 2. Current timing architecture

See `timing-audit.json`.

| Domain | Use |
| ------ | --- |
| `SOURCE_MEDIA_TIME` | Silence intervals, speech anchors, proposed trim, `trimRanges` |
| `COMPRESSED_PROGRAMME_TIME` | Post-apply compositor + audio join verify only |

No second timeline model.

---

## 3. FFmpeg detector

`detect.ts` + `parseSilencedetect.ts`:

- `resolveFfmpeg()` + argv spawn (path never shell-concatenated)
- Handles no-audio, timeout, cancel, missing ffmpeg
- Version recorded (corpus: **8.1.2**)

---

## 4. Detector parameters

`detector-config.json` / `DEFAULT_DEAD_AIR_POLICY`:

| Param | Value | Rationale |
| ----- | ----- | --------- |
| `noiseThresholdDb` | **-35** | Speech-friendly; less aggressive than -30 |
| `minimumSilenceDurationSec` | **0.55** | Above typical breath |
| `minSilenceForCandidateSec` | **1.0** | Propose only longer gaps |
| `speechPaddingSec` | **0.15** | Protect speech edges |
| `targetPauseInteriorSec` | **0.55** | KEEP_SOME_PAUSE |
| `minRemovableSec` | **0.4** | Meaningful shorten only |
| `allowTrailingPropose` | **false** | Outro uncertainty |

---

## 5. Silence vs dead-air

Detection ≠ deletion. Classifications:

`TOO_SHORT`, `INTER_SENTENCE_PAUSE`, `POSSIBLE_DEAD_AIR`, `LEADING_SILENCE`, `TRAILING_SILENCE`, `WITHIN_PROTECTED_CONTEXT`, `VISUAL_ACTIVITY_PRESENT`, `ALREADY_REMOVED`, `UNKNOWN`

Only `POSSIBLE_DEAD_AIR` / `LEADING_SILENCE` (and optional trailing) may set `safeToPropose`.

---

## 6. Speech boundary integration

Reuses `assessSpeechBoundary` (`renderVerify/speechBoundary.ts`) when an Axcut transcript/document is present. Adjacent speech anchors stored on each candidate. Cuts inside protected speech → block.

---

## 7. Visual safety

Cursor sidecar non-`move` interactions inside silence → `VISUAL_ACTIVITY_PRESENT` → not safe. No AI. Scene-change / OCR not yet wired (limitation).

---

## 8. Candidate contract

`DeadAirCandidateV1` in `types.ts`: silence range, proposed trim, keep duration, classification, confidence, evidence refs, speech boundary state, visual hits, `safeToPropose`, `blockingReasons`.

`safeToPropose ≠ apply`.

---

## 9. Keep-some-pause policy

`planKeepSomePause`: after pads, keep `targetPause*` at the start of the quiet window; remove only excess. Never collapse to zero.

---

## 10. Source/programme mapping

Trims emitted in SOURCE_MEDIA_TIME. `programmeMap.ts` ensures proposed trim still sits in a kept playback span given current `trimRanges`.

---

## 11. Cache

`SOURCE_ANALYSIS_CACHE` keyed by path + size + mtime + detector params. Programme trims do not invalidate silence analysis. Warm hit ~**66–165 ms** vs cold ~**1–2.4 s**.

---

## 12. Proposal integration

`deadAirCandidateToProposalItem` → `EditProposalItem` with `addTrim`, deterministic review copy (“Shorten a N-second quiet pause near T seconds.”). No LLM. Single best safe candidate via `selectSingleDeadAirCandidate`.

---

## 13. Apply / verify integration

Existing `runConsentedApplyPreview` only. Tests prove:

- no consent → **0** mutations
- audio fail (`click_pop`) → **rollback**
- happy path → verified with compositor + audio still in lifecycle

Consent architecture not modified.

---

## 14. Real corpus results

| Case | audioState | intervals | safe |
| ---- | ---------- | --------- | ---- |
| bug5 narrated | present | 1 | **1** (addTrim) |
| case4 spoken | present | 1 | 0 (trailing blocked) |
| silent screen | absent | 0 | 0 |
| short no-audio | absent | 0 | 0 |
| long-pause audio | present | 3 | 0 (all TOO_SHORT) |
| longest ~29s | present | 0 | 0 |
| already-trimmed | present | 1 | 0 (ALREADY_REMOVED) |

---

## 15. Manual precision review

Among `safeToPropose`: **1 / 1** labeled `TRUE_DEAD_AIR` → **precision = 1.0**.  
Recall not claimed. Critical false positives: **0**.

---

## 16. False positives

None on this corpus. Prefer miss over cut.

---

## 17. Performance

Cold FFmpeg ~1–2.4s for ~17–29s clips; cache hit &lt;200ms. Interactive-enough for short screen recordings.

---

## 18. Tests

- Unit: `deadAirV1.test.ts` — 21 tests (parse, classify, keep-pause, speech/visual/trim gates, proposal, consent, rollback, cache)
- Corpus: `deadAirV1.corpus.runtime.test.ts` — real local media, 0 paid AI

---

## 19. Paid AI proof

```text
OPENAI_CALLS=0
ANTHROPIC_CALLS=0
GEMINI_CALLS=0
OTHER_PAID_AI_CALLS=0
TOTAL_PAID_AI_CALLS=0
```

(`zero-paid-ai-proof.json`)

---

## 20. Remaining limitations

- Trailing silence never auto-proposed in V1
- Visual safety = cursor interactions only (no scdet/blackdetect yet)
- Corpus speech anchors for narrated cases were offline SOURCE windows (not a live Whisper bake this run); production should pass real `SpeechEvidence` / transcript
- Single-candidate apply only
- Not wired into agent tool loop UI yet (library + proposal adapter ready)

---

## 21. Recommended next capability

**Local loudness normalize (FFmpeg `loudnorm`)** — next audit priority; same local/deterministic pattern; no AI.

---

## Final decisions

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS

SILENCE_DETECTION: PASS
DEAD_AIR_CLASSIFICATION: PASS
SPEECH_BOUNDARY_SAFETY: PASS
VISUAL_ACTIVITY_SAFETY: PARTIAL
KEEP_SOME_PAUSE_POLICY: PASS
SOURCE_PROGRAMME_MAPPING: PASS
APPLY_PATH_REUSE: PASS
COMPOSITOR_VERIFY: PASS
AUDIO_VERIFY: PASS
FALSE_POSITIVE_SAFETY: PASS
REAL_CORPUS_PRECISION: 1.0
TOTAL_PAID_AI_CALLS: 0
PRODUCTION_DEFAULT: UNCHANGED
NEXT_LOCAL_CAPABILITY: loudness_normalize_v1 (FFmpeg loudnorm → reviewable gain/normalize proposal)
```

---

## HARD STOP

Stopped after implementation of this capability + report.

Did **not**: implement loudness normalize, multi-silence auto-edit, Improve-video autonomy, AI cognition changes, paid provider tests, denoise, transitions, or consent/apply redesign.
