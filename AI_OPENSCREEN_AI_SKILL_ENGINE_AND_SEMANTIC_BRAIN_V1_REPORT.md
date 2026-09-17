# AI_OPENSCREEN_AI_SKILL_ENGINE_AND_SEMANTIC_BRAIN_V1_REPORT

**Milestone:** `OPENSCREEN_AI_SKILL_ENGINE_AND_SEMANTIC_BRAIN_V1` (late-seed onset retarget)  
**Date:** 2026-09-17  
**Repo:** `/Users/osama/Documents/GitHub/FlutterGoVideoEditingBYAi`  
**HARD STOP** after this report. Independent Codex/Work review only. **No Phase 3.** Frozen skill executors not rewritten.

---

## Overall verdict: **PARTIAL**

| Gate | Verdict | Basis |
|------|---------|--------|
| Live Chat WHERE failure (Connect landing) | **FAIL observed → fixed in code** | Pre-fix Chat NOT_FOUND; root cause confirmed |
| Late-seed onset retarget | **PASS** (injected on real project file) | `semanticOnsetRetargetV1.test.ts` |
| Prior V1 unit/injected suites | **PASS** | 13 files / 77 tests |
| Live desktop Chat retest (advisory→yes→stronger) | **SKIP** | No computer-use MCP this session; prior Send approval rejected; no bypass |
| Captions named-event | **UNSUPPORTED in V1** | Unchanged |
| Gate 0 raw `target.type` | **PARTIAL** | Unchanged |
| Codex stop-hook | **PENDING_RETRY** | Unchanged |

---

## Live failure (independent observation — not PASS)

**Project:** `proj_codex_landing_qa_20260917` · media `recording-1789588079993.mp4` · provider `openai/gpt-4o`

**User:** advice-only — whether switch to Connect landing page should stand out.

**UI output (chat session):**
> I couldn't identify “The moment of switching to the Connect landing page” as a confirmed on-screen appearance. Speech mentions something similar around 15s and 15s — that is spoken evidence only, not visual event identity. I observed pixel/activity changes near 15s and 22s, but that does not identify the requested on-screen event. Evidence status: candidate too late vs earlier onset. … (4 candidates checked; 1 later candidates skipped under vision cost budget.)

**Document:** `zoomRanges.length === 0` (confirmed on saved `.openscreen`).

**Independent scrub:** App Store Connect still visible @ **13.6s**; Connect landing visibly present by **14.4s**.

---

## Root cause (exact)

1. `verifyRequestedEventIdentity` lookback from a late preliminary candidate (speech/visual ~15s+) **did** build an absent→present bracket and set `earliestProgrammeSec`.
2. When `|candidate − earliest| > adaptiveOnsetMatchToleranceSec`, it returned **`NOT_IDENTIFIED`** with `onset_bound:candidate_too_late` — **discarding the verified first-onset bracket**.
3. `resolveSemanticEditEvent` then had zero `requestedEventIdentified` candidates → **`NOT_FOUND`** with the “candidate too late vs earlier onset” status string.

This is a WHERE bug: the system found first onset evidence, then threw it away because the **search seed** was late — not because presence failed.

---

## Fix (V1)

**`semanticEventIdentity.ts`:** When a clean absent→present bracket exists (recurrence cleared) and the preliminary candidate is later than tolerance, **IDENTIFY and retarget** to `earliestProgrammeSec` with evidence `onset_bound:retargeted_from_late_candidate@…`. Do **not** invent time; do **not** accept speech/pixel-only without the presence bracket.

**`semanticEventResolve.ts`:** When identity returns identified with `earliestProgrammeSec` differing from the seed anchor, **retarget** candidate `anchorSec` / window to that onset before ranking.

Still refused: insufficient bracket, reappearance, absent-at-candidate, speech-only, visual-change-only.

Frozen Zoom/Trim/Speed/Captions/Title/Callout/Transitions executors untouched.

---

## Tests

```text
npx vitest --run \
  electron/ai-edition/localEditorialChat/semanticEventIdentity.test.ts \
  … (prior V1 suites) … \
  electron/ai-edition/localEditorialChat/semanticOnsetRetargetV1.test.ts \
  electron/ai-edition/localEditorialChat/skillRegistryBinding.test.ts
```

**Result: 13 files, 77 passed, 0 failed**

| Suite | Kind | Proof |
|-------|------|--------|
| `semanticOnsetRetargetV1.test.ts` | **injected** on live project copy | Late seed → IDENTIFY @ ~14.4; resolve FOUND; advisory→pending→yes→save/reopen→stronger; absent refuse; original file untouched |
| `semanticEventIdentity.test.ts` | unit | Late seed retargets (was “too late” fail) |
| Prior disposable/held-out suites | injected | Unchanged green |

Artifact: `…/_artifacts/semantic-brain-v1/onset-retarget/onset-retarget-proof.json`  
Isolated copy prepared: `proj_codex_landing_qa_20260917_retest.openscreen` (0 zooms).

---

## Live desktop Chat retest

**SKIP** — cannot drive Electron Chat Send here (computer-use MCP unavailable; prior automatic Send approval rejected for OpenAI video evidence; **no bypass**).

Injected path on the same project file proves the WHERE fix. Product Chat with selected gpt-4o remains **unproven live** until an approved Send retest.

---

## Remaining gaps

1. Approved live Chat on `proj_codex_landing_qa_20260917_retest`: advisory → yes → stronger → save/reopen → absent refusal.  
2. Observed raw provider `target.type` on next validation failure.  
3. Phase 3 not started.

---

## HARD STOP

No Phase 3. No next milestone. Overall **PARTIAL** (WHERE retarget **PASS** injected; live Chat **SKIP**; pre-fix live Chat **FAIL** documented).
