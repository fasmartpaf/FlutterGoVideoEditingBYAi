# AUTONOMOUS_EDITOR_FINAL_NATIVE_PRODUCT_CLOSURE_V1

**Verdict: PASS_WITH_LIMITATIONS**

Native compositor on this host (Apple M5 / hardware). Cloud calls: **0**. No new Director/planner/store.

Artifacts: `tmp/perception-benchmark/final-native-product-closure-v1/`

---

## 1. Trim rejection / root cause

Join QC was failing many **speech-safe silencedetect** trims because `verifyJoinSpeech` ignored confirmed silence and treated a long STT **segment** as active speech. Dead-air planning already used silencedetect as authoritative.

That is a **false rejection of silence-as-speech (segment clock)**. Fix: pass dead-air silence ranges into join speech QC. Word-interior cuts still block (not loosened).

| Rec | Planned | Final | Dropped | Root cause of drops |
|-----|---------|-------|---------|---------------------|
| A 1789555833018 | 2 | 1 | 12.54–13.81s | `cut_inside_word` **word_21** — ASR word spans the cut. **UNSAFE_CANDIDATE**, not segment-false-silence |
| C 1789497588181 | 2 | 2 | none | both **CORRECT_SHORTEN** |
| D 1788978271417 | 3 | 1 | trailing + 14.78–15.18s | `cut_inside_word` **word_41** / QC revision. **UNSAFE_CANDIDATE** |

A leading 0.30–2.29s LEADING_SILENCE: **CORRECT_REMOVE**, survived.

## 2. Safe SHORTEN/REMOVE

| Rec | Classification |
|-----|----------------|
| A leading ~2.0s quiet | CORRECT_REMOVE |
| A mid ~2.1s | UNSAFE_CANDIDATE (word overlap) |
| C 0.81–1.43 and 2.01–2.30 | CORRECT_SHORTEN (kept breath) |
| D 19.41–19.85 | CORRECT_SHORTEN |
| D trailing / protected | UNSAFE_CANDIDATE / KEEP |

Acceptance: **at least one real SHORTEN/REMOVE survived QC** (A, C, D).

## 3. Final committed families

| Rec | Families |
|-----|----------|
| A | trim, zoom, captions, loudness |
| C | trim, zoom, captions, loudness, callout |
| D | trim, zoom, captions, loudness, callout |

## 4. Receipt vs document

**FALSE_APPLIED_CLAIMS = 0**  
**ROLLED_BACK_EDIT_CLAIMS = 0**

Receipt is rebuilt **after** execution, join QC revision, and bounded caption revision, from **final trim/zoom/caption/gain counts**.

A: “removing **1** unnecessary pause …” (not 2).  
C: “removing **2** …” matches 2 trims.  
D: “removing **1** …” matches 1 trim.

## 5. Native compositor

**NATIVE_PRODUCTION_VERIFIED**  
`hasAddon=true`, backend=`hardware`, frames via `live_readFrame` (`native_compositor`). Not injected.

## 6. Playback / frames

Zoom A: wide OpenAI page → enter/hold on Cursor IDE around the click → return wide. Captions readable at bottom (“This is the A prompt I have”).  
Zoom C: IDE/wide → hold emphasizes timer/work UI → return. Captions (“Hello this is our cursor…”). Callout present on C/D documents; zoom already carries most of the focus.

Ending samples at raw duration fail `programme_time_unmapped` after trims (harness sampled pre-trim length). Export duration is the edited programme (A **31.375s**, C **19.125s**).

Joins: **PASS_WITH_WARNINGS**; failing word-cut trims were revised out, not shipped.

## 7. Export

- `final-professional-edit-A.mp4` (31.4s, 753 frames)  
- `final-professional-edit-C.mp4` / `final-professional-edit.mp4` (19.1s, 459 frames) — strongest multi-family  

preview fingerprint = receipt fingerprint = export document fingerprint.

## 8. Raw vs final

| | PACING | VISUAL_FOCUS | CLARITY | AUDIO | CAPTIONS | DISTRACTIONS | STORY | KEEP? |
|--|--------|--------------|---------|-------|----------|--------------|-------|-------|
| A | better | better | better | better | useful | none | intact | yes |
| C | better | better | better | better | useful | minor (callout+zoom) | intact | yes |
| D | better | better | better | better | useful | minor | intact | yes |

BEST_EDIT: C (two safe shortens + zoom + captions + callout).  
WORST_EDIT: none BAD.  
MISSED: mid-take pauses that STT words still cover; SPEED not in this set.  
OVER_EDITED: none that shipped.

## 9. Remaining genuine gaps

- ASR **word** timestamps can overlap silencedetect gaps → join QC correctly refuses (not a threshold loosen).  
- SPEED not re-proven here.  
- Titles still quality-gated / unused.  
- Wallpaper path warning in compositor (`/wallpapers/wallpaper1.jpg`) — cosmetic in this harness.

## 10. Verdict

**PASS_WITH_LIMITATIONS**

Native first-pass is materially better on A/C (and D), Chat no longer claims rolled-back pauses, captions/zoom render on the real compositor, and safe SHORTEN/REMOVE now survives when words do not occupy the cut. Remaining trim misses are **word-clock unsafe**, not “silence labeled as speech.”

HARD STOP.
