# Offscreen Native Compositor Verification V1

Identity: `CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1`

## Scope

Extends Render Verification so authoritative visual samples come from the OpenScreen native compositor:

```text
post-edit AxcutDocument
  → buildSceneDescription
  → CompositorViewService (live readFrame and/or bounded exportMulti)
  → RGBA8 pixel validation
  → accept / rollback
```

ffmpeg source stills are diagnostics only and never upgrade status to verified.

## Capture paths

1. **live_readFrame** — `createView` → `setScene` → `setActiveClip` → `presentTime` → `readFrame` (offscreen, no HWND)
2. **bounded_exportMulti** — same scene + `walk_composited_timeline` for a ±window around the join, then decode RGBA from the *composited* export

Both are `frameProvider: native_compositor`.

## Policy

- Authoritative PASS requires `native_compositor` (or explicit test double with `allowInjectedAsAuthoritative`)
- `compositor_unavailable` → fail-closed rollback
- Audio continuity: `NOT_VERIFIED`
- 0 required LLM calls

## Non-goals

Multi-edit, autonomy, UI consent, zoom/crop/speed execution
