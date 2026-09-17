# Editorial Recommendation Product Surface V1

Identity: `CURRENT_OPENSCREEN_EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1`

Connects local editorial stack (caption layout, dead-air, orchestration,
temporal context, bounded reasoning) to the **chat product path**:

- Gather local signals from the live document (+ optional ffmpeg dead-air)
- Orchestrate → (optional) temporal store + bounded reasoning
- Convert one READY recommendation into `EditProposalV1` + UI consent card
- Never auto-applies; Apply still requires `runUiConsentedApply` / Apply Preview

Hard constraints: no paid AI in this path, no multi-edit auto-apply, no invented geometry.
