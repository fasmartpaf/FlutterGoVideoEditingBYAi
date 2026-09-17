# AI Video-Use Capability Audit V1

**Identity:** `CURRENT_OPENSCREEN_VIDEO_USE_CAPABILITY_AUDIT_V1`  
**OpenScreen:** `/Users/osama/Documents/GitHub/FlutterGoVideoEditingBYAi`  
**video-use:** `/Users/osama/Documents/GitHub/video-use`  
**Mode:** architecture audit only — 0 code changes, 0 paid AI calls, 0 ElevenLabs installs

Artifacts: `tmp/perception-benchmark/video-use-capability-audit-v1/`

---

## 1. Executive verdict

**ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS**

OpenScreen is already stronger than video-use on the product architecture that matters for a real editor: local STT, AxcutDocument NLE, native compositor, SOURCE/PROGRAMME timing, dead-air with speech padding, caption layout, verified apply + rollback, and Temporal Context.

video-use is stronger as a *conversation-driven one-shot talking-head assembler*: paid Scribe (diarization + audio events), compact `takes_packed.md`, ffmpeg grade + fixed 30ms join fades, and a documented **final-sequence self-eval** loop. Many of those “capabilities” are **PROMPT/SKILL-ONLY**, not helper code.

**Do not replace** AxcutDocument, Temporal Context Store, or the native compositor. **Do not require** ElevenLabs. Port **concepts**, not the agent-skill architecture.

**Recommended next milestone:** `BUILD_CUT_QUALITY_VERIFY_FIRST` (final-sequence join QC), then PackedEditorialTranscript + targeted investigation composite.

---

## 2. OpenScreen current capability map

| Area | Status | Notes |
|------|--------|-------|
| Local Whisper STT + word times | IMPLEMENTED | `electron/stt/*`, `speechEvidence/*` |
| Dead air | IMPLEMENTED | detect/classify/keepPause; `speechPaddingSec=0.15` |
| Visual analysis / scene | IMPLEMENTED | MAD + ffmpeg scene/black/freeze |
| Temporal Context + packet | IMPLEMENTED | `TemporalReasoningPacketV1`, `EditorialContextSessionV1` |
| Caption layout | IMPLEMENTED | programme map + verified apply |
| Loudness | IMPLEMENTED | measure → apply → verify |
| Verified apply / rollback | IMPLEMENTED | consent, snapshot, compositor+audio verify |
| Trim/zoom/crop/speed | IMPLEMENTED | first-class NLE ops |
| Native compositor / export | IMPLEMENTED | Metal/D3D/Linux |
| Cursor telemetry | IMPLEMENTED | sidecar + compositor |
| OCR | MISSING | hooks only |
| Filler / false-start | MISSING | |
| Color grading | MISSING | LGPL `eq` blocker |
| Packed editorial transcript | MISSING | |
| Final-sequence self-eval | MISSING | per-edit only |
| Multi-take protocol | PARTIAL | multi-clip yes; take selection no |

---

## 3. video-use capability map

| Area | Kind | Notes |
|------|------|-------|
| ElevenLabs Scribe | CODE + paid | words, diarize, audio_events |
| `pack_transcripts.py` | CODE | 0.5s silence / speaker → `takes_packed.md` |
| `timeline_view.py` | CODE | local filmstrip+waveform+labels |
| `render.py` | CODE | extract+afade → concat → overlays → subs → loudnorm |
| `grade.py` | CODE | subtle / neutral_punch / warm_cinematic / auto |
| Word-boundary / padding | PROMPT | Hard Rules 6–7; not validated in code |
| Filler / false-start | PROMPT | agent EDL craft |
| Self-eval max 3 | PROMPT | `timeline_view` on output at cuts ±1.5s |
| `project.md` | PROMPT | session markdown |
| Animations | PROMPT + optional engines | HyperFrames / Remotion / Manim / PIL |

License: **MIT** (Browser Use 2026).

---

## 4. Capability comparison

OpenScreen wins local-first editing, verification, captions, cursor/screen-recording, undo/rollback, provider abstraction.

video-use wins packed transcript, targeted timeline PNG, color grade helpers, automatic 30ms fades, multi-take prompt protocol, diarization/audio events (paid), final-sequence self-eval *concept*.

Full matrix: `capability-comparison-matrix.json`.

---

## 5. Local transcription replacement

**CAN_OPENSCREEN_STT_REPLACE_ELEVENLABS: PARTIAL**

| Scribe field | OpenScreen |
|--------------|------------|
| word text / start / end | AVAILABLE |
| phrase grouping | DERIVABLE from word gaps |
| confidence / language | AVAILABLE / OPTIONAL |
| speaker_id | MISSING |
| audio_event tokens | MISSING |
| spacing entries | DERIVABLE |

For OpenScreen’s primary screen-recording path, local STT is enough. Diarization/audio events matter more for interviews/talking-head beat craft.

**PAID_TRANSCRIPTION_REQUIRED: NO**

---

## 6. Packed transcript

**PACKED_TRANSCRIPT_VALUE: HIGH**

`takes_packed.md` is a compact, phrase-addressable reasoning view (~1/10 tokens of raw JSON). It is **not** redundant with `TemporalReasoningPacketV1` (multi-modal evidence packet with budgets). Recommend **PackedEditorialTranscriptV1** as a projection over `SpeechEvidence` for local models — **do not** replace Temporal Context Store.

---

## 7. Targeted visual inspection

**TIMELINE_VIEW_VALUE: HIGH**  
**Verdict: ADAPT_CONCEPT**

`timeline_view.py` is fully local (ffmpeg + Pillow + numpy): ~10 frames, waveform, silence shade ≥0.4s, word labels, ≥1920px PNG. OpenScreen already has compositor frames, peaks, speech, visualAnalysis separately. Compose them into a cut-window investigation artifact; do not adopt the Python helper as architecture.

---

## 8. Cut quality

**CUT_QUALITY_GAP: MEDIUM**

| Check | OpenScreen |
|-------|------------|
| No cut inside word | PASS (`speechBoundary`) |
| Safe speech boundary | PASS (deadAir + 0.15s pad) |
| Audio discontinuity | PARTIAL (verify yes; auto micro-fade no) |
| Visual discontinuity | PARTIAL (per-edit / deadAir safety; no full join sweep) |
| Caption continuity | PASS |
| Cut padding | PASS (CODE 0.15s vs video-use prompt-only) |

OpenScreen’s **code-enforced** cut safety is already ahead of video-use’s prompt rules. Remaining gap is sequence-level QC + join fades + speech cleanup.

---

## 9. Audio fades

video-use CODE (`render.py:270-272`):

```text
afade=t=in:st=0:d=0.03,afade=t=out:st={duration-0.03}:d=0.03
```

Applied on **every** segment extract. Masks pops well for talking heads; may soften intentional hard edges / UI-SFX in screen recordings.

**Recommendation: TEST_REQUIRED** — not blind FIXED_FADE. Prefer adaptive/opt-in micro-fade at speech-trim joins, measured with `audioVerify`.

---

## 10. Render pipeline

| video-use | OpenScreen |
|-----------|------------|
| extract → concat → overlays → subs → loudnorm | AxcutDocument → scene → native compositor → preview/export |

**OPENSCREEN_RENDERER_SHOULD_BE_REPLACED: NO**

Port ideas (join QC, optional grade, micro-fades), not the ffmpeg one-shot pipeline as SSOT.

---

## 11. Final-output self-eval

**FINAL_CUT_VERIFY_VALUE: HIGH**

video-use: PROMPT checks rendered cuts ±1.5s for jump/pop/subtitle/overlay; max 3 retries.

OpenScreen: strong **PER_EDIT_VERIFY**; missing **FINAL_SEQUENCE_VERIFY**.

Exact missing layer: sequence-level join verification after edit batches, built on existing compositor/audio/speech — not LLM-only PNGs.

---

## 12. Color grading

**COLOR_GRADE_REUSE_VALUE: MEDIUM**

`grade.py` presets + auto `signalstats` are local and useful conceptually. Direct filter reuse blocked by OpenScreen **LGPL** ffmpeg (no `eq`). Prefer future compositor color ops. Do not add yet.

---

## 13. Multi-take

**MULTI_TAKE_VALUE: MEDIUM**

video-use: batch transcribe + packed multi-take markdown + prompt take selection. OpenScreen: multi-asset/multi-clip timeline, no take-selection protocol. Valuable later; not the first import for screen-recording core.

---

## 14. Speech cleanup

**SPEECH_CLEANUP_GAP: HIGH**

video-use filler/false-start handling is LLM+transcript-driven (not deterministic CODE). OpenScreen has word timestamps but no filler/false-start automation (deadAir = silence only). Real editorial gap for “make it professional” talking-head asks.

---

## 15. Captions

**OpenScreen stronger.** Editable layout, safe areas, programme remap, verified apply via compositor text. video-use burned 2-word UPPERCASE SRT with output offsets. Do **not** replace OpenScreen captions.

---

## 16. Memory

**TEMPORAL_CONTEXT_STORE_SHOULD_BE_REPLACED: NO**

Useful video-use idea: human-readable strategy/decision journal (`project.md`). Layer beside `EditorialContextSessionV1` / videoMemory — separate from evidence memory.

---

## 17. Animations

**POTENTIAL_PLUGIN_ARCHITECTURE / RELEVANT_LATER**

HyperFrames / Remotion / Manim / PIL are skill-orchestrated overlays. Do not distract current roadmap. Classify as later plugins.

---

## 18. Licenses

| Component | Class |
|-----------|-------|
| video-use (MIT) | SAFE_REFERENCE / ATTRIBUTION_REQUIRED if copying code |
| Helper ideas | Prefer reimplementation |
| FFmpeg grade filters | REVIEW_REQUIRED vs LGPL build |
| Animation engines | NOT_SUITABLE for core now |
| ElevenLabs | NOT_SUITABLE |

---

## 19. Local-first opportunities (ranked)

1. FinalSequenceCutQualityVerify — value 5 / fit 5  
2. PackedEditorialTranscriptV1 — value 5 / cost 2  
3. TargetedTemporalInvestigationComposite — value 4  
4. LocalFillerFalseStartCleanup — value 4  
5. AdaptiveJoinMicroFade — value 3 / TEST_REQUIRED  
6. HumanReadableStrategyJournal — value 2  

---

## 20. Do-not-port list

- Replace AxcutDocument with `edl.json`
- Replace Temporal Context Store with packed markdown
- Replace native compositor with ffmpeg extract/concat
- Require ElevenLabs
- Agent-only workflow as sole UX
- Hard-couple animation frameworks
- Blind fixed 30ms fades without testing
- Burned-only SRT replacing captionLayout
- Prompt-only correctness without CODE gates

---

## 21. Top OpenScreen gaps (“make this video professional”)

1. **Final-sequence cut QC** — video-use SKILL self-eval; OpenScreen per-edit only  
2. **Packed editorial transcript** — `pack_transcripts.py` CODE; OpenScreen missing projection  
3. **Filler / false-start cleanup** — video-use prompt workflow; OpenScreen silence-only  
4. **Targeted timeline composite** — `timeline_view.py`; OpenScreen has pieces  
5. **Color grading** — `grade.py`; OpenScreen missing (+ LGPL blocker)  
6. **Automatic join micro-fades** — `render.py` CODE; OpenScreen optional fades  
7. **Multi-take selection protocol** — later  

---

## 22. Three candidate imports

1. **FinalSequenceCutQualityVerify** — deterministic join sweep on programme cuts using compositor/audio/speech  
2. **PackedEditorialTranscriptV1** — compact phrase projection for local/bounded reasoning  
3. **TargetedTemporalInvestigationComposite** — adapt timeline_view from existing peaks + frames + words  

Details: `candidate-imports.json`.

---

## 23. Recommended next step

**NEXT_MILESTONE: BUILD_CUT_QUALITY_VERIFY_FIRST**

Finding-backed: OpenScreen already leads on per-edit verify and local stack; the clearest *professional* gap vs video-use’s marketed pipeline is **final-sequence join quality verification**. Immediate follow-ons: PackedEditorialTranscriptV1 (cheap), then investigation composite (feeds verify UX).

Do not auto-change the broader roadmap beyond this audit recommendation.

---

## Final decisions

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
CAN_OPENSCREEN_STT_REPLACE_ELEVENLABS: PARTIAL
PACKED_TRANSCRIPT_VALUE: HIGH
TIMELINE_VIEW_VALUE: HIGH
CUT_QUALITY_GAP: MEDIUM
FINAL_CUT_VERIFY_VALUE: HIGH
COLOR_GRADE_REUSE_VALUE: MEDIUM
MULTI_TAKE_VALUE: MEDIUM
SPEECH_CLEANUP_GAP: HIGH
OPENSCREEN_RENDERER_SHOULD_BE_REPLACED: NO
TEMPORAL_CONTEXT_STORE_SHOULD_BE_REPLACED: NO
PAID_TRANSCRIPTION_REQUIRED: NO
TOP_3_REUSABLE_CONCEPTS:
  1. FinalSequenceCutQualityVerify
  2. PackedEditorialTranscriptV1
  3. TargetedTemporalInvestigationComposite
DO_NOT_PORT: Axcut→EDL, TemporalStore→markdown, native compositor, ElevenLabs, agent-only UX, animation coupling, blind 30ms fades, burned-SRT captions, prompt-only gates
NEXT_MILESTONE: BUILD_CUT_QUALITY_VERIFY_FIRST
TOTAL_PAID_AI_CALLS: 0
OPENSCREEN_CODE_CHANGES: 0
VIDEO_USE_CODE_CHANGES: 0
```
