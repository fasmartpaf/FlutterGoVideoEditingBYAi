# Local Dead-Air Shorten V1 (+ Visual Safety V1.1)

Identity: `CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_V1`  
Visual safety: `CURRENT_OPENSCREEN_LOCAL_DEAD_AIR_VISUAL_SAFETY_V1_1`

```text
media audio
  → FFmpeg silencedetect (analyzer only)
  → SilenceIntervals (SOURCE_MEDIA_TIME)
  → speech-aware DeadAirCandidate[]
  → visual activity safety (cursor / Bug-3 / ledger / OCR cache / bounded scene)
  → reviewable addTrim proposal
  → existing consent / applyPreview
  → compositor + audio verify
```

Hard rules:

- FFmpeg is the **analyzer**, not a destructive editor (`silenceremove` unused).
- Trims are SOURCE_MEDIA_TIME via existing `addTrim`.
- No LLM in DETECT / PLAN / APPLY / VERIFY.
- `safeToPropose` ≠ auto-apply. Single-candidate V1.
- Visual: significant/scene/click/text → block; moderate → uncertain; black/freeze observational only.
- TOTAL_PAID_AI_CALLS = 0.
