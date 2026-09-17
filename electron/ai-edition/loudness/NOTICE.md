# Local Loudness Normalize V1

Identity: `CURRENT_OPENSCREEN_LOCAL_LOUDNESS_NORMALIZE_V1`

```text
PRIMARY_SOURCE_AUDIO
  → FFmpeg loudnorm print_format=json
  → LoudnessAnalysisV1
  → AudioNormalizeCandidateV1
  → reviewable proposal
  → consented patch of legacyEditor.audioGainDb
  → re-measure with volume=gain
  → keep / rollback
```

Domains:

- analysisDomain: PRIMARY_SOURCE_AUDIO
- applyDomain: PROGRAMME_AUDIO_GAIN_DB (`legacyEditor.audioGainDb`)
- verificationDomain: PRIMARY_SOURCE_AUDIO_WITH_VOLUME

Hard rules: no paid AI; no silenceremove/loudnorm bake into media; no limiter/EQ;
applyPreview remains addTrim-only (this module uses consent-gated settings patch).
TOTAL_PAID_AI_CALLS = 0.
