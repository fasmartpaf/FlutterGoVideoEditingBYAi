# UI Consent Surface V1

Identity: `CURRENT_OPENSCREEN_UI_CONSENT_V1`

Human review for **one** grounded edit proposal. Calls existing Apply Preview APIs.

## Rules

- Only `proposal_ready` + eligible preflight → Apply
- React never calls `executeAgentTool`
- Consent mint + `runConsentedApplyPreview` on main process
- 0 additional LLM calls for copy / consent
- Max one mutation; stop after success

## Non-goals

Multi-edit, batch consent, autonomy, auto-repair, crossfades, zoom/crop/speed execution.
