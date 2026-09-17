# Consent + Apply Preview V1 (+ Verified Apply Expansion V1)

Identity: `CURRENT_OPENSCREEN_APPLY_PREVIEW_V1`
Expansion: `CURRENT_OPENSCREEN_VERIFIED_APPLY_EXPANSION_V1`

## Scope

Human-consented transactional single apply:

```text
Constrained Edit Proposal V1
  → Proposal Eligibility
  → Family preflight (trim | zoom | crop | speed)
  → Consent Gate (binds tool + args fingerprint)
  → Transactional Single Apply (MAX_MUTATIONS_PER_PREVIEW = 1)
  → Structural verification
  → Family verification (trim: compositor+audio; zoom/crop/speed: editVerify + native compositor)
  → ACCEPT or ROLLBACK
```

## Allowlist (V1 production)

- `addTrim`
- `addZoom` / `setZoom`
- `setClipCrop`
- `addSpeed` / `setSpeed`
- `enableCaptions` (settings-only; derived cues from transcript SSOT)

Unsupported tools fail closed. Loudness stays on its own settings-patch consent path.
Legacy `generateCaptions` annotation writer: DEPRECATE_LATER.

## Hard limits

- Proposal creation ≠ consent.
- Consent ≠ permission for additional edits / different operation.
- Tool success ≠ editorial quality success.
- At most one mutation per preview session.
- Zero additional orchestration LLM calls.
- Injected compositor frames cannot produce LIVE_VERIFIED / production authoritative proof.
- Fail closed on stale proposals / missing landing / invalid args / native compositor unavailable.

## Transaction decision

**A — full `AxcutDocument` snapshot** via `structuredClone` immediately before mutation.
Rollback restores the snapshot and re-fingerprints to prove restoration.

One orchestrator: `runConsentedApplyPreview` (no separate zoom/crop/speed pipelines).

## Non-goals

- Autonomous editing, multi-edit, captions, transitions, denoise, stabilization
- Automatic post-edit repair / regenerating proposal args inside execution
- Subjective quality claims
