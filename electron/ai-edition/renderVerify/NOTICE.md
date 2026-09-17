# Render Verification V1

Identity: `CURRENT_OPENSCREEN_RENDER_VERIFY_V1`

## Scope

Extends Consent + Apply Preview V1 verification for **`addTrim` only**:

```text
structural verify → preservation verify → RENDER VERIFY → accept/rollback
```

## Policy

- Fail-closed when render samples are unavailable (`render_unavailable` → rollback).
- Does not treat structural verification as render verification.
- Does not invent a second renderer; uses programme mapping (`resolvePlaybackSegments`) + optional ffmpeg source stills / injected sampler.
- Native compositor, when present, is preferred for future parity; V1 reports status honestly and uses bounded stills path.
- 0 required LLM calls.

## Non-goals

- Multi-edit / autonomy / auto-repair
- Zoom/crop/speed render verification
- Universal perceptual “looks good” score
