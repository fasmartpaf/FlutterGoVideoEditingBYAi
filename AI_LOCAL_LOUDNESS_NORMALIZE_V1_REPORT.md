# OpenScreen — Local Loudness Analysis + Normalize V1

**Identity:** `CURRENT_OPENSCREEN_LOCAL_LOUDNESS_NORMALIZE_V1`  
**Date:** 2026-09-15  
**Code:** `electron/ai-edition/loudness/`  
**Artifacts:** `tmp/perception-benchmark/local-loudness-normalize-v1/`  
**Paid AI:** **0**

Pattern follows dead-air V1: analyze → candidate → review → consent → apply → verify → rollback.  
AI cognition / Bounded / applyPreview tool set: **UNCHANGED** (still `addTrim`-only).

---

## 1. Executive verdict

Local loudness analysis works via FFmpeg `loudnorm` print JSON. Normalization is **non-destructive** via `legacyEditor.audioGainDb`. True-peak safety correctly blocks aggressive raises. Real-corpus proposal precision **1.0**. One peak-limited normalize verified and kept; forced verify failure rolls back.

---

## 2. Audio path architecture

See `audio-path-audit.json`.

```text
asset AAC → (atempo under speed) → overlay mix → finish_audio(audioGainDb) → export
```

`audioGainDb` (±12) is the only programme makeup that matches preview and export.

---

## 3. Domains

| Domain | Choice |
| ------ | ------ |
| analysisDomain | `PRIMARY_SOURCE_AUDIO` (screen track via FFmpeg) |
| applyDomain | `PROGRAMME_AUDIO_GAIN_DB` |
| verificationDomain | `PRIMARY_SOURCE_AUDIO_WITH_VOLUME` (re-measure with `volume=gain`) |

V1 does not measure full mixed export (compositor exportMulti optional later). Complex overlays → `UNSUPPORTED_COMPLEX_MIX`.

---

## 4. FFmpeg analysis

`loudnorm=I:TP:LRA:print_format=json` → `input_i` / `input_tp` / `input_lra` / `input_thresh`. Safe argv spawn. Handles no-audio / timeout / parse failure.

---

## 5. Target policy

`DEFAULT_LOUDNESS_TARGET_POLICY`: **−16 LUFS**, band ±2.5, TP ≤ −1.5, gain ±12, min delta 1.5 dB.  
Online/speech-forward — **not** EBU −23 broadcast compliance.

---

## 6. Classification

`ALREADY_ACCEPTABLE` | `TOO_QUIET` | `TOO_LOUD` | `TRUE_PEAK_RISK` | `DYNAMIC_RANGE_CONCERN` | `NO_AUDIO` | `INSUFFICIENT_ANALYSIS` | `UNSUPPORTED_COMPLEX_MIX`

---

## 7–8. Candidate + gain strategy

`AudioNormalizeCandidateV1` → clamp to compositor limit → reduce gain if expected TP unsafe (no limiter). Linear gain only — not two-pass loudnorm bake.

---

## 9. True peak safety

PASS — bug5 (−20 LUFS, TP −1.92) blocked; longest-29s peak-limited to +2.26 dB.

---

## 10. Multi-track

V1: single primary only. Active music/VO overlays → unsupported.

---

## 11–13. Proposal / consent / apply

Deterministic copy. Consent via existing `createApplyConsent` / `validateConsent`. Apply = `patchEditorSettings({ audioGainDb })` — **not** a second media renderer; applyPreview unchanged.

---

## 14. Verification

Re-measure with `volume={gain}dB,loudnorm=…`. Check vs **expected** integrated (peak-limited proposals), toward-target, TP ceiling. Fail → rollback.

---

## 15. Real corpus

| Case | I (LUFS) | Class | Safe |
| ---- | -------- | ----- | ---- |
| bug5 | −20.1 | TOO_QUIET | no (peak) |
| case4 | −16.9 | ALREADY_ACCEPTABLE | no |
| no-audio | — | NO_AUDIO | no |
| long-audio | −36.2 | TOO_QUIET | no (>±12) |
| longest-29s | −23.4 | TOO_QUIET | **yes** (+2.26 dB peak-limited) |

---

## 16. Manual review

Proposal precision **1.0** (1/1 NORMALIZATION_USEFUL). Peak blocks labeled WOULD_BE_TOO_AGGRESSIVE — correct.

---

## 17–18. Cache / performance

Source cache by path/size/mtime/params. Warm ~70–165 ms; cold ~1.6–3 s.

---

## 19–20. Tests / paid AI

Unit + corpus green. `TOTAL_PAID_AI_CALLS = 0`.

---

## 21. Remaining limitations

- Source-level analysis (not full programme export mix)
- Linear gain ≠ full loudnorm dynamics
- ±12 dB compositor ceiling
- No limiter/EQ/denoise
- applyPreview not extended (settings-patch consent path)

---

## 22. Next capability

**black_freeze_analysis_v1** or **caption_layout_safe_areas_v1** — prefer **scene/black/freeze analysis suite** next (pairs with dead-air visual; still local FFmpeg).

Actually audit priority after loudness was analysis suite / caption layout. Recommend: **caption_layout_safe_areas_v1** (high screen-recording value, compositor-compatible).

---

## Final decisions

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS

LOUDNESS_ANALYSIS: PASS
TARGET_POLICY: PASS
NORMALIZATION_CANDIDATE: PASS
TRUE_PEAK_SAFETY: PASS
NON_DESTRUCTIVE_APPLY: PASS
MULTI_TRACK_HANDLING: PASS
POST_APPLY_LOUDNESS_VERIFY: PASS
FALSE_POSITIVE_SAFETY: PASS
REAL_CORPUS_PROPOSAL_PRECISION: 1.0
TOTAL_PAID_AI_CALLS: 0
PRODUCTION_DEFAULT: UNCHANGED
LOUDNESS_NORMALIZE_V1: READY_FOR_PRODUCT_INTEGRATION
NEXT_LOCAL_CAPABILITY: caption_layout_safe_areas_v1
```

---

## HARD STOP

Stopped after report. Did **not** implement denoise, compression/limiter, EQ, transitions, multi-edit, cognition changes, or applyPreview redesign.
