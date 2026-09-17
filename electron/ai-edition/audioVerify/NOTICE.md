# Audio Continuity Verification V1

Identity: `CURRENT_OPENSCREEN_AUDIO_VERIFY_V1`

## Authoritative path

```text
post-edit AxcutDocument
  → bounded exportMulti (join ± 0.75s)
  → ffmpeg f32le mono @ 48 kHz from COMPOSITED MP4
  → PCM join analysis
  → accept | rollback
```

Not source-file stitch. Not preview HTML audio. Not STT 16 kHz peaks.

## Statuses

- `verified_audio_basic` / `verified_audio_with_warnings`
- `audio_verification_failed` → rollback
- `audio_unavailable` → fail-closed rollback
- `not_applicable_no_audio` → does **not** block (distinct from unavailable)

## Non-goals

Crossfades, multi-edit, LLM audio QA, claiming professional mix quality.
