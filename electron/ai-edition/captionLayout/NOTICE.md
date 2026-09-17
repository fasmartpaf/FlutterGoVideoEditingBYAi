# Local Caption Layout + Safe Areas V1

Identity: `CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1`

Deterministic TRANSCRIPT → grouping → line break → safe placement → collision →
scene-ready cues → optional native verify.

- Transcript text is authoritative (no LLM rewrite).
- Does not replace `src/lib/ai-edition/captions/` product path; adds layout analysis,
  collision / safe-area policy, reviewable proposal, and verification.
- Does not force captions through Apply Preview allowlist.
- Apply path (if used): consent → `patchCaptionSettings({ enabled: true })` only —
  never mutates user-edited annotation text.
- TOTAL_PAID_AI_CALLS = 0.

Non-goals: AI rewrite, translation, TTS, karaoke animation, multi-edit autonomy.
