# OpenScreen — AI Product Inspection Report

**Date:** 2026-09-08  
**Repo inspected:** local clone of OpenScreen (Electron + React + TypeScript + Pixi.js + Rust compositor)  
**App version in tree:** 1.10.0  
**Purpose of this report:** baseline for planning an AI-first product direction (“user prompts like Cursor; agent performs the edits”). Intended to be shared with multiple AI advisors (Cursor / ChatGPT / others) so they work from the same facts.

---

## 1. Executive summary

OpenScreen is a **real, working open-source screen recorder + demo editor**, not a toy. Capture, timeline editing, on-device captions, GPU export, and an optional AI chat agent all exist in code.

It is **not** yet a Cursor-like product. Today the AI is a **BYOK co-pilot inside Studio**: the user still opens the app, configures a provider, and often finishes work manually. The agent can change the project document through validated tools, but it cannot fully own “prompt → finished video” for most real workflows.

**Honest maturity label:** mid-stage **assistant**, not an autonomous **editor-agent product**.

**Recommended strategy (reconciled with external review):** do **not** aim for an agent that can do everything first. Keep the document model + validated tools + compositor. Prove **one valuable editing job** end-to-end on one OS with existing footage, then expand. Manual controls stay available for corrections. Hosted billing / paid tiers stay **out of scope** for this repo’s plan (Option A / technical Option C without a commercial fork decision).

---

## 2. What the product is today (plain language)

```
Record (native OS helper)
  → Project file (.openscreen JSON) + media on disk
  → Edit (manual UI and/or AI tools mutate the same document)
  → Export (Rust compositor → MP4/GIF)
```

| Layer | Role |
|---|---|
| HUD | Record / stop / source / mic / webcam |
| Studio editor | Timeline, preview, transcript, chat, export |
| `AxcutDocument` | Single source of truth for the edit |
| Native capture helpers | Actually record screen (macOS SCK / Windows WGC / Linux PipeWire) |
| Rust compositor | Preview frames + final export (same pipeline) |
| AI chat | Optional: LLM calls fixed tools that mutate the document |

Upstream charter (important for product strategy):
- **100% free forever**, MIT, **no paywalls / premium tiers**
- AI is **opt-in BYOK** (bring your own key) or local CLI agents
- Explicitly **not production-grade** yet; rough edges expected
- North star in ROADMAP: **Record → Edit → Export**, with AI as an **optional** sidekick — not the only path

---

## 3. What already works well (keep / build on)

1. **Document-centric architecture** — One Zod-validated `AxcutDocument`; UI, preview, export, and agent all project from it. This is the correct foundation for an AI editor (same idea as Cursor editing a codebase via tools, not free-writing binary state).
2. **Model never free-writes JSON** — Agent may only call a fixed tool schema; args validated with Zod. Bad model output fails cleanly instead of corrupting the project.
3. **On-device Whisper transcription** — Offline, privacy-preserving; transcript-driven cutting exists in the UI.
4. **Cross-platform capture + shared compositor** — Serious engineering; Metal / D3D11 / Vulkan paths exist.
5. **CLI + in-app CLI bridge** — Headless `openscreen record|captions|export` and agent tools that can spawn those operations.
6. **Local CLI chat** — Can drive Claude Code / Codex / Cursor Agent / Gemini / Ollama without an OpenScreen-hosted model.
7. **Strong unit tests on the tool executor** — Large `agent-tools` test surface; workbench scenarios exist (but not enforced in CI).

---

## 4. Gap analysis vs “Cursor for video” vision

User vision: *User arrives, writes a prompt; agent performs exactly what they asked; no manual timeline editing required.*

| Requirement for that vision | Current state | Severity |
|---|---|---|
| Agent can do everything the manual editor can | Tools cover cuts/zooms/speed/annotations/camera/audio/aspect/background + record/captions/export; **missing** import-from-disk, asset delete, caption styling/translation-as-tools, cursor/webcam/look settings, many polish ops | **Blocker** |
| Agent can “see” the video (vision) | Cloud models mostly get **transcript + document + cursor JSON**. Prompt still talks about frames; real vision mostly limited to local-CLI file access | **Blocker** |
| Durable chat / project memory | Chat sessions + checkpoints live in **process memory only**; restart loses conversation and restore points | **Blocker** |
| Whole-turn undo of agent edits | **Exists in-session:** pre-turn checkpoint + `rewindToMessage` (UI rewind control, covered by unit tests + manual e2e checklist). Gap is **persist + verify**, not invent from scratch | **High** (persistence), not a greenfield build |
| Prompt-only full product loop | Not required for v1. Narrower first promise: polish **existing** narrated footage → export | **Deferred** |
| One-turn consent / safe autonomy | `allowAgentEdits` is coarse (settings toggle); no “approve this turn” | **Medium** for v1 (manual UI remains escape hatch) |
| Reliable long sessions | History capped (~20 msgs); transcript to model uncapped; agent recursion limit very high; weak abort/timeout on product path | **High** |
| Quality gate for agent behavior | Workbench exists but **not in CI**; Playwright cannot judge edit quality on real footage | **High** |
| Consumer onboarding without BYOK friction | ChatGPT/Copilot OAuth removed; user must paste keys or install a local agent CLI | **Medium** |
| Headless vs Studio tool parity | Way-1 / `npm run agent` JSON ops are a **subset** of in-app tools — two edit surfaces to maintain | **High** |
| Product charter vs commercial hosted AI | Free forever + BYOK blocks hosted billing / “AI Pro” without an intentional charter fork | **Business blocker** |

---

## 5. Agent capability inventory (today)

### Can do (via tools)
- Read document / transcript / cursor track
- Trims, clip range/crop/move/add/remove, replace timeline
- Zooms, speed ramps, text annotations, camera fullscreen
- Overlay audio (existing audio assets), set word caption text
- Set aspect ratio / background
- Process: list sources, record screen, generate captions, export project

### Cannot do (or only poorly)
- Import media from arbitrary disk paths as a first-class agent action
- Delete assets / recordings
- True word-level media surgery the way the transcript UI can (agent told to use trims; `setWordText` is label-only)
- Caption style / layout / translation inside the agent tool loop
- Cursor theme/size/smoothing/click FX, motion blur, webcam layout/mask as first-class tools
- “One-click cleanup” (filler words, studio sound) — roadmap still open
- Transitions, templates, brand kits, TTS, CTAs — explicitly out of scope in system prompt

---

## 6. Architecture facts multi-AI planning must respect

Settled decisions (do not casually overturn without evidence):

1. **One document is SSOT** (`AxcutDocument`).
2. **Model never free-writes the document** — tools only.
3. **Modifiers are clip-anchored**, timeline clips contiguous.
4. **Native helpers own capture**; Electron owns orchestration.
5. **Preview and export share one compositor**.
6. **Whisper is local and ungated**; LLM is opt-in.
7. **Credentials in OS `safeStorage`**, not plaintext.
8. **One package / one repo** — no sidecar Python/Fastify server (previously removed).

Key code areas:
- Agent tools: `electron/ai-edition/agent-tools.ts`
- Chat / checkpoints: `electron/ai-edition/chat-service.ts`
- Deep agent + system prompt: `electron/ai-edition/deep-agent/`
- Document schema/store: `src/lib/ai-edition/`
- CLI bridge: `electron/cli/inAppCliEngine.ts`
- Docs: `technical-documentation/architecture/ai-agent.md`, `llm-providers.md`, `document-model.md`, `ROADMAP.md`, `AGENTS.md`

---

## 7. Stability gaps (non-AI, still matter for “solid product”)

From ROADMAP / open issues (illustrative, not exhaustive):
- macOS crash after stop recording (#21)
- macOS cursor offset in window capture (#22)
- Linux preview / export edge cases (#8, #19)
- Linux export still software-encoded (slower)
- Performance measurements thin (mostly one weak iGPU laptop)

An AI-first UX on top of unreliable capture/export will feel broken no matter how smart the agent is. **Stability is part of the AI product.**

---

## 8. Strategic options (settled for now)

| Option | Decision |
|---|---|
| **A — Stay within project rules** | **Adopted.** Free forever, BYOK / local providers, no paywalls in the implementation plan. |
| **B — Commercial hosted fork** | **Out of scope** for current work. Revisit only as an explicit product decision later. |
| **C — Technical sequence** | **Adopt the engineering order** (baseline → sessions → workflow tools → eval → vision → chat-first UX) **without** requiring a commercial fork. |

---

## 9. Reconciled v1 plan (Cursor + external review)

### v1 product promise (narrow)

> Take an **existing narrated screen recording**, remove long pauses, add captions and cursor-guided zooms, then export a polished MP4—with a **clear way to undo** the changes.

Constraints for v1:
- **One target OS** (recommend: macOS on this machine)
- **Existing footage** (no “agent records for you” requirement yet)
- **One supported AI provider** (pick and stick; BYOK)
- **Manual timeline remains** as the escape hatch for corrections
- Timelines are **estimates**, not commitments — native media issues can dominate

### Ordered work (do in this sequence)

1. **Establish a baseline**  
   Run several real recordings through: import → manual edit smoke → save → reopen → export. Log what actually breaks on *this* machine. Do **not** treat ROADMAP/issue numbers as live bugs until re-verified.

2. **Make sessions dependable**  
   Persist chat sessions + checkpoints to disk.  
   **Verify** (not rebuild) existing whole-turn rewind (`rewindToMessage` / UI rewind control).  
   Verify cancellation, failure recovery, and that rewind still works after restart once persistence lands.

3. **Complete only workflow-necessary tools**  
   Enough for: import existing recording, pause/silence removal, captions, cursor-guided zooms, export.  
   Do **not** expose every editor setting before the workflow is proven.

4. **Evaluate results on a fixed set**  
   Metrics: speech preserved (don’t cut words), caption timing, zoom placement usefulness, export success rate. Same golden recordings every run.

5. **Add visual understanding when needed**  
   Frame/vision only when transcript + cursor data are not enough to know what is on screen. Not a v1 blocker for the pause/caption/zoom workflow.

6. **Make chat the primary interface**  
   Only after the workflow succeeds consistently. Chat-first UX is a reward for reliability, not the starting point.

### Corrections to the original Cursor draft

| Original claim | Correction |
|---|---|
| Build whole-turn undo | **Wrong emphasis.** Checkpoint + rewind already exist in-session; persist and verify them. |
| Tool completeness = full editor parity first | **Too wide.** Workflow-specific tools only for v1. |
| Platform bugs from ROADMAP as current facts | **Unverified.** Re-check on target OS before scheduling fixes. |
| Phase timelines as soft commitments | **Estimates only.** Native/media can slip the schedule. |
| Decide commercial fork early | **Unnecessary for this plan.** Stay on Option A. |
| Vision before proving the workflow | **Deferred.** Transcript + cursor can carry the first promise. |

---

## 10. Risks and anti-patterns

| Risk | Why it hurts |
|---|---|
| Rewriting the editor from scratch | Throws away the strongest asset (document + tools + compositor) |
| Letting the model emit raw `.openscreen` JSON | Guaranteed corruption; upstream already rejected this |
| Building chat-first UX before the workflow is reliable | Pretty empty state over a flaky agent |
| Full editor tool parity before one finished job | Scope explosion; never ships a credible demo |
| Treating roadmap issues as live without re-verify | Fixing ghosts / missing real local breakage |
| AI features before baseline import/save/export works on target OS | Users blame “AI” for platform bugs |
| Planning monetization inside this repo’s constraints | Conflicts with AGENTS.md / ROADMAP — keep it out |

---

## 11. Open decisions before code (small list)

1. Confirm **macOS** as the sole v1 target OS.
2. Pick **one** AI provider for the eval loop (e.g. Anthropic or OpenAI or local-cli).
3. Collect / record **3–5 golden narrated screen recordings** for the eval set.
4. Agree: **no code** until baseline (step 1) is run and logged.

---

## 12. Bottom line (reconciled)

- Keep document + tools + compositor.
- **Disagree with original Cursor scope:** do not aim for “agent can do everything” first.
- **Agree with external review:** prove one valuable job — pause removal + captions + cursor zooms + export + undo — then expand.
- Persistence of sessions/checkpoints is the real memory gap; whole-turn rewind already exists in-session.
- Commercial fork / hosted billing stays out of the implementation plan.
- Next action: **baseline on this Mac**, then persist sessions — not a greenfield AI rewrite.

---

*v1 of this report: codebase inspection. Updated after independent external review to narrow scope and correct undo/persistence emphasis. Code remains the authority if docs and tree disagree.*

