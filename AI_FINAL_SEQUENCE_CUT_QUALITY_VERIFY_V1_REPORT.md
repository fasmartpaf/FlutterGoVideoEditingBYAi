# OpenScreen — Final Sequence Cut Quality Verify V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_FINAL_SEQUENCE_CUT_QUALITY_VERIFY_V1`  
**Code:** `electron/ai-edition/finalSequenceCutQualityVerify/`  
**Artifacts:** `tmp/perception-benchmark/final-sequence-cut-quality-verify-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** OpenScreen now has a **whole-programme** join QC layer that answers: after edits are composed into the programme, are cut/join boundaries technically clean and preservation-safe?

This is **not** an editorial AI milestone. Verification is deterministic (speech boundary, PCM metrics, compositor pixels, caption programme map). Single verified apply / consent architecture / production compositor fades are **unchanged**. Micro-fade experiment is **report-only** → `MORE_EVIDENCE_REQUIRED`. Critical false positives on intentional hard visual cuts: **0**.

---

## 2. Existing join behavior

See `current-cut-quality-audit.json`.

| Already present | Scope |
|-----------------|--------|
| applyPreview → compositorVerify + audioVerify + speechBoundary | **Per trim operation** |
| Native `CUT_FADE_HALF_SEC = 0.35s` video dissolve | Runtime export/preview |
| Native `AUDIO_BOUNDARY_FADE_SAMPLES = 240` (~**5 ms**) audio crossfade | Runtime PCM assemble |
| `resolvePlaybackSegments` source→programme | Document mapping |

**Not present before:** whole-programme join enumeration + multi-modality sequence result; discontinuity vs integrity split; join-centric captions; report-only micro-fade comparison.

**video-use 30 ms fade:** **not** in OpenScreen code — not copied.

---

## 3. Join contract

`ProgrammeJoinV1` — derived from `resolvePlaybackSegments` (no second timeline).

Causes: `TRIM_CREATED` | `CLIP_TO_CLIP` | `SPEED_BOUNDARY` | `SOURCE_DISCONTINUITY` | `NATURAL_CONTINUITY`.

Fields: joinId, programmeTimeSec, left/right source ranges + clip/asset ids, cause, editCreated, mutationRefs, optional speech/caption/visual context.

---

## 4. Enumeration

`enumerateProgrammeJoins` — stable SHA join IDs, deterministic sort, edit-created vs natural, speed edges as non-cut boundaries. Undo/rollback of document restores prior join set (unit-proven).

---

## 5. Speech

Reuses `assessSpeechBoundary` + word-interior cut detection.

Outcomes: PASS | WARNING | FAIL | NOT_APPLICABLE | INSUFFICIENT_EVIDENCE.

Cut-inside-word → **FAIL**. Safe silence trim → not FAIL.

---

## 6. Audio

Reuses `analyzeJoinPcm` / `classifyWaveformPolicy` (±0.75s window semantics via injected PCM or `AudioPcmProvider`).

Click/pop → FAIL. Clean silence → PASS. No auto fades.

---

## 7. Visual

Compositor RGBA samples → `analyzeRgba8`.

Separates:

- `VISUAL_DISCONTINUITY_PRESENT` (warning — intentional hard cuts OK)
- `VISUAL_INTEGRITY_FAILURE` (blocking — blank/invalid/transparent)

Speed boundaries → NOT_APPLICABLE (motion change ≠ integrity failure).

---

## 8. Captions

When captions enabled: layout + programme map; cues over removed source → FAIL; non-monotonic / duplicate cue IDs flagged. No OCR of own captions.

---

## 9. Speed

Timing continuity only via `expectedProgrammeDurationForSpeed`. Not reported as bad visual cuts.

---

## 10. Preservation

Without Temporal/must-survive evidence → **UNKNOWN** (never invent PASS). Overlap with removed trim gap → FAIL/WARNING.

---

## 11. Sequence result

`FinalSequenceCutQualityResultV1` with per-join `FinalSequenceJoinVerificationV1` and overall PASS | PASS_WITH_WARNINGS | FAIL | INSUFFICIENT_EVIDENCE.

Diagnostic only — **no document mutation** on failure.

---

## 12. Micro-fade experiment

Compared current vs 10/20/30 ms / adaptive on synthetic click_pop PCM.

Native already has ~5 ms audio boundary fade + 0.35 s video dissolve.

**Recommendation: `MORE_EVIDENCE_REQUIRED`** — do not change production compositor in this milestone.

---

## 13. Join investigation artifact

Per-join JSON under `join-investigation-artifacts/` (programme time, cause, speech/caption context, PCM summary, modality outcomes). Not a full TargetedTemporalInvestigationComposite.

---

## 14. Preview vs final export

`preview-vs-export.json`: visual integrity authoritative on **native compositor frames**; audio join on **bounded exportMulti PCM**. Full MP4 encode ladder not proven identical → **PARTIAL** parity without paired live measure. Spot-check full export for RCs.

---

## 15. Cache

Keyed by media fingerprint + programme fingerprint + join id set + policy version. Unrelated mutations invalidate via programme fingerprint change.

---

## 16. Temporal Context integration

`temporalRecordsFromSequenceResult` → `FINAL_SEQUENCE_JOIN_VERIFY` refs/summaries only (no PCM/frame blobs).

---

## 17. Corpus

Synthetic: clean silence join, audio pop, cut-inside-word, intentional hard visual cut, caption-across-trim, speed boundary.

Real recordings presence noted in `corpus-availability.json` (optional; unit path does not require them).

---

## 18. Manual review

| Case | System | Human |
|------|--------|-------|
| Intentional hard visual cut | WARNING (discontinuity) | ACCEPTABLE_JOIN |
| Audio pop | FAILED | TRUE_DEFECT |
| Cut inside word | FAILED | TRUE_DEFECT |
| Safe silence trim | CLEAN / warnings only | ACCEPTABLE_JOIN |

**CRITICAL_FALSE_POSITIVES = 0** (hard cut not blocking FAIL).

---

## 19. Performance

Join-bounded; cache-backed. See `performance.json` from artifact run.

---

## 20. Cross-platform

This run: **macOS LIVE_UNIT**. Windows/Linux: **NOT_RUN**.

---

## 21. Tests

`finalSequenceCutQualityVerifyV1.test.ts` + artifacts runtime test — **17 passed**.

Coverage: enumeration, stable IDs, trim/natural/speed, speech-safe + cut-inside-word, audio pop/clean, hard visual ≠ FAIL, blank frame FAIL, preservation UNKNOWN, undo join restore, cache invalidation, micro-fade, captions, temporal refs, zero paid AI.

---

## 22. Paid AI proof

```json
{ "TOTAL_PAID_AI_CALLS": 0, "AUTO_MUTATIONS": 0 }
```

---

## 23. Limitations

- Live full-programme compositor/PCM sampling optional (injectable for CI).
- Preview↔full-file encode parity not fully measured live.
- Micro-fade not productionized (by design).
- Loudness/artistic transition taste out of scope.
- Does not wire into chat product surface yet (diagnostic API).

---

## 24. Recommended next milestone

**`final_sequence_verify_product_gate_v1`** — optional post-apply diagnostic surfacing of FAIL joins in UI after consented single apply (still no auto-fade / no multi-edit).

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
FINAL_SEQUENCE_JOIN_ENUMERATION: PASS
SPEECH_JOIN_SAFETY: PASS
AUDIO_JOIN_SAFETY: PASS
VISUAL_JOIN_INTEGRITY: PASS
CAPTION_JOIN_CONTINUITY: PASS
SPEED_BOUNDARY_INTEGRITY: PASS
PRESERVATION_JOIN_CHECK: PASS
FINAL_SEQUENCE_VERIFY: PASS
PREVIEW_EXPORT_PARITY: PARTIAL
MICRO_FADE_POLICY: MORE_EVIDENCE_REQUIRED
CRITICAL_FALSE_POSITIVES: 0
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
PRODUCTION_DEFAULT: UNCHANGED
NEXT_MILESTONE: final_sequence_verify_product_gate_v1
```

HARD STOP.
