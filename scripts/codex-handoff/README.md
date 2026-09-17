# Codex handoff — optional notes only

The Cursor stop hook (`.cursor/hooks/notify-codex-review.sh`) prefers
`/Applications/ChatGPT.app/Contents/Resources/codex`.

**Do not install another local Codex CLI for this handoff.**  
Do not `npm install` here to “fix” delivery. Repo-local
`node_modules/@openai/codex` paths are ignored by the hook.

When Cursor’s sandbox mounts `~/.codex` read-only, `codex queue` cannot
initialize its sqlite DB. That is expected:

- delivery status → `PENDING_RETRY` (not delivered; retryable)
- artifact: `electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/codex-handoff/delivery-status.json`
- fallback: active **Work five-minute heartbeat** (no instant-handoff claim)

If you previously installed `@openai/codex` under this directory for experiments,
you may delete `node_modules/` — the handoff hook does not use it.
